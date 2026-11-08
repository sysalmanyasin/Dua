import { describe, expect, it } from 'vitest';
import {
  bestWorst,
  buildInsights,
  cagr,
  cashBankChart,
  clientsChart,
  comparePeriod,
  computeKpis,
  dayOfWeek,
  heatmapYear,
  normalizeDays,
  normalizeMonths,
  presetSlice,
  raceData,
  summaryRows,
  topDays,
  totalChart,
  yearsOf,
  yoyChart,
} from '../../js/modules/sales/domain/dashboard.js';

// 25 months (Nov 2024 – Nov 2026): total = 1000 + 10 × index, customers = 100 + index.
function monthRows() {
  const rows = [];
  for (let i = 0; i < 25; i++) {
    const y = 2024 + Math.floor((10 + i) / 12);
    const m = ((10 + i) % 12) + 1;
    rows.push({
      month: `${y}-${String(m).padStart(2, '0')}-01`,
      total: 1000 + 10 * i,
      comp_sale: 990 + 10 * i,
      customers: 100 + i,
      days: 28,
      cash: 600 + 5 * i,
      banks: 300,
      credit: 100 + 5 * i,
      monthly_only: false,
    });
  }
  return rows;
}
const dayRow = (date, total, extra = {}) => ({
  business_date: date,
  total,
  comp_sale: total - 10,
  customers: 10,
  cash: total * 0.6,
  banks: total * 0.2,
  credit: total * 0.2,
  ...extra,
});
function dayRows() {
  const rows = [];
  for (let d = 1; d <= 9; d++) rows.push(dayRow(`2026-11-0${d}`, 40)); // this month so far: 9 days, 360
  for (let d = 1; d <= 28; d++) rows.push(dayRow(`2026-10-${String(d).padStart(2, '0')}`, 30)); // last month: 28 days
  for (let d = 1; d <= 9; d++) rows.push(dayRow(`2025-11-0${d}`, 20)); // the same days last year
  return rows;
}
const months = normalizeMonths(monthRows());
const days = normalizeDays(dayRows());
const TODAY = '2026-11-10';

describe('headline numbers while the month is running', () => {
  const k = computeKpis(months, days, { '2026-11': 2000 }, TODAY);
  it('knows which month it is, and how many days have sales', () => {
    expect(k.lat.key).toBe('2026-11');
    expect(k.isLive).toBe(true);
    expect(k.D).toBe(9);
    expect(k.daysInMonth).toBe(30);
  });
  it('compares month-to-date with the same days of last month and of last year', () => {
    expect(k.prvAt.total).toBe(270); // 9 days of 30
    expect(k.yoyAt.total).toBe(180); // 9 days of 20
    expect(k.vs.total).toBeCloseTo(((1240 - 270) / 270) * 100, 5);
  });
  it('forecast is the daily average carried to month end; target and score use the target', () => {
    expect(k.dailyAvg).toBeCloseTo(1240 / 9, 5);
    expect(k.forecastTotal).toBeCloseTo((1240 / 9) * 30, 5);
    expect(k.target).toBe(2000);
    expect(k.forecastVsTarget).toBeCloseTo((((1240 / 9) * 30) / 2000 - 1) * 100, 4);
    expect(k.score).toBeGreaterThan(0);
    expect(k.score).toBeLessThanOrEqual(100);
  });
  it('year to date adds this year, against last year up to the same point', () => {
    expect(k.year).toBe(2026);
    expect(k.ytd).toBe(months.filter((m) => m.year === 2026).reduce((s, m) => s + m.total, 0));
    expect(k.pYtd).toBe(months.filter((m) => m.year === 2025 && m.mi < 10).reduce((s, m) => s + m.total, 0) + 180);
  });
  it('average bill, cumulative difference, grand total', () => {
    expect(k.avgBill).toBeCloseTo(1240 / 124, 5);
    expect(k.grandTotal).toBe(months.reduce((s, m) => s + m.total, 0));
    expect(k.cumDiff).toBe(25 * 10);
  });
  it('CAGR needs two years of months', () => {
    expect(k.cagr).toBeGreaterThan(0);
    expect(cagr(months.slice(0, 20))).toBeNull();
  });
});

