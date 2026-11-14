// Pure helpers for Candela's imported daily aggregates. No DOM, network or database calls.
// Supabase numeric values may arrive as decimal strings; convert to integer paisa before adding.

export function toPaisa(value) {
  if (value === null || value === undefined || value === '') return 0;

  const raw = String(value).trim();
  const match = raw.match(/^([+-]?)(\d+)(?:\.(\d+))?$/);
  if (!match) throw new TypeError('Invalid monetary amount');

  const sign = match[1] === '-' ? -1n : 1n;
  const fraction = match[3] ?? '';
  let paisa = BigInt(match[2]) * 100n;
  paisa += BigInt((fraction + '00').slice(0, 2));
  if (fraction.length > 2 && fraction[2] >= '5') paisa += 1n;

  const result = Number(paisa * sign);
  if (!Number.isSafeInteger(result)) {
    throw new RangeError('Monetary amount is outside the safe range');
  }
  return result;
}

export function fromPaisa(paisa) {
  if (!Number.isSafeInteger(paisa)) {
    throw new TypeError('Paisa total must be a safe integer');
  }
  return paisa / 100;
}

export function summarizePayments(rows = []) {
  const totals = { cash_sale: 0, card_sale: 0, credit_sale: 0, total_sale: 0 };

  for (const row of rows) {
    totals.cash_sale += toPaisa(row.cash_sale);
    totals.card_sale += toPaisa(row.card_sale);
    totals.credit_sale += toPaisa(row.credit_sale);
    totals.total_sale += toPaisa(row.total_sale);
  }

  return {
    cash_sale: fromPaisa(totals.cash_sale),
    card_sale: fromPaisa(totals.card_sale),
    credit_sale: fromPaisa(totals.credit_sale),
    total_sale: fromPaisa(totals.total_sale),
  };
}

export function filterPaymentDays(rows = [], from = null, to = null) {
  const filtered = [];

  for (const row of rows) {
    if (from && row.sale_day < from) continue;
    if (to && row.sale_day > to) continue;
    filtered.push(row);
  }

  return filtered.sort((a, b) => b.sale_day.localeCompare(a.sale_day));
}

export function filterCreditRows(rows = [], from = null, to = null, search = '') {
  const needle = String(search).trim().toLocaleLowerCase();
  const filtered = [];

  for (const row of rows) {
    if (from && row.sale_day < from) continue;
    if (to && row.sale_day > to) continue;

    const customer = String(row.customer_name ?? '');
    if (needle && !customer.toLocaleLowerCase().includes(needle)) continue;
    filtered.push(row);
  }

  return filtered.sort((a, b) => b.sale_day.localeCompare(a.sale_day));
}

export function summarizeCredit(rows = []) {
  let amount = 0;
  let receipts = 0;

  for (const row of rows) {
    amount += toPaisa(row.credit_amount);

    const count = Number(row.receipt_count ?? 0);
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new TypeError('Receipt count must be a non-negative integer');
    }
    receipts += count;
  }

  if (!Number.isSafeInteger(receipts)) {
    throw new RangeError('Receipt count is outside the safe range');
  }

  return { credit_amount: fromPaisa(amount), receipt_count: receipts, rows: rows.length };
}

// ───────── history views (kept rows, newest first) ─────────

// One customer = one name, ignoring case and extra spaces (same rule as the database's candela_customer_key).
export const customerKey = (name) =>
  String(name ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();

const emptyPay = () => ({ cash_sale: 0, card_sale: 0, credit_sale: 0, total_sale: 0 });

// Month roll-up of daily rows: [{ month: '2026-11', days, cash_sale, card_sale, credit_sale, total_sale }], newest first.
export function groupPaymentsByMonth(rows = []) {
  const months = new Map();
  for (const row of rows) {
    const month = String(row.sale_day).slice(0, 7);
    const m = months.get(month) ?? { month, days: 0, ...emptyPay() };
    m.days += 1;
    for (const k of Object.keys(emptyPay())) m[k] += toPaisa(row[k]);
    months.set(month, m);
  }
  return [...months.values()]
    .sort((a, b) => b.month.localeCompare(a.month))
    .map((m) => ({
      month: m.month,
      days: m.days,
      cash_sale: fromPaisa(m.cash_sale),
      card_sale: fromPaisa(m.card_sale),
      credit_sale: fromPaisa(m.credit_sale),
      total_sale: fromPaisa(m.total_sale),
    }));
}

// Credit rows (one per customer per day) added up per customer, biggest first.
export function groupCreditByCustomer(rows = []) {
  const people = new Map();
  for (const row of rows) {
    const key = row.customer_key ?? customerKey(row.customer_name);
    const p = people.get(key) ?? { customer_key: key, customer_name: row.customer_name || '(no name)', amount: 0, receipts: 0, days: 0 };
    p.amount += toPaisa(row.credit_amount);
    const count = Number(row.receipt_count ?? 0);
    if (!Number.isSafeInteger(count) || count < 0) throw new TypeError('Receipt count must be a non-negative integer');
    p.receipts += count;
    p.days += 1;
    people.set(key, p);
  }
  return [...people.values()]
    .sort((a, b) => b.amount - a.amount || a.customer_name.localeCompare(b.customer_name))
    .map((p) => ({
      customer_key: p.customer_key,
      customer_name: p.customer_name,
      credit_amount: fromPaisa(p.amount),
      receipt_count: p.receipts,
      days: p.days,
    }));
}

// Share of a whole as a whole-number percent (0 when the whole is 0). Done in paisa so it never drifts.
export function percentOf(part, whole) {
  const w = toPaisa(whole);
  if (w === 0) return 0;
  return Math.round((toPaisa(part) * 100) / w);
}

// Today against yesterday: { change, percent } where percent is null when yesterday was 0.
export function compareTotals(today, yesterday) {
  const t = toPaisa(today);
  const y = toPaisa(yesterday);
  return { change: fromPaisa(t - y), percent: y === 0 ? null : Math.round(((t - y) * 100) / y) };
}

// ───────── dates (plain YYYY-MM-DD strings; no time zones involved) ─────────
export function addDays(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export const monthStart = (iso) => `${iso.slice(0, 7)}-01`;
