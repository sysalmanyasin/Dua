// Grouping and comparing sales by month and year. Pure functions.
import { percentChange } from './totals.js';

const ym = (iso) => iso.slice(0, 7);

// Days (any order) -> months, newest first, each with its days newest first.
export function groupDaysByMonth(days) {
  const map = new Map();
  for (const d of [...days].sort((a, b) => b.business_date.localeCompare(a.business_date))) {
    const key = ym(d.business_date);
    if (!map.has(key)) map.set(key, { month: key, days: [], total: 0, comp_sale: 0, customers: 0 });
    const g = map.get(key);
    g.days.push(d);
    g.total += Number(d.total) || 0;
    g.comp_sale += Number(d.comp_sale) || 0;
    g.customers += Number(d.customers) || 0;
  }
  return [...map.values()].map((g) => ({ ...g, diff: Math.floor(g.total - g.comp_sale + 0.5), count: g.days.length }));
}

// Months from daily detail (v_monthly rows) plus months that only exist as monthly figures.
export function buildIndex(monthlyRows, historyRows) {
  const rows = new Map();
  for (const r of monthlyRows) {
    rows.set(ym(r.month), {
      month: ym(r.month),
      total: Number(r.total) || 0,
      days: Number(r.days) || 0,
      comp_sale: r.comp_sale === null ? null : Number(r.comp_sale),
      customers: r.customers === null ? null : Number(r.customers),
      monthlyOnly: false,
    });
  }
  for (const h of historyRows) {
    const key = ym(h.month);
    if (rows.has(key)) continue;
    rows.set(key, {
      month: key,
      total: Number(h.total) || 0,
      days: 0,
      comp_sale: h.comp_sale === null ? null : Number(h.comp_sale),
      customers: h.customers === null ? null : Number(h.customers),
      monthlyOnly: true,
    });
  }
  const list = [...rows.values()].sort((a, b) => b.month.localeCompare(a.month));
  const byKey = new Map(list.map((r) => [r.month, r]));
  return list.map((r) => {
    const prev = byKey.get(`${Number(r.month.slice(0, 4)) - 1}${r.month.slice(4)}`);
    const diff = r.comp_sale === null ? null : Math.floor(r.total - r.comp_sale + 0.5);
    return {
      ...r,
      diff,
      avgPerDay: r.days ? Math.round(r.total / r.days) : null,
      vsLastYear: prev ? percentChange(r.total, prev.total) : null,
    };
  });
}

export function groupMonthsByYear(months) {
  const map = new Map();
  for (const m of months) {
    const y = m.month.slice(0, 4);
    if (!map.has(y)) map.set(y, { year: y, months: [], total: 0 });
    const g = map.get(y);
    g.months.push(m);
    g.total += m.total;
  }
  return [...map.values()];
}
