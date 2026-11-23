// Pure helpers for the Owner's Business Intelligence on Home. No Supabase, no DOM.
// The database supplies every figure (Sales as entered, Inventory's own summary, Closing counts); this file only checks the
// shape, words the comparison fairly and lays out the trend bars. Detailed financial analysis stays in Sales and Reports.

export const PERIODS = [7, 30, 90];
export const DEFAULT_PERIOD = 30;

const num = (v) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
const int0 = (v) => Math.max(0, Math.trunc(num(v) ?? 0));
const iso = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);

export function normaliseBi(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw.sales ?? {};
  const t = raw.transactions ?? {};
  const o = raw.operations ?? {};
  const inv = raw.inventory && typeof raw.inventory === 'object' ? raw.inventory : null;
  const part = (p) => ({ count: int0(p?.count), value: num(p?.value) ?? 0 });
  return {
    days: PERIODS.includes(Number(raw.days)) ? Number(raw.days) : DEFAULT_PERIOD,
    from: iso(raw.from),
    to: iso(raw.to),
    sales: {
      total: num(s.total) ?? 0,
      recordedDays: int0(s.recorded_days),
      avg: num(s.avg_per_day),
      prevTotal: num(s.previous_total) ?? 0,
      prevDays: int0(s.previous_recorded_days),
      prevAvg: num(s.previous_avg_per_day),
      series: (Array.isArray(s.series) ? s.series : [])
        .map((p) => ({ date: iso(p?.date), total: num(p?.total) }))
        .filter((p) => p.date && p.total !== null),
    },
    transactions: {
      total: int0(t.total),
      countedDays: int0(t.counted_days),
      avg: num(t.avg_per_day),
      prevTotal: int0(t.previous_total),
      prevDays: int0(t.previous_counted_days),
      prevAvg: num(t.previous_avg_per_day),
    },
    inventory: inv
      ? {
          stockValue: num(inv.stockValue),
          reorder: part(inv.reorder),
          notSold: part(inv.notSold),
          excess: part(inv.excess),
          asOf: typeof inv.asOf === 'string' ? inv.asOf : null,
        }
      : null,
    inventoryFailed: raw.inventory_failed === true,
    operations: {
      daysInPeriod: int0(o.days_in_period) || (PERIODS.includes(Number(raw.days)) ? Number(raw.days) : DEFAULT_PERIOD),
      daysWithSales: int0(o.days_with_sales),
      daysWithClosing: int0(o.days_with_closing),
      closingsSubmitted: int0(o.closings_submitted),
      openDrafts: int0(o.open_drafts),
    },
  };
}

// Change in the average per recorded day against the period before. Averages (not totals) keep the comparison fair when a
// day was not entered. Says so plainly when there is nothing to compare or when too few days were recorded to trust it.
export function compareAverages(avg, prevAvg, recordedDays, prevRecordedDays, periodDays) {
  if (avg === null || prevAvg === null || prevAvg <= 0) return { pct: null, direction: null, text: 'No earlier period to compare with' };
  const pct = ((avg - prevAvg) / prevAvg) * 100;
  const rounded = Math.round(pct * 10) / 10;
  const direction = Math.abs(rounded) < 0.5 ? 'flat' : rounded > 0 ? 'up' : 'down';
  const thin = recordedDays < periodDays / 2 || prevRecordedDays < periodDays / 2;
  const word =
    direction === 'flat'
      ? 'About the same as'
      : `${direction === 'up' ? '▲' : '▼'} ${Math.abs(rounded)}% ${direction === 'up' ? 'above' : 'below'}`;
  return {
    pct: rounded,
    direction,
    thin,
    text: `${word} the previous ${periodDays} days${thin ? ' (few days recorded, so take with care)' : ''}`,
  };
}

export const completeness = (recorded, period, what) => `${what} for ${recorded} of ${period} days`;

// One bar per calendar day of the period, so a day with no entry shows as a gap instead of being skipped.
export function trendBars(series, fromIso, toIso, { width = 300, height = 80, gap = 1 } = {}) {
  if (!fromIso || !toIso) return [];
  const start = Date.parse(`${fromIso}T00:00:00Z`);
  const end = Date.parse(`${toIso}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return [];
  const byDate = new Map(series.map((p) => [p.date, p.total]));
  const n = Math.round((end - start) / 86_400_000) + 1;
  const max = Math.max(0, ...series.map((p) => p.total));
  const bw = Math.max(1, width / n - gap);
  return Array.from({ length: n }, (_, i) => {
    const date = new Date(start + i * 86_400_000).toISOString().slice(0, 10);
    const total = byDate.has(date) ? byDate.get(date) : null;
    const h = total !== null && max > 0 ? Math.max(1, (total / max) * height) : 0;
    return { date, total, missing: total === null, x: i * (width / n), y: height - h, w: bw, h };
  });
}
