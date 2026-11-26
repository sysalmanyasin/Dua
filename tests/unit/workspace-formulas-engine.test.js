import { describe, expect, it } from 'vitest';
import { colLetters } from '../../js/modules/workspace/domain/formulas/a1.js';
import { createEngine } from '../../js/modules/workspace/domain/formulas/engine.js';
import { ERR } from '../../js/modules/workspace/domain/formulas/values.js';

const cell = (row, col, value = null, formula = null) => ({ row, col, value, formula });
const f = (row, col, formula) => cell(row, col, null, formula);
const shownGrid = (engine) => {
  const out = [];
  for (let r = 0; r < engine.rows; r += 1) for (let c = 0; c < engine.cols; c += 1) out.push(engine.get(r, c));
  return out;
};
const same = (a, b) => (a && b && typeof a === 'object' && typeof b === 'object' ? a.error === b.error : a === b);
const pos = (list) => list.map((p) => `${p.row}:${p.col}`).sort();

describe('engine basics', () => {
  it('shows constants as they are, formulas as calculated, and empty cells as null', () => {
    const e = createEngine({ rows: 10, cols: 5, cells: [cell(0, 0, 4), cell(1, 0, 'x'), f(2, 0, '=A1*2'), cell(3, 0, true)] });
    expect([e.get(0, 0), e.get(1, 0), e.get(2, 0), e.get(3, 0), e.get(4, 0)]).toEqual([4, 'x', 8, true, null]);
    expect(e.isFormula(2, 0)).toBe(true);
    expect(e.isFormula(0, 0)).toBe(false);
    expect(e.formulaText(2, 0)).toBe('=A1*2');
    expect(e.formulaText(0, 0)).toBeNull();
  });

  it('a cell with neither value nor formula is empty; a cell outside the sheet is ignored', () => {
    const e = createEngine({ rows: 3, cols: 3, cells: [cell(0, 0, null, null), cell(5, 5, 9), cell(-1, 0, 1), cell(1.5, 0, 1)] });
    expect(shownGrid(e).every((v) => v === null)).toBe(true);
    expect(e.get(5, 5)).toBeNull();
    expect(e.update([cell(9, 9, 1)])).toEqual([]);
  });

  it('a formula is never empty and a formula without = is #NAME?', () => {
    const e = createEngine({ rows: 5, cols: 5, cells: [f(0, 0, '=B1'), f(1, 0, 'A1+1'), f(2, 0, '=')] });
    expect(e.get(0, 0)).toBe(0);
    expect(e.get(1, 0)).toBe(ERR.NAME);
    expect(e.get(2, 0)).toBe(ERR.NAME);
  });

  it('formula text wins when a cell has both (the database never allows both)', () => {
    const e = createEngine({ rows: 5, cols: 5, cells: [cell(0, 0, 99, '=1+1')] });
    expect(e.get(0, 0)).toBe(2);
  });

  it('refers to cells beyond the sheet as #REF!, and ranges that start or end outside as #REF!', () => {
    // the formulas sit in column C, outside the ranges they read
    const e = createEngine({
      rows: 4,
      cols: 3,
      cells: [f(0, 2, '=A5'), f(1, 2, '=SUM(A1:A5)'), f(2, 2, '=SUM(A1:D1)'), f(3, 2, '=SUM(A1:A3)'), cell(0, 0, 1)],
    });
    expect([e.get(0, 2), e.get(1, 2), e.get(2, 2)]).toEqual([ERR.REF, ERR.REF, ERR.REF]);
    expect(e.get(3, 2)).toBe(1); // a range that fits in the sheet is fine
  });

  it('the same formula text in many cells works (parse cache)', () => {
    const cells = [cell(0, 0, 1), cell(1, 0, 2), cell(2, 0, 3)];
    for (let c = 1; c < 5; c += 1) cells.push(f(0, c, '=SUM($A$1:$A$3)'));
    const e = createEngine({ rows: 5, cols: 5, cells });
    expect([1, 2, 3, 4].map((c) => e.get(0, c))).toEqual([6, 6, 6, 6]);
  });
});

