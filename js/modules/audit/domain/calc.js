// The counting calculator's arithmetic: "6 boxes × 10 + 4 loose" without leaving the count screen. Pure: no screen, no storage.
// Exact on purpose. Numbers are fractions of whole numbers (BigInt), so 0.1 + 0.2 is 0.3 and 10 ÷ 3 × 3 is 10, never 9.999999.
// × and ÷ are done before + and −, like a printed sum, and the sum is shown as typed. There is no eval and no Function.
// Only a result that is a valid count (0 or more, at most 3 decimals) can be inserted; it is never rounded on the way in.
import { MAX_QTY, parseQty } from './count.js';

export const MAX_DIGITS = 12; // whole-number digits in one number typed
export const MAX_ENTRY_DECIMALS = 3; // a count has at most 3 decimals, so a number typed has no more
const SHOWN_DECIMALS = 6; // an endless result (10 ÷ 3) is shown to 6 decimals and can then not be inserted
const SCALE = 10n ** BigInt(SHOWN_DECIMALS);
const LIMIT = 10n ** 12n; // a result this large or larger is "Too big"

const gcd = (a, b) => {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y) [x, y] = [y, x % y];
  return x;
};
const frac = (n, d = 1n) => {
  const sign = d < 0n ? -1n : 1n;
  const g = gcd(n, d) || 1n;
  return { n: (sign * n) / g, d: (sign * d) / g };
};
const add = (a, b) => frac(a.n * b.d + b.n * a.d, a.d * b.d);
const sub = (a, b) => frac(a.n * b.d - b.n * a.d, a.d * b.d);
const mul = (a, b) => frac(a.n * b.n, a.d * b.d);
const div = (a, b) => frac(a.n * b.d, a.d * b.n);

/** "12", "12.5" or "6." as a fraction. The text is always one this module built from keys, never free text. */
function parseEntry(text) {
  const [whole, part = ''] = text.split('.');
  return frac(BigInt(whole + part), 10n ** BigInt(part.length));
}

/** A fraction as text: exact when it has up to 6 decimals, otherwise rounded to 6 (half away from zero), trailing zeros dropped. */
export function formatFraction(f) {
  const negative = f.n < 0n;
  const magnitude = negative ? -f.n : f.n;
  const scaled = (magnitude * SCALE * 2n + f.d) / (f.d * 2n);
  const whole = scaled / SCALE;
  const part = scaled % SCALE;
  const text = part === 0n ? whole.toString() : `${whole}.${part.toString().padStart(SHOWN_DECIMALS, '0').replace(/0+$/, '')}`;
  return negative && scaled !== 0n ? `-${text}` : text;
}

const OPERATORS = { '+': '+', '-': '−', '−': '−', '*': '×', x: '×', X: '×', '×': '×', '/': '÷', '÷': '÷' };
const num = (text) => ({ t: 'n', f: parseEntry(text), text });

export const initialCalc = () => ({ tokens: [], entry: '', done: false, error: null });

/** The numbers and operators of the sum so far, with the number being typed (if any) included. */
function sumOf(state) {
  const tokens = state.entry === '' ? state.tokens : [...state.tokens, num(state.entry)];
  if (tokens.length === 0) return { empty: true };
  if (tokens.at(-1).t === 'o') return { incomplete: true };
  return { tokens };
}

/** { value } as a fraction, or { error }, or { empty } / { incomplete } while the sum is not finished. */
function compute(state) {
  const sum = sumOf(state);
  if (!sum.tokens) return sum;
  const terms = [sum.tokens[0].f];
  const addends = [];
  for (let i = 1; i < sum.tokens.length; i += 2) {
    const op = sum.tokens[i].op;
    const x = sum.tokens[i + 1].f;
    if (op === '×') terms[terms.length - 1] = mul(terms.at(-1), x);
    else if (op === '÷') {
      if (x.n === 0n) return { error: 'Cannot divide by zero.' };
      terms[terms.length - 1] = div(terms.at(-1), x);
    } else {
      addends.push(op);
      terms.push(x);
    }
  }
  let value = terms[0];
  addends.forEach((op, i) => {
    value = op === '+' ? add(value, terms[i + 1]) : sub(value, terms[i + 1]);
  });
  const magnitude = value.n < 0n ? -value.n : value.n;
  if (magnitude >= LIMIT * value.d) return { error: 'The result is too big.' };
  return { value };
}

