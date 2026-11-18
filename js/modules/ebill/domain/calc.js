// Billing arithmetic for Emergency Billing. Pure functions; money is rounded to 2 decimals at every step so the screen,
// the printed receipt and (later) the server agree to the paisa. A discount is either a percentage or a flat amount and is
// always resolved to ONE amount, never above what it is taken from (business rules §9).
export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

/** Resolve a discount ({mode:'pct'|'amt', value}) against a base amount. Never negative, never above the base. */
export function resolveDiscount(base, d) {
  const b = Math.max(0, num(base));
  if (!d || !num(d.value)) return 0;
  const v = Math.max(0, num(d.value));
  return round2(d.mode === 'pct' ? clamp((b * Math.min(v, 100)) / 100, 0, b) : Math.min(v, b));
}

/** Quantity in selling units: 'pack' multiplies by the pack size (a missing/invalid pack counts as 1). */
export const unitsOf = (qty, unit, pack) => (unit === 'pack' ? num(qty) * (num(pack) > 0 ? num(pack) : 1) : num(qty));

/** One line: gross = rate x qty, minus its own discount. `rate` is per displayed unit. */
export function lineTotals(line) {
  const gross = round2(num(line.rate) * num(line.qty));
  const discount = resolveDiscount(gross, line.discount);
  return { gross, discount, total: round2(gross - discount) };
}

/**
 * Whole bill. Order: lines (own discounts) -> gross total -> customer discount (% of gross) -> receipt discount ->
 * net gross -> tax -> adjustment -> net total. Tax is on the net gross; the adjustment (rounding, +/-) comes last.
 */
export function billTotals({
  lines = [],
  customerDiscountPct = 0,
  receiptDiscount = null,
  adjustment = 0,
  taxPct = 0,
  roundToRupee = false,
} = {}) {
  const per = lines.map(lineTotals);
  const grossTotal = round2(per.reduce((s, l) => s + l.total, 0));
  const lineDiscounts = round2(per.reduce((s, l) => s + l.discount, 0));
  const customerDiscount = resolveDiscount(grossTotal, { mode: 'pct', value: customerDiscountPct });
  const receiptDiscountAmt = resolveDiscount(round2(grossTotal - customerDiscount), receiptDiscount);
  const netGross = round2(grossTotal - customerDiscount - receiptDiscountAmt);
  const tax = round2((netGross * Math.max(0, num(taxPct))) / 100);
  const before = round2(netGross + tax + num(adjustment));
  const netTotal = Math.max(0, roundToRupee ? Math.round(before) : before);
  return {
    lines: per,
    lineDiscounts,
    grossTotal,
    customerDiscount,
    receiptDiscount: receiptDiscountAmt,
    netGross,
    tax,
    adjustment: round2(num(adjustment)),
    netTotal,
  };
}

/** Payment: received is what was handed over; change goes back; due is what is still owed. */
export function payment(netTotal, cashReceived) {
  const received = round2(Math.max(0, num(cashReceived)));
  return { received, change: round2(Math.max(0, received - netTotal)), due: round2(Math.max(0, netTotal - received)) };
}
