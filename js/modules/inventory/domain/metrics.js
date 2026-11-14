// "Stock not sold in N days": the headline number. ONE definition everywhere (decision INV-17, owner, 13 Nov 2026):
// whole packs only. It is the Stock Ledger's Never Sold list plus its Dead Stock list for the same window, so the
// headline always equals what the two lists add up to (ledger.js has the rules: pack size usable, received date, whole
// packs, value = whole packs x price). The old app's looser headline (every loose unit, no received-date test) is retired.
import { computeLedger, DEFAULT_WINDOW_DAYS } from './ledger.js';

/**
 * @param {Array} rows joined product rows (needs the sales half, for the last sale date)
 * @param {number} [days] the window, default 60 (INV-10)
 * @param {Date} [today]
 * @returns {{ count: number, value: number, neverSold: Array, deadStock: Array }} value in whole rupees
 */
export function notSoldStock(rows, days = DEFAULT_WINDOW_DAYS, today = new Date()) {
  const { neverSold, deadStock } = computeLedger(rows, { today, neverSoldDays: days, deadDays: days });
  const value = Math.round([...neverSold, ...deadStock].reduce((s, r) => s + r.value, 0));
  return { count: neverSold.length + deadStock.length, value, neverSold, deadStock };
}
