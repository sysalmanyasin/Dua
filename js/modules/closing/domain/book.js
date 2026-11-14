// Display helpers for the Closing Book, the history tabs and the review list. Pure functions: every figure shown is one the database
// stored (closing_results) or one that was typed; nothing is added up or worked out here.
import { money, shortDate } from '../../../shared/format.js';
import { snapshotTitle } from './ledgers.js';

const M = (v) => money(v, { decimals: true });
const INT = (v) => String(Math.round(Number(v) || 0));
const has = (v) => v !== null && v !== undefined && v !== '';
const num = (v) => Number(v) || 0;

export const RANGES = [
  { id: 'last10', label: 'Last 10 closings' },
  { id: 'days3', label: 'Last 3 days' },
  { id: 'days7', label: 'Last 7 days' },
  { id: 'month', label: 'Last month' },
];

const addDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
/** The date range and page limit to ask the database for. `today` is 'YYYY-MM-DD'. */
export function rangeFor(id, today) {
  if (id === 'days3') return { from: addDays(today, -2), to: today, limit: 200 };
  if (id === 'days7') return { from: addDays(today, -6), to: today, limit: 200 };
  if (id === 'month') return { from: addDays(today, -30), to: today, limit: 200 };
  return { from: null, to: null, limit: 10 };
}

/** The database answers newest first; a book is read oldest first. */
export const chronological = (pages) => [...(pages ?? [])].reverse();

/** Which page to show for a date: the last page on that date or the closest earlier one; the first page if the date is before all of them. */
export function pageIndexForDate(pages, date) {
  if (!pages?.length) return -1;
  let found = 0;
  pages.forEach((p, i) => {
    if (p.business_date <= date) found = i;
  });
  return found;
}

export const pageTitle = (p) => `${shortDate(p.business_date)} · ${snapshotTitle(p)}`;

/** "500.00 (Less)" / "500.00 (Plus)": the direction is written, never carried by colour alone. */
export const variance = (v) => {
  const n = num(v);
  return n === 0 ? M(0) : `${M(Math.abs(n))} (${n > 0 ? 'Plus' : 'Less'})`;
};

const INPUTS = [
  ['sys_cash', 'System cash', M, true],
  ['last_bill_no', 'Last bill no.', INT, true],
  ['comp_sale', 'Comp sale'],
  ['alfalah', 'Alfalah'],
  ['keenu', 'Keenu'],
  ['ret_manual_1', 'Manual return 1'],
  ['ret_manual_2', 'Manual return 2'],
  ['ret_manual_3', 'Manual return 3'],
  ['ret_system', 'System returns'],
  ['final_sys_returns', 'System returns (final)'],
  ['book_bill_1', 'Book bill 1'],
  ['book_bill_2', 'Book bill 2'],
  ['extra_cash', 'Extra cash'],
  ['credit_adj', 'Credit adjustment'],
];
const CARRIED = [
  ['prev_cash', 'Cash'],
  ['prev_cc', 'Card (CC)'],
  ['prev_credit', 'Credit'],
  ['prev_deposits', 'Deposits'],
  ['prev_mediq', 'MEDIQ'],
];
const OVERRIDES = [
  ['ov_shift_sale', 'Shift sale', M],
  ['ov_customers', 'Customers', INT],
  ['ov_curr_cc', 'Card (CC) now', M],
  ['ov_prev_cash', 'Previous cash', M],
];
const RESULTS = [
  ['shift_sale', 'Shift sale'],
  ['customers', 'Customers', INT],
  ['customers_charge', 'Customer charge'],
  ['hs_total', 'HS total'],
  ['strips_a', 'Strips'],
  ['total_returns', 'Returns'],
  ['mediq_extra', 'MEDIQ extra'],
  ['net_sale', 'Net sale'],
  ['cc_curr', 'Card (CC) now'],
  ['cc_total', 'Card (CC) total'],
  ['till_c', 'Till'],
  ['vault_d', 'Vault'],
  ['debt_e', 'Credit'],
  ['deposits_f', 'Deposits'],
  ['misc_g', 'Misc'],
  ['grand', 'Grand total'],
  ['liquid', 'Liquid'],
  ['prev_cash', 'Previous cash'],
  ['net_cash', 'Net cash'],
  ['shift_variance', 'Shift variance', variance],
];
const FINAL_RESULTS = [
  ['final_net_sale', 'Final net sale'],
  ['final_net_cash', 'Final net cash'],
  ['final_variance', 'Final variance', variance],
];

