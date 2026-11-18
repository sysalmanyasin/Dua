// Pure ledger rules (the database, 0107_mgmt_ledgers.sql, is the authority; this repeats it for previews and is tested against the SAME
// fixture tests/fixtures/manager-ledger-cases.json). Amounts are always positive; each entry carries its direction (effect +1 adds,
// -1 reduces). Opening balance is zero. The balance after an entry is the sum of every entry up to it in date order (ties: the order
// they were added). Sums are exact (paisa).
import { fromPaisa, toPaisa } from './credit.js';

// entries: [{ date: 'YYYY-MM-DD', effect: 1 | -1, amount }] in the order they were added. Returns the balance after each, by that order.
export function runningBalances(entries) {
  const order = entries
    .map((_, i) => i)
    .sort((a, b) => (entries[a].date < entries[b].date ? -1 : entries[a].date > entries[b].date ? 1 : a - b));
  const out = new Array(entries.length);
  let run = 0;
  for (const i of order) {
    run += entries[i].effect * toPaisa(entries[i].amount);
    out[i] = fromPaisa(run);
  }
  return out;
}

export const directionWord = (direction) => (direction > 0 ? 'adds' : 'reduces');

// The sentence shown next to a balance, in the owner's own words (MGR-22): never a bare +/-.
export function balanceMessage(ledger, balance) {
  const b = toPaisa(balance);
  if (b === 0) return { text: 'Settled', amount: 0, tone: 'zero' };
  return b > 0
    ? { text: ledger.positive_label, amount: fromPaisa(b), tone: 'positive' }
    : { text: ledger.negative_label, amount: fromPaisa(-b), tone: 'negative' };
}

// Totals per category over some entries (reversals are entries too, with the opposite direction, so they net out).
export function groupByCategory(entries) {
  const map = new Map();
  for (const e of entries) {
    const g = map.get(e.category_id) ?? {
      category_id: e.category_id,
      name: e.category_name,
      direction: e.category_direction,
      added: 0,
      reduced: 0,
      count: 0,
    };
    if (e.effect > 0) g.added += toPaisa(e.amount);
    else g.reduced += toPaisa(e.amount);
    g.count += 1;
    map.set(e.category_id, g);
  }
  return [...map.values()].map((g) => ({
    ...g,
    added: fromPaisa(g.added),
    reduced: fromPaisa(g.reduced),
    net: fromPaisa(g.added - g.reduced),
  }));
}

// Early feedback only; the database repeats every one of these checks.
export function validateLedgerEntry({ date, amount, today, categoryId, shift, needsShift }) {
  if (!categoryId) return 'Pick a category.';
  if (amount === null || amount === undefined || Number.isNaN(amount) || amount <= 0) return 'Enter an amount above zero.';
  if (amount > 1e9) return 'That amount is too large.';
  if (!date) return 'Pick a date.';
  if (date > today) return 'The date cannot be in the future.';
  if (needsShift && !shift) return 'Pick a shift.';
  return null;
}

// Balance Tally: the Jazz Cash ledger balance (money held) plus the counted accounts, against what the "expense app" says.
export function tallyTotal(ledgerBalance, amounts) {
  return fromPaisa(toPaisa(ledgerBalance) + amounts.reduce((s, a) => s + toPaisa(a), 0));
}
export function tallyDifference(total, appTotal) {
  const d = toPaisa(total) - toPaisa(appTotal);
  return { amount: fromPaisa(d), label: d === 0 ? 'Balanced' : d > 0 ? 'Extra cash' : 'Short' };
}

export const SHIFTS = ['Morning', 'Evening', 'Night', 'Both', 'Off'];
