// Reorder Report maths, ported from the old app (js/inventory/reorder-data.js: computeAllRows, lowCoverWithin, topNByValue).
// Same arithmetic; tests/unit/inventory-engines.test.js compares every number with what the old code produced.
//
// For each product and each window (30, 60, 90 days):
//   sale quantity = net quantity sold in the window  (+ today's sales when `includeToday`)
//   daily rate    = sale quantity / (window + the part of today that has passed, when `includeToday`)
//   days of cover = stock / daily rate              (null when nothing sold)
//   demand        = whole units to buy to reach `coverDays` of cover: max(0, ceil(rate x coverDays - stock))
// "Today" is folded in because the window figures end yesterday evening; they never overlap, so it is a plain sum.
// With includeToday off the figures match Candela's own C-19 report (historical windows only).
// Sale value uses the tax-inclusive figure for taxable products and the tax-exclusive one otherwise.
export const WINDOWS = [30, 60, 90];
const KARACHI_OFFSET_MS = 5 * 3600 * 1000; // the pharmacy's clock: UTC+5, no daylight saving

/** How much of today has passed in Karachi, 0..1. */
export function todayFraction(now = new Date()) {
  return Math.min(1, Math.max(0, ((now.getTime() + KARACHI_OFFSET_MS) % 86400000) / 86400000));
}

/**
 * @param {Array} rows joined product rows (stock + sales halves)
 * @param {{ window?: number, coverDays?: number, includeToday?: boolean, now?: Date, inTransit?: Record<string, number> }} [opts]
 */
export function computeReorderRows(rows, { window = 60, coverDays = 30, includeToday = true, now = new Date(), inTransit = {} } = {}) {
  const fraction = todayFraction(now);
  const fold = includeToday !== false;
  return rows.map((r) => {
    const stock = Number(r.qty) || 0;
    const price = Number(r.price) || 0;
    const taxable = !!r.taxable;
    const todayQty = Number(r.n0) || 0;
    const todayValue = Number(taxable ? r.vi0 : r.ve0) || 0;
    const foldQty = fold ? todayQty : 0;
    const foldValue = fold ? todayValue : 0;
    const out = {
      code: r.code || '',
      name: r.name || '',
      supplier: (r.supplier && String(r.supplier).trim()) || (r.company && String(r.company).trim()) || 'Unspecified',
      company: r.company || '',
      stock,
      unitPrice: price,
      inTransitQty: inTransit[r.code] || 0,
      saleQtyToday: todayQty,
      saleValueToday: todayValue,
      isTaxable: taxable,
      taxPercent: Number(r.tax) || 0,
    };
    for (const w of WINDOWS) {
      const historicalQty = Number(r['n' + w]) || 0;
      const historicalValue = Number(taxable ? r['vi' + w] : r['ve' + w]) || 0;
      const saleQty = historicalQty + foldQty;
      const saleValue = historicalValue + foldValue;
      const dailyRate = saleQty / (w + (fold ? fraction : 0));
      out['saleQty' + w] = saleQty;
      out['saleQty' + w + 'Historical'] = historicalQty;
      out['saleValue' + w] = saleValue;
      out['saleValue' + w + 'Historical'] = historicalValue;
      out['daysCover' + w] = dailyRate > 0 ? stock / dailyRate : null;
      out['demandQty' + w] = dailyRate > 0 ? Math.max(0, Math.ceil(dailyRate * coverDays - stock)) : 0;
    }
    out.saleQtyP = out['saleQty' + window];
    out.saleValueP = out['saleValue' + window];
    out.daysCoverP = out['daysCover' + window];
    out.demandQtyP = out['demandQty' + window];
    out.demandValueP = out.demandQtyP * price;
    return out;
  });
}

/** Sold something in the primary window and has less than `coverDays` of cover (zero or negative stock included on purpose). */
export const lowCoverWithin = (rows, coverDays) => rows.filter((r) => r.saleQtyP > 0 && r.daysCoverP !== null && r.daysCoverP < coverDays);

/** Rank by sale value (only products that sold in the window), keep the best N. */
export const topNByValue = (rows, n) =>
  rows
    .filter((r) => r.saleQtyP > 0)
    .sort((a, b) => b.saleValueP - a.saleValueP)
    .slice(0, Math.max(1, n || 50));

/** The two tabs of the report: "Top N" ranks everything first, then applies the cover limit; "All flagged" is every low-cover product. */
export function reorderLists(rows, opts = {}) {
  const coverDays = opts.coverDays ?? 30;
  const all = computeReorderRows(rows, opts);
  return { all, flagged: lowCoverWithin(all, coverDays), topN: lowCoverWithin(topNByValue(all, opts.topN ?? 50), coverDays) };
}

/** Sort rows by a key; text compares as text, and a missing days-of-cover sorts as "infinite" (never urgent). */
export function sortRows(rows, key, dir = -1) {
  const isDays = key.startsWith('daysCover');
  return [...rows].sort((a, b) => {
    let av = a[key];
    let bv = b[key];
    if (typeof av === 'string' || typeof bv === 'string') return String(av || '').localeCompare(String(bv || '')) * dir;
    if (av === null || av === undefined) av = isDays ? Infinity : 0;
    if (bv === null || bv === undefined) bv = isDays ? Infinity : 0;
    return (Number(av) - Number(bv)) * dir;
  });
}
