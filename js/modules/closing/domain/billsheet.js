// The Bill Number Sheet: a printed A4 page of consecutive bill numbers (staff tick them off through the shift) with boxes to write the
// credit-type bills. Plain data only, so it can be tested without drawing. Nothing here is saved to the database or used in a calculation.
// The POS bill number has more digits than the paper needs, so the sheet shows its LAST FIVE digits (owner, 26 Nov 2026).

export const DEFAULT_COUNT = 250;
export const MAX_COUNT = 500;
export const COLUMNS = 10;
export const DEFAULT_TITLE = 'Evening Closing';
export const DEFAULT_BOXES = ['Salman Jazz Cash', 'Pharmacy Use', 'Expenses', 'Home Service', 'Staff Credit', 'Book Bill'];

const whole = (v) => {
  const digits = String(v ?? '').replace(/[^\d-]/g, '');
  if (!/\d/.test(digits)) return NaN;
  const n = Math.trunc(Number(digits));
  return Number.isFinite(n) ? n : NaN;
};

/** The last five digits of a bill number, as a number: 147452 -> 47452. Not a whole number, or below 0 -> null. */
export function lastFive(v) {
  const n = whole(v);
  return Number.isFinite(n) && n >= 0 ? n % 100000 : null;
}

/** The number the new sheet starts at: one after the last bill of the last closing (last five digits). Nothing known -> null. */
export function startAfter(lastBillNo) {
  const l = lastBillNo === null || lastBillNo === undefined || lastBillNo === '' ? null : lastFive(lastBillNo);
  return l === null || Number(lastBillNo) === 0 ? null : (l + 1) % 100000;
}

/** A typed start number (any digits) as 0..99999, or null when it is not one. */
export const parseStart = (v) => (String(v ?? '').trim() === '' ? null : lastFive(v));

/** A typed count kept between 1 and MAX_COUNT; anything unreadable becomes the default. */
export function parseCount(v) {
  const n = whole(v);
  return Number.isFinite(n) && n >= 1 ? Math.min(n, MAX_COUNT) : DEFAULT_COUNT;
}

/** 7 -> "00007"; the counter wraps after 99999. */
export const padBill = (n) => String(((Math.trunc(n) % 100000) + 100000) % 100000).padStart(5, '0');

/** The numbers, split into columns that read top to bottom, left to right (like the old paper sheet). */
export function numberColumns(start, count = DEFAULT_COUNT, columns = COLUMNS) {
  const total = parseCount(count);
  const rows = Math.ceil(total / columns);
  const cols = [];
  for (let c = 0; c < columns; c++) {
    const col = [];
    for (let r = 0; r < rows; r++) {
      const i = c * rows + r;
      if (i < total) col.push(padBill(start + i));
    }
    if (col.length) cols.push(col);
  }
  return cols;
}

/** The box names to print: blanks dropped, spaces trimmed, at most six, and the defaults when nothing is left. */
export function cleanBoxes(list) {
  const names = (Array.isArray(list) ? list : [])
    .map((s) =>
      String(s ?? '')
        .trim()
        .slice(0, 28),
    )
    .filter(Boolean);
  return names.length ? names.slice(0, 6) : [...DEFAULT_BOXES];
}

/** "47453 – 47702" for the heading line. */
export const rangeLabel = (start, count) => `${padBill(start)} – ${padBill(start + parseCount(count) - 1)}`;