describe('update reports exactly what changed on screen', () => {
  const make = () =>
    createEngine({ rows: 10, cols: 5, cells: [cell(0, 0, 1), cell(1, 0, 2), f(2, 0, '=SUM(A1:A2)'), f(3, 0, '=A3*10'), cell(0, 1, 'x')] });

  it('lists the edited cell and what depends on it, not the rest', () => {
    const e = make();
    expect(pos(e.update([cell(0, 0, 5)]))).toEqual(['0:0', '2:0', '3:0']);
    expect([e.get(2, 0), e.get(3, 0)]).toEqual([7, 70]);
  });
  it('leaves out a cell whose shown value ended up the same', () => {
    const e = make();
    expect(e.update([cell(0, 0, 1)])).toEqual([]); // same value written again
    expect(pos(e.update([cell(0, 0, 0), cell(1, 0, 3)]))).toEqual(['0:0', '1:0']); // 0 + 3 = 3 = 1 + 2: the sum does not change
    expect(e.get(2, 0)).toBe(3);
  });
  it('handles a formula turned into a constant, a constant into a formula, and clearing', () => {
    const e = make();
    expect(pos(e.update([cell(2, 0, 100)]))).toEqual(['2:0', '3:0']);
    expect(e.get(3, 0)).toBe(1000);
    expect(e.isFormula(2, 0)).toBe(false);
    e.update([f(2, 0, '=A1+A2')]);
    expect(e.get(2, 0)).toBe(3);
    expect(pos(e.update([cell(2, 0)]))).toEqual(['2:0', '3:0']); // cleared: A4 now multiplies an empty cell
    expect([e.get(2, 0), e.get(3, 0)]).toEqual([null, 0]);
  });
  it('applies several changes at once and reports each cell once', () => {
    const e = make();
    const out = e.update([cell(0, 0, 10), cell(1, 0, 20), cell(0, 1, 'y')]);
    expect(pos(out)).toEqual(['0:0', '0:1', '1:0', '2:0', '3:0']);
    expect(e.get(2, 0)).toBe(30);
  });
  it('the last of two changes to the same cell wins', () => {
    const e = make();
    e.update([cell(0, 0, 100), cell(0, 0, 7)]);
    expect(e.get(0, 0)).toBe(7);
    expect(e.get(2, 0)).toBe(9);
  });
});

describe('only what a change can affect is recalculated', () => {
  const sheet = () => {
    // a chain A2 = A1 + 1, A3 = A2 + 1 ... A6; an unrelated column C; a SUM over A1:A6
    const cells = [cell(0, 0, 1)];
    for (let r = 1; r < 6; r += 1) cells.push(f(r, 0, `=A${r}+1`));
    cells.push(cell(0, 2, 5), f(1, 2, '=C1*2'), f(0, 4, '=SUM(A1:A6)'));
    return createEngine({ rows: 10, cols: 5, cells });
  };
  it('a change in an unrelated cell evaluates nothing else', () => {
    const e = sheet();
    const before = e.stats.evaluations;
    e.update([cell(0, 2, 6)]);
    expect(e.stats.evaluations - before).toBe(1); // only C2
    expect(e.get(1, 2)).toBe(12);
  });
  it('a change at the head of a chain evaluates the chain and the sum, once each', () => {
    const e = sheet();
    const before = e.stats.evaluations;
    e.update([cell(0, 0, 10)]);
    expect(e.stats.evaluations - before).toBe(6); // A2..A6 and E1
    expect(e.get(0, 4)).toBe(10 + 11 + 12 + 13 + 14 + 15);
  });
  it('a change in the middle leaves the head alone', () => {
    const e = sheet();
    const before = e.stats.evaluations;
    e.update([cell(3, 0, 100)]);
    expect(e.stats.evaluations - before).toBe(3); // A5, A6 and E1; A4 became a constant, so it is not evaluated
    expect(e.get(5, 0)).toBe(102);
  });
  it('a change inside a range recalculates its owner; a change outside it does not', () => {
    const e = createEngine({ rows: 20, cols: 5, cells: [cell(0, 0, 1), cell(10, 0, 5), f(0, 1, '=SUM(A1:A5)')] });
    let before = e.stats.evaluations;
    e.update([cell(10, 0, 6)]);
    expect(e.stats.evaluations - before).toBe(0);
    before = e.stats.evaluations;
    e.update([cell(3, 0, 4)]);
    expect(e.stats.evaluations - before).toBe(1);
    expect(e.get(0, 1)).toBe(5);
  });
  it('a formula that no longer reads a cell stops depending on it', () => {
    const e = createEngine({ rows: 5, cols: 5, cells: [cell(0, 0, 1), cell(0, 1, 2), f(0, 2, '=A1')] });
    e.update([f(0, 2, '=B1')]);
    const before = e.stats.evaluations;
    expect(e.update([cell(0, 0, 50)])).toEqual([{ row: 0, col: 0 }]);
    expect(e.stats.evaluations - before).toBe(0);
    expect(e.get(0, 2)).toBe(2);
  });
});

