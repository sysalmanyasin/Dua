// Display helpers for the Closing Book filters, the history tabs and the review list. Pure functions: every figure shown is one the database
// stored (closing_results) or one that was typed; nothing is added up or worked out here.
import { money, shortDate } from '../../../shared/format.js';
import { snapshotTitle } from './ledgers.js';

const M = (v) => money(v, { decimals: true });
const has = (v) => v !== null && v !== undefined && v !== '';
const num = (v) => Number(v) || 0;

/** The one-tap ranges of the Closing Book. */
export const PRESETS = [
  { id: 'days3', label: 'Last 3 days', days: 3 },
  { id: 'days7', label: 'Last 7 days', days: 7 },
  { id: 'days15', label: 'Last 15 days', days: 15 },
];

const addDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
/** The date range to ask the database for. `today` is 'YYYY-MM-DD'. A 3-day range is today and the two days before it. */
export function rangeFor(id, today) {
  const days = PRESETS.find((p) => p.id === id)?.days ?? 3;
  return { from: addDays(today, -(days - 1)), to: today };
}

/** Where a shift sits inside a day (the database's own slot order): Night 10, Morning 20, handovers 30+, Evening 9999. */
export const SHIFTS = [
  { v: 'any', label: 'Any', seq: null },
  { v: 'night', label: 'Night', seq: 10 },
  { v: 'morning', label: 'Morning', seq: 20 },
  { v: 'evening', label: 'Evening', seq: 9999 },
];

/** True when the closing lies inside the range. fromShift / toShift are 'any' or a shift value; 'any' means the whole day. */
export function inRange(p, { from, fromShift = 'any', to, toShift = 'any' }) {
  const lo = SHIFTS.find((s) => s.v === fromShift)?.seq ?? 0;
  const hi = SHIFTS.find((s) => s.v === toShift)?.seq ?? 99999;
  const d = p.business_date;
  if (from && (d < from || (d === from && p.seq < lo))) return false;
  if (to && (d > to || (d === to && p.seq > hi))) return false;
  return true;
}

export const pageTitle = (p) => `${shortDate(p.business_date)} · ${snapshotTitle(p)}`;

/** "500.00 (Less)" / "500.00 (Plus)": the direction is written, never carried by colour alone. */
export const variance = (v) => {
  const n = num(v);
  return n === 0 ? M(0) : `${M(Math.abs(n))} (${n > 0 ? 'Plus' : 'Less'})`;
};

const pick = (source, spec, keep) =>
  spec
    .filter(([k, , , always]) => has(source?.[k]) && (always || keep(source[k])))
    .map(([k, label, fmt = M]) => ({ label, value: fmt(source[k]) }));

export const HISTORY_TABS = [
  { id: 'cc', label: 'CC', path: '/closing/history/cc', blurb: 'Card (CC) at each Evening closing' },
  { id: 'rbd', label: 'RBD', path: '/closing/history/rbd', blurb: 'Returns, book bills and deposits' },
  { id: 'mediq', label: 'MEDIQ', path: '/closing/history/mediq', blurb: 'MEDIQ orders and extras' },
];

/** Rows for a history tab from newest-first pages: [{ key, title, rows }]; closings with nothing to show are skipped. */
export function historyRows(pages, tab) {
  const out = [];
  for (const p of pages ?? []) {
    const i = p.inputs ?? {};
    const r = p.results ?? {};
    let rows = [];
    if (tab === 'cc') {
      if (p.kind === 'evening' && has(r.cc_total))
        rows = [
          { label: 'Card (CC) now', value: M(r.cc_curr) },
          { label: 'Card (CC) total', value: M(r.cc_total) },
        ];
    } else if (tab === 'rbd') {
      rows = [
        ...pick(
          i,
          [
            ['ret_manual_1', 'Manual return 1'],
            ['ret_manual_2', 'Manual return 2'],
            ['ret_manual_3', 'Manual return 3'],
            ['ret_system', 'System returns'],
          ],
          (v) => num(v) !== 0,
        ),
        ...(num(r.total_returns) !== 0 ? [{ label: 'Returns total', value: M(r.total_returns) }] : []),
        ...pick(
          i,
          [
            ['book_bill_1', 'Book bill 1'],
            ['book_bill_2', 'Book bill 2'],
          ],
          (v) => num(v) !== 0,
        ),
        ...(p.deposits ?? []).map((d) => ({ label: d.label || 'Deposit', value: M(d.amount) })),
        ...(num(r.deposits_f) !== 0 ? [{ label: 'Deposits total', value: M(r.deposits_f) }] : []),
      ];
    } else if (tab === 'mediq') {
      rows = [
        ...(num(i.prev_mediq) !== 0 ? [{ label: 'Carried in', value: M(i.prev_mediq) }] : []),
        ...(p.mediq ?? []).map((m) => ({
          label: `Bill ${m.bill_no || '-'}`,
          value: `Collected ${M(m.collected)} · Pharmacy ${M(m.pharmacy_bill)}`,
        })),
        ...(num(r.mediq_extra) !== 0 ? [{ label: 'MEDIQ extra', value: M(r.mediq_extra) }] : []),
      ];
    }
    if (rows.length) out.push({ key: p.closing_id, title: pageTitle(p), rows });
  }
  return out;
}
