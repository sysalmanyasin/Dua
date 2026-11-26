// The calculation engine for ONE sheet, by position. Holds the non-empty cells, the dependency graph and the calculated
// values; recalculates only what a change can affect. No DOM, no network, no sheet ids (domain/formulas/sheetCalc.js maps
// ids to positions).
//
//   const engine = createEngine({ rows, cols, cells: [{ row, col, value, formula }] });
//   engine.get(row, col)         the value to show (null when empty); formulas give their calculated value
//   engine.update(changes)       changes: [{ row, col, value, formula }] (value and formula null = the cell is now empty);
//                                returns [{ row, col }] for every cell whose shown value changed
//   engine.recalculateAll()      from scratch (same answers as update; used by tests as the oracle)
import { colOfKey, keyOf, rowOfKey } from './a1.js';
import { collectDeps, components } from './dependencies.js';
import { evaluate } from './evaluator.js';
import { parseFormula } from './parser.js';
import { ERR, isError } from './values.js';

const same = (a, b) => (isError(a) && isError(b) ? a.error === b.error : a === b);
const PARSE_CACHE_LIMIT = 5000;

export function createEngine({ rows, cols, cells = [] }) {
  const store = new Map(); // key -> { value, formula }: every non-empty cell
  const formulas = new Map(); // key -> { ast | null, cells: [key], ranges: [{ r1, c1, r2, c2 }] }
  const rev = new Map(); // key -> Set(formula keys that read that single cell)
  const rangeOwners = new Map(); // formula key -> ranges it reads
  const values = new Map(); // formula key -> calculated value
  const parseCache = new Map();
  const stats = { evaluations: 0 };

  const inSheet = (row, col) => Number.isInteger(row) && Number.isInteger(col) && row >= 0 && col >= 0 && row < rows && col < cols;

  function parsed(text) {
    let p = parseCache.get(text);
    if (!p) {
      const r = parseFormula(text);
      p = r.ok ? { ast: r.ast, deps: collectDeps(r.ast) } : { ast: null, deps: { cells: [], ranges: [] } };
      if (parseCache.size >= PARSE_CACHE_LIMIT) parseCache.clear();
      parseCache.set(text, p);
    }
    return p;
  }

  function unlink(key) {
    const rec = formulas.get(key);
    if (!rec) return;
    for (const dep of rec.cells) {
      const set = rev.get(dep);
      if (set) {
        set.delete(key);
        if (set.size === 0) rev.delete(dep);
      }
    }
    rangeOwners.delete(key);
    formulas.delete(key);
    values.delete(key);
  }

  function link(key, text) {
    const p = parsed(text);
    const depKeys = [...new Set(p.deps.cells.filter((c) => inSheet(c.row, c.col)).map((c) => keyOf(c.row, c.col)))];
    const ranges = p.deps.ranges.filter((r) => inSheet(r.r1, r.c1)); // a range that starts outside the sheet is #REF!
    formulas.set(key, { ast: p.ast, cells: depKeys, ranges });
    for (const dep of depKeys) {
      let set = rev.get(dep);
      if (!set) rev.set(dep, (set = new Set()));
      set.add(key);
    }
    if (ranges.length) rangeOwners.set(key, ranges);
  }

  function put(row, col, value, formula) {
    const key = keyOf(row, col);
    unlink(key);
    const hasFormula = typeof formula === 'string';
    const hasValue = value !== null && value !== undefined;
    if (!hasFormula && !hasValue) {
      store.delete(key);
      return key;
    }
    store.set(key, { value: hasFormula ? null : value, formula: hasFormula ? formula : null });
    if (hasFormula) link(key, formula);
    return key;
  }

  const shown = (key) => {
    if (formulas.has(key)) return values.has(key) ? values.get(key) : 0;
    const c = store.get(key);
    return c ? c.value : null;
  };

  const ctx = {
    rows,
    cols,
    value: (row, col) => shown(keyOf(row, col)),
    eachInRange(r1, c1, r2, c2, fn) {
      const area = (r2 - r1 + 1) * (c2 - c1 + 1);
      if (area <= store.size) {
        for (let r = r1; r <= r2; r += 1) {
          for (let c = c1; c <= c2; c += 1) {
            const v = shown(keyOf(r, c));
            if (v !== null && v !== undefined && fn(v) === true) return;
          }
        }
        return;
      }
      const hit = [];
      for (const key of store.keys()) {
        const r = rowOfKey(key);
        const c = colOfKey(key);
        if (r >= r1 && r <= r2 && c >= c1 && c <= c2) hit.push(key);
      }
      hit.sort((a, b) => a - b); // numeric key order is row order
      for (const key of hit) {
        const v = shown(key);
        if (v !== null && v !== undefined && fn(v) === true) return;
      }
    },
  };

  function dependentsOf(key) {
    const out = [...(rev.get(key) ?? [])];
    const r = rowOfKey(key);
    const c = colOfKey(key);
    for (const [owner, ranges] of rangeOwners) {
      for (const g of ranges) {
        if (r >= g.r1 && r <= g.r2 && c >= g.c1 && c <= g.c2) {
          out.push(owner);
          break;
        }
      }
    }
    return out;
  }

  // The formula cells (among `set`) that formula `key` reads, for ordering and cycle detection.
  function readsWithin(key, set) {
    const rec = formulas.get(key);
    const out = [];
    for (const dep of rec.cells) if (set.has(dep)) out.push(dep);
    for (const g of rec.ranges) {
      const area = (g.r2 - g.r1 + 1) * (g.c2 - g.c1 + 1);
      if (area <= set.size) {
        for (let r = g.r1; r <= g.r2; r += 1) for (let c = g.c1; c <= g.c2; c += 1) if (set.has(keyOf(r, c))) out.push(keyOf(r, c));
      } else {
        for (const k of set) {
          const r = rowOfKey(k);
          const c = colOfKey(k);
          if (r >= g.r1 && r <= g.r2 && c >= g.c1 && c <= g.c2) out.push(k);
        }
      }
    }
    return out;
  }

  // The keys of `dirty` and everything that can depend on them, by the graph as it is now.
  function closure(dirty) {
    const affected = new Set(dirty);
    const queue = [...dirty];
    while (queue.length) {
      const k = queue.pop();
      for (const d of dependentsOf(k)) {
        if (!affected.has(d)) {
          affected.add(d);
          queue.push(d);
        }
      }
    }
    return affected;
  }

  // Recalculate `dirty` cells and everything that depends on them. `before` maps every cell that might change to what it
  // showed before this call; the result is the positions whose shown value is now different.
  function recompute(dirty, before) {
    const affected = closure(dirty);
    const formulaKeys = new Set([...affected].filter((k) => formulas.has(k)));
    const adjacency = new Map();
    for (const k of formulaKeys) adjacency.set(k, readsWithin(k, formulaKeys));
    for (const comp of components(formulaKeys, adjacency)) {
      if (comp.cyclic) {
        for (const k of comp.nodes) values.set(k, ERR.CIRC);
        continue;
      }
      const k = comp.nodes[0];
      const rec = formulas.get(k);
      stats.evaluations += 1;
      values.set(k, rec.ast ? evaluate(rec.ast, ctx) : ERR.NAME);
    }
    const changed = [];
    for (const k of affected) {
      if (!same(before.get(k), shown(k))) changed.push({ row: rowOfKey(k), col: colOfKey(k) });
    }
    return changed;
  }

  for (const c of cells) if (inSheet(c.row, c.col)) put(c.row, c.col, c.value, c.formula);

  const api = {
    rows,
    cols,
    stats,
    get: (row, col) => (inSheet(row, col) ? shown(keyOf(row, col)) : null),
    isFormula: (row, col) => formulas.has(keyOf(row, col)),
    formulaText: (row, col) => store.get(keyOf(row, col))?.formula ?? null,
    update(changes) {
      const before = new Map(); // what each cell showed before this call (captured once, before anything changes)
      const remember = (k) => {
        if (!before.has(k)) before.set(k, shown(k));
      };
      const dirty = new Set();
      for (const ch of changes) if (inSheet(ch.row, ch.col)) dirty.add(keyOf(ch.row, ch.col));
      // Editing a cell changes only what THAT cell reads, never who reads it, so the cells that can be affected (the edited
      // cells and everything that depends on them) are the same before and after the edit.
      for (const k of closure(dirty)) remember(k);
      for (const ch of changes) if (inSheet(ch.row, ch.col)) put(ch.row, ch.col, ch.value, ch.formula);
      return recompute(dirty, before);
    },
    recalculateAll() {
      const before = new Map();
      for (const k of formulas.keys()) before.set(k, shown(k));
      values.clear();
      return recompute(new Set(formulas.keys()), before);
    },
  };
  api.recalculateAll();
  return api;
}
