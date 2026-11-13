// Pure helpers for Candela's imported daily aggregates. No DOM, network or database calls.
// Supabase numeric values may arrive as decimal strings; convert them to integer paisa before adding.

export function toPaisa(value) {
  if (value === null || value === undefined || value === '') return 0;
  const raw = String(value).trim();
  const match = raw.match(/^([+-]?)(\d+)(?:\.(\d+))?$/);
  if (!match) throw new TypeError('Invalid monetary amount');
  const sign = match[1] === '-' ? -1n : 1n;
  const fraction = match[3] ?? '';
  let paisa = BigInt(match[2]) * 100n + BigInt((fraction + '00').slice(0, 2));
  if (fraction.length > 2 && fraction[2] >= '5') paisa += 1n;
  const result = Number(paisa * sign);
  if (!Number.isSafeInteger(result)) throw new RangeError('Monetary amount is outside the safe range');
  return result;
}

export const fromPaisa = (paisa) => {
  if (!Number.isSafeInteger(paisa)) throw new TypeError('Paisa total must be a safe integer');
  return paisa / 100;
};

const PAYMENT_FIELDS = ['cash_sale', 'card_sale', 'credit_sale', 'total_sale'];

export function summarizePayments(rows = []) {
  const totals = Object.fromEntries(PAYMENT_FIELDS.map((field) => [field, 0]));
  for (const row of rows) {
    for (const field of PAYMENT_FIELDS) totals[field] += toPaisa(row[field]);
  }
  return Object.fromEntries(PAYMENT_FIELDS.map((field) => [field, fromPaisa(totals[field])]));
}

export function filterPaymentDays(rows = [], { from = null, to = null } = {}) {
  return rows
    .filter((row) => (!from || row.sale_day >= from) && (!to || row.sale_day <= to))
    .slice()
    .sort((a, b) => b.sale_day.localeCompare(a.sale_day));
}

export function monthlyPayments(rows = []) {
  const months = new Map();
  for (const row of rows) {
    const month = String(row.sale_day ?? '').slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) continue;
    if (!months.has(month)) months.set(month, []);
    months.get(month).push(row);
  }
  return [...months.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, days]) => ({ month, days: days.length, ...summarizePayments(days) }));
}

export function filterCreditRows(rows = [], { from = null, to = null, search = '' } = {}) {
  const needle = String(search).trim().toLocaleLowerCase();
  return rows
    .filter((row) => (!from || row.sale_day >= from) && (!to || row.sale_day <= to))
    .filter((row) => !needle || String(row.customer_name ?? '').toLocaleLowerCase().includes(needle))
    .slice()
    .sort(
      (a, b) =>
        b.sale_day.localeCompare(a.sale_day) ||
        String(a.customer_name ?? '').localeCompare(String(b.customer_name ?? '')),
    );
}

export function summarizeCredit(rows = []) {
  let amount = 0;
  let receipts = 0;
  for (const row of rows) {
    amount += toPaisa(row.credit_amount);
    const count = Number(row.receipt_count ?? 0);
    if (!Number.isSafeInteger(count) || count < 0) throw new TypeError('Receipt count must be a non-negative integer');
    receipts += count;
  }
  if (!Number.isSafeInteger(receipts)) throw new RangeError('Receipt count is outside the safe range');
  return { credit_amount: fromPaisa(amount), receipt_count: receipts, rows: rows.length };
}
