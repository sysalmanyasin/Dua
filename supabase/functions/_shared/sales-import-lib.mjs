// Pure logic for importing the old BT Sales backup. No file or network access here, so it can be unit tested.
// This is a one-time data job. It is NOT part of the app (see docs/DECISIONS.md D-11).

const SECTION = { cash: 'Cash', banks: 'Banks', clients: 'Credit Clients' };
const m = (code, label, legacyKey, section, sign) => ({ code, label, legacyKey, section, sign });

// Built-in payment methods, in the order the old app shows them.
export const BUILTIN_METHODS = [
  m('cash_sale', 'Cash Sale', 'Cash Sale', SECTION.cash, 'add'),
  m('cash_returns', 'Cash Returns', 'Cash Returns', SECTION.cash, 'sub'),
  m('hbl', 'HBL', 'HBL', SECTION.banks, 'add'),
  m('mcb', 'MCB', 'MCB', SECTION.banks, 'add'),
  m('bank_alfalah', 'Bank Alfalah', 'Alfala Bank', SECTION.banks, 'add'),
  m('bank_al_habib', 'Bank Al Habib', 'Bank Al Habib', SECTION.banks, 'add'),
  m('meezan_bank', 'Meezan Bank', 'Meezan Bank (Paysa)', SECTION.banks, 'add'),
  m('askari_bank', 'Askari', 'Askari Bank', SECTION.clients, 'add'),
  m('askari_returns', 'Askari Returns', 'Askari Bank Returns', SECTION.clients, 'sub'),
  m('pso', 'PSO', 'PSO', SECTION.clients, 'add'),
  m('pso_returns', 'PSO Returns', 'PSO Returns', SECTION.clients, 'sub'),
  m('nespak', 'NESPAK', 'NESPAK', SECTION.clients, 'add'),
  m('nespak_returns', 'NESPAK Returns', 'NESPAK Returns', SECTION.clients, 'sub'),
  m('parco', 'PARCO', 'PARCO', SECTION.clients, 'add'),
  m('parco_returns', 'PARCO Returns', 'PARCO Returns', SECTION.clients, 'sub'),
  m('tepa', 'TEPA', 'TEPA', SECTION.clients, 'add'),
  m('tepa_returns', 'TEPA Returns', 'TEPA Returns', SECTION.clients, 'sub'),
  m('lda', 'LDA', 'LDA', SECTION.clients, 'add'),
  m('lda_returns', 'LDA Returns', 'LDA Returns', SECTION.clients, 'sub'),
  m('gourmet', 'Gourmet', 'Gourmet', SECTION.clients, 'add'),
  m('wapda_hospital', 'Wapda Hospital', 'Wapda Hospital', SECTION.clients, 'add'),
  m('bth', 'BTH', 'BTH', SECTION.clients, 'add'),
  m('berger_paints', 'Berger Paints', 'Berger Paints', SECTION.clients, 'add'),
  m('ecolean_pk', 'Ecolean PK', 'Ecolean PK', SECTION.clients, 'add'),
  m('style_textile', 'Style Textile', 'Style Textile', SECTION.clients, 'add'),
  m('syed_babar_ali', 'Syed Babar Ali Foundation', 'Syed Babar Ali Foundation', SECTION.clients, 'add'),
  m('rahnuma_ngo', 'Rahnuma NGO', 'Rahnuma NGO', SECTION.clients, 'add'),
  m('health_pass', 'Health Pass', 'Health Pass', SECTION.clients, 'add'),
  m('nisar_spinning', 'Nisar Spinning Mills', 'Nisar Spinning Mills', SECTION.clients, 'add'),
  m('food_panda', 'Food Panda', 'Food Panda', SECTION.clients, 'add'),
  m('f_issue', 'F/Issue', 'F/Issue', SECTION.clients, 'add'),
];

// Information-only daily fields (never part of TOTAL).
export const INFO_FIELDS = {
  comp_sale: 'COMP SALE',
  customers: 'Customers',
  fdpp_pos: 'FDPP',
  fdpp_consumer: 'FDPP Con',
  amount_received: 'Amount Received',
  load_sale: 'Load Sale',
  cash_to_deposit: 'Cash to be Deposited',
};

