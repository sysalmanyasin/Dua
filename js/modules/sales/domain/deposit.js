// Cash to be Deposited = Cash Sale - Cash Returns + FDPP POS + FDPP Consumer, worked out fresh for every day.
const n = (v) => Number(v) || 0;
const round = (x) => Math.floor(x + 0.5);

export const depositValue = (d) => round(n(d.cash_sale) - Math.abs(n(d.cash_returns)) + n(d.fdpp_pos) + n(d.fdpp_consumer));

// Rows (newest first) that carry data, each with its deposit value.
export function depositRows(days) {
  return days
    .filter((d) => n(d.total) !== 0 || d.low_sale_reason)
    .map((d) => ({ ...d, deposit: depositValue(d) }))
    .sort((a, b) => b.business_date.localeCompare(a.business_date));
}

export function summarizeSelection(rows, selected) {
  const chosen = rows.filter((r) => selected.has(r.business_date)).sort((a, b) => a.business_date.localeCompare(b.business_date));
  return { rows: chosen, count: chosen.length, total: chosen.reduce((s, r) => s + r.deposit, 0) };
}
