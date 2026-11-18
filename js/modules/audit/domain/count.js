// Counting screen logic: reading what a person typed, the difference on each row, filters and totals. Pure functions.
// Money is integer paisa, quantities are compared in thousandths (see compile.js); the database does the final sums.
import { computeEffectiveRow, varianceValuePaisa } from './compile.js';

export const MAX_QTY = 999999999;
export const MAX_CODES = 500;
export const MAX_COMPANIES = 20;

/** Retail price from the database (rupees, up to 2 decimals) to integer paisa. */
export const toPaisa = (price) => Math.round(Number(price ?? 0) * 100);

/** "12", "12.5", "١٢" is not accepted. Returns a number of 0 or more with up to 3 decimals, or null when the text is not a quantity. */
export function parseQty(text) {
  const t = String(text ?? '').trim();
  if (!/^\d+(\.\d{1,3})?$/.test(t)) return null;
  const n = Number(t);
  return n <= MAX_QTY ? n : null;
}

/** Product codes typed or pasted, separated by spaces, commas, semicolons or lines. Distinct, in the order given. */
export function parseCodes(text) {
  const seen = new Set();
  const out = [];
  for (const raw of String(text ?? '').split(/[\s,;]+/)) {
    const c = raw.trim();
    if (c && !seen.has(c)) {
      seen.add(c);
      out.push(c);
    }
  }
  return out;
}

/** Company names typed one per line (or separated by semicolons, since a name can contain a comma). Distinct, in the order given. */
export function parseCompanies(text) {
  const seen = new Set();
  const out = [];
  for (const raw of String(text ?? '').split(/[\n;]+/)) {
    const c = raw.trim();
    if (c && !seen.has(c)) {
      seen.add(c);
      out.push(c);
    }
  }
  return out;
}

/**
 * One row as the counter sees it. `entry` is { qty, auto } or null when nothing is counted yet.
 * `difference` is counted minus system (a shortage is negative); `value` is that times the retail price, in paisa.
 */
export function rowView(item, entry) {
  const counted = !!entry && entry.qty !== null && entry.qty !== undefined;
  const eff = computeEffectiveRow(item.system_qty, counted ? entry.qty : null, !!entry?.auto);
  return {
    counted,
    auto: !!entry?.auto,
    qty: counted ? Number(entry.qty) : null,
    difference: counted ? eff.variance : null,
    value: counted ? varianceValuePaisa(eff.variance, toPaisa(item.retail_price)) : null,
  };
}

/** Totals for the header. Items not yet counted are not in the difference figures; they are shown as "to count". */
export function summarize(items, entries) {
  let counted = 0;
  let different = 0;
  let value = 0;
  for (const it of items) {
    const v = rowView(it, entries[it.round_item_id]);
    if (!v.counted) continue;
    counted += 1;
    if (v.difference !== 0) different += 1;
    value += v.value;
  }
  return { total: items.length, counted, left: items.length - counted, different, value };
}

/** mode: 'all' | 'todo' | 'done' | 'diff'. text matches code, name or company, ignoring case. */
export function filterItems(items, entries, { text = '', company = '', mode = 'all' } = {}) {
  const q = text.trim().toLowerCase();
  return items.filter((it) => {
    if (company && it.company !== company) return false;
    if (q && !`${it.code} ${it.name} ${it.company}`.toLowerCase().includes(q)) return false;
    if (mode === 'all') return true;
    const v = rowView(it, entries[it.round_item_id]);
    if (mode === 'todo') return !v.counted;
    if (mode === 'done') return v.counted;
    return v.counted && v.difference !== 0;
  });
}

/** Whole rupees with the sign kept, from paisa. */
export const rupees = (paisa) => {
  const sign = paisa < 0 ? '-' : '';
  const abs = Math.abs(paisa);
  return `${sign}Rs ${Math.floor(abs / 100).toLocaleString('en-PK')}${abs % 100 ? `.${String(abs % 100).padStart(2, '0')}` : ''}`;
};