describe('circular references as cells are edited', () => {
  it('forms and clears a cycle', () => {
    const e = createEngine({ rows: 5, cols: 5, cells: [cell(0, 0, 1), f(0, 1, '=A1+1'), f(0, 2, '=B1+1')] });
    expect([e.get(0, 1), e.get(0, 2)]).toEqual([2, 3]);
    e.update([f(0, 0, '=C1')]); // A1 -> C1 -> B1 -> A1
    expect([e.get(0, 0), e.get(0, 1), e.get(0, 2)]).toEqual([ERR.CIRC, ERR.CIRC, ERR.CIRC]);
    const changed = e.update([cell(0, 0, 10)]);
    expect([e.get(0, 0), e.get(0, 1), e.get(0, 2)]).toEqual([10, 11, 12]);
    expect(pos(changed)).toEqual(['0:0', '0:1', '0:2']);
  });
  it('a cell that only reads a cycle gets #CIRC! and recovers with it', () => {
    const e = createEngine({ rows: 5, cols: 5, cells: [f(0, 0, '=B1'), f(0, 1, '=A1'), f(0, 2, '=A1*2')] });
    expect(e.get(0, 2)).toBe(ERR.CIRC);
    e.update([cell(0, 1, 4)]);
    expect([e.get(0, 0), e.get(0, 2)]).toEqual([4, 8]);
  });
  it('a formula that contains itself in a range is circular, and a neighbouring range is not', () => {
    const e = createEngine({ rows: 8, cols: 3, cells: [cell(0, 0, 1), cell(1, 0, 2), f(2, 0, '=SUM(A1:A3)'), f(4, 0, '=SUM(A1:A4)')] });
    expect(e.get(2, 0)).toBe(ERR.CIRC);
    expect(e.get(4, 0)).toBe(ERR.CIRC); // reads the circular A3
    e.update([f(2, 0, '=SUM(A1:A2)')]);
    expect([e.get(2, 0), e.get(4, 0)]).toEqual([3, 6]); // A5 sums A1:A4 = 1 + 2 + 3
  });
});

describe('large sheets', () => {
  it('a chain of 50,000 formulas does not overflow the stack and is right', () => {
    const rows = 10000;
    const cols = 100;
    const cells = [cell(0, 0, 1)];
    const at = (k) => [k % 500, Math.floor(k / 500)]; // snake through 500 rows x 100 columns
    for (let k = 1; k < 50000; k += 1) {
      const [r, c] = at(k);
      const [pr, pc] = at(k - 1);
      cells.push(f(r, c, `=${colLetters(pc)}${pr + 1}+1`));
    }
    const t0 = performance.now();
    const e = createEngine({ rows, cols, cells });
    const [lr, lc] = at(49999);
    expect(e.get(lr, lc)).toBe(50000);
    const changed = e.update([cell(0, 0, 100)]);
    expect(changed).toHaveLength(50000);
    expect(e.get(lr, lc)).toBe(50099);
    expect(performance.now() - t0).toBeLessThan(8000);
  }, 30000);

  it('10,000 formulas that read one cell are all updated by one edit', () => {
    const cells = [cell(0, 0, 1)];
    for (let r = 1; r < 10000; r += 1) cells.push(f(r, 0, '=$A$1+1'));
    const e = createEngine({ rows: 10000, cols: 2, cells });
    expect(e.get(9999, 0)).toBe(2);
    expect(e.update([cell(0, 0, 9)])).toHaveLength(10000);
    expect(e.get(9999, 0)).toBe(10);
  }, 30000);

  it('running totals down a column (each reads a growing range) stay correct and fast enough', () => {
    const n = 2500;
    const cells = [];
    for (let r = 0; r < n; r += 1) cells.push(cell(r, 0, 1), f(r, 1, `=SUM($A$1:A${r + 1})`));
    const t0 = performance.now();
    const e = createEngine({ rows: 10000, cols: 3, cells });
    expect(e.get(n - 1, 1)).toBe(n);
    e.update([cell(0, 0, 11)]);
    expect(e.get(n - 1, 1)).toBe(n + 10);
    expect(e.get(0, 1)).toBe(11);
    expect(performance.now() - t0).toBeLessThan(8000);
  }, 30000);

  it('a range over a huge empty area reads only the cells that exist, in row order', () => {
    const e = createEngine({
      rows: 10000,
      cols: 100,
      // the formulas are in row 1; the range starts at row 2 so they are outside it
      cells: [
        cell(5, 2, 'c'),
        cell(1, 50, 'b'),
        cell(1, 3, 'a'),
        cell(9999, 99, 'z'),
        f(0, 0, '=CONCAT(A2:CV10000)'),
        f(0, 1, '=COUNTA(A2:CV10000)'),
      ],
    });
    expect(e.get(0, 0)).toBe('abcz'); // (row 2, col D) (row 2, col AY) (row 6, col C) (row 10000, col CV): row order, not insertion order
    expect(e.get(0, 1)).toBe(4);
  });
});

