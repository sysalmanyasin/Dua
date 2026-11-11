import { describe, expect, it } from 'vitest';
import { monthlyReport, paginate, saleBook } from '../../js/modules/sales/domain/bookReports.js';

const methods = [
  { code: 'cash_sale', label: 'Cash Sale', section: 'Cash', sign: 'add', sort: 10 },
  { code: 'cash_returns', label: 'Cash Returns', section: 'Cash', sign: 'sub', sort: 20 },
  { code: 'bank_alfalah', label: 'Bank Alfalah', section: 'Banks', sign: 'add', sort: 30 },
  { code: 'pso', label: 'PSO', section: 'Credit Clients', sign: 'add', sort: 40 },
  { code: 'hbl', label: 'HBL', section: 'Banks', sign: 'add', sort: 50 },
  { code: 'info', label: 'Info', section: 'Cash', sign: 'none', sort: 60 },
];
const days = [
  { business_date: '2026-11-02', total: 900, comp_sale: 800, customers: 9 },
  { business_date: '2026-11-01', total: 700, comp_sale: null, customers: 7 },
];
const lines = [
  { business_date: '2026-11-01', method_code: 'cash_sale', amount: 700 },
  { business_date: '2026-11-02', method_code: 'cash_sale', amount: 1000 },
  { business_date: '2026-11-02', method_code: 'cash_returns', amount: 150 }, // saved positive
  { business_date: '2026-11-02', method_code: 'pso', amount: 50 },
  { business_date: '2026-11-02', method_code: 'info', amount: 999 },
];

describe('monthly report', () => {
  const r = monthlyReport({ days, lines, methods, target: 2000 });
  it('has one column for each field that has figures, in entry-page order, and none for empty or info-only fields', () => {
    expect(r.columns.map((c) => c.code)).toEqual(['cash_sale', 'cash_returns', 'pso']);
  });
  it('rows run from the first day, and returns show as negatives however they were saved', () => {
    expect(r.rows.map((x) => x.date)).toEqual(['2026-11-01', '2026-11-02']);
    expect(r.rows[1].cells.cash_returns).toBe(-150);
    expect(r.totals.cells.cash_returns).toBe(-150);
  });
  it('summary adds up the month by section, with average per day, average bill, best day and target progress', () => {
    expect(r.summary).toMatchObject({
      days: 2,
      total: 1600,
      cash: 1550,
      banks: 0,
      credit: 50,
      comp: 800,
      customers: 16,
      diff: 800,
      targetPct: 80,
    });
    expect(r.summary.avgPerDay).toBe(800);
    expect(r.summary.avgBill).toBe(100);
    expect(r.summary.best).toEqual({ date: '2026-11-02', total: 900 });
  });
  it('a day without a COMP SALE has no diff, and the month diff is left out if there is no COMP at all', () => {
    expect(r.rows[0].diff).toBeNull();
    expect(monthlyReport({ days: [days[1]], lines, methods }).totals.diff).toBeNull();
  });
  it('an empty month does not fail', () => {
    const e = monthlyReport({ days: [], lines: [], methods });
    expect(e.rows).toEqual([]);
    expect(e.summary.best).toBeNull();
    expect(e.summary.avgPerDay).toBe(0);
  });
});

describe('sale book', () => {
  const months = [
    { month: '2025-12-01', total: '500', comp_sale: '450', customers: 5, days: 30, monthly_only: false },
    { month: '2026-01-01', total: '800', comp_sale: null, customers: 8, days: 0, monthly_only: true },
    { month: '2026-02-01', total: '1000', comp_sale: '900', customers: 10, days: 28, monthly_only: false },
  ];
  const mm = [
    { month: '2025-12-01', method_code: 'cash_sale', amount: '500' },
    { month: '2026-01-01', method_code: 'cash_sale', amount: '900' },
    { month: '2026-01-01', method_code: 'cash_returns', amount: '100' },
    { month: '2026-02-01', method_code: 'bank_alfalah', amount: '1000' },
  ];
  it('all time: every month in order, columns for fields with figures, totals per year and overall', () => {
    const b = saleBook({ months, monthMethods: mm, methods });
    expect(b.rows.map((r) => r.key)).toEqual(['2025-12', '2026-01', '2026-02']);
    expect(b.columns.map((c) => c.code)).toEqual(['cash_sale', 'cash_returns', 'bank_alfalah']);
    expect(b.rows[1].cells.cash_returns).toBe(-100);
    expect(b.years.map((y) => [y.year, y.total])).toEqual([
      [2025, 500],
      [2026, 1800],
    ]);
    expect(b.totals).toMatchObject({ total: 2300, customers: 23, days: 58 });
    expect(b.totals.cells.cash_sale).toBe(1400);
  });
  it('one year: only that year, and only its columns', () => {
    const b = saleBook({ months, monthMethods: mm, methods, year: 2025 });
    expect(b.rows).toHaveLength(1);
    expect(b.columns.map((c) => c.code)).toEqual(['cash_sale']);
  });
  it('a month with only monthly figures is marked', () => {
    expect(saleBook({ months, monthMethods: mm, methods }).rows[1].monthlyOnly).toBe(true);
  });
});

describe('pagination', () => {
  it('splits into pages of a fixed size and always returns at least one page', () => {
    expect(
      paginate(
        Array.from({ length: 61 }, (_, i) => i),
        28,
      ).map((p) => p.length),
    ).toEqual([28, 28, 5]);
    expect(paginate([])).toEqual([[]]);
  });
});
