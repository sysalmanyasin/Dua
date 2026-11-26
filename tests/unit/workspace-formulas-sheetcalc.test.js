import { describe, expect, it } from 'vitest';
import { rewriteForDelete, rewriteForInsert } from '../../js/modules/workspace/domain/formulas/rewrite.js';
import { createSheetCalc } from '../../js/modules/workspace/domain/formulas/sheetCalc.js';
import { applyOps, buildOp, createWorkbook, findSheet, newIds } from '../../js/modules/workspace/domain/spreadsheet.js';
import { describeCell, displayCell } from '../../js/modules/workspace/domain/grid.js';

const SHEET = '0a000000-0000-4000-8000-0000000000e1';

function sheetWith(cells) {
  const wb = createWorkbook();
  applyOps(wb, [buildOp('add_sheet', { sheet_id: SHEET, name: 'S' })]);
  applyOps(wb, [buildOp('set_cells', { sheet_id: SHEET, base_seq: wb.head_seq, cells })]);
  return { wb, sheet: findSheet(wb, SHEET) };
}
const run = (wb, op) => {
  const r = applyOps(wb, [op]);
  expect(r.results[0].status, JSON.stringify(r.results[0])).toBe('applied');
};

describe('mapping a sheet to the engine', () => {
  it('reads values and formulas by id, whatever order the rows are in', () => {
    const { wb, sheet } = sheetWith([
      { r: 1, c: 1, value: 4 },
      { r: 2, c: 1, value: 5 },
      { r: 3, c: 1, formula: '=A1+A2' },
    ]);
    const calc = createSheetCalc(sheet);
    expect(calc.get(3, 1)).toBe(9);
    expect(calc.isFormula(3, 1)).toBe(true);
    expect(calc.isFormula(1, 1)).toBe(false);
    // insert two rows after row 1: ids are new, positions move, the formula is rewritten by the caller
    const ids = newIds(2, new Set(sheet.row_order));
    run(wb, buildOp('insert_rows', { sheet_id: SHEET, after: 1, ids }));
    expect(sheet.row_order.slice(0, 5)).toEqual([1, ids[0], ids[1], 2, 3]);
    // the formula text is still =A1+A2, and A2 is now one of the new empty rows: 4 + 0
    expect(createSheetCalc(sheet).get(3, 1)).toBe(4);
    expect(createSheetCalc(sheet).get(2, 1)).toBe(5); // the cell itself kept its id and its value
  });

  it('ignores style-only cells, cells of deleted rows and unknown ids', () => {
    const { wb, sheet } = sheetWith([
      { r: 1, c: 1, value: 1 },
      { r: 2, c: 2, formula: '=SUM(A1:A5)' },
      { r: 4, c: 1, value: 10 },
    ]);
    run(wb, buildOp('delete_rows', { sheet_id: SHEET, ids: [4] }));
    const calc = createSheetCalc(sheet);
    expect(calc.get(4, 1)).toBeNull(); // a deleted row
    expect(calc.get(99999, 1)).toBeNull(); // unknown id
    expect(calc.get(1, 99999)).toBeNull();
    expect(calc.isFormula(99999, 1)).toBe(false);
    expect(calc.get(2, 2)).toBe(1); // 10 was in the deleted row: gone from the sum
  });

  it('copes with an empty sheet and with a sheet at the largest size', () => {
    const { sheet } = sheetWith([]);
    expect(createSheetCalc(sheet).get(1, 1)).toBeNull();
    const big = {
      row_order: Array.from({ length: 12000 }, (_, i) => i + 1),
      col_order: Array.from({ length: 130 }, (_, i) => i + 1),
      cells: new Map(),
    };
    big.cells.set('1:1', { r: 1, c: 1, value: 3, formula: null });
    big.cells.set('1:2', { r: 1, c: 2, value: null, formula: '=A1*2' });
    big.cells.set('1:101', { r: 1, c: 101, value: 9, formula: null }); // beyond column CV: not part of any sheet
    const calc = createSheetCalc(big);
    expect(calc.get(1, 2)).toBe(6);
    expect(calc.get(1, 101)).toBeNull();
  });
});

