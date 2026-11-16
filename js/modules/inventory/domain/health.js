// Inventory Health: one traffic-light class per product, plus the numbers for the dashboard.
// Ported from the old app's Health dashboard, with one deliberate change (decision INV-17, one definition of "not sold"):
// the Never Sold and Dead Stock classes come from the Stock Ledger lists (whole packs, received date, 60-day windows by
// default), not from the dashboard's own looser tests. The four headline KPIs are the same four numbers as the Home cover
// (cover.js), so the dashboard and Home can never disagree.
//
// First match wins, most urgent first:
//   zeroStock  no stock (or negative)
//   neverSold  on the Never Sold list
//   dead       on the Dead Stock list
//   reorder    sells, and under 30 days of cover
//   excess     90 or more days of cover
//   healthy    everything else
// Velocity for reorder and cover is the 60-day rate; if nothing sold in 60 days the 30-day rate, then the 90-day rate.
import { computeCover } from './cover.js';
import { computeLedger } from './ledger.js';

export const HEALTH = { reorderCoverDays: 30, excessCoverDays: 90 };
export const FLAGS = ['reorder', 'excess', 'dead', 'neverSold', 'zeroStock', 'healthy'];

export function computeHealth(rows, { now = new Date(), windowDays = 60 } = {}) {
  const ledger = computeLedger(rows, { today: now, neverSoldDays: windowDays, deadDays: windowDays });
  const never = new Set(ledger.neverSold.map((r) => r.code));
  const dead = new Set(ledger.deadStock.map((r) => r.code));
  return rows.map((r) => {
    const stock = Number(r.qty) || 0;
    const price = Number(r.price) || 0;
    const q30 = Number(r.n30) || 0;
    const q60 = Number(r.n60) || 0;
    const q90 = Number(r.n90) || 0;
    const rate30 = q30 / 30;
    const rate60 = q60 / 60;
    const rate90 = q90 / 90;
    const rate = rate60 > 0 ? rate60 : rate30 > 0 ? rate30 : rate90;
    const coverDays = rate > 0 ? stock / rate : stock > 0 ? Infinity : 0;
    const demandQty = rate > 0 ? Math.max(0, Math.ceil(rate * HEALTH.reorderCoverDays - stock)) : 0;
    const valueOf = (w, q) => Number(r.taxable ? r['vi' + w] : r['ve' + w]) || q * price;
    let flag = 'healthy';
    if (stock <= 0) flag = 'zeroStock';
    else if (never.has(r.code)) flag = 'neverSold';
    else if (dead.has(r.code)) flag = 'dead';
    else if (rate > 0 && coverDays < HEALTH.reorderCoverDays) flag = 'reorder';
    else if (coverDays >= HEALTH.excessCoverDays) flag = 'excess';
    return {
      code: r.code || '',
      name: r.name || '(unnamed)',
      supplier: (r.supplier && String(r.supplier).trim()) || (r.company && String(r.company).trim()) || 'Unassigned',
      stock,
      unitPrice: price,
      stockValue: stock * price,
      qty30: q30,
      qty60: q60,
      qty90: q90,
      saleValue30: valueOf(30, q30),
      coverDays,
      demandQty,
      reorderValue: demandQty * price,
      flag,
    };
  });
}

export function healthCounts(health) {
  const c = Object.fromEntries(FLAGS.map((f) => [f, 0]));
  for (const r of health) c[r.flag] += 1;
  return c;
}

/** Stock value by supplier, biggest first. */
export function supplierBreakdown(health, topN = 8) {
  const map = new Map();
  for (const r of health) map.set(r.supplier, (map.get(r.supplier) || 0) + r.stockValue);
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, topN);
}

/** Best sellers by 30-day sale value (only products that sold). */
export const topMovers = (health, n = 8) =>
  health
    .filter((r) => r.saleValue30 > 0)
    .sort((a, b) => b.saleValue30 - a.saleValue30)
    .slice(0, n);

/** The dashboard's headline numbers: the Home four plus counts. */
export function healthKpis(rows, health, now = new Date()) {
  return { ...computeCover(rows, now), counts: healthCounts(health), skus: rows.length };
}
