// Display helpers for the Credit Ledger and the Misc Ledger. Pure functions, no money maths: every figure shown is one the database
// stored (closing_results.debt_e, closings.prev_credit, closings.credit_adj) or a line the cashier typed.
import { money, shortDate } from '../../../shared/format.js';
import { slotLabel } from './slots.js';

/** "Today", "1 day", "12 days". Aging is shown as plain days; the owner has set no thresholds, so none are invented. */
export function daysText(n) {
  const d = Math.max(0, Math.round(Number(n) || 0));
  return d === 0 ? 'Today' : d === 1 ? '1 day' : `${d} days`;
}

/** Snapshots as [{ date, items: [...] }], keeping the newest-first order the database returned. */
export function groupByDate(snapshots) {
  const groups = [];
  for (const s of snapshots ?? []) {
    const last = groups[groups.length - 1];
    if (last && last.date === s.business_date) last.items.push(s);
    else groups.push({ date: s.business_date, items: [s] });
  }
  return groups;
}

/** "Morning", "Handover 2", with " (opening)" or " (corrected)" where it applies. */
export function snapshotTitle(s) {
  const base = slotLabel(s.kind, s.seq);
  return s.is_opening ? `${base} (opening)` : Number(s.revision) > 1 ? `${base} (corrected)` : base;
}

const num = (v) => Number(v) || 0;

/**
 * The 3-inch receipt for one credit snapshot as plain rows: { title } | { sub } | { rule } | { left, right }.
 * The same rows are drawn on screen in the tests, so what is checked is what prints.
 */
export function receiptRows(s) {
  const rows = [
    { title: 'CREDIT LEDGER' },
    { sub: `${shortDate(s.business_date)} · ${snapshotTitle(s)}` },
    { sub: s.mode === 'final' ? 'Final closing' : 'Shift closing' },
    { rule: true },
    { left: 'Carried in', right: money(s.prev_credit, { decimals: true }) },
  ];
  for (const l of s.lines ?? []) rows.push({ left: l.label || 'Credit', right: money(l.amount, { decimals: true }) });
  if (num(s.credit_adj) !== 0) rows.push({ left: 'Adjustment', right: money(s.credit_adj, { decimals: true }) });
  rows.push({ rule: true }, { left: 'TOTAL CREDIT', right: money(s.debt_e, { decimals: true }) }, { rule: true });
  return rows;
}
