// Small arithmetic shared by the Inventory reports. Ported unchanged from the old app's Stock Ledger
// (daysSince, downRound, isPackValid) so the numbers agree with what the owner is used to; see the golden fixtures.

/** Parse a date or date-time string. null when blank or not a date. */
export function parseDate(str) {
  if (!str) return null;
  const d = new Date(str);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Whole days between `str` and `today` (a Date, so the time of day counts, as in the old app). null when no date. */
export function daysSince(str, today) {
  const d = parseDate(str);
  if (!d) return null;
  return Math.floor((today - d) / 86400000);
}

/** Round stock down to whole packs: { packs, qty, loose }. A missing or non-positive pack counts as 1. */
export function downRound(stock, pack) {
  const p = pack && pack > 0 ? pack : 1;
  const packs = Math.floor(stock / p);
  return { packs, qty: packs * p, loose: stock - packs * p };
}

/** A usable pack size: a finite number above zero. */
export function isPackValid(raw) {
  const n = Number(raw);
  return raw !== '' && raw != null && Number.isFinite(n) && n > 0;
}

/** Numbers as the old app read them: anything that is not a number counts as 0. */
export const n0 = (v) => Number(v) || 0;