// A sheet with data in A to C and formulas in D and E; then real structure operations plus the rewrite.
function prng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const L = 'ABC';
function randomCells(rnd, rows = 15, readRows = rows, formulaRows = rows) {
  const cells = [];
  for (let r = 1; r <= rows; r += 1)
    for (let c = 1; c <= 3; c += 1) if (rnd() < 0.8) cells.push({ r, c, value: Math.floor(rnd() * 90) + 1 });
  const ref = () => `${L[Math.floor(rnd() * 3)]}${1 + Math.floor(rnd() * readRows)}`;
  const rng = () => `${ref()}:${ref()}`;
  const kinds = [
    () => `=${ref()}*${ref()}`,
    () => `=SUM(${rng()})`,
    () => `=MAX(${rng()},${ref()})`,
    () => `=COUNT(${rng()})`,
    () => `=IF(${ref()}>40,${ref()},0)`,
  ];
  for (let r = 1; r <= formulaRows; r += 1)
    for (const c of [4, 5]) if (rnd() < 0.7) cells.push({ r, c, formula: kinds[Math.floor(rnd() * kinds.length)]() });
  return cells;
}
const snapshot = (sheet, calc) => {
  const out = new Map();
  for (const r of sheet.row_order) for (let c = 1; c <= 5; c += 1) out.set(`${r}:${c}`, calc.get(r, c));
  return out;
};
const sameValue = (a, b) => (a && b && typeof a === 'object' && typeof b === 'object' ? a.error === b.error : a === b);

describe('structure changes keep every number (rows are matched by their stable id)', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    it(`inserting rows, seed ${seed}`, () => {
      const rnd = prng(seed);
      for (let round = 0; round < 15; round += 1) {
        const { wb, sheet } = sheetWith(randomCells(rnd));
        const before = snapshot(sheet, createSheetCalc(sheet));
        const after = Math.floor(rnd() * 14) + 1; // insert after this row id
        const ids = newIds(1 + Math.floor(rnd() * 3), new Set(sheet.row_order));
        const at = sheet.row_order.indexOf(after) + 1;
        run(wb, buildOp('insert_rows', { sheet_id: SHEET, after, ids }));
        // the browser rewrites every formula text for the new positions and stores it
        const rewrites = [...sheet.cells.values()]
          .filter((c) => c.formula)
          .map((c) => ({ r: c.r, c: c.c, formula: rewriteForInsert(c.formula, 'row', at, ids.length) }));
        const changed = rewrites.filter((x) => x.formula !== sheet.cells.get(`${x.r}:${x.c}`).formula);
        if (changed.length) run(wb, buildOp('set_cells', { sheet_id: SHEET, base_seq: wb.head_seq, cells: changed }));
        const now = snapshot(sheet, createSheetCalc(sheet));
        for (const [key, v] of before)
          expect(
            sameValue(v, now.get(key)),
            `seed ${seed} round ${round} ${key}: ${JSON.stringify(v)} vs ${JSON.stringify(now.get(key))}`,
          ).toBe(true);
      }
    });
  }

  it('without the rewrite the numbers change (so the rewrite is doing real work)', () => {
    const { wb, sheet } = sheetWith([
      { r: 1, c: 1, value: 4 },
      { r: 2, c: 1, value: 5 },
      { r: 3, c: 1, formula: '=A1+A2' },
    ]);
    expect(createSheetCalc(sheet).get(3, 1)).toBe(9);
    run(wb, buildOp('insert_rows', { sheet_id: SHEET, after: 1, ids: newIds(1, new Set(sheet.row_order)) }));
    expect(createSheetCalc(sheet).get(3, 1)).toBe(4); // =A1+A2 now reads the new empty row
    const text = rewriteForInsert('=A1+A2', 'row', 1, 1);
    expect(text).toBe('=A1+A3');
    run(wb, buildOp('set_cells', { sheet_id: SHEET, base_seq: wb.head_seq, cells: [{ r: 3, c: 1, formula: text }] }));
    expect(createSheetCalc(sheet).get(3, 1)).toBe(9);
  });

  for (const seed of [11, 12, 13]) {
    it(`deleting rows nothing reads, seed ${seed}`, () => {
      const rnd = prng(seed);
      let checked = 0;
      for (let round = 0; round < 25; round += 1) {
        const { wb, sheet } = sheetWith(randomCells(rnd, 15, 10, 10)); // formulas read and sit in rows 1 to 10 only
        const read = new Set();
        for (const c of sheet.cells.values()) {
          if (!c.formula) continue;
          for (const m of c.formula.matchAll(/([A-C])(\d+):?([A-C]\d+)?/g)) {
            const a = Number(m[2]);
            const b = m[3] ? Number(m[3].slice(1)) : a;
            for (let r = Math.min(a, b); r <= Math.max(a, b); r += 1) read.add(r);
          }
        }
        const free = sheet.row_order.filter(
          (id) => id <= 15 && !read.has(id) && ![...sheet.cells.values()].some((c) => c.r === id && c.formula),
        );
        const gone = free.filter(() => rnd() < 0.5).slice(0, 4);
        if (gone.length === 0) continue;
        checked += 1;
        const before = snapshot(sheet, createSheetCalc(sheet));
        const positions = gone.map((id) => sheet.row_order.indexOf(id));
        const rewrites = [...sheet.cells.values()]
          .filter((c) => c.formula && !gone.includes(c.r))
          .map((c) => ({ r: c.r, c: c.c, formula: rewriteForDelete(c.formula, 'row', positions) }));
        run(wb, buildOp('delete_rows', { sheet_id: SHEET, ids: gone }));
        const changed = rewrites.filter((x) => x.formula !== sheet.cells.get(`${x.r}:${x.c}`)?.formula);
        if (changed.length) run(wb, buildOp('set_cells', { sheet_id: SHEET, base_seq: wb.head_seq, cells: changed }));
        const now = snapshot(sheet, createSheetCalc(sheet));
        for (const [key, v] of now) expect(sameValue(before.get(key), v), `seed ${seed} round ${round} ${key}`).toBe(true);
      }
      expect(checked).toBeGreaterThan(3);
    });
  }
});

