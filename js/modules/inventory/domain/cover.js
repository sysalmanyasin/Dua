// The four Home numbers (decision INV-17 for the third one), the same ones inventory_cover_summary() computes in the
// database. This JavaScript version exists so the two can be compared on the same products (the parity test) and so the
// screens and the database can never quietly disagree about what a headline means.
//   stockValue  stock above zero x price
//   reorder     products that sold in the last 60 days and have under 30 days of cover: how many, and the cost of buying
//               up to 30 days (today excluded, so the figure is steady all day)
//   notSold     whole packs only: Never Sold + Dead Stock, 60 days
//   excess      the Stock Ledger's 100-day excess, narrowed to products at least 90 days old with at least 200 days of cover
import { computeLedger } from './ledger.js';
import { lowCoverWithin, computeReorderRows } from './reorder.js';

export const COVER = { window: 60, coverDays: 30, notSoldDays: 60 };

export function computeCover(rows, now = new Date()) {
  const ledger = computeLedger(rows, { today: now, neverSoldDays: COVER.notSoldDays, deadDays: COVER.notSoldDays });
  const reorder = lowCoverWithin(
    computeReorderRows(rows, { window: COVER.window, coverDays: COVER.coverDays, includeToday: false, now }),
    COVER.coverDays,
  );
  const sum = (list, f) => list.reduce((s, r) => s + f(r), 0);
  return {
    stockValue: sum(rows, (r) => ((Number(r.qty) || 0) > 0 ? r.qty * r.price : 0)),
    reorder: { count: reorder.length, value: sum(reorder, (r) => r.demandValueP) },
    notSold: {
      count: ledger.neverSold.length + ledger.deadStock.length,
      value: sum([...ledger.neverSold, ...ledger.deadStock], (r) => r.value),
    },
    excess: { count: ledger.excessDefault.length, value: sum(ledger.excessDefault, (r) => r.excessValue) },
  };
}
