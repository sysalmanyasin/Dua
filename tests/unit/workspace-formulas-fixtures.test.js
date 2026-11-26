import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseRef } from '../../js/modules/workspace/domain/formulas/a1.js';
import { createEngine } from '../../js/modules/workspace/domain/formulas/engine.js';

// The cases live in tests/fixtures/workspace-formula-cases.json (invented numbers). Expected answers follow the rules in
// docs/modules/workspace.formulas.md, written before the code.
const { cases } = JSON.parse(readFileSync('tests/fixtures/workspace-formula-cases.json', 'utf8'));
const ROWS = 100;
const COLS = 26;
const SCRATCH = 'Z100';

const at = (a1) => {
  const r = parseRef(a1);
  return { row: r.row, col: r.col };
};
const cellsOf = (map) =>
  Object.entries(map ?? {}).map(([a1, v]) => ({
    ...at(a1),
    value: typeof v === 'string' && v.startsWith('=') ? null : v,
    formula: typeof v === 'string' && v.startsWith('=') ? v : null,
  }));
const wanted = (e) => (e !== null && typeof e === 'object' && 'error' in e ? { error: e.error } : e);

function check(actual, expected) {
  if (expected !== null && typeof expected === 'object' && 'approx' in expected) {
    expect(typeof actual).toBe('number');
    expect(actual).toBeCloseTo(expected.approx, 9);
  } else {
    expect(actual).toEqual(wanted(expected));
  }
}

describe('formula fixtures', () => {
  it('has plenty of cases', () => {
    expect(cases.length).toBeGreaterThan(250);
  });

  cases.forEach((c, i) => {
    const label = c.f
      ? `${c.f}${c.cells ? `  with ${JSON.stringify(c.cells)}` : ''}`
      : `cells ${JSON.stringify(c.cells)}${c.note ? ` (${c.note})` : ''}`;
    it(`#${i} ${label}`, () => {
      if (c.f) {
        const engine = createEngine({
          rows: ROWS,
          cols: COLS,
          cells: [...cellsOf(c.cells), { ...at(SCRATCH), value: null, formula: c.f }],
        });
        const p = at(SCRATCH);
        check(engine.get(p.row, p.col), c.expect);
      } else {
        const engine = createEngine({ rows: ROWS, cols: COLS, cells: cellsOf(c.cells) });
        for (const [a1, e] of Object.entries(c.expect)) {
          const p = at(a1);
          check(engine.get(p.row, p.col), e);
        }
      }
    });
  });
});