describe('when the month is over or history is thin', () => {
  it('a closed latest month is compared whole, and its forecast is the actual', () => {
    const k = computeKpis(months, days, {}, '2026-12-15');
    expect(k.isLive).toBe(false);
    expect(k.D).toBe(0);
    expect(k.prvAt.total).toBe(months.at(-2).total);
    expect(k.forecastTotal).toBe(k.lat.total);
    expect(k.target).toBeNull();
  });
  it('a month with only monthly figures is compared on its full figures', () => {
    const m2 = normalizeMonths([...monthRows().slice(0, -2), { ...monthRows().at(-2), monthly_only: true, days: 0 }, monthRows().at(-1)]);
    const d2 = normalizeDays(dayRows().filter((r) => !r.business_date.startsWith('2026-10')));
    expect(computeKpis(m2, d2, {}, TODAY).prvAt.total).toBe(m2.at(-2).total);
  });
  it('needs at least two months', () => {
    expect(computeKpis(months.slice(0, 1), days, {}, TODAY)).toBeNull();
    expect(computeKpis([], [], {}, TODAY)).toBeNull();
  });
  it('months in the future are ignored', () => {
    const k = computeKpis(months, days, {}, '2026-10-20');
    expect(k.lat.key).toBe('2026-10');
  });
});

describe('chart ranges and comparison', () => {
  it('presets cut from the end, YTD is the latest year', () => {
    expect(presetSlice(months, '3M').map((m) => m.key)).toEqual(['2026-09', '2026-10', '2026-11']);
    expect(presetSlice(months, 'YTD')).toHaveLength(11);
    expect(presetSlice(months, 'ALL')).toHaveLength(25);
    expect(presetSlice([], '6M')).toEqual([]);
  });
  it('compare is the equal-length period before, YTD is the same span last year, ALL and thin history give nothing', () => {
    expect(comparePeriod(months, '6M').map((m) => m.key)[0]).toBe('2025-12');
    expect(comparePeriod(months, '12M')).toHaveLength(12);
    expect(comparePeriod(months, '24M')).toEqual([]);
    expect(comparePeriod(months, 'YTD').map((m) => m.key)).toEqual([
      '2025-01',
      '2025-02',
      '2025-03',
      '2025-04',
      '2025-05',
      '2025-06',
      '2025-07',
      '2025-08',
      '2025-09',
      '2025-10',
      '2025-11',
    ]);
    expect(comparePeriod(months, 'ALL')).toEqual([]);
  });
  it('total chart lines the previous period up on the same bars', () => {
    const c = totalChart(months, '3M', true);
    expect(c.labels).toEqual(['Sep 26', 'Oct 26', 'Nov 26']);
    expect(c.datasets.map((d) => d.label)).toEqual(['Total', 'Previous period']);
    expect(c.datasets[1].data).toEqual(months.slice(-6, -3).map((m) => m.total));
    expect(totalChart(months, '3M', false).datasets).toHaveLength(1);
  });
  it('other charts', () => {
    expect(cashBankChart(months.slice(-2)).datasets.map((d) => d.label)).toEqual(['Cash', 'Banks']);
    expect(yearsOf(months)).toEqual([2024, 2025, 2026]);
    const y = yoyChart(months);
    expect(y.datasets.map((d) => d.label)).toEqual(['2024', '2025', '2026']);
    expect(y.datasets[0].data[0]).toBeNull(); // no Jan 2024
    expect(y.datasets[1].data[0]).toBe(months.find((m) => m.key === '2025-01').total);
    expect(
      clientsChart([
        { label: 'A', total: '5' },
        { label: 'B', total: '50' },
        { label: 'C', total: '-3' },
        { label: 'D', total: '0' },
      ]),
    ).toEqual({ labels: ['B', 'A'], data: [50, 5] });
  });
});

