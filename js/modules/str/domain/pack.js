// Pack maths for STR. Quantities arrive in loose units; a pack is `factor` loose units.
// Rules carried over exactly from the old str-shared.js (STR-R3):
//   - a missing, zero, negative or non-finite factor falls back to 1 (pack qty = loose qty);
//   - pack qty = floor(loose / factor), done separately for each quantity;
//   - a null quantity stays null (not dispatched / not received yet), it never becomes 0.
export function packFactor(raw) {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export function toPackQty(loose, factor) {
  if (loose === null || loose === undefined) return null;
  return Math.floor((Number(loose) || 0) / factor);
}

// Convenience: loose quantity and the raw factor straight from the product.
export const packQty = (loose, rawFactor) => toPackQty(loose, packFactor(rawFactor));

// Dispatch pack qty minus receive pack qty; blank (null) when either side is missing.
export function diffQty(line) {
  if (line.packDispatchQty === null || line.packDispatchQty === undefined) return null;
  if (line.packReceiveQty === null || line.packReceiveQty === undefined) return null;
  return line.packDispatchQty - line.packReceiveQty;
}

// Words, not only colour (MODULES: status is never colour-only).
export function diffTone(d) {
  if (d === null || d === undefined) return 'none';
  return d === 0 ? 'even' : d < 0 ? 'short' : 'over';
}

export function diffText(d) {
  if (d === null || d === undefined) return '';
  return d > 0 ? `+${d}` : String(d);
}
