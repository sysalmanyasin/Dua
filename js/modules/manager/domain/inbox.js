// Pure Credit Inbox rules for the screen. The database (0108_mgmt_inbox.sql) decides everything and checks it again;
// this file only words things and repeats the checks so the screen can explain a problem before the owner presses File.
// The date and amount of the entry start as what Closing recorded and the owner may correct them while filing.
import { SHIFTS } from './ledger.js';

export const INBOX_TABS = [
  { id: 'unfiled', label: 'Unfiled' },
  { id: 'filed', label: 'Filed' },
  { id: 'dismissed', label: 'Dismissed' },
];

const KIND_WORDS = { named: 'Named customer', tier: 'Credit tier', free: 'Other credit', adjustment: 'Adjustment' };
export const kindLabel = (kind) => KIND_WORDS[kind] ?? 'Credit';

const SLOT_WORDS = { day: 'Day shift', night: 'Night shift', morning: 'Morning shift', evening: 'Evening shift' };
// The shift a ledger entry starts with, taken from the Closing slot (the owner can change it).
export const defaultShift = (slotKind) => ({ morning: 'Morning', evening: 'Evening', night: 'Night' })[slotKind] ?? SHIFTS[0];

export const slotLabel = (kind, seq) => `${SLOT_WORDS[kind] ?? kind ?? 'Shift'}${Number(seq) > 1 ? ` ${seq}` : ''}`;

// Where this person may file to. Seeing the inbox is not enough: the target's own key is needed as well.
export function allowedTargets(perms) {
  const p = perms instanceof Set ? perms : new Set(perms ?? []);
  return { credit: p.has('mgmt.credit_manage'), ledger: p.has('mgmt.ledgers') };
}

// The lines of a tab. Lines Closing has since removed can only be dismissed; the screen says so.
export const linesFor = (lines, tab) => (lines ?? []).filter((l) => l.state === tab);
export const waitingCount = (lines) => (lines ?? []).filter((l) => l.state === 'unfiled' && !l.removed).length;

// What filing would do, in words, before the owner confirms.
export function filingSummary(line, { target, person = null, ledger = null, category = null }) {
  if (target === 'credit') return person ? `Staff credit for ${person.full_name}` : '';
  if (target === 'ledger' && ledger && category)
    return `${ledger.name} · ${category.name} (${category.direction === 1 ? 'adds' : 'reduces'})`;
  return '';
}

// Mirrors the checks in mgmt_inbox_file. Returns { field: message }; empty means "looks fine".
export function validateFiling(line, form, { ledgers = [], people = [] } = {}) {
  const errors = {};
  const amount = form.amount === undefined || form.amount === '' ? Number(line.amount) : Number(form.amount);
  const date = form.date || line.business_date;
  if (!Number.isFinite(amount) || amount === 0) errors.amount = 'Enter an amount.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) errors.date = 'Pick a date.';
  if (line.removed) errors.line = 'Closing has removed this line. Dismiss it instead.';
  if (form.target === 'credit') {
    const person = people.find((p) => p.staff_id === form.staffId);
    if (!person) errors.staff = 'Pick a person.';
    else if (person.opening_month && date < person.opening_month)
      errors.staff = 'This date is before that person’s opening balance month.';
  } else if (form.target === 'ledger') {
    const ledger = ledgers.find((l) => l.ledger_id === form.ledgerId);
    const category = ledger?.categories.find((c) => c.id === form.categoryId);
    if (!ledger) errors.ledger = 'Pick a ledger.';
    else if (!category) errors.category = 'Pick a category.';
    if (amount < 0) errors.line = 'A negative line can only go to staff credit, or be dismissed.';
    if (ledger?.has_shift && !SHIFTS.includes(form.shift)) errors.shift = 'Pick a shift.';
  } else {
    errors.target = 'Pick where this line goes.';
  }
  return errors;
}

// "Changed after filing": Closing now says something different from what the owner filed or dismissed. Nothing moves by itself.
export function changeNote(line) {
  if (!line.changed_after_filing) return '';
  if (line.removed) return 'Closing has removed this line since.';
  const parts = [];
  if (Number(line.amount) !== Number(line.filed_amount)) parts.push(`amount is now ${line.amount} (was ${line.filed_amount})`);
  if ((line.label ?? '') !== (line.filed_label ?? '')) parts.push('the name changed');
  return `Changed in Closing: ${parts.join(', ') || 'details changed'}.`;
}
