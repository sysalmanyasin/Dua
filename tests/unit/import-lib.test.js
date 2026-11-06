import { describe, expect, it } from 'vitest';
import {
  analyze,
  buildMethods,
  computeTotal,
  parseLegacyDate,
  parseMonthYear,
} from '../../supabase/functions/_shared/sales-import-lib.mjs';

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

describe('database payload', () => {
  it('sends only custom methods, all days, and monthly-only months with their lines', async () => {
    const { buildImportPayload } = await import('../../supabase/functions/_shared/sales-import-lib.mjs');
    const backup = {
      colConfig: { custom: [{ id: 'custom_X', label: 'X Client', section: 'Credit Clients', calcType: 'add' }] },
      daily: [
        { Date: '02/Mar/2024', Month_Year: 'March 2024', 'Cash Sale': 100, custom_X: 5, Customers: '40.0', 'COMP SALE': 90, TOTAL: '105' },
      ],
      monthly: [{ Month_Year: 'March 2024' }, { Month_Year: 'May 2023', TOTAL: '5000', 'Cash Sale': 5000, Customers: '900' }],
    };
    const p = buildImportPayload(analyze(backup));
    expect(p.methods.map((x) => x.code)).toEqual(['c_x']);
    expect(p.days).toHaveLength(1);
    expect(p.days[0].customers).toBe(40);
    expect(p.days[0].lines).toEqual([
      { method: 'cash_sale', amount: 100 },
      { method: 'c_x', amount: 5 },
    ]);
    expect(p.months).toEqual([
      { month: '2023-05-01', total: 5000, comp_sale: null, customers: 900, lines: [{ method: 'cash_sale', amount: 5000 }] },
    ]);
  });
});
