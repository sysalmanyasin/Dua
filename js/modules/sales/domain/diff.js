// Diff report: DIFF = TOTAL - COMP SALE, summed by month, with a running (cumulative) total.
// Inside a month the day-by-day running total restarts at 0, as in the original report.
const hasData = (d) => Number(d.total) !== 0 || (d.comp_sale !== null && d.comp_sale !== undefined && Number(d.comp_sale) !== 0);
const round = (x) => Math.floor(x + 0.5);

export function buildDiffReport(days) {
  const sorted = days.filter(hasData).sort((a, b) => a.business_date.localeCompare(b.business_date));
  const months = [];
  let cumulative = 0;
  for (const d of sorted) {
    const key = d.business_date.slice(0, 7);
    let m = months.at(-1);
    if (!m || m.month !== key) {
      m = { month: key, total: 0, comp_sale: 0, diff: 0, cumulative: 0, days: [] };
      months.push(m);
    }
    const total = Number(d.total) || 0;
    const comp = Number(d.comp_sale) || 0;
    const diff = round(total - comp);
    const previous = m.days.at(-1)?.running ?? 0;
    m.days.push({ date: d.business_date, total, comp_sale: comp, diff, running: previous + diff });
    m.total += total;
    m.comp_sale += comp;
  }
  for (const m of months) {
    m.diff = round(m.total - m.comp_sale);
    cumulative += m.diff;
    m.cumulative = cumulative;
  }
  return months.reverse();
}
