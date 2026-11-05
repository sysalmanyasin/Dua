import { describe, expect, it } from 'vitest';
import { analyze, buildMethods, computeTotal, parseLegacyDate, parseMonthYear } from '../../tools/import/sales-lib.mjs';

// Synthetic data only: no real figures are ever stored in the repo.
const methods = buildMethods({ custom: [{ id: 'custom_X', label: 'X Client', section: 'Credit Clients', calcType: 'add' }] });

describe('legacy parsing', () => {
  it('reads old dates and month labels, and rejects impossible dates', () => {
    expect(parseLegacyDate('04/Nov/2026')).toBe('2026-11-04');
    expect(parseLegacyDate('31/Apr/2026')).toBeNull();
    expect(parseLegacyDate('garbage')).toBeNull();
    expect(parseMonthYear('April 2022')).toEqual({ year: 2022, month: 4 });
  });
});

describe('TOTAL', () => {
  const lines = [
    { method: 'cash_sale', amount: 1000 },
    { method: 'cash_returns', amount: -100 },
    { method: 'pso', amount: -50 },
    { method: 'c_x', amount: 25 },
  ];
  it('subtracts return fields whatever their sign', () => {
    expect(computeTotal([{ method: 'cash_returns', amount: 100 }], methods)).toBe(-100);
    expect(computeTotal([{ method: 'cash_returns', amount: -100 }], methods)).toBe(-100);
  });
  it('signed mode lets a negative client value reduce the total; abs mode (old formula) flips it', () => {
    expect(computeTotal(lines, methods, 'signed')).toBe(1000 - 100 - 50 + 25);
    expect(computeTotal(lines, methods, 'abs')).toBe(1000 - 100 + 50 + 25);
  });
  it('rounds like JavaScript Math.round', () => {
    expect(computeTotal([{ method: 'cash_sale', amount: 10.5 }], methods)).toBe(11);
    expect(computeTotal([{ method: 'cash_sale', amount: -10.5 }], methods)).toBe(-10);
  });
});

describe('analysis', () => {
  const row = (date, my, extra = {}) => ({ Date: date, Month_Year: my, 'Cash Sale': 100, TOTAL: '100', 'COMP SALE': 100, ...extra });
  it('flags a stored total that disagrees with the formula', () => {
    const r = analyze({ daily: [row('01/Mar/2024', 'March 2024', { TOTAL: '90' })], monthly: [] });
    expect(r.anomalies.map((a) => a.type)).toContain('total_mismatch');
  });
  it('flags a typed year that disagrees with the month label, and fixes it only when told to', () => {
    const data = { daily: [row('05/Apr/2021', 'April 2022')], monthly: [] };
    expect(analyze(data).days[0].business_date).toBe('2021-04-05');
    expect(analyze(data).anomalies.map((a) => a.type)).toContain('date_vs_month_label');
    expect(analyze(data, { trustMonthYear: true }).days[0].business_date).toBe('2022-04-05');
  });
  it('finds calendar gaps, duplicates, and months with only monthly figures', () => {
    const r = analyze({
      daily: [row('01/Mar/2024', 'March 2024'), row('03/Mar/2024', 'March 2024'), row('03/Mar/2024', 'March 2024')],
      monthly: [{ Month_Year: 'March 2024' }, { Month_Year: 'May 2023' }],
    });
    expect(r.gaps).toEqual(['2024-03-02']);
    expect(r.anomalies.map((a) => a.type)).toContain('duplicate_date');
    expect(r.monthlyOnly.map((m) => m.Month_Year)).toEqual(['May 2023']);
  });
  it('never invents DIFF when COMP SALE is empty', () => {
    const r = analyze({ daily: [row('01/Mar/2024', 'March 2024', { 'COMP SALE': null })], monthly: [] });
    expect(r.anomalies.map((a) => a.type)).not.toContain('diff_missing_in_old_data');
  });
});