export const num = (v) => {
  if (v === null || v === undefined || v === '') return 0;
  const x = Number.parseFloat(v);
  return Number.isNaN(x) ? 0 : x;
};
export const jsRound = (x) => Math.floor(x + 0.5); // JavaScript Math.round, as the old app used

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export function parseLegacyDate(s) {
  const mt = /^(\d{1,2})\/([A-Za-z]{3})\/(\d{4})$/.exec(String(s ?? '').trim());
  if (!mt) return null;
  const month = MONTHS.indexOf(mt[2][0].toUpperCase() + mt[2].slice(1).toLowerCase());
  if (month < 0) return null;
  const iso = `${mt[3]}-${String(month + 1).padStart(2, '0')}-${mt[1].padStart(2, '0')}`;
  const d = new Date(`${iso}T00:00:00Z`);
  return d.getUTCMonth() === month && d.getUTCDate() === Number(mt[1]) ? iso : null;
}
export function parseMonthYear(s) {
  const mt = /^([A-Za-z]+)\s+(\d{4})$/.exec(String(s ?? '').trim());
  if (!mt) return null;
  const i = MONTH_NAMES.findIndex((n) => n.toLowerCase() === mt[1].toLowerCase());
  return i < 0 ? null : { year: Number(mt[2]), month: i + 1 };
}

export function buildMethods(colConfig) {
  const custom = (colConfig?.custom ?? []).map((c) => ({
    code: String(c.id)
      .replace(/^custom_/, 'c_')
      .toLowerCase(),
    label: c.label,
    legacyKey: c.id,
    section: c.section,
    sign: c.calcType === 'sub' ? 'sub' : c.calcType === 'none' ? 'none' : 'add',
  }));
  return [...BUILTIN_METHODS, ...custom];
}

// TOTAL for one day. addMode "signed": a negative value in an "add" field reduces the total
// (a credit return typed into the client's column). addMode "abs": the old app's current formula.
export function computeTotal(lines, methods, addMode = 'signed') {
  const by = new Map(methods.map((x) => [x.code, x]));
  let t = 0;
  for (const { method, amount } of lines) {
    const mm = by.get(method);
    if (!mm || mm.sign === 'none') continue;
    t += mm.sign === 'sub' ? -Math.abs(amount) : addMode === 'abs' ? Math.abs(amount) : amount;
  }
  return jsRound(t);
}
export const computeDiff = (total, comp) => jsRound(total - comp);

export function normalizeDay(row, methods, { trustMonthYear = false } = {}) {
  const anomalies = [];
  let date = parseLegacyDate(row.Date);
  if (!date) return { day: null, anomalies: [{ type: 'bad_date', value: row.Date }] };
  const my = parseMonthYear(row.Month_Year);
  if (my && (my.year !== Number(date.slice(0, 4)) || my.month !== Number(date.slice(5, 7)))) {
    const sameMonth = my.month === Number(date.slice(5, 7));
    anomalies.push({ type: 'date_vs_month_label', date, monthLabel: row.Month_Year });
    if (trustMonthYear && sameMonth) date = `${my.year}${date.slice(4)}`;
  }
  const lines = [];
  for (const meth of methods) {
    const v = num(row[meth.legacyKey]);
    if (v !== 0) lines.push({ method: meth.code, amount: v });
  }
  const info = {};
  for (const [k, legacy] of Object.entries(INFO_FIELDS))
    info[k] = row[legacy] === null || row[legacy] === undefined || row[legacy] === '' ? null : num(row[legacy]);
  return {
    day: {
      business_date: date,
      lines,
      ...info,
      low_sale_reason: row['Low Sale Reason'] || null,
      legacy_total: row.TOTAL === null || row.TOTAL === undefined ? null : num(row.TOTAL),
      legacy_diff: row.DIFF === null || row.DIFF === undefined || row.DIFF === '' ? null : num(row.DIFF),
    },
    anomalies,
  };
}

