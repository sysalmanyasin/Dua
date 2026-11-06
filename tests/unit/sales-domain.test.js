import { describe, expect, it } from 'vitest';
import { buildIndex, groupDaysByMonth, groupMonthsByYear } from '../../js/modules/sales/domain/months.js';
import { buildDiffReport } from '../../js/modules/sales/domain/diff.js';
import { depositRows, depositValue, summarizeSelection } from '../../js/modules/sales/domain/deposit.js';
import { emptyForm, formFromDay, friendlyError, parseForm, preview } from '../../js/modules/sales/domain/entry.js';

const methods = [
  { code: 'cash_sale', sign: 'add' },
  { code: 'cash_returns', sign: 'sub' },
  { code: 'pso', sign: 'add' },
];

describe('months', () => {
  const days = [
    { business_date: '2026-09-01', total: 100, comp_sale: 90, customers: 10 },
    { business_date: '2026-09-02', total: 200, comp_sale: 250, customers: 20 },
    { business_date: '2026-08-31', total: 50, comp_sale: null, customers: null },
  ];
  it('groups newest month first with totals, diff and newest day first', () => {
    const g = groupDaysByMonth(days);
    expect(g.map((m) => m.month)).toEqual(['2026-09', '2026-08']);
    expect(g[0]).toMatchObject({ total: 300, comp_sale: 340, diff: -40, customers: 30, count: 2 });
    expect(g[0].days[0].business_date).toBe('2026-09-02');
  });
  it('index merges daily months with monthly-only months and compares with last year', () => {
    const idx = buildIndex(
      [
        { month: '2022-04-01', total: 800, days: 30, comp_sale: 700, customers: 3000 },
        { month: '2021-04-01', total: 1000, days: 0, comp_sale: null, customers: null },
      ],
      [
        { month: '2021-04-01', total: 1000, comp_sale: null, customers: null },
        { month: '2020-04-01', total: 700, comp_sale: null, customers: null },
      ],
    );
    expect(idx.map((m) => m.month)).toEqual(['2022-04', '2021-04', '2020-04']);
    expect(idx[0]).toMatchObject({ diff: 100, avgPerDay: 27, monthlyOnly: false });
    expect(idx[0].vsLastYear).toBeCloseTo(-20);
    expect(idx[1].vsLastYear).toBeCloseTo((1000 - 700) / 7);
    expect(idx[2]).toMatchObject({ monthlyOnly: true, vsLastYear: null });
  });
  it('groups months by year', () => {
    const y = groupMonthsByYear([
      { month: '2026-02', total: 5 },
      { month: '2026-01', total: 7 },
      { month: '2025-12', total: 1 },
    ]);
    expect(y.map((g) => [g.year, g.total])).toEqual([
      ['2026', 12],
      ['2025', 1],
    ]);
  });
});

describe('diff report', () => {
  const days = [
    { business_date: '2026-01-02', total: 110, comp_sale: 100 },
    { business_date: '2026-01-01', total: 90, comp_sale: 100 },
    { business_date: '2026-01-03', total: 0, comp_sale: null }, // blank day is left out
    { business_date: '2026-02-01', total: 300, comp_sale: 250 },
  ];
  const r = buildDiffReport(days);
  it('has the latest month first, and a cumulative total across months', () => {
    expect(r.map((m) => m.month)).toEqual(['2026-02', '2026-01']);
    expect(r[1]).toMatchObject({ total: 200, comp_sale: 200, diff: 0, cumulative: 0 });
    expect(r[0]).toMatchObject({ diff: 50, cumulative: 50 });
  });
  it('days run in order with a running total that restarts each month', () => {
    expect(r[1].days.map((d) => [d.date, d.diff, d.running])).toEqual([
      ['2026-01-01', -10, -10],
      ['2026-01-02', 10, 0],
    ]);
    expect(r[0].days[0].running).toBe(50);
  });
});

describe('cash to deposit', () => {
  it('is cash sale minus cash returns plus both FDPP figures, whatever sign returns were typed with', () => {
    expect(depositValue({ cash_sale: 1000, cash_returns: 100, fdpp_pos: 50, fdpp_consumer: 25 })).toBe(975);
    expect(depositValue({ cash_sale: 1000, cash_returns: -100, fdpp_pos: null, fdpp_consumer: undefined })).toBe(900);
  });
  it('lists newest first, skips blank days, and totals a selection', () => {
    const rows = depositRows([
      { business_date: '2026-01-01', total: 10, cash_sale: 10, cash_returns: 0 },
      { business_date: '2026-01-02', total: 0 },
      { business_date: '2026-01-03', total: 20, cash_sale: 20, cash_returns: 5 },
    ]);
    expect(rows.map((r) => r.business_date)).toEqual(['2026-01-03', '2026-01-01']);
    const s = summarizeSelection(rows, new Set(['2026-01-01', '2026-01-03']));
    expect(s).toMatchObject({ count: 2, total: 25 });
    expect(s.rows[0].business_date).toBe('2026-01-01');
  });
});

describe('entry form', () => {
  it('turns typed text into lines and header, skipping blanks and zeros-as-blank', () => {
    const f = emptyForm();
    f.values = { cash_sale: '250,000', cash_returns: '30,197', pso: '', ghost: '5' };
    f.header = { comp_sale: '240000', customers: '310', low_sale_reason: ' rain ' };
    const p = parseForm(f, methods);
    expect(p.ok).toBe(true);
    expect(p.lines).toEqual([
      { method: 'cash_sale', amount: 250000 },
      { method: 'cash_returns', amount: 30197 },
    ]);
    expect(p.header).toMatchObject({ comp_sale: 240000, customers: 310, fdpp_pos: null, low_sale_reason: 'rain' });
  });
  it('reports bad numbers by field', () => {
    const f = emptyForm();
    f.values = { cash_sale: '12a' };
    f.header = { customers: '3.5' };
    const p = parseForm(f, methods);
    expect(p.ok).toBe(false);
    expect(p.errors).toEqual({ cash_sale: 'Enter a number', customers: 'Whole number' });
  });
  it('previews total and diff with the same rule as the database', () => {
    const f = emptyForm();
    f.values = { cash_sale: '90000.5', cash_returns: '-500', pso: '15000' };
    f.header = { comp_sale: '100000' };
    expect(preview(f, methods)).toEqual({ total: 104501, diff: 4501, hasData: true });
  });
  it('loads a saved day back into the form', () => {
    const f = formFromDay({ comp_sale: '100000.00', customers: 210, low_sale_reason: null }, [
      { method_code: 'cash_sale', amount: '90000.50' },
    ]);
    expect(f.values.cash_sale).toBe('90000.5');
    expect(f.header.comp_sale).toBe('100000');
    expect(f.header.fdpp_pos).toBe('');
  });
  it('translates database errors', () => {
    expect(friendlyError('a reason is required to correct a saved day')).toMatch(/reason/);
    expect(friendlyError('date cannot be in the future')).toMatch(/future/);
    expect(friendlyError('weird')).toMatch(/Could not save/);
  });
});