// ───────── the strongest check: incremental recalculation always equals recalculating from scratch ─────────
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

describe('incremental equals from scratch (random sheets, random edits, cycles included)', () => {
  const ROWS = 7;
  const COLS = 4;
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    it(`seed ${seed}`, () => {
      const rnd = prng(seed);
      const pick = (list) => list[Math.floor(rnd() * list.length)];
      const ref = () =>
        `${colLetters(Math.floor(rnd() * (COLS + (rnd() < 0.05 ? 1 : 0))))}${1 + Math.floor(rnd() * (ROWS + (rnd() < 0.05 ? 1 : 0)))}`;
      const range = () => `${ref()}:${ref()}`;
      const atom = () =>
        pick([
          () => ref(),
          () => ref(),
          () => String(Math.floor(rnd() * 9) - 2),
          () => '"t"',
          () => pick(['TRUE', 'FALSE']),
          () => '""',
          () => '0.5',
        ])();
      const expr = (d) => {
        if (d <= 0) return atom();
        const k = rnd();
        if (k < 0.25) return `${expr(d - 1)}${pick(['+', '-', '*', '/', '^', '&', '=', '<>', '<', '>='])}${expr(d - 1)}`;
        if (k < 0.55)
          return `${pick(['SUM', 'AVERAGE', 'MIN', 'MAX', 'COUNT', 'COUNTA', 'CONCAT'])}(${[range(), expr(d - 1), atom()].slice(0, 1 + Math.floor(rnd() * 3)).join(',')})`;
        if (k < 0.7) return `IF(${expr(d - 1)},${expr(d - 1)},${expr(d - 1)})`;
        if (k < 0.8) return `${pick(['AND', 'OR'])}(${expr(d - 1)},${expr(d - 1)})`;
        if (k < 0.9) return `${pick(['ROUND', 'ABS'])}(${expr(d - 1)}${rnd() < 0.5 ? ',1' : ''})`;
        return `-${expr(d - 1)}`;
      };
      const randomCell = (row, col) => {
        const k = rnd();
        if (k < 0.25) return cell(row, col);
        if (k < 0.5) return cell(row, col, Math.floor(rnd() * 20) - 5);
        if (k < 0.58) return cell(row, col, pick(['a', 'b', '3', 'x y', '']));
        if (k < 0.62) return cell(row, col, rnd() < 0.5);
        if (k < 0.97) return f(row, col, `=${expr(2)}`);
        return f(row, col, pick(['=', '=1+', '=SUM(', 'oops']));
      };
      const model = new Map();
      const initial = [];
      for (let r = 0; r < ROWS; r += 1) {
        for (let c = 0; c < COLS; c += 1) {
          const x = randomCell(r, c);
          model.set(`${r}:${c}`, x);
          initial.push(x);
        }
      }
      const engine = createEngine({ rows: ROWS, cols: COLS, cells: initial });
      for (let round = 0; round < 250; round += 1) {
        const changes = [];
        for (let i = 0, n = 1 + Math.floor(rnd() * 3); i < n; i += 1) {
          const x = randomCell(Math.floor(rnd() * ROWS), Math.floor(rnd() * COLS));
          changes.push(x);
          model.set(`${x.row}:${x.col}`, x);
        }
        const before = shownGrid(engine);
        const changed = engine.update(changes);
        const after = shownGrid(engine);
        const fresh = createEngine({ rows: ROWS, cols: COLS, cells: [...model.values()] });
        const expected = shownGrid(fresh);
        for (let i = 0; i < after.length; i += 1)
          expect(
            same(after[i], expected[i]),
            `seed ${seed} round ${round} cell ${i}: ${JSON.stringify(after[i])} vs ${JSON.stringify(expected[i])}`,
          ).toBe(true);
        const differing = [];
        for (let i = 0; i < after.length; i += 1) if (!same(before[i], after[i])) differing.push(`${Math.floor(i / COLS)}:${i % COLS}`);
        expect(pos(changed), `seed ${seed} round ${round}: the report of changed cells`).toEqual(differing.sort());
        // recalculating everything in place changes nothing
        expect(engine.recalculateAll()).toEqual([]);
      }
    });
  }
});
