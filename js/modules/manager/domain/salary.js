// Pure salary and generic rules. The database functions (0104_mgmt_salary.sql) are the authority; this file repeats them for
// live previews and is tested against the SAME fixtures (tests/fixtures/manager-salary-cases.json, manager-generic-cases.json).
// Whole rupees, rounded exactly like JavaScript Math.round (halves go up, also for negatives): floor(x + 0.5).
import { fromPaisa, toPaisa } from './credit.js';

export function rup(x) {
  const r = Math.floor((toPaisa(x) + 50) / 100);
  return r === 0 ? 0 : r; // never -0
}

// Sum a list of rupee amounts exactly (in paisa), as rupees.
export const sumAmounts = (list) => fromPaisa(list.reduce((s, a) => s + toPaisa(a), 0));

// rate is a fraction with at most 5 decimals (0.045 = 4.5%). Integer maths, so 2,500 at 4.5% is exactly 112.5 -> 113.
export function genericRow({ sale, extra = 0, rate }) {
  const units = BigInt(Math.round(Number(rate) * 100000));
  const num = BigInt(rup(sale)) * units + 50000n;
  let q = num / 100000n;
  if (num < 0n && num % 100000n !== 0n) q -= 1n; // floor, not truncate
  const incentive = Number(q) === 0 ? 0 : Number(q);
  const fin = incentive + rup(extra);
  return { incentive, final: fin === 0 ? 0 : fin };
}

// extras: [{ sign: 1 | -1, amount }]. Every figure is rounded to a whole rupee on its own, then combined.
export function salaryNet({ ho, advance = 0, generic = 0, extras = [] }) {
  const customs = extras.reduce((s, c) => s + c.sign * rup(c.amount), 0);
  const net = rup(ho) - rup(advance) + rup(generic) + customs;
  return net === 0 ? 0 : net;
}

// What to flag on screen (MGR-16): the saved figures of a closed month versus the live ones, and the credit sheet's own
// salary deduction versus the salary advance.
export function salaryFlags(row) {
  const advance = rup(row.advance);
  const credit = rup(row.credit_deduction);
  return {
    advanceChanged: Boolean(row.closed) && rup(row.advance) !== rup(row.advance_live),
    genericChanged: Boolean(row.closed) && rup(row.generic) !== rup(row.generic_live),
    creditDiffers: (advance !== 0 || credit !== 0) && advance !== credit,
  };
}

export const percent = (rate) => `${Number((Number(rate) * 100).toFixed(3))}%`;
export const rateFromPercent = (pct) => Number((Number(pct) / 100).toFixed(5));
