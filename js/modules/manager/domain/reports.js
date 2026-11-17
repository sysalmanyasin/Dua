// Pure report builders for the printable Manager reports (MGR-14): Credit (detailed and summary), Salary detail, Generic sheet.
// They only arrange figures the database already produced (mgmt_credit_month, mgmt_salary_month, mgmt_generic_month) and add
// totals in whole paisa, so nothing is recomputed differently here. "Hide from print" (R21) removes a person from the rows AND the
// totals, so the printed page always adds up to what is on it. Nothing is stored about it.
import { fromPaisa, toPaisa } from './credit.js';

export const REPORTS = [
  {
    id: 'credit-summary',
    title: 'Credit summary',
    desc: 'One line per person: previous, entries, deductions, net',
    anyOf: ['credit.view', 'mgmt.credit_manage'],
  },
  {
    id: 'credit-detail',
    title: 'Credit detailed',
    desc: 'Every entry of the month, person by person',
    anyOf: ['credit.view', 'mgmt.credit_manage'],
  },
  { id: 'salary', title: 'Salary detail', desc: 'HO salary, advance, generic, extras and net', anyOf: ['mgmt.salary', 'mgmt.salary_view'] },
  {
    id: 'generic',
    title: 'Generic sheet',
    desc: 'Generic sale, incentive and final for each person',
    anyOf: ['mgmt.salary', 'mgmt.salary_view'],
  },
];

export const reportsFor = (perms) => {
  const p = perms instanceof Set ? perms : new Set(perms ?? []);
  return REPORTS.filter((r) => r.anyOf.some((k) => p.has(k)));
};

const total = (rows, pick) => fromPaisa(rows.reduce((s, r) => s + toPaisa(pick(r) ?? 0), 0));
const shown = (rows, hidden) => (rows ?? []).filter((r) => !hidden.has(r.staff_id));
const person = (r) => ({ staff_id: r.staff_id, name: r.full_name, code: r.staff_code ?? '' });

export function creditSummary(people, hidden = new Set()) {
  const rows = shown(people, hidden).map((p) => ({
    ...person(p),
    prev: Number(p.prev_balance),
    entries: Number(p.entries_total),
    salary: Number(p.salary_deduction),
    generic: Number(p.generic_deduction),
    net: Number(p.net),
  }));
  return {
    rows,
    totals: {
      prev: total(rows, (r) => r.prev),
      entries: total(rows, (r) => r.entries),
      salary: total(rows, (r) => r.salary),
      generic: total(rows, (r) => r.generic),
      net: total(rows, (r) => r.net),
    },
  };
}

export function creditDetail(people, hidden = new Set()) {
  const rows = shown(people, hidden).map((p) => ({
    ...person(p),
    prev: Number(p.prev_balance),
    net: Number(p.net),
    salary: Number(p.salary_deduction),
    generic: Number(p.generic_deduction),
    entries: (p.entries ?? []).map((e) => ({
      date: e.entry_date,
      note: e.description || '',
      amount: Number(e.amount),
      reversal: Boolean(e.reverses_id),
      reversed: Boolean(e.reversed_by),
      reason: e.reason || '',
    })),
  }));
  return { rows, totals: { net: total(rows, (r) => r.net) } };
}

// rows: mgmt_salary_month; cols: mgmt_salary_columns. The net is the database's own (saved when the month is closed).
export function salaryReport(rows, cols, hidden = new Set()) {
  const list = shown(rows, hidden).map((r) => ({
    ...person(r),
    designation: r.designation ?? '',
    ho: Number(r.ho_salary),
    advance: Number(r.advance),
    generic: Number(r.generic),
    extras: cols.map((c) => Number(r.extras?.[c.column_id] ?? 0)),
    net: Number(r.net),
  }));
  return {
    columns: cols.map((c) => ({ name: c.name, sign: c.sign })),
    rows: list,
    totals: {
      ho: total(list, (r) => r.ho),
      advance: total(list, (r) => r.advance),
      generic: total(list, (r) => r.generic),
      extras: cols.map((_, i) => total(list, (r) => r.extras[i])),
      net: total(list, (r) => r.net),
    },
  };
}

export function genericReport(rows, hidden = new Set()) {
  const list = shown(rows, hidden).map((r) => ({
    ...person(r),
    sale: Number(r.generic_sale),
    rate: Number(r.rate),
    incentive: Number(r.incentive),
    extra: Number(r.extra),
    final: Number(r.final),
  }));
  return {
    rows: list,
    totals: {
      sale: total(list, (r) => r.sale),
      incentive: total(list, (r) => r.incentive),
      extra: total(list, (r) => r.extra),
      final: total(list, (r) => r.final),
    },
  };
}
