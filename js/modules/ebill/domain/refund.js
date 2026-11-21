// Partial-refund preview. The SERVER decides the real amount (ebill_refund_lines, migration 0633); this mirrors its rule so the screen can
// show the manager what will come back before they confirm. A refund of part of the lines returns that share of the invoice NET total
// (so discounts, tax and adjustment come back in proportion); the refund that takes the last item returns exactly what is left.
const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

// Exact arithmetic for the share calculation. Floating point can land a hair under a half-paisa and round the wrong way (the server,
// which uses exact decimals, would then differ from the preview by 0.01), so the sums are done as whole-number fractions.
const gcd = (a, b) => (b === 0n ? (a < 0n ? -a : a) : gcd(b, a % b));
/** A fraction { n, d } (BigInt) from a plain decimal number. */
function frac(x) {
  const t = Number(x).toFixed(8).replace(/0+$/, '').replace(/\.$/, ''); // up to 8 decimals is far beyond any quantity or price here
  const [i, f = ''] = t.split('.');
  return { n: BigInt(i + f), d: 10n ** BigInt(f.length) };
}
const add = (a, b) => norm({ n: a.n * b.d + b.n * a.d, d: a.d * b.d });
const mul = (a, b) => norm({ n: a.n * b.n, d: a.d * b.d });
const div = (a, b) => norm({ n: a.n * b.d, d: a.d * b.n });
function norm(a) {
  const g = gcd(a.n, a.d) || 1n;
  return a.d < 0n ? { n: -a.n / g, d: -a.d / g } : { n: a.n / g, d: a.d / g };
}
/** Round a fraction to 2 decimals, halves away from zero (as the database does), as a number. */
const round2Frac = (a) => {
  const neg = a.n < 0n;
  const n = neg ? -a.n : a.n;
  const cents = (2n * n * 100n + a.d) / (2n * a.d);
  return Number(neg ? -cents : cents) / 100;
};

/**
 * @param {{ lines: { line_no: number, qty: number|string, line_total: number|string, refunded: number|string, remaining: number|string }[],
 *           net_total: number|string, refunded_amount: number|string }} inv
 * @param {Record<number, number>} want  line_no -> quantity to refund now
 * @returns {{ ok: boolean, message?: string, amount: number, leftAfter: number, finalRefund: boolean, chosen: { line_no: number, qty: number }[] }}
 */
export function previewRefund(inv, want) {
  const net = Number(inv.net_total);
  const before = Number(inv.refunded_amount) || 0;
  let totalLt = frac(0);
  let beforeVal = frac(0);
  let addVal = frac(0);
  let leftAfter = 0;
  const chosen = [];
  for (const l of inv.lines) {
    const qty = Number(l.qty);
    const lt = frac(l.line_total);
    const rem = Number(l.remaining);
    totalLt = add(totalLt, lt);
    if (qty > 0) beforeVal = add(beforeVal, mul(div(frac(l.refunded), frac(qty)), lt));
    const v = Number(want[l.line_no] ?? 0);
    if (v < 0 || Number.isNaN(v)) return bad('Quantities must be numbers of zero or more.');
    if (v > rem) return bad(`Only ${rem} of “${l.name ?? 'this item'}” can still be refunded.`);
    if (v > 0) {
      addVal = add(addVal, mul(div(frac(v), frac(qty)), lt));
      chosen.push({ line_no: l.line_no, qty: v });
    }
    leftAfter += rem - v;
  }
  if (!chosen.length) return { ok: false, message: 'Choose what to refund.', amount: 0, leftAfter, finalRefund: false, chosen };
  let cumAfter;
  if (leftAfter === 0) cumAfter = net;
  else if (totalLt.n > 0n) cumAfter = round2Frac(div(mul(frac(net), add(beforeVal, addVal)), totalLt));
  else cumAfter = before;
  return { ok: true, amount: Math.max(r2(cumAfter - before), 0), leftAfter, finalRefund: leftAfter === 0, chosen };

  function bad(message) {
    return { ok: false, message, amount: 0, leftAfter: 0, finalRefund: false, chosen: [] };
  }
}

/** The invoice's lines with every remaining quantity chosen. */
export const allRemaining = (lines) =>
  Object.fromEntries(lines.filter((l) => Number(l.remaining) > 0).map((l) => [l.line_no, Number(l.remaining)]));

/** The words for an invoice status. */
export const STATUS_WORDS = { posted: 'Posted', corrected: 'Corrected', partially_refunded: 'Part refunded', refunded: 'Refunded' };
