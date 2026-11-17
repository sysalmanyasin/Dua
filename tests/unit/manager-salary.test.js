import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { genericRow, percent, rateFromPercent, rup, salaryFlags, salaryNet, sumAmounts } from '../../js/modules/manager/domain/salary.js';

const generic = JSON.parse(readFileSync('tests/fixtures/manager-generic-cases.json', 'utf8'));
const salary = JSON.parse(readFileSync('tests/fixtures/manager-salary-cases.json', 'utf8'));

describe('generic sheet (shared cases, also run against the database)', () => {
  it('has the cases', () => expect(generic.length).toBe(16));
  for (const c of generic) {
    it(c.name, () => {
      const r = genericRow({ sale: c.sale, extra: c.extra, rate: c.rate });
      expect(r.incentive).toBe(c.incentive);
      expect(r.final).toBe(c.final);
    });
  }
});

describe('salary net (shared cases, also run against the database)', () => {
  it('has the cases', () => expect(salary.length).toBe(9));
  for (const c of salary) {
    it(c.name, () => {
      const net = salaryNet({
        ho: c.ho,
        advance: sumAmounts(c.advances),
        generic: c.generic,
        extras: [
          { sign: 1, amount: c.plus },
          { sign: -1, amount: c.minus },
        ],
      });
      expect(net).toBe(c.net);
    });
  }
});

describe('rounding is exactly JavaScript Math.round (halves go up, also for negatives)', () => {
  it('matches Math.round on every half and near-half', () => {
    for (const x of [0.5, 1.5, 2.5, -0.5, -1.5, -2.5, 4.5, -4.5, 12500.5, 99.49, 99.5, -99.5, 0.4, -0.4, 1e6 + 0.5]) {
      expect(rup(x) + 0).toBe(Math.round(x) + 0);
    }
  });
  it('never returns minus zero', () => {
    expect(Object.is(rup(-0.5), 0)).toBe(true);
    expect(Object.is(rup(-0.4), 0)).toBe(true);
    expect(Object.is(salaryNet({ ho: 0 }), 0)).toBe(true);
    expect(Object.is(genericRow({ sale: 0.4, extra: -0.5, rate: 0.04 }).final, 0)).toBe(true);
  });
  it('uses integer maths for the rate, so the floating point trap cannot bite', () => {
    expect(2500 * 0.045).toBeCloseTo(112.5, 10);
    expect(genericRow({ sale: 2500, rate: 0.045 }).incentive).toBe(113);
    for (let sale = 0; sale <= 20000; sale += 7) {
      for (const rate of [0.04, 0.045, 0.005]) {
        const exact = (sale * Math.round(rate * 100000) + 50000) / 100000;
        expect(genericRow({ sale, rate }).incentive).toBe(Math.floor(exact));
      }
    }
  });
});

describe('flags (MGR-16)', () => {
  const base = { closed: false, advance: 1500, advance_live: 1500, generic: 1100, generic_live: 1100, credit_deduction: 1500 };
  it('flags nothing when everything agrees', () =>
    expect(salaryFlags(base)).toEqual({ advanceChanged: false, genericChanged: false, creditDiffers: false }));
  it('flags a closed month whose live advance or generic moved', () => {
    expect(salaryFlags({ ...base, closed: true, advance_live: 2200 }).advanceChanged).toBe(true);
    expect(salaryFlags({ ...base, closed: true, generic_live: 900 }).genericChanged).toBe(true);
  });
  it('never flags a live change in an open month (it simply updates)', () =>
    expect(salaryFlags({ ...base, advance_live: 9 }).advanceChanged).toBe(false));
  it('flags a credit sheet deduction that differs from the advance, but not two zeros', () => {
    expect(salaryFlags({ ...base, credit_deduction: 1000 }).creditDiffers).toBe(true);
    expect(salaryFlags({ ...base, advance: 0, advance_live: 0, credit_deduction: 0 }).creditDiffers).toBe(false);
  });
});

describe('rates', () => {
  it('shows percentages without noise', () => {
    expect(percent(0.04)).toBe('4%');
    expect(percent(0.045)).toBe('4.5%');
    expect(percent(0.1234)).toBe('12.34%');
  });
  it('turns what a person types back into a fraction with at most 5 decimals', () => {
    expect(rateFromPercent(4)).toBe(0.04);
    expect(rateFromPercent(4.5)).toBe(0.045);
    expect(rateFromPercent(12.345)).toBe(0.12345);
  });
});
