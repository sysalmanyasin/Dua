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

/**
 * How a row's difference reads on the counting screen, as in the old Audit Hub: an item not counted yet reads as zero in
 * stock ("assumed"), so the company total starts at the full shortage and shrinks as items are counted (R1).
 * hint is 'assumed', 'auto-matched' or ''.
 */
export function varianceView(item, entry) {
  const counted = !!entry && entry.qty !== null && entry.qty !== undefined;
  const auto = counted && !!entry.auto;
  const eff = computeEffectiveRow(item.system_qty, counted ? entry.qty : null, auto);
  return {
    counted,
    delta: eff.variance,
    value: varianceValuePaisa(eff.variance, toPaisa(item.retail_price)),
    hint: !counted ? 'assumed' : auto ? 'auto-matched' : '',
  };
}

/** The running difference in paisa for a set of items (a whole company), uncounted items read as zero in stock. */
export const impactPaisa = (items, entries) => items.reduce((sum, it) => sum + varianceView(it, entries[it.round_item_id]).value, 0);

/** The items grouped by company for display (names in order). One group with no company when there is only one company. */
export function groupByCompany(items) {
  const byName = (a, b) => String(a.name || a.code).localeCompare(String(b.name || b.code));
  const sorted = [...items].sort(byName);
  if (new Set(items.map((i) => i.company)).size <= 1) return [{ company: null, items: sorted }];
  const names = [...new Set(sorted.map((i) => i.company))].sort((a, b) => a.localeCompare(b));
  return names.map((company) => ({ company, items: sorted.filter((i) => i.company === company) }));
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

/** An assignment the person can still count: the round is counting and they have not submitted. A revoked one is no longer theirs. */
export const isOpenAssignment = (a) => a.round_state === 'counting' && a.status !== 'submitted' && a.status !== 'revoked';

/** The id of the only open assignment, or null when there is none or there are several. */
export function soleOpenAssignment(list) {
  const open = (list ?? []).filter(isOpenAssignment);
  return open.length === 1 ? open[0].assignment_id : null;
}

/** The first open assignment other than `currentId`, or null. */
export const nextOpenAssignment = (list, currentId) =>
  (list ?? []).find((a) => a.assignment_id !== currentId && isOpenAssignment(a)) ?? null;

/**
 * Codes of the items whose difference is not zero, uncounted items reading as zero in stock (R1), so a recount covers exactly
 * what the compile counts as different. Distinct, in list order, at most `max`.
 */
export function differingCodes(items, entries, max = MAX_CODES) {
  const seen = new Set();
  for (const it of items) {
    if (!it.code || varianceView(it, entries[it.round_item_id]).delta === 0) continue;
    seen.add(String(it.code));
    if (seen.size >= max) break;
  }
  return [...seen];
}

/** Whole rupees with the sign kept, from paisa. */
export const rupees = (paisa) => {
  const sign = paisa < 0 ? '-' : '';
  const abs = Math.abs(paisa);
  return `${sign}Rs ${Math.floor(abs / 100).toLocaleString('en-PK')}${abs % 100 ? `.${String(abs % 100).padStart(2, '0')}` : ''}`;
};
