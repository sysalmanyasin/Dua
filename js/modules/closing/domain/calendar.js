// Month calendar of the start page: which days have which closings, and what to suggest opening next on a day. Pure functions.
export const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
export const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

/** Cells of a month grid: leading blanks, then { date, day }. month is 0-11. */
export function monthCells(year, month) {
  const first = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const pad = (n) => String(n).padStart(2, '0');
  return [
    ...Array.from({ length: first }, () => null),
    ...Array.from({ length: days }, (_, k) => ({ day: k + 1, date: `${year}-${pad(month + 1)}-${pad(k + 1)}` })),
  ];
}

/** { 'YYYY-MM-DD': [kinds] } for the closings that count as saved (submitted) on each day, in slot order, one dot per kind. */
export function dotsByDate(records) {
  const order = ['night', 'morning', 'handover', 'evening'];
  const out = {};
  for (const r of records ?? []) {
    if (r.status !== 'submitted') continue;
    (out[r.business_date] ??= new Set()).add(r.kind);
  }
  return Object.fromEntries(Object.entries(out).map(([d, set]) => [d, order.filter((k) => set.has(k))]));
}

/** The slot to suggest for a day: the one after the last submitted closing of that day, else Night. null when the Evening is done. */
export function suggestForDate(date, records) {
  const done = new Set((records ?? []).filter((r) => r.status === 'submitted' && r.business_date === date).map((r) => r.kind));
  if (done.has('evening')) return null;
  if (done.has('morning') || done.has('handover')) return 'evening';
  if (done.has('night')) return 'morning';
  return 'night';
}
