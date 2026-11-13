// Pure staff-credit rules. The database function mgmt_credit_month (0102_mgmt_credit.sql) is the authority;
// this file repeats it for live previews and is tested against the SAME fixture (tests/fixtures/manager-credit-cases.json).
// Money is summed in whole paisa so 0.1 + 0.2 is exactly 0.30.

export const toPaisa = (rupees) => Math.round(Number(rupees) * 100);
export const fromPaisa = (paisa) => paisa / 100;

export const monthStart = (iso) => `${iso.slice(0, 7)}-01`;
export function shiftMonth(iso, by) {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7)) - 1 + by;
  const yy = y + Math.floor(m / 12);
  const mm = ((m % 12) + 12) % 12;
  return `${String(yy).padStart(4, '0')}-${String(mm + 1).padStart(2, '0')}-01`;
}

// opening: { month: 'YYYY-MM-01', amount } | null.  rows: [{ date, kind, amount }].  month: 'YYYY-MM-01'.
// Net = previous balance + entries - salary deduction - less-generic deduction (the old sheet's formula).
export function computeCreditMonth({ opening = null, rows = [], month, active = true }) {
  const next = shiftMonth(month, 1);
  let prior = 0;
  let entries = 0;
  let salary = 0;
  let generic = 0;
  let hasRows = false;
  for (const r of rows) {
    const p = toPaisa(r.amount);
    if (r.date < month) prior += p;
    else if (r.date < next) {
      hasRows = true;
      if (r.kind === 'entry') entries += p;
      else if (r.kind === 'salary_deduction') salary -= p;
      else if (r.kind === 'generic_deduction') generic -= p;
    }
  }
  const prev = opening && month < opening.month ? 0 : (opening ? toPaisa(opening.amount) : 0) + prior;
  const net = prev + entries - salary - generic;
  return {
    listed: Boolean(active) || hasRows || prev !== 0 || net !== 0,
    prev: fromPaisa(prev),
    entries: fromPaisa(entries),
    salary_deduction: fromPaisa(salary),
    generic_deduction: fromPaisa(generic),
    net: fromPaisa(net),
  };
}

// Early feedback only; the database repeats every one of these checks.
export function validateEntry({ date, amount, today, openingMonth = null }) {
  if (amount === null || amount === undefined || Number.isNaN(amount) || amount === 0)
    return 'Enter an amount (use a minus for a repayment).';
  if (Math.abs(amount) > 1e9) return 'That amount is too large.';
  if (!date) return 'Pick a date.';
  if (date > today) return 'The date cannot be in the future.';
  if (openingMonth && date < openingMonth) return 'The date is before this person’s opening balance month.';
  return null;
}

// The deduction fields hold the month's TOTAL; saving adds a delta row. Returns what the database will do.
export function deductionChange(currentTotal, wanted) {
  const delta = toPaisa(wanted) - toPaisa(currentTotal);
  return { delta: fromPaisa(delta), unchanged: delta === 0, needsReason: delta !== 0 && toPaisa(currentTotal) !== 0 };
}

export const sumNet = (people) => fromPaisa(people.reduce((s, p) => s + toPaisa(p.net), 0));