export function analyze(backup, { addMode = 'signed', trustMonthYear = false } = {}) {
  const methods = buildMethods(backup.colConfig);
  const anomalies = [];
  const days = [];
  for (const row of backup.daily ?? []) {
    const { day, anomalies: a } = normalizeDay(row, methods, { trustMonthYear });
    anomalies.push(...a.map((x) => ({ ...x, source: row.Date })));
    if (!day) continue;
    day.computed_total = computeTotal(day.lines, methods, addMode);
    day.computed_diff = computeDiff(day.computed_total, day.comp_sale ?? 0);
    if (day.legacy_total !== null && day.legacy_total !== day.computed_total) {
      anomalies.push({ type: 'total_mismatch', date: day.business_date, stored: day.legacy_total, computed: day.computed_total });
    }
    if (day.computed_diff !== 0 && (day.legacy_diff === null || day.legacy_diff === 0) && day.comp_sale) {
      anomalies.push({ type: 'diff_missing_in_old_data', date: day.business_date, computed: day.computed_diff });
    }
    days.push(day);
  }
  const seen = new Map();
  for (const d of days) seen.set(d.business_date, (seen.get(d.business_date) ?? 0) + 1);
  for (const [date, n] of seen) if (n > 1) anomalies.push({ type: 'duplicate_date', date, count: n });

  days.sort((a, b) => a.business_date.localeCompare(b.business_date));
  const have = new Set(days.map((d) => d.business_date));
  const gaps = [];
  if (days.length) {
    const end = new Date(`${days.at(-1).business_date}T00:00:00Z`);
    for (let t = new Date(`${days[0].business_date}T00:00:00Z`); t <= end; t = new Date(t.getTime() + 86_400_000)) {
      const iso = t.toISOString().slice(0, 10);
      if (!have.has(iso)) gaps.push(iso);
    }
  }
  const dayMonths = new Set(days.map((d) => d.business_date.slice(0, 7)));
  const monthlyOnly = (backup.monthly ?? []).filter((r) => {
    const my = parseMonthYear(r.Month_Year);
    return my && !dayMonths.has(`${my.year}-${String(my.month).padStart(2, '0')}`);
  });
  return { methods, days, gaps, monthlyOnly, anomalies };
}

export function summarize(result) {
  const count = {};
  for (const a of result.anomalies) count[a.type] = (count[a.type] ?? 0) + 1;
  return {
    days: result.days.length,
    first: result.days[0]?.business_date,
    last: result.days.at(-1)?.business_date,
    gapDays: result.gaps.length,
    monthlyOnlyMonths: result.monthlyOnly.map((r) => r.Month_Year),
    anomalyCounts: count,
  };
}

// A month that exists only as monthly figures (no daily detail).
export function normalizeMonth(row, methods) {
  const my = parseMonthYear(row.Month_Year);
  if (!my) return null;
  const lines = [];
  for (const meth of methods) {
    const v = num(row[meth.legacyKey]);
    if (v !== 0) lines.push({ method: meth.code, amount: v });
  }
  return {
    month: `${my.year}-${String(my.month).padStart(2, '0')}-01`,
    total: num(row.TOTAL),
    comp_sale: row['COMP SALE'] === null || row['COMP SALE'] === undefined || row['COMP SALE'] === '' ? null : num(row['COMP SALE']),
    customers: row.Customers === null || row.Customers === undefined || row.Customers === '' ? null : Math.round(num(row.Customers)),
    lines,
  };
}

// Everything the database needs, in the exact shape import_sales_batch() expects.
export function buildImportPayload(result) {
  const builtin = new Set(BUILTIN_METHODS.map((x) => x.code));
  return {
    methods: result.methods.filter((x) => !builtin.has(x.code)).map((x, i) => ({ code: x.code, label: x.label, section: x.section, sign: x.sign, sort: 400 + i })),
    days: result.days.map((d) => ({
      business_date: d.business_date,
      comp_sale: d.comp_sale,
      customers: d.customers === null ? null : Math.round(d.customers),
      fdpp_pos: d.fdpp_pos,
      fdpp_consumer: d.fdpp_consumer,
      amount_received: d.amount_received,
      load_sale: d.load_sale,
      cash_to_deposit: d.cash_to_deposit,
      low_sale_reason: d.low_sale_reason,
      lines: d.lines,
    })),
    months: result.monthlyOnly.map((r) => normalizeMonth(r, result.methods)).filter(Boolean),
  };
}
