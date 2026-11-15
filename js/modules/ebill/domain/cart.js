// The bill being built. Immutable helpers: each returns a new cart, so the screen can keep the old one while a popup is open.
// A product is added once per sale unit; adding it again raises the quantity.
import { unitsOf } from './calc.js';

let seq = 0;
const lineId = () => `l${Date.now().toString(36)}${(seq++).toString(36)}`;

export const emptyCart = () => ({ lines: [] });

/** The stock fact for one line, from this device's copy. `null` = fine. Cached stock is never called live. */
export function stockIssue(line, product) {
  if (!product) return { kind: 'unknown', text: 'Not in the product list on this device' };
  const need = unitsOf(line.qty, line.unit, line.pack);
  if (product.qty <= 0) return { kind: 'none', text: 'No stock on this device’s copy' };
  if (need > product.qty) return { kind: 'short', text: `Only ${product.qty} in stock on this device’s copy` };
  return null;
}

export function addProduct(cart, product, { qty = 1, unit = 'unit' } = {}) {
  const q = Number(qty) > 0 ? Number(qty) : 1;
  const i = cart.lines.findIndex((l) => l.code === product.code && l.unit === unit);
  if (i >= 0) return { ...cart, lines: cart.lines.map((l, j) => (j === i ? { ...l, qty: l.qty + q } : l)) };
  const pack = product.pack > 0 ? product.pack : 1;
  const line = {
    id: lineId(),
    code: product.code,
    name: product.name,
    generic: product.generic || '',
    unit,
    pack,
    qty: q,
    rate: unit === 'pack' ? Math.round(product.price * pack * 100) / 100 : product.price,
    discount: { mode: 'pct', value: 0 },
  };
  return { ...cart, lines: [...cart.lines, line] };
}

const change = (cart, id, patch) => ({ ...cart, lines: cart.lines.map((l) => (l.id === id ? { ...l, ...patch } : l)) });
export const setQty = (cart, id, qty) => (Number(qty) > 0 ? change(cart, id, { qty: Number(qty) }) : cart);
export const setRate = (cart, id, rate) => (Number(rate) >= 0 ? change(cart, id, { rate: Number(rate) }) : cart);
export const setLineDiscount = (cart, id, mode, value) =>
  change(cart, id, { discount: { mode: mode === 'amt' ? 'amt' : 'pct', value: Math.max(0, Number(value) || 0) } });
export const removeLine = (cart, id) => ({ ...cart, lines: cart.lines.filter((l) => l.id !== id) });