/** Applies one key and returns the new state. Keys: 0-9 . + − × ÷ (also - * x /) = back clear. */
export function press(state, key) {
  if (key === 'clear') return initialCalc();
  const isDigit = /^[0-9]$/.test(key);
  if (state.error) return isDigit || key === '.' ? press(initialCalc(), key) : key === 'back' ? initialCalc() : state;

  if (isDigit || key === '.') {
    const s = state.done ? initialCalc() : state; // typing after "=" starts a new sum
    let entry = s.entry;
    if (key === '.') {
      if (entry.includes('.')) return state;
      entry = entry === '' ? '0.' : `${entry}.`;
    } else if (entry === '0')
      entry = key; // no leading zeros
    else if (entry.includes('.')) {
      if (entry.split('.')[1].length >= MAX_ENTRY_DECIMALS) return state;
      entry += key;
    } else {
      if (entry.length >= MAX_DIGITS) return state;
      entry += key;
    }
    return { ...s, entry };
  }

  if (Object.hasOwn(OPERATORS, key)) {
    let tokens = state.tokens;
    if (state.entry !== '') tokens = [...tokens, num(state.entry)];
    else if (tokens.length === 0)
      return state; // nothing to operate on yet
    else if (tokens.at(-1).t === 'o') tokens = tokens.slice(0, -1); // a second operator replaces the first
    return { tokens: [...tokens, { t: 'o', op: OPERATORS[key] }], entry: '', done: false, error: null };
  }

  if (key === '=') {
    const r = compute(state);
    if (r.empty || r.incomplete) return state;
    if (r.error) return { ...initialCalc(), error: r.error };
    return { tokens: [{ t: 'n', f: r.value, text: formatFraction(r.value) }], entry: '', done: true, error: null };
  }

  if (key === 'back') {
    if (state.done) return initialCalc();
    if (state.entry !== '') return { ...state, entry: state.entry.slice(0, -1) };
    if (state.tokens.at(-1)?.t === 'o') {
      const before = state.tokens.slice(0, -1); // take the operator off and make the number before it editable again
      const last = before.at(-1);
      return { ...state, tokens: before.slice(0, -1), entry: last.text };
    }
  }
  return state;
}

/** The line above the display: the sum so far, without the number being typed. */
export const expressionText = (state) => state.tokens.map((t) => (t.t === 'n' ? t.text : t.op)).join(' ');

/** The big display: the number being typed, else the last number, else 0. */
export function displayText(state) {
  if (state.error) return 'Error';
  if (state.entry !== '') return state.entry;
  const last = [...state.tokens].reverse().find((t) => t.t === 'n');
  return last ? last.text : '0';
}

/** What the whole sum comes to right now, as text, when it is finished and has an operator to show; otherwise null. */
export function previewText(state) {
  if (state.done || state.error || !state.tokens.some((t) => t.t === 'o')) return null;
  const r = compute(state);
  return r.value ? formatFraction(r.value) : null;
}

/** Can the sum be put into a count box? { ok, qty, text } or { ok: false, reason } in words for the person. */
export function insertable(state) {
  if (state.error) return { ok: false, reason: state.error };
  const r = compute(state);
  if (r.empty) return { ok: false, reason: 'Enter a number first.' };
  if (r.incomplete) return { ok: false, reason: 'Finish the sum first.' };
  if (r.error) return { ok: false, reason: r.error };
  const text = formatFraction(r.value);
  if (r.value.n < 0n) return { ok: false, reason: 'A count cannot be below zero.' };
  if ((r.value.n * 1000n) % r.value.d !== 0n) return { ok: false, reason: `${text} has more than 3 decimals. A count can have up to 3.` };
  const qty = parseQty(text);
  if (qty === null) return { ok: false, reason: `A count can be at most ${MAX_QTY.toLocaleString('en-US')}.` };
  return { ok: true, qty, text };
}