describe('showing results in the grid', () => {
  const cell = (value, formula = null) => ({ value, formula, style_id: null, last_seq: 1 });

  it('a formula cell shows its calculated result with the number format, errors as text, and without a calculator its formula text', () => {
    const f = cell(null, '=A1*2');
    expect(displayCell(f, { numfmt: { type: 'currency', currency: 'PKR' } }, 3000)).toEqual({ text: 'PKR 3,000.00', kind: 'number' });
    expect(displayCell(f, {}, 'hello')).toEqual({ text: 'hello', kind: 'text' });
    expect(displayCell(f, {}, true)).toEqual({ text: 'TRUE', kind: 'boolean' });
    expect(displayCell(f, {}, { error: '#DIV/0!' })).toEqual({ text: '#DIV/0!', kind: 'error' });
    expect(displayCell(f, {}, null)).toEqual({ text: '', kind: 'empty' });
    expect(displayCell(f, {})).toEqual({ text: '=A1*2', kind: 'formula' });
    expect(displayCell(cell(7), {}, 99)).toEqual({ text: '7', kind: 'number' }); // a computed value never overrides a constant
  });

  it('describeCell asks the calculator only for formula cells', () => {
    const asked = [];
    const calc = { get: (r, c) => (asked.push(`${r}:${c}`), 42) };
    const sheet = {
      cells: new Map([
        ['1:1', cell(5)],
        ['2:1', cell(null, '=A1')],
      ]),
      styles: new Map(),
    };
    expect(describeCell(sheet, 1, 1, calc).text).toBe('5');
    expect(describeCell(sheet, 2, 1, calc)).toMatchObject({ text: '42', kind: 'number', formula: '=A1', value: null });
    expect(asked).toEqual(['2:1']);
    expect(describeCell(sheet, 2, 1).text).toBe('=A1'); // no calculator: the formula text
  });
});
