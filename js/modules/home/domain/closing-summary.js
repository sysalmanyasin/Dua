// The Owner's "Latest closing summary" on Home: turns what the database returns (ops_closing_summary) into the words and boxes shown.
// Pure functions. Nothing is calculated here: every figure was added up by Closing (closing_ops_summary, migration 0227).

const SLOT_NAMES = { night: 'Night', morning: 'Morning', evening: 'Evening' };

/** "Night", "Morning", "Evening", "Handover 2" (seq 40; 30 is the first handover, as in the Closing module). */
export function slotName(kind, seq) {
  if (kind === 'handover') return `Handover ${Math.max(1, Math.round((Number(seq) - 20) / 10))}`;
  return SLOT_NAMES[kind] ?? String(kind ?? '');
}

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** "Rs. 19,872", with paisa only when there are some. */
export function rs(v) {
  const n = num(v);
  const decimals = !Number.isInteger(n);
  const body = new Intl.NumberFormat('en-US', { minimumFractionDigits: decimals ? 2 : 0, maximumFractionDigits: decimals ? 2 : 0 }).format(
    Math.abs(n),
  );
  return `${n < 0 ? '−' : ''}Rs. ${body}`;
}

/**
 * The card for one database answer.
 *   null                    -> { state: 'hidden' }  (not for this person)
 *   { has_closing: false }  -> { state: 'empty' }
 *   otherwise               -> { state: 'ready', title, mode, note, cards: [{ id, label, value }] }
 */
export function buildClosingSummary(raw) {
  if (raw === null || raw === undefined) return { state: 'hidden' };
  if (typeof raw !== 'object' || !raw.has_closing) return { state: 'empty' };

  const title = `${raw.business_date} — Closing ${num(raw.day_no) || '?'} — ${slotName(raw.kind, raw.seq)}`;
  const isFinal = raw.mode === 'final';
  const n = num(raw.period_closings);
  let note;
  if (isFinal) note = 'This is a Final Closing, so the period since the last Final starts here.';
  else if (raw.period_start)
    note = `Book Bills, Manual Returns, Total Deposits and MEDIQ are since the last Final Closing (${raw.period_start}): ${n} closing${n === 1 ? '' : 's'}.`;
  else note = `No Final Closing yet, so the totals run from the first closing: ${n} closing${n === 1 ? '' : 's'}.`;

  return {
    state: 'ready',
    title,
    mode: isFinal ? 'Final' : raw.is_opening ? 'Opening' : 'Shift',
    note,
    cards: [
      { id: 'carried-cc', label: 'Carried CC', value: rs(raw.carried_cc) },
      { id: 'deposits', label: 'Total Deposits', value: rs(raw.deposits) },
      { id: 'book-bills', label: 'Book Bills', value: rs(raw.book_bills) },
      { id: 'manual-returns', label: 'Manual Returns', value: rs(raw.manual_returns) },
      { id: 'mediq', label: 'MEDIQ Collected', value: rs(raw.mediq_collected) },
    ],
  };
}
