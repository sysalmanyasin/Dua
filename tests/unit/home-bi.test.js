import { describe, expect, it } from 'vitest';
import { DEFAULT_PERIOD, PERIODS, compareAverages, completeness, normaliseBi, trendBars } from '../../js/modules/home/domain/bi.js';

const raw = (o = {}) => ({
  days: 30,
  from: '2026-10-23',
  to: '2026-11-21',
  previous_from: '2026-09-23',
  previous_to: '2026-10-22',
  sales: {
    total: 600000,
    recorded_days: 28,
    avg_per_day: 21428.57,
    previous_total: 500000,
    previous_recorded_days: 30,
    previous_avg_per_day: 16666.67,
    series: [
      { date: '2026-11-20', total: 30000 },
      { date: '2026-11-21', total: 15000 },
    ],
  },
  transactions: {
    total: 3000,
    counted_days: 28,
    avg_per_day: 107.1,
    previous_total: 2500,
    previous_counted_days: 30,
    previous_avg_per_day: 83.3,
  },
  inventory: {
    stockValue: 9000000,
    reorder: { count: 12, value: 400000 },
    notSold: { count: 5, value: 90000 },
    excess: { count: 3, value: 70000 },
    asOf: '2026-11-22T10:00:00Z',
  },
  inventory_failed: false,
  operations: { days_in_period: 30, days_with_sales: 28, days_with_closing: 20, closings_submitted: 25, open_drafts: 1 },
  ...o,
});

describe('normaliseBi', () => {
  it('reads a full result', () => {
    const b = normaliseBi(raw());
    expect(b.days).toBe(30);
    expect(b.sales).toMatchObject({ total: 600000, recordedDays: 28, avg: 21428.57, prevAvg: 16666.67 });
    expect(b.transactions).toMatchObject({ total: 3000, countedDays: 28 });
    expect(b.inventory.reorder).toEqual({ count: 12, value: 400000 });
    expect(b.operations).toMatchObject({ daysInPeriod: 30, daysWithSales: 28, daysWithClosing: 20, openDrafts: 1 });
  });
  it('returns null when the database gave nothing (not allowed)', () => {
    expect(normaliseBi(null)).toBeNull();
    expect(normaliseBi('x')).toBeNull();
  });
  it('tolerates missing parts and bad numbers without inventing figures', () => {
    const b = normaliseBi({
      days: 7,
      sales: { total: 'abc', series: [null, { date: 'bad', total: 1 }, { date: '2026-11-21', total: 5 }] },
    });
    expect(b.days).toBe(7);
    expect(b.sales.total).toBe(0);
    expect(b.sales.avg).toBeNull();
    expect(b.sales.series).toEqual([{ date: '2026-11-21', total: 5 }]);
    expect(b.inventory).toBeNull();
    expect(b.operations.daysInPeriod).toBe(7);
  });
  it('falls back to 30 days for an unknown period and never shows negative counts', () => {
    expect(normaliseBi({ days: 14 }).days).toBe(DEFAULT_PERIOD);
    expect(normaliseBi({ transactions: { total: -5 } }).transactions.total).toBe(0);
  });
  it('flags a failed inventory read', () => {
    expect(normaliseBi(raw({ inventory: null, inventory_failed: true })).inventoryFailed).toBe(true);
  });
  it('offers exactly 7, 30 and 90 days, defaulting to 30', () => {
    expect(PERIODS).toEqual([7, 30, 90]);
    expect(DEFAULT_PERIOD).toBe(30);
  });
});

describe('compareAverages', () => {
  it('words an increase and a decrease against the previous period', () => {
    expect(compareAverages(120, 100, 30, 30, 30).text).toBe('▲ 20% above the previous 30 days');
    expect(compareAverages(80, 100, 30, 30, 30).text).toBe('▼ 20% below the previous 30 days');
  });
  it('calls a tiny change "about the same"', () => {
    const c = compareAverages(100.2, 100, 30, 30, 30);
    expect(c.direction).toBe('flat');
    expect(c.text).toBe('About the same as the previous 30 days');
  });
  it('says so when there is nothing to compare with, and never divides by zero', () => {
    expect(compareAverages(100, null, 30, 0, 30).pct).toBeNull();
    expect(compareAverages(100, 0, 30, 5, 30).text).toBe('No earlier period to compare with');
    expect(compareAverages(null, 100, 0, 30, 30).pct).toBeNull();
  });
  it('warns when too few days were recorded to trust the comparison', () => {
    const c = compareAverages(120, 100, 5, 30, 30);
    expect(c.thin).toBe(true);
    expect(c.text).toContain('few days recorded');
  });
  it('words the completeness of the records', () => {
    expect(completeness(27, 30, 'Sales entered')).toBe('Sales entered for 27 of 30 days');
  });
});

describe('trendBars', () => {
  const series = [
    { date: '2026-11-01', total: 100 },
    { date: '2026-11-03', total: 50 },
  ];
  it('makes one bar per calendar day and marks missing days', () => {
    const bars = trendBars(series, '2026-11-01', '2026-11-04');
    expect(bars.map((b) => b.date)).toEqual(['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04']);
    expect(bars.map((b) => b.missing)).toEqual([false, true, false, true]);
  });
  it('scales the tallest day to the full height and the others in proportion', () => {
    const bars = trendBars(series, '2026-11-01', '2026-11-03', { height: 80 });
    expect(bars[0].h).toBe(80);
    expect(bars[2].h).toBe(40);
    expect(bars[0].y + bars[0].h).toBe(80);
  });
  it('handles empty or invalid input without throwing', () => {
    expect(trendBars([], '2026-11-01', '2026-11-03').every((b) => b.h === 0)).toBe(true);
    expect(trendBars(series, null, '2026-11-03')).toEqual([]);
    expect(trendBars(series, '2026-11-05', '2026-11-01')).toEqual([]);
    expect(trendBars(series, 'x', 'y')).toEqual([]);
  });
});
