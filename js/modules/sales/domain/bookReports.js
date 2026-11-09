// Monthly report and Sale Book (monthly / yearly / all-time). Pure functions.
// Returns columns always show and add up as negatives, whatever sign they were saved with (as in the original).
const n = (v) => Number(v) || 0;
const round = (x) => Math.floor(x + 0.5);

const signedAmount = (method, amount) => (method?.sign === 'sub' ? -Math.abs(n(amount)) : method?.sign === 'none' ? 0 : n(amount));

// Fields that have at least one figure in the period, in the order they appear on the entry page.
function activeColumns(methods, amountsByCode) {
  return methods
    .filter((m) => m.sign !== 'none' && [...(amountsByCode.get(m.code) ?? [])].some((v) => n(v) !== 0))
    .sort((a, b) => a.sort - b.sort)
    .map((m) => ({ code: m.code, label: m.label, section: m.section, sign: m.sign }));
}

// One month, day by day. `days`: [{business_date,total,comp_sale,customers}], `lines`: [{business_date,method_code,amount}].
export function monthlyReport({ days, lines, methods, target = null }) {
  const by = new Map(methods.map((m) => [m.code, m]));
  const perDay = new Map();
  const seen = new Map();
  for (const l of lines) {
    const m = by.get(l.method_code);
    if (!m) continue;
    const v = signedAmount(m, l.amount);
    (perDay.get(l.business_date) ?? perDay.set(l.business_date, new Map()).get(l.business_date)).set(l.method_code, v);
    (seen.get(l.method_code) ?? seen.set(l.method_code, []).get(l.method_code)).push(v);
  }
  const columns = activeColumns(methods, seen);
  const rows = [...days]
    .sort((a, b) => a.business_date.localeCompare(b.business_date))
    .map((d) => ({
      date: d.business_date,
      total: n(d.total),
      comp: d.comp_sale === null || d.comp_sale === undefined ? null : n(d.comp_sale),
      customers: n(d.customers),
      diff: d.comp_sale ? round(n(d.total) - n(d.comp_sale)) : null,
      cells: Object.fromEntries(columns.map((c) => [c.code, perDay.get(d.business_date)?.get(c.code) ?? 0])),
    }));
  const sum = (f) => rows.reduce((s, r) => s + f(r), 0);
  const section = (s) => columns.filter((c) => c.section === s).reduce((t, c) => t + sum((r) => r.cells[c.code]), 0);
  const total = sum((r) => r.total);
  const comp = sum((r) => r.comp ?? 0);
  const best = rows.reduce((a, b) => (b.total > (a?.total ?? -Infinity) ? b : a), null);
  return {
    columns,
    rows,
    totals: {
      cells: Object.fromEntries(columns.map((c) => [c.code, sum((r) => r.cells[c.code])])),
      total,
      comp,
      customers: sum((r) => r.customers),
      diff: comp ? round(total - comp) : null,
    },
    summary: {
      days: rows.length,
      total,
      cash: section('Cash'),
      banks: section('Banks'),
      credit: section('Credit Clients'),
      comp,
      customers: sum((r) => r.customers),
      diff: comp ? round(total - comp) : null,
      avgPerDay: rows.length ? total / rows.length : 0,
      avgBill: sum((r) => r.customers) ? total / sum((r) => r.customers) : 0,
      best: best ? { date: best.date, total: best.total } : null,
      target,
      targetPct: target ? Math.round((total / target) * 100) : null,
    },
  };
}

// Months as rows, payment fields as columns. `months`: v_monthly_full rows, `monthMethods`: v_monthly_methods rows.
export function saleBook({ months, monthMethods, methods, year = null }) {
  const by = new Map(methods.map((m) => [m.code, m]));
  const keep = (key) => year === null || key.startsWith(`${year}-`);
  const amounts = new Map();
  const perMonth = new Map();
  for (const r of monthMethods) {
    const key = String(r.month).slice(0, 7);
    const m = by.get(r.method_code);
    if (!m || !keep(key)) continue;
    const v = signedAmount(m, r.amount);
    (perMonth.get(key) ?? perMonth.set(key, new Map()).get(key)).set(r.method_code, v);
    (amounts.get(r.method_code) ?? amounts.set(r.method_code, []).get(r.method_code)).push(v);
  }
  const columns = activeColumns(methods, amounts);
  const rows = months
    .filter((m) => keep(String(m.month).slice(0, 7)))
    .map((m) => {
      const key = String(m.month).slice(0, 7);
      return {
        key,
        year: Number(key.slice(0, 4)),
        total: n(m.total),
        comp: m.comp_sale === null || m.comp_sale === undefined ? null : n(m.comp_sale),
        customers: n(m.customers),
        days: n(m.days),
        monthlyOnly: Boolean(m.monthly_only),
        diff: m.comp_sale ? round(n(m.total) - n(m.comp_sale)) : null,
        cells: Object.fromEntries(columns.map((c) => [c.code, perMonth.get(key)?.get(c.code) ?? 0])),
      };
    })
    .sort((a, b) => a.key.localeCompare(b.key));
  const total = (list, f) => list.reduce((s, r) => s + f(r), 0);
  const totalsOf = (list) => ({
    total: total(list, (r) => r.total),
    comp: total(list, (r) => r.comp ?? 0),
    customers: total(list, (r) => r.customers),
    days: total(list, (r) => r.days),
    cells: Object.fromEntries(columns.map((c) => [c.code, total(list, (r) => r.cells[c.code])])),
  });
  const years = [...new Set(rows.map((r) => r.year))];
  return { columns, rows, years: years.map((y) => ({ year: y, ...totalsOf(rows.filter((r) => r.year === y)) })), totals: totalsOf(rows) };
}

// Splits long tables into fixed-size pages so print never breaks a page in the middle of a row.
export const paginate = (rows, perPage = 28) => {
  const pages = [];
  for (let i = 0; i < rows.length; i += perPage) pages.push(rows.slice(i, i + perPage));
  return pages.length ? pages : [[]];
};
