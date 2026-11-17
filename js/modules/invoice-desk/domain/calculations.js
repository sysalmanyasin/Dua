// Money is represented as integer paisa. Quantity supports up to three decimal places.
export function toPaisa(value) {
  const s = String(value ?? '').trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(s)) throw new Error('Enter a valid non-negative amount.');
  const [whole, fraction = ''] = s.split('.');
  const n = BigInt(whole) * 100n + BigInt((fraction + '00').slice(0, 2));
  if (n > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Amount is too large.');
  return Number(n);
}
export function quantityMilli(value) {
  const s = String(value ?? '').trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,3})?$/.test(s)) throw new Error('Enter a valid quantity.');
  const [whole, fraction = ''] = s.split('.');
  const n = BigInt(whole) * 1000n + BigInt((fraction + '000').slice(0, 3));
  if (n <= 0n || n > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Quantity must be greater than zero.');
  return Number(n);
}
export function lineTotalPaisa(quantity, unitPricePaisa) {
  const q = typeof quantity === 'number' ? quantity : quantityMilli(quantity);
  if (!Number.isSafeInteger(q) || q <= 0 || !Number.isSafeInteger(unitPricePaisa) || unitPricePaisa < 0) throw new Error('Invalid quantity or price.');
  return Math.floor((q * unitPricePaisa + 500) / 1000);
}
export function calculateInvoice(lines, discountPaisa = 0) {
  if (!Array.isArray(lines) || lines.length === 0) throw new Error('Add at least one invoice item.');
  const normalized = lines.map((line) => {
    const q = quantityMilli(line.quantity);
    const price = typeof line.unitPricePaisa === 'number' ? line.unitPricePaisa : toPaisa(line.unitPrice);
    const total = lineTotalPaisa(q, price);
    return { ...line, quantityMilli: q, unitPricePaisa: price, lineTotalPaisa: total };
  });
  const subtotalPaisa = normalized.reduce((sum, line) => sum + line.lineTotalPaisa, 0);
  if (!Number.isSafeInteger(discountPaisa) || discountPaisa < 0 || discountPaisa > subtotalPaisa) throw new Error('Discount must be between zero and subtotal.');
  return { lines: normalized, subtotalPaisa, discountPaisa, grandTotalPaisa: subtotalPaisa - discountPaisa };
}
