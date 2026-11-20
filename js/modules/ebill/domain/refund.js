// Partial-refund preview. The SERVER decides the real amount (ebill_refund_lines, migration 0633); this mirrors its rule so the screen can
// show the manager what will come back before they confirm. A refund of part of the lines returns that share of the invoice NET total
// (so discounts, tax and adjustment come back in proportion); the refund that takes the last item returns exactly what is left.
const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * @param {{ lines: { line_no: number, qty: number|string, line_total: number|string, refunded: number|string, remaining: number|string }[],
 *           net_total: number|string, refunded_amount: number|string }} inv
 * @param {Record<number, number>} want  line_no -> quantity to refund now
 * @returns {{ ok: boolean, message?: string, amount: number, leftAfter: number, finalRefund: boolean, chosen: { line_no: number, qty: number }[] }}
 */
export function previewRefund(inv, want) {
  const net = Number(inv.net_total);
  const before = Number(inv.refunded_amount) || 0;
  let totalLt = 0;
  let beforeVal = 0;
  let addVal = 0;
  let leftAfter = 0;
  const chosen = [];
  for (const l of inv.lines) {
    const qty = Number(l.qty);
    const lt = Number(l.line_total);
    const rem = Number(l.remaining);
    totalLt += lt;
    if (qty > 0) beforeVal += (Number(l.refunded) / qty) * lt;
    const v = Number(want[l.line_no] ?? 0);
    if (v < 0 || Number.isNaN(v)) return bad('Quantities must be numbers of zero or more.');
    if (v > rem) return bad(`Only ${rem} of “${l.name ?? 'this item'}” can still be refunded.`);
    if (v > 0) {
      addVal += (v / qty) * lt;
      chosen.push({ line_no: l.line_no, qty: v });
    }
    leftAfter += rem - v;
  }
  if (!chosen.length) return { ok: false, message: 'Choose what to refund.', amount: 0, leftAfter, finalRefund: false, chosen };
  let cumAfter;
  if (leftAfter === 0) cumAfter = net;
  else if (totalLt > 0) cumAfter = r2((net * (beforeVal + addVal)) / totalLt);
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
