import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { computeClosing, DENOMINATIONS, cashTotal, toPaisa, varianceLabel } from '../../js/modules/closing/domain/compute.js';

// The same cases are run against the database function closing_calc() in supabase/tests/0201_closing_test.sql.
// Expected figures were worked out by hand from docs/BUSINESS_RULES.md, not produced by this code.
const cases = JSON.parse(readFileSync('tests/fixtures/closing-cases.json', 'utf8'));

describe('closing maths (shared cases, also run against the database)', () => {
  for (const c of cases) {
    it(c.name, () => {
      const got = computeClosing(c.input);
      for (const [key, want] of Object.entries(c.expect)) {
        if (want === null) expect(got[key], key).toBeNull();
        else if (key === 'customers') expect(got[key], key).toBe(want);
        else expect(got[key], key).toBe(toPaisa(want));
      }
    });
  }
});

describe('rules', () => {
  const base = { mode: 'shift', settings: { till_float: 45000, per_customer_charge: 1 } };

  it('uses the confirmed denominations in screen order', () => {
    expect(DENOMINATIONS).toEqual([5000, 1000, 500, 100, 50, 20, 10, 1]);
    expect(cashTotal([1, 1, 1, 1, 1, 1, 1, 1])).toBe(toPaisa(6681));
  });
  it('refuses to calculate without the settings (no silent default float)', () => {
    expect(() => computeClosing({ mode: 'shift' })).toThrow(/settings/);
    expect(() => computeClosing({ mode: 'shift', settings: { till_float: 45000 } })).toThrow(/settings/);
  });
  it('a typed 0 override is a real override, an empty one is not', () => {
    const input = { ...base, pos: { sys_cash: 1000 }, overrides: { shift_sale: 0 } };
    expect(computeClosing(input).shift_sale).toBe(0);
    expect(computeClosing({ ...input, overrides: { shift_sale: null } }).shift_sale).toBe(toPaisa(1000));
    expect(computeClosing({ ...input, overrides: { shift_sale: '' } }).shift_sale).toBe(toPaisa(1000));
  });
  it('struck-through rows count for nothing, in every section', () => {
    const struck = {
      ...base,
      hs: [{ v: 5, deleted: true }],
      strips: [{ price: 5, qty: 5, deleted: true }],
      mediq: [{ collected: 50, bill: 1, deleted: true }],
      credit: { named: [{ v: 9, deleted: true }], free: [{ v: 9, deleted: true }] },
      deposits: [{ v: 9, deleted: true }],
      misc: [{ v: 9, deleted: true }],
    };
    const r = computeClosing(struck);
    expect([r.hs_total, r.strips_a, r.mediq_extra, r.debt_e, r.deposits_f, r.misc_g]).toEqual([0, 0, 0, 0, 0, 0]);
  });
  it('gross MEDIQ cash is not counted, only collected minus pharmacy bill', () => {
    expect(computeClosing({ ...base, mediq: [{ collected: 1500, bill: 1200 }] }).mediq_extra).toBe(toPaisa(300));
  });
  it('an ordinary shift never saves the period figure as its variance (C7)', () => {
    const r = computeClosing({
      ...base,
      pos: { sys_cash: 100 },
      till: [1, 0, 0, 0, 0, 0, 0, 0],
      agg: { pre_date_shift_sale: 9999999 },
    });
    expect(r.shift_variance).toBe(r.net_cash - r.net_sale);
    expect(r.final_variance).toBeNull();
  });
  it('plus / less / even carry a word and an arrow, not only a colour', () => {
    expect(varianceLabel(100)).toEqual({ word: 'Plus', arrow: '▲' });
    expect(varianceLabel(-100)).toEqual({ word: 'Less', arrow: '▼' });
    expect(varianceLabel(0)).toEqual({ word: 'Even', arrow: '✓' });
  });
});
