// Expiry helpers: statuses, month choices and the form check. Pure functions, no network or DOM.
export const STATUSES = ['Near Expiry', 'Sold', 'Returned to Warehouse', 'Discarded'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** 'YYYY-MM' to 'November 2026'. Anything else comes back as it was. */
export function monthLabel(key) {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(String(key ?? ''));
  return m ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : String(key ?? '');
}

/** The month key moved by n months: ('2026-11', 3) is '2027-02'. */
export function shiftMonth(key, n) {
  const m = /^(\d{4})-(\d{2})$/.exec(key);
  if (!m) return key;
  const total = Number(m[1]) * 12 + (Number(m[2]) - 1) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

/** The months a near-expiry entry may carry: from 3 months back to 3 years ahead (the database enforces the same window). */
export const monthOptions = (current) =>
  Array.from({ length: 40 }, (_, i) => shiftMonth(current, i - 3)).map((value) => ({ value, label: monthLabel(value) }));

/** Checks the logging form before it is sent. Returns the first problem in words, or null. The database checks again. */
export function checkEntry({ product, qty, month, rack }) {
  if (!product) return 'Search for a product and pick it.';
  const n = Number(qty);
  if (!Number.isFinite(n) || n <= 0) return 'Enter a quantity above zero.';
  if (!month) return 'Choose the expiry month.';
  if (!rack) return 'Choose a rack.';
  return null;
}

/** A new key for one save. The same key sent twice is one entry. */
export const newKey = () =>
  globalThis.crypto?.randomUUID?.() ??
  'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16));
