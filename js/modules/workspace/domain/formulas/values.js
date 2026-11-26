// Values and the rules for turning one kind into another. See docs/modules/workspace.formulas.md ("Converting between kinds").
// A value is a number, text, a boolean, null (empty), or an error value { error: '#REF!' }. Nothing here throws.
import { generalNumber } from '../grid.js';

export const ERR = Object.freeze({
  REF: Object.freeze({ error: '#REF!' }),
  VALUE: Object.freeze({ error: '#VALUE!' }),
  DIV0: Object.freeze({ error: '#DIV/0!' }),
  NAME: Object.freeze({ error: '#NAME?' }),
  CIRC: Object.freeze({ error: '#CIRC!' }),
});
const BY_TEXT = new Map(Object.values(ERR).map((e) => [e.error, e]));
export const errorFromText = (text) => BY_TEXT.get(text) ?? ERR.VALUE;

export const isError = (v) => v !== null && typeof v === 'object' && typeof v.error === 'string';
export const MAX_TEXT = 32767;

// Plain numbers only: optional sign, digits, optional decimal, optional exponent. Not 1,200 or 5% or 0x10 or Infinity.
const NUMERIC_TEXT = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

// number | error
export function toNumber(v) {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string') {
    const t = v.trim();
    if (!NUMERIC_TEXT.test(t)) return ERR.VALUE;
    const n = Number(t);
    return Number.isFinite(n) ? n : ERR.VALUE;
  }
  return isError(v) ? v : ERR.VALUE;
}

// string | error
export function toText(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return generalNumber(v);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return isError(v) ? v : ERR.VALUE;
}

// boolean | error
export function toBool(v) {
  if (v === null || v === undefined) return false;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') {
    const t = v.trim().toUpperCase();
    if (t === 'TRUE') return true;
    if (t === 'FALSE') return false;
    return ERR.VALUE;
  }
  return isError(v) ? v : ERR.VALUE;
}

// A result must be a finite number; anything else is #VALUE!. Negative zero becomes 0.
export function finite(n) {
  if (!Number.isFinite(n)) return ERR.VALUE;
  return n === 0 ? 0 : n;
}

const rank = (v) => (typeof v === 'number' ? 0 : typeof v === 'string' ? 1 : 2);
const neutral = (other) => (typeof other === 'number' ? 0 : typeof other === 'string' ? '' : false);

function compareText(a, b) {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  let i = 0;
  let j = 0;
  while (i < x.length && j < y.length) {
    const p = x.codePointAt(i);
    const q = y.codePointAt(j);
    if (p !== q) return p < q ? -1 : 1;
    i += p > 0xffff ? 2 : 1;
    j += q > 0xffff ? 2 : 1;
  }
  if (i < x.length) return 1;
  if (j < y.length) return -1;
  return 0;
}

// -1, 0 or 1; or an error when either side is one. Empty takes the kind of the other side.
export function compare(a, b) {
  if (isError(a)) return a;
  if (isError(b)) return b;
  let x = a ?? null;
  let y = b ?? null;
  if (x === null && y === null) return 0;
  if (x === null) x = neutral(y);
  if (y === null) y = neutral(x);
  const rx = rank(x);
  const ry = rank(y);
  if (rx !== ry) return rx < ry ? -1 : 1;
  if (rx === 0) return x < y ? -1 : x > y ? 1 : 0;
  if (rx === 1) return compareText(x, y);
  return x === y ? 0 : x ? 1 : -1; // FALSE before TRUE
}

// Half away from zero, on the decimal reading of the number (see the brief): ROUND(1.005, 2) is 1.01.
export function roundHalfAway(x, digits) {
  const d = Math.min(Math.max(Math.trunc(digits), -15), 15);
  const a = Math.abs(x);
  const p = 10 ** Math.abs(d);
  let scaled = d >= 0 ? a * p : a / p;
  scaled = Number(scaled.toPrecision(15));
  const rounded = scaled >= 2 ** 52 ? scaled : Math.floor(scaled + 0.5);
  const back = d >= 0 ? rounded / p : rounded * p;
  const out = Number(back.toPrecision(15));
  return x < 0 && out !== 0 ? -out : out;
}
