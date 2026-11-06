// Number and date formatting for the whole app. Pure functions; Pakistan time is used for "today".
const NUM = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const NUM2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function money(v, { decimals = false } = {}) {
  if (v === null || v === undefined || v === '' || Number.isNaN(Number(v))) return '–';
  const n = Number(v);
  const s = (decimals ? NUM2 : NUM).format(Math.abs(n));
  return n < 0 && Number(s.replace(/[,.]/g, '')) !== 0 ? `−${s}` : s;
}

// Signed amount with an explicit plus for gains (used for DIFF).
export function signed(v) {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '–';
  const n = Number(v);
  return n > 0 ? `+${NUM.format(n)}` : n < 0 ? `−${NUM.format(Math.abs(n))}` : '0';
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const monthName = (m) => MONTHS[m - 1];
export const isoParts = (iso) => ({ y: Number(iso.slice(0, 4)), m: Number(iso.slice(5, 7)), d: Number(iso.slice(8, 10)) });
export const monthLabel = (iso) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
export const weekday = (iso) => DAYS[new Date(`${iso}T00:00:00Z`).getUTCDay()];
export const longDate = (iso) =>
  `${weekday(iso)}, ${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1].slice(0, 3)} ${iso.slice(0, 4)}`;
export const shortDate = (iso) => `${iso.slice(8, 10)} ${MONTHS[Number(iso.slice(5, 7)) - 1].slice(0, 3)} ${iso.slice(0, 4)}`;

// Today's date in Pakistan (the business day changes at 00:00 PKT), as YYYY-MM-DD.
export function todayPkt(now = new Date()) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  return p;
}

// Parses what a person types into a number field: "1,234", " 12 500.5", "-300". Returns null for blank, NaN for junk.
export function parseAmount(text) {
  const t = String(text ?? '')
    .replace(/[,\s]/g, '')
    .replace(/^−/, '-');
  if (t === '') return null;
  return /^-?\d+(\.\d{1,2})?$/.test(t) ? Number(t) : Number.NaN;
}
