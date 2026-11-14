// The Stock Ledger lists, ported from the old app (js/inventory/stockledger.js, computeAll) with the same rules and the
// same arithmetic; tests/unit/inventory-ledger.test.js compares every list with numbers produced by the old code.
//
// Row shape (see domain/join.js): code, name, qty, price, company, generic, supplier, pack, created, received, sold,
// and the sales half n90 (net quantity sold in the last 90 days).
//
//   zeroStock    qty is exactly 0: nothing to value, listed for reference only.
//   packIssues   qty not 0 and the pack size is not a usable number: kept out of Never Sold and Dead Stock because the
//                quantity cannot be rounded down to whole packs (still eligible for Excess, which ignores pack size).
//   neverSold    no sale date at all, received more than `neverSoldDays` ago, at least one whole pack in stock.
//   deadStock    has a sale date, but the last sale AND the last receipt are both more than `deadDays` ago, at least one
//                whole pack in stock. Never overlaps Never Sold (that one requires "no sale date").
//   excess       sold something in 90 days, stock above 100 days of that rate, and at least 4 units in stock.
//   excessDefault  excess narrowed to products at least 90 days old with at least 200 days of stock cover (a missing
//                  creation date counts as old enough).
// Values: Never Sold and Dead Stock count whole packs only (rounded-down quantity x price); Excess counts every unit
// above the target.
import { daysSince, downRound, isPackValid, n0 } from './stockMath.js';

export const EXCESS_MIN_AGE_DAYS = 90;
export const EXCESS_MIN_STOCK_DAYS = 200;
export const DEFAULT_WINDOW_DAYS = 60; // decision INV-10 (both windows; adjustable on the screen)

/**
 * @param {Array} rows joined product rows
 * @param {{ today?: Date, neverSoldDays?: number, deadDays?: number }} [opts]
 */
export function computeLedger(rows, { today = new Date(), neverSoldDays = DEFAULT_WINDOW_DAYS, deadDays = DEFAULT_WINDOW_DAYS } = {}) {
  const neverSold = [];
  const deadStock = [];
  const excess = [];
  const packIssues = [];
  const zeroStock = [];

  for (const it of rows) {
    const stock = n0(it.qty);
    const unitPrice = n0(it.price);
    const recDays = daysSince(it.received, today);
    const saleDays = daysSince(it.sold, today);
    const hasSale = !!it.sold;
    const net90 = n0(it.n90);

    if (stock === 0) {
      zeroStock.push({ ...it, unitPrice, recDays, saleDays, net90 });
      continue;
    }

    if (!isPackValid(it.pack)) {
      packIssues.push({ ...it, qty: stock, unitPrice, recDays, saleDays, net90, stockValue: stock * unitPrice });
    } else {
      const pack = Number(it.pack);
      if (!hasSale && recDays !== null && recDays > neverSoldDays) {
        const dr = downRound(stock, pack);
        if (dr.qty > 0)
          neverSold.push({
            ...it,
            qty: stock,
            pack,
            unitPrice,
            recDays,
            packs: dr.packs,
            roundedQty: dr.qty,
            loose: dr.loose,
            value: dr.qty * unitPrice,
          });
      }
      if (hasSale && saleDays !== null && saleDays > deadDays && recDays !== null && recDays > deadDays) {
        const dr = downRound(stock, pack);
        if (dr.qty > 0)
          deadStock.push({
            ...it,
            qty: stock,
            pack,
            unitPrice,
            recDays,
            saleDays,
            packs: dr.packs,
            roundedQty: dr.qty,
            loose: dr.loose,
            value: dr.qty * unitPrice,
          });
      }
    }

    // 100-day excess: net90 is the trailing 90-day net quantity sold; scale it to a 100-day target.
    const dailyRate = net90 / 90;
    const target100 = dailyRate * 100;
    const excessQty = stock - target100;
    const daysOld = daysSince(it.created, today);
    const stockDays = dailyRate > 0 ? stock / dailyRate : null;
    if (net90 > 0 && excessQty > 0 && stock >= 4) {
      excess.push({ ...it, qty: stock, unitPrice, net90, target100, excessQty, excessValue: excessQty * unitPrice, daysOld, stockDays });
    }
  }

  const excessDefault = excess.filter((r) => {
    if (r.daysOld !== null && r.daysOld < EXCESS_MIN_AGE_DAYS) return false;
    return r.stockDays !== null && r.stockDays >= EXCESS_MIN_STOCK_DAYS;
  });

  return { neverSold, deadStock, excess, excessDefault, packIssues, zeroStock };
}

/** Total of a list's `value` (or the named field), rounded to whole rupees. */
export const sumValue = (list, field = 'value') => Math.round(list.reduce((s, r) => s + (Number(r[field]) || 0), 0));
