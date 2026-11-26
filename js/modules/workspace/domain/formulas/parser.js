// Formula text -> a tree. Never throws.
//   parseFormula("=1+A1") -> { ok: true, ast } or { ok: false, error: { message, pos } }
// Tree nodes (t = type):
//   { t: 'num', v } { t: 'str', v } { t: 'bool', v } { t: 'err', v }
//   { t: 'ref', row, col, absRow, absCol }                 a single cell (0-based position)
//   { t: 'range', a: ref, b: ref }                          two corners, as written
//   { t: 'name', name }                                     a word that is not a function, cell or TRUE/FALSE (-> #NAME?)
//   { t: 'call', name, args: [node] }                       name is upper case
//   { t: 'un', op: '-' | '+', x }   { t: 'bin', op, l, r }
// Precedence, tightest first: unary - +, ^, * /, + -, &, comparisons. Unary minus binds tighter than ^ (as in Excel), and
// ^ is left to right. See docs/modules/workspace.formulas.md.
import { parseRef } from './a1.js';
import { tokenize } from './lexer.js';

export const MAX_FORMULA_LENGTH = 1000;
export const MAX_DEPTH = 64;

class Stop extends Error {
  constructor(message, pos) {
    super(message);
    this.pos = pos;
  }
}

const COMPARE = new Set(['=', '<>', '<', '>', '<=', '>=']);

export function parseFormula(text) {
  if (typeof text !== 'string' || !text.startsWith('=')) return bad('A formula must start with an = sign.', 0);
  if ([...text].length > MAX_FORMULA_LENGTH)
    return bad(`A formula can be at most ${MAX_FORMULA_LENGTH.toLocaleString('en-US')} characters.`, 0);
  const lexed = tokenize(text.slice(1), 1);
  if (lexed.error) return { ok: false, error: lexed.error };
  const tokens = lexed.tokens;
  if (tokens.length === 0) return bad('Type something after the = sign.', 1);
  let at = 0;
  let depth = 0;
  const here = () => tokens[at];
  const endPos = () => (tokens.length ? tokens[tokens.length - 1].end : 1);
  const posOf = (t) => (t ? t.start : endPos());
  const describe = (t) => (t ? `"${t.text}"` : 'the end of the formula');
  const isOp = (t, s) => t && t.type === 'op' && t.text === s;

  function enter(t) {
    depth += 1;
    if (depth > MAX_DEPTH) throw new Stop('Too many brackets or functions inside each other.', posOf(t));
  }

  function binary(next, ops) {
    let left = next();
    while (here() && here().type === 'op' && ops.has(here().text)) {
      const op = tokens[at++].text;
      left = { t: 'bin', op, l: left, r: next() };
    }
    return left;
  }

  const parseCompare = () => binary(parseConcat, COMPARE);
  const parseConcat = () => binary(parseAdd, new Set(['&']));
  const parseAdd = () => binary(parseMul, new Set(['+', '-']));
  const parseMul = () => binary(parsePower, new Set(['*', '/']));
  const parsePower = () => binary(parseUnary, new Set(['^']));

  function parseUnary() {
    const t = here();
    if (t && t.type === 'op' && (t.text === '-' || t.text === '+')) {
      at += 1;
      enter(t);
      const x = parseUnary();
      depth -= 1;
      return { t: 'un', op: t.text, x };
    }
    return parsePrimary();
  }

  function refFrom(word) {
    const r = parseRef(word.text);
    return r ? { t: 'ref', ...r } : null;
  }

  function parsePrimary() {
    const t = here();
    if (!t) throw new Stop('The formula ends too soon.', endPos());
    if (t.type === 'num') return ((at += 1), { t: 'num', v: t.value });
    if (t.type === 'str') return ((at += 1), { t: 'str', v: t.value });
    if (t.type === 'err') return ((at += 1), { t: 'err', v: t.value });
    if (t.type === 'op' && t.text === '(') {
      at += 1;
      enter(t);
      const inner = parseCompare();
      const close = here();
      if (!isOp(close, ')')) throw new Stop(`Expected ) but found ${describe(close)}.`, posOf(close));
      at += 1;
      depth -= 1;
      return inner;
    }
    if (t.type === 'word') {
      at += 1;
      if (isOp(here(), '(')) {
        at += 1;
        enter(t);
        const args = [];
        if (!isOp(here(), ')')) {
          for (;;) {
            args.push(parseCompare());
            const sep = here();
            if (isOp(sep, ',')) {
              at += 1;
              continue;
            }
            if (isOp(sep, ')')) break;
            throw new Stop(`Expected , or ) but found ${describe(sep)}.`, posOf(sep));
          }
        }
        at += 1; // the closing bracket
        depth -= 1;
        return { t: 'call', name: t.text.toUpperCase(), args };
      }
      const upper = t.text.toUpperCase();
      if (upper === 'TRUE' || upper === 'FALSE') return { t: 'bool', v: upper === 'TRUE' };
      const a = refFrom(t);
      if (a) {
        if (isOp(here(), ':')) {
          at += 1;
          const w = here();
          const b = w && w.type === 'word' ? refFrom(w) : null;
          if (!b) throw new Stop('A range needs a cell after the colon, like A1:B9.', posOf(w));
          at += 1;
          return { t: 'range', a, b };
        }
        return a;
      }
      return { t: 'name', name: t.text };
    }
    throw new Stop(`Unexpected ${describe(t)}.`, posOf(t));
  }

  try {
    const ast = parseCompare();
    if (at < tokens.length) throw new Stop(`Unexpected ${describe(here())}.`, posOf(here()));
    return { ok: true, ast };
  } catch (e) {
    if (e instanceof Stop) return bad(e.message, e.pos);
    return bad('This formula could not be read.', 0); // never expected; a formula can never throw out of the parser
  }
}

function bad(message, pos) {
  return { ok: false, error: { message, pos } };
}
