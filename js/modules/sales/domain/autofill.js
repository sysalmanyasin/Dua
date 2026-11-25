// Add Entry auto-pull: turns the saved evening closing and Candela's figures for one day into form values.
// Pure functions: no screen, no database.
//
//   Cash Sale       = the evening closing's System Cash Sales Total
//   Bank Alfalah    = the evening closing's Bank Alfalah card machine
//   Bank Alfalah 2  = the evening closing's Keenu card machine
//   Cash Returns    = Cash Sale - Candela's cash for the day (rounded to the rupee first)
//   Comp Sale       = Candela's total for the day (rounded to the rupee)
//   Credit clients  = Candela's credit by customer, matched to our fields by name

const NOISE = new Set(['ltd', 'limited', 'pvt', 'private', 'co', 'company', 'corp', 'corporation', 'inc', 'the', 'and', 'of', 'pakistan']);

// "Askari General Insurance Company Ltd." -> ['askari', 'general', 'insurance']
export const nameTokens = (s) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((t) => t && !NOISE.has(t));

const cents = (v) => Math.round(Number(v) * 100) / 100;
const asText = (v) => String(cents(v));
const finite = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));

// Fields whose Candela customer name is spelled out in full. Keyed by the field's name, any case.
export const ALIASES = {
  lda: ['Lahore Development Authority'],
  pso: ['Pakistan State Oil'],
};

// The word lists a field answers to: its own name, plus any alias.
const variantsOf = (label) => {
  const own = nameTokens(label);
  const key = own.join(' ');
  const extra = Object.entries(ALIASES)
    .filter(([k]) => nameTokens(k).join(' ') === key)
    .flatMap(([, names]) => names.map(nameTokens));
  return [own, ...extra].filter((t) => t.length);
};

// Picks the one field a Candela customer belongs to, or null (no field, or more than one fits equally).
// An exact name match wins; otherwise a field whose words all appear in the customer's name ("Askari" in "Askari General
// Insurance"), the most specific one first. Fields that deduct (returns) are never a target.
export function matchClient(customerName, clients) {
  const cust = nameTokens(customerName);
  if (!cust.length) return null;
  const cs = new Set(cust);
  const cands = clients
    .map((m) => {
      const hits = variantsOf(m.label).filter((t) => t.every((w) => cs.has(w)));
      return { m, n: Math.max(0, ...hits.map((t) => t.length)) };
    })
    .filter((x) => x.n > 0);
  if (!cands.length) return null;
  const exact = cands.filter((x) => x.n === cs.size);
  if (exact.length) return exact.length === 1 ? exact[0].m : null;
  const most = Math.max(...cands.map((x) => x.n));
  const best = cands.filter((x) => x.n === most);
  return best.length === 1 ? best[0].m : null;
}

const byLabel = (methods, section, label) =>
  methods.find((m) => m.section === section && nameTokens(m.label).join(' ') === nameTokens(label).join(' ')) ?? null;

/**
 * @param {{closing: object|null, candela: object|null}} src  the two published feeds for one day (either may be null)
 * @param {Array} methods  the active payment fields
 * @param {{closing?: string, candela?: string}} unavailable  why a source could not be read (shown instead of "nothing yet")
 * @returns {{values: object, header: object, rows: Array, unmatched: Array, notes: Array<string>, usedClosing: boolean, usedCandela: boolean}}
 */
export function buildAutofill({ closing, candela }, methods, unavailable = {}) {
  const values = {};
  const header = {};
  const rows = [];
  const notes = [];
  const unmatched = [];
  const set = (method, amount, from) => {
    values[method.code] = asText(amount);
    rows.push({ label: method.label, value: cents(amount), from });
  };
  const need = (method, label) => {
    if (!method) notes.push(`No active field called “${label}”, so that amount was not filled.`);
    return method;
  };

  // ── evening closing: cash and the two card machines ──
  const cashField = methods.find((m) => m.code === 'cash_sale');
  const retField = methods.find((m) => m.code === 'cash_returns');
  const alfalah = methods.find((m) => m.code === 'bank_alfalah');
  const alfalah2 = byLabel(methods, 'Banks', 'Bank Alfalah 2');
  let sysCash = null;
  if (closing) {
    if (finite(closing.sys_cash)) {
      sysCash = cents(closing.sys_cash);
      if (need(cashField, 'Cash Sale')) set(cashField, sysCash, 'Evening closing');
    }
    if (finite(closing.alfalah) && need(alfalah, 'Bank Alfalah')) set(alfalah, closing.alfalah, 'Evening closing');
    if (finite(closing.keenu) && need(alfalah2, 'Bank Alfalah 2')) set(alfalah2, closing.keenu, 'Evening closing');
  }

  // ── Candela: comp sale, cash returns, credit clients ──
  const pay = candela?.payments ?? null;
  if (pay && finite(pay.total_sale)) {
    header.comp_sale = String(Math.round(Number(pay.total_sale)));
    rows.push({ label: 'COMP SALE', value: Number(header.comp_sale), from: 'Candela' });
  }
  if (pay && finite(pay.cash_sale) && sysCash !== null && need(retField, 'Cash Returns')) {
    const returns = cents(sysCash - Math.round(Number(pay.cash_sale)));
    if (returns < 0) {
      notes.push('Candela’s cash is higher than the closing’s system cash, so Cash Returns was left empty. Please check both.');
    } else {
      set(retField, returns, 'Closing − Candela cash');
    }
  }
  const clients = methods.filter((m) => m.section === 'Credit Clients' && m.sign === 'add');
  const sums = new Map();
  for (const c of candela?.credit ?? []) {
    const amount = Number(c.amount);
    if (!Number.isFinite(amount) || amount === 0) continue;
    const m = matchClient(c.name, clients);
    if (!m) unmatched.push({ name: String(c.name ?? ''), amount: cents(amount) });
    else sums.set(m.code, (sums.get(m.code) ?? 0) + amount);
  }
  for (const m of clients) if (sums.has(m.code)) set(m, sums.get(m.code), 'Candela credit');
  if (unmatched.length) {
    const sum = unmatched.reduce((a, u) => a + u.amount, 0);
    notes.push(
      `${unmatched.length} Candela credit customer${unmatched.length > 1 ? 's' : ''} (Rs. ${cents(sum).toLocaleString('en-US')}) matched no field. Add a field with that name in Manage Fields, or enter the amount by hand.`,
    );
  }

  if (!closing) notes.push(unavailable.closing ?? 'No saved evening closing for this day yet, so cash and card machines were not filled.');
  if (!candela)
    notes.push(unavailable.candela ?? 'Candela has sent nothing for this day yet, so credit, returns and COMP SALE were not filled.');
  return { values, header, rows, unmatched, notes, usedClosing: !!closing, usedCandela: !!candela };
}

// Writes a result into the form. With `overwrite: false` (the automatic pull when a day opens) a field the person has
// already typed in is left alone.
export function applyAutofill(form, result, { overwrite }) {
  let filled = 0;
  for (const [code, v] of Object.entries(result.values)) {
    if (!overwrite && String(form.values[code] ?? '').trim() !== '') continue;
    form.values[code] = v;
    filled += 1;
  }
  for (const [key, v] of Object.entries(result.header)) {
    if (!overwrite && String(form.header[key] ?? '').trim() !== '') continue;
    form.header[key] = v;
    filled += 1;
  }
  return filled;
}

export const isNotAllowed = (error) => !!error && (error.code === '42501' || /not allowed/i.test(String(error.message ?? '')));