const pick = (source, spec, keep) =>
  spec
    .filter(([k, , , always]) => has(source?.[k]) && (always || keep(source[k])))
    .map(([k, label, fmt = M]) => ({ label, value: fmt(source[k]) }));

const when = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-GB', { timeZone: 'Asia/Karachi', dateStyle: 'medium', timeStyle: 'short' });
};

const AREA = { till: 'Till', vault: 'Vault' };

/** A page as printable sections: [{ id, title, rows: [{ label, value }] }]; empty sections are left out. */
export function bookSections(p) {
  const i = p.inputs ?? {};
  const r = p.results ?? {};
  const head = [
    p.staff ? { label: 'Entered for', value: p.staff } : null,
    p.submitted_at ? { label: 'Submitted', value: when(p.submitted_at) } : null,
    { label: 'Closing type', value: p.mode === 'final' ? 'Final' : 'Shift' },
    Number(p.revision) > 1 ? { label: 'Revision', value: String(p.revision) } : null,
    p.correction_reason ? { label: 'Corrected because', value: p.correction_reason } : null,
  ].filter(Boolean);
  const list = (rows, label, value) => (rows ?? []).map((x) => ({ label: label(x), value: value(x) }));
  const cash = (p.cash ?? []).filter((c) => num(c.qty) !== 0);
  const audit = p.audit
    ? [
        { label: 'Verified', value: when(p.audit.verified_at) || 'Yes' },
        has(p.audit.data_as_of) ? { label: 'Stock data as of', value: when(p.audit.data_as_of) } : null,
        { label: 'Codes not found', value: INT((p.audit.not_found ?? []).length) },
      ].filter(Boolean)
    : [];
  const sections = [
    { id: 'head', title: 'Closing', rows: head },
    { id: 'typed', title: 'Typed figures', rows: pick(i, INPUTS, (v) => num(v) !== 0) },
    { id: 'carried', title: 'Carried in', rows: pick(i, CARRIED, (v) => num(v) !== 0) },
    { id: 'overrides', title: 'Overrides', rows: pick(i, OVERRIDES, () => true) },
    {
      id: 'hs',
      title: 'HS',
      rows: list(
        p.hs,
        (x) => x.label || 'HS',
        (x) => M(x.amount),
      ),
    },
    {
      id: 'strips',
      title: 'Strips',
      rows: list(
        p.strips,
        (x) => x.label,
        (x) => `${INT(x.qty)} × ${M(x.price)}`,
      ),
    },
    {
      id: 'cash',
      title: 'Till and vault count',
      rows: list(
        cash,
        (x) => `${AREA[x.area] ?? x.area} ${INT(x.denomination)}`,
        (x) => `× ${INT(x.qty)}`,
      ),
    },
    {
      id: 'mediq',
      title: 'MEDIQ orders',
      rows: list(
        p.mediq,
        (x) => `Bill ${x.bill_no || '-'}`,
        (x) => `Collected ${M(x.collected)} · Pharmacy ${M(x.pharmacy_bill)}`,
      ),
    },
    {
      id: 'credit',
      title: 'Credit lines',
      rows: list(
        p.credit,
        (x) => x.label || 'Credit',
        (x) => M(x.amount),
      ),
    },
    {
      id: 'deposits',
      title: 'Deposits',
      rows: list(
        p.deposits,
        (x) => x.label || 'Deposit',
        (x) => M(x.amount),
      ),
    },
    {
      id: 'misc',
      title: 'Misc charges',
      rows: list(
        p.misc,
        (x) => x.label || 'Charge',
        (x) => M(x.amount),
      ),
    },
    { id: 'audit', title: 'Inventory audit', rows: audit },
    {
      id: 'results',
      title: 'Results',
      rows: [...pick(r, RESULTS, () => true), ...(p.mode === 'final' ? pick(r, FINAL_RESULTS, () => true) : [])],
    },
  ];
  return sections.filter((s) => s.rows.length);
}

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
