import { describe, expect, it } from 'vitest';
import { colLetters, parseRef } from '../../js/modules/workspace/domain/formulas/a1.js';
import { createEngine } from '../../js/modules/workspace/domain/formulas/engine.js';
import { rewriteForDelete, rewriteForInsert, translateFormula } from '../../js/modules/workspace/domain/formulas/rewrite.js';

describe('inserting rows or columns', () => {
  it.each([
    ['=A1+A2+SUM(A1:A9)', 'row', 1, 2, '=A1+A4+SUM(A1:A11)'], // a range that spans the insertion point grows
    ['=A1+A2', 'row', 0, 1, '=A2+A3'],
    ['=A1+A2', 'row', 2, 1, '=A1+A2'], // inserting below changes nothing
    ['=SUM(A2:A5)', 'row', 1, 3, '=SUM(A5:A8)'], // inserting at the first row of a range pushes the whole range down
    ['=SUM(A2:A5)', 'row', 5, 3, '=SUM(A2:A5)'], // just after its end: no change
    ['=SUM(A2:A5)', 'row', 4, 1, '=SUM(A2:A6)'], // at its last row: grows
    ['=  $A$1 + B2', 'col', 0, 1, '=  $B$1 + C2'], // spacing and $ are kept
    ['=$A1+A$1', 'row', 0, 1, '=$A2+A$2'], // inserting always moves, $ or not
    ['=B1&"A1"', 'col', 0, 1, '=C1&"A1"'], // text is never touched
    ['=SUM(B9:A1)', 'row', 4, 1, '=SUM(B10:A1)'], // a range written backwards keeps its order
    ['=IF(A1>0,B1,C1)', 'col', 1, 2, '=IF(A1>0,D1,E1)'],
    ['=LOG10(A1)', 'row', 0, 1, '=LOG10(A2)'], // a function name is not a reference
    ['=A1+#REF!', 'row', 0, 1, '=A2+#REF!'],
    ['=A1', 'row', 0, 0, '=A1'],
    ['=a1+b2', 'row', 0, 1, '=A2+B3'], // changed references are written in capitals
    ['=a1+b2', 'row', 9, 1, '=a1+b2'], // unchanged ones are left exactly as typed
  ])('%s, insert at %s %j x%j', (text, axis, at, count, out) => expect(rewriteForInsert(text, axis, at, count)).toBe(out));

  it('turns a reference pushed off the largest sheet into #REF!', () => {
    expect(rewriteForInsert('=A10000', 'row', 0, 1)).toBe('=#REF!');
    expect(rewriteForInsert('=SUM(A1:A10000)', 'row', 5, 1)).toBe('=SUM(#REF!)');
    expect(rewriteForInsert('=CV1', 'col', 0, 1)).toBe('=#REF!');
    expect(rewriteForInsert('=A9999', 'row', 0, 1)).toBe('=A10000');
  });
});

describe('deleting rows or columns', () => {
  it.each([
    ['=A1+A2+A3+SUM(A1:A9)', 'row', [1], '=A1+#REF!+A2+SUM(A1:A8)'],
    ['=SUM(A1:A3)+SUM(A2:A5)', 'row', [0, 1, 2], '=SUM(#REF!)+SUM(A1:A2)'], // a range with no rows left; another that shrinks
    ['=B1+C1+SUM(A1:C1)', 'col', [1], '=#REF!+B1+SUM(A1:B1)'],
    ['=SUM(B9:A1)', 'row', [4], '=SUM(B8:A1)'],
    ['=A5', 'row', [0, 1], '=A3'],
    ['=SUM(A1:A5)', 'row', [0], '=SUM(A1:A4)'], // the first row of a range
    ['=SUM(A1:A5)', 'row', [4], '=SUM(A1:A4)'], // the last row
    ['=SUM(A1:A5)', 'row', [2], '=SUM(A1:A4)'], // the middle
    ['=SUM(A3:A3)', 'row', [2], '=SUM(#REF!)'],
    ['=SUM(A3:A3)', 'row', [0], '=SUM(A2:A2)'],
    ['=A1+A9', 'row', [20, 30], '=A1+A9'], // rows that do not matter
    ['=$A$5', 'row', [0], '=$A$4'],
    ['=A1', 'row', [], '=A1'],
    ['=A1+B1', 'col', [5], '=A1+B1'],
    ['=SUM(A1:C1)', 'col', [0, 2], '=SUM(A1:A1)'],
    ['=A5', 'row', [1, 1, 1], '=A4'], // a position listed twice counts once
  ])('%s, delete %s %j', (text, axis, deleted, out) => expect(rewriteForDelete(text, axis, deleted)).toBe(out));
});

