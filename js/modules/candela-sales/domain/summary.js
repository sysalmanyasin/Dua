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
