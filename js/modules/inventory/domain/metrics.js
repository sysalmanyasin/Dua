// "Stock not sold in N days": the headline number (old app: js/shared/inventory-metrics.js). ONE definition, so the same
// count and value appear wherever it is shown. Different on purpose from the Stock Ledger lists (ledger.js), which round
// to whole packs and also look at the received date: the headline counts every unit in stock.
//
// A product counts when it holds stock (qty > 0) AND
//   - its last sale date is older than N days, OR
//   - it has no last sale date AND no net sales in the 90-day window (a missing date with sales in the window is NOT slow).
// Value = qty x price.
const num = (v) => {
  const x = parseFloat(String(v === null || v === undefined ? '' : v).replace(/,/g, ''));
  return Number.isFinite(x) ? x : 0;
};

export const qtyOf = (r) => num(r && r.qty);
export const priceOf = (r) => num(r && r.price);

export function isNotSold(row, days = 90, now = Date.now()) {
  if (!row || qtyOf(row) <= 0) return false;
  const last = row.sold ? new Date(row.sold).getTime() : NaN;
  if (Number.isFinite(last)) return last < now - days * 86400000;
  return num(row.n90) <= 0;
}

/** @returns {{ count: number, value: number, rows: Array, valued: Array<{row: object, value: number}> }} largest value first */
export function notSoldStock(rows, days = 90, now = Date.now()) {
  const hit = (Array.isArray(rows) ? rows : [])
    .filter((r) => isNotSold(r, days, now))
    .map((r) => ({ row: r, value: qtyOf(r) * priceOf(r) }))
    .sort((a, b) => b.value - a.value);
  return { count: hit.length, value: Math.round(hit.reduce((s, x) => s + x.value, 0)), rows: hit.map((x) => x.row), valued: hit };
}