describe('copying a formula to another cell', () => {
  it.each([
    ['=A1+$B$2+C$3', 2, 1, '=B3+$B$2+D$3'],
    ['=SUM(A1:B2)', 1, 0, '=SUM(A2:B3)'],
    ['=SUM($A1:B$2)', 3, 2, '=SUM($A4:D$2)'],
    ['=A1', 0, 0, '=A1'],
    ['=A1+B2', -1, 0, '=#REF!+B1'], // above the first row
    ['=SUM(A1:B2)', -1, 0, '=SUM(#REF!)'],
    ['=A1', 0, -1, '=#REF!'],
    ['=CV1', 0, 1, '=#REF!'],
    ['=A1', 9999, 0, '=A10000'],
    ['=A1', 10000, 0, '=#REF!'],
    ['="A1"&A1', 1, 0, '="A1"&A2'],
  ])('%s by (%j, %j)', (text, dr, dc, out) => expect(translateFormula(text, dr, dc)).toBe(out));
});

describe('text that is not a valid formula is never touched', () => {
  it.each(['A1+1', '=SUM(A1', '=1+', '', '=Sheet2!A1', '=A1:', '=A1 B1', '="abc'])('%j', (text) => {
    expect(rewriteForInsert(text, 'row', 0, 1)).toBe(text);
    expect(rewriteForDelete(text, 'row', [0])).toBe(text);
    expect(translateFormula(text, 1, 1)).toBe(text);
  });
  it('and non-text is returned as it is', () => {
    for (const v of [null, undefined, 5]) expect(rewriteForInsert(v, 'row', 0, 1)).toBe(v);
  });
});

// ───────── semantic properties: the numbers stay the same ─────────
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
const ROWS = 12;
const COLS = 5;

// A random sheet: numbers in columns A to C, formulas in columns D and E that read them (single cells and ranges).
function randomSheet(rnd) {
  const cells = [];
  for (let r = 0; r < ROWS; r += 1)
    for (let c = 0; c < 3; c += 1) if (rnd() < 0.8) cells.push({ row: r, col: c, value: Math.floor(rnd() * 100) });
  const refs = () => `${colLetters(Math.floor(rnd() * 3))}${1 + Math.floor(rnd() * ROWS)}`;
  const rng = () => {
    const a = Math.floor(rnd() * ROWS);
    const b = Math.floor(rnd() * ROWS);
    const c1 = Math.floor(rnd() * 3);
    const c2 = Math.floor(rnd() * 3);
    return `${colLetters(c1)}${a + 1}:${colLetters(c2)}${b + 1}`;
  };
  const kinds = [
    () => `=${refs()}+${refs()}`,
    () => `=SUM(${rng()})`,
    () => `=MAX(${rng()},${refs()})`,
    () => `=COUNT(${rng()})*2`,
    () => `=AVERAGE(${rng()},1)`,
    () => `=IF(${refs()}>50,${refs()},-1)`,
  ];
  for (let r = 0; r < ROWS; r += 1)
    for (const col of [3, 4]) if (rnd() < 0.6) cells.push({ row: r, col, value: null, formula: kinds[Math.floor(rnd() * kinds.length)]() });
  return cells;
}
const valuesOf = (cells, rows, cols) => {
  const e = createEngine({ rows, cols, cells: cells.map((c) => ({ value: null, formula: null, ...c })) });
  return (r, c) => e.get(r, c);
};
const same = (a, b) => (a && b && typeof a === 'object' && typeof b === 'object' ? a.error === b.error : a === b);

describe('inserting rows never changes a number', () => {
  for (const seed of [11, 12, 13, 14, 15, 16]) {
    it(`seed ${seed}: every cell shows the same value after rewriting and moving`, () => {
      const rnd = prng(seed);
      for (let round = 0; round < 40; round += 1) {
        const cells = randomSheet(rnd);
        const at = Math.floor(rnd() * (ROWS + 1));
        const count = 1 + Math.floor(rnd() * 3);
        const before = valuesOf(cells, ROWS, COLS);
        const moved = cells.map((c) => ({
          ...c,
          row: c.row >= at ? c.row + count : c.row,
          formula: c.formula ? rewriteForInsert(c.formula, 'row', at, count) : null,
        }));
        const after = valuesOf(moved, ROWS + count, COLS);
        for (let r = 0; r < ROWS; r += 1) {
          for (let c = 0; c < COLS; c += 1) {
            const r2 = r >= at ? r + count : r;
            expect(
              same(before(r, c), after(r2, c)),
              `seed ${seed} round ${round} cell ${colLetters(c)}${r + 1}: ${JSON.stringify(before(r, c))} vs ${JSON.stringify(after(r2, c))}`,
            ).toBe(true);
          }
        }
      }
    });
  }
  it('works the same for columns', () => {
    const cells = [
      { row: 0, col: 0, value: 4 },
      { row: 0, col: 1, value: 5 },
      { row: 0, col: 2, value: null, formula: '=SUM(A1:B1)*A1' },
    ];
    const moved = cells.map((c) => ({
      ...c,
      col: c.col >= 1 ? c.col + 2 : c.col,
      formula: c.formula ? rewriteForInsert(c.formula, 'col', 1, 2) : null,
    }));
    expect(valuesOf(cells, 3, 6)(0, 2)).toBe(36);
    expect(valuesOf(moved, 5, 6)(0, 4)).toBe(36);
    expect(moved[2].formula).toBe('=SUM(A1:D1)*A1');
  });
});