describe('tables and calendar', () => {
  it('summary rows are the latest months newest first, with diff when there is a COMP SALE', () => {
    const s = summaryRows(months, 3);
    expect(s.map((r) => r.key)).toEqual(['2026-11', '2026-10', '2026-09']);
    expect(s[0].diff).toBe(10);
    expect(summaryRows(normalizeMonths([{ month: '2021-04-01', total: 5, comp_sale: null, monthly_only: true }]))[0].diff).toBeNull();
  });
  it('top days and weekday averages', () => {
    const rows = normalizeDays([dayRow('2026-11-02', 500), dayRow('2026-11-03', 700), dayRow('2026-11-09', 300), dayRow('2026-11-10', 0)]);
    expect(topDays(rows, 2).map((d) => d.date)).toEqual(['2026-11-03', '2026-11-02']);
    const w = dayOfWeek(rows);
    expect(w.find((r) => r.name === 'Monday')).toMatchObject({ count: 2, avg: 400 }); // 2 Nov and 9 Nov 2026 are Mondays
    expect(Math.max(...w.map((r) => r.share))).toBe(1);
  });
  it('best and worst month per year leave out the running month', () => {
    const bw = bestWorst(months, TODAY);
    expect(bw.find((r) => r.year === 2026).best.key).toBe('2026-10');
    expect(bw.find((r) => r.year === 2024).worst.key).toBe('2024-11');
  });
  it('heat map: one cell per day, shaded by quartile of that year, Monday first', () => {
    const rows = normalizeDays([
      dayRow('2026-01-01', 100),
      dayRow('2026-01-02', 200),
      dayRow('2026-01-03', 300),
      dayRow('2026-01-04', 400),
    ]);
    const h = heatmapYear(rows, 2026);
    expect(h.cells).toHaveLength(365);
    expect(h.cells[0]).toMatchObject({ date: '2026-01-01', row: 3, col: 0, level: 1 }); // a Thursday
    expect(h.cells[1].level).toBeLessThanOrEqual(h.cells[3].level);
    expect(h.cells[3].level).toBe(4);
    expect(h.cells[10].level).toBe(0);
    expect(h.saleDays).toBe(4);
    expect(h.cols).toBe(53);
  });
});

describe('insights and race', () => {
  it('states the target pace, last weekday against its recent average, and month so far', () => {
    const k = computeKpis(months, days, { '2026-11': 2000 }, TODAY);
    const ins = buildInsights(k, days, TODAY);
    expect(ins.map((i) => i.id)).toContain('pace');
    expect(ins.find((i) => i.id === 'pace').text).toMatch(/next 21 days/);
    expect(ins.map((i) => i.id)).toContain('mom');
  });
  it('flags a weekday above its average and a 90-day record', () => {
    const many = [];
    for (let i = 0; i < 100; i++) {
      const d = new Date(Date.UTC(2026, 6, 1) + i * 86_400_000).toISOString().slice(0, 10);
      many.push(dayRow(d, 100));
    }
    many.push(dayRow('2026-11-09', 500));
    const dd = normalizeDays(many);
    const k = computeKpis(months, dd, {}, TODAY);
    const ins = buildInsights(k, dd, TODAY);
    expect(ins.find((i) => i.id === 'weekday').tone).toBe('good');
    expect(ins.some((i) => i.id === 'record')).toBe(true);
  });
  it('no insights without data', () => expect(buildInsights(null, [], TODAY)).toEqual([]));
  it('race: where the month stands, against the target, and where the pace is heading', () => {
    const r = raceData(computeKpis(months, days, { '2026-11': 2000 }, TODAY));
    expect(r.target).toBe(2000);
    expect(r.onTrack).toBe(r.forecast >= 2000);
    expect(r.targetPct).toBeLessThanOrEqual(100);
    expect(raceData(computeKpis(months, days, {}, TODAY))).toBeNull();
  });
});
