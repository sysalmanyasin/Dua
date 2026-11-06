// Add Entry form: turns what people type into the lines and header the database expects. Pure functions.
import { parseAmount } from '../../../shared/format.js';
import { computeDiff, computeTotal } from './totals.js';

export const HEADER_FIELDS = [
  { key: 'comp_sale', label: 'COMP SALE', integer: false },
  { key: 'customers', label: 'Customers', integer: true },
  { key: 'fdpp_pos', label: 'FDPP POS', integer: false },
  { key: 'fdpp_consumer', label: 'FDPP Consumer', integer: false },
  { key: 'amount_received', label: 'Amount Received', integer: false },
  { key: 'load_sale', label: 'Load Sale', integer: false },
  { key: 'cash_to_deposit', label: 'Cash to be Deposited', integer: false },
];

export const emptyForm = () => ({ values: {}, header: {}, reason: '' });

const text = (v) => (v === null || v === undefined || Number(v) === 0 ? '' : String(Number(v)));

export function formFromDay(day, lines) {
  const form = emptyForm();
  for (const l of lines) form.values[l.method_code] = text(l.amount);
  for (const f of HEADER_FIELDS) form.header[f.key] = day[f.key] === null || day[f.key] === undefined ? '' : String(Number(day[f.key]));
  form.header.low_sale_reason = day.low_sale_reason ?? '';
  return form;
}

// Returns { ok, errors, lines, header }. `errors` is keyed by method code or header key.
export function parseForm(form, methods) {
  const errors = {};
  const lines = [];
  const known = new Set(methods.map((m) => m.code));
  for (const [code, raw] of Object.entries(form.values)) {
    if (!known.has(code)) continue;
    const v = parseAmount(raw);
    if (v === null) continue;
    if (Number.isNaN(v)) errors[code] = 'Enter a number';
    else if (Math.abs(v) > 1_000_000_000) errors[code] = 'Too large';
    else lines.push({ method: code, amount: v });
  }
  const header = {};
  for (const f of HEADER_FIELDS) {
    const v = parseAmount(form.header[f.key]);
    if (v === null) header[f.key] = null;
    else if (Number.isNaN(v) || (f.integer && (!Number.isInteger(v) || v < 0)))
      errors[f.key] = f.integer ? 'Whole number' : 'Enter a number';
    else header[f.key] = v;
  }
  header.low_sale_reason = String(form.header.low_sale_reason ?? '').trim() || null;
  return { ok: Object.keys(errors).length === 0, errors, lines, header };
}

export function preview(form, methods) {
  const { lines, header } = parseForm(form, methods);
  const total = computeTotal(lines, methods);
  return { total, diff: computeDiff(total, header.comp_sale), hasData: lines.length > 0 };
}

// Maps database error text to something a person can act on.
export function friendlyError(message) {
  const m = String(message ?? '');
  if (/reason is required/i.test(m)) return 'Please write the reason for this correction.';
  if (/future/i.test(m)) return 'That date is in the future.';
  if (/not allowed|permission/i.test(m)) return 'You do not have permission to do that.';
  if (/inactive|unknown method/i.test(m)) return 'One of the payment fields is no longer available. Reload the page.';
  if (/out of range/i.test(m)) return 'One of the amounts is too large.';
  return 'Could not save. Please check the numbers and try again.';
}