describe('deleting rows that nothing reads never changes a number', () => {
  for (const seed of [21, 22, 23, 24]) {
    it(`seed ${seed}`, () => {
      const rnd = prng(seed);
      for (let round = 0; round < 40; round += 1) {
        const cells = randomSheet(rnd);
        // rows that no formula mentions (neither as a cell nor inside a range) and that hold no formula
        const read = new Set();
        for (const c of cells) {
          if (!c.formula) continue;
          for (const m of c.formula.matchAll(/([A-C])(\d+):?([A-C]\d+)?/g)) {
            const a = Number(m[2]);
            const b = m[3] ? Number(m[3].slice(1)) : a;
            for (let r = Math.min(a, b); r <= Math.max(a, b); r += 1) read.add(r - 1);
          }
        }
        const free = [];
        for (let r = 0; r < ROWS; r += 1) if (!read.has(r) && !cells.some((c) => c.row === r && c.formula)) free.push(r);
        if (free.length === 0) continue;
        const gone = free.filter(() => rnd() < 0.5);
        if (gone.length === 0) continue;
        const goneSet = new Set(gone);
        const shift = (r) => r - gone.filter((g) => g < r).length;
        const before = valuesOf(cells, ROWS, COLS);
        const kept = cells
          .filter((c) => !goneSet.has(c.row))
          .map((c) => ({ ...c, row: shift(c.row), formula: c.formula ? rewriteForDelete(c.formula, 'row', gone) : null }));
        const after = valuesOf(kept, ROWS - gone.length, COLS);
        for (let r = 0; r < ROWS; r += 1) {
          if (goneSet.has(r)) continue;
          for (let c = 0; c < COLS; c += 1)
            expect(same(before(r, c), after(shift(r), c)), `seed ${seed} round ${round} ${colLetters(c)}${r + 1}`).toBe(true);
        }
      }
    });
  }
  it('a deleted row that WAS read gives #REF! (single cell) or a smaller range', () => {
    const cells = [
      { row: 0, col: 0, value: 1 },
      { row: 1, col: 0, value: 2 },
      { row: 2, col: 0, value: 3 },
      { row: 0, col: 1, value: null, formula: '=A2' },
      { row: 3, col: 1, value: null, formula: '=SUM(A1:A3)' },
    ];
    const kept = cells
      .filter((c) => c.row !== 1)
      .map((c) => ({ ...c, row: c.row > 1 ? c.row - 1 : c.row, formula: c.formula ? rewriteForDelete(c.formula, 'row', [1]) : null }));
    const v = valuesOf(kept, 3, 3);
    expect(kept.map((c) => c.formula).filter(Boolean)).toEqual(['=#REF!', '=SUM(A1:A2)']);
    expect(v(0, 1)).toEqual({ error: '#REF!' });
    expect(v(2, 1)).toBe(4); // 1 + 3: the deleted 2 is gone from the sum
  });
});

describe('structural round trips', () => {
  it('insert then delete the same rows gives back the original text', () => {
    const rnd = prng(99);
    for (let i = 0; i < 300; i += 1) {
      const formulas = randomSheet(rnd)
        .filter((c) => c.formula)
        .map((c) => c.formula);
      const at = Math.floor(rnd() * ROWS);
      const count = 1 + Math.floor(rnd() * 3);
      const added = Array.from({ length: count }, (_, k) => at + k);
      for (const f of formulas) expect(rewriteForDelete(rewriteForInsert(f, 'row', at, count), 'row', added), f).toBe(f);
    }
  });
  it('copying down then back up gives back the original', () => {
    const rnd = prng(7);
    for (const c of randomSheet(rnd).filter((x) => x.formula)) {
      expect(translateFormula(translateFormula(c.formula, 5, 0), -5, 0)).toBe(c.formula);
      expect(translateFormula(translateFormula(c.formula, 0, 1), 0, -1)).toBe(c.formula);
    }
  });
  it('a formula copied one row down reads the next row', () => {
    const copied = translateFormula('=A1*2+SUM(B1:C1)', 1, 0);
    expect(copied).toBe('=A2*2+SUM(B2:C2)');
    expect(parseRef('A2')).toMatchObject({ row: 1 });
  });
});
