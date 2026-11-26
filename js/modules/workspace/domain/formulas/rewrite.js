// Rewrites the cell references inside formula TEXT when rows or columns are inserted or deleted, or when a formula is
// copied somewhere else. The author's spacing, $ marks and everything that is not a reference stay exactly as typed.
// Text that is not a valid formula (or has a syntax problem) is returned unchanged. Positions are 0-based.
// See docs/modules/workspace.formulas.md ("Inserting and deleting rows and columns").
import { MAX_COLS, MAX_ROWS, parseRef, refText, withinLimits } from './a1.js';
import { tokenize } from './lexer.js';
import { parseFormula } from './parser.js';

const BROKEN = '#REF!';

// Every reference and range written in the text, in order: { kind: 'ref', ref, start, end } or { kind: 'range', a, b, start, end }.
function findRefs(text) {
  if (typeof text !== 'string' || !text.startsWith('=') || !parseFormula(text).ok) return null; // only a valid formula is touched
  const { tokens, error } = tokenize(text.slice(1), 1);
  if (error) return null;
  const found = [];
  const isCall = (i) => tokens[i + 1] && tokens[i + 1].type === 'op' && tokens[i + 1].text === '(';
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i];
    if (t.type !== 'word' || isCall(i)) continue;
    const a = parseRef(t.text);
    if (!a) continue;
    const colon = tokens[i + 1];
    const t2 = tokens[i + 2];
    if (colon && colon.type === 'op' && colon.text === ':' && t2 && t2.type === 'word' && !isCall(i + 2)) {
      const b = parseRef(t2.text);
      if (b) {
        found.push({ kind: 'range', a, b, start: t.start, end: t2.end });
        i += 2;
        continue;
      }
    }
    found.push({ kind: 'ref', ref: a, start: t.start, end: t.end });
  }
  return found;
}

// `change(item)` returns the new text for that reference or range, or undefined to leave it alone.
function rewrite(text, change) {
  const found = findRefs(text);
  if (!found) return text;
  let out = '';
  let at = 0;
  for (const item of found) {
    const replacement = change(item);
    if (replacement === undefined) continue;
    out += text.slice(at, item.start) + replacement;
    at = item.end;
  }
  return out + text.slice(at);
}

// Insert `count` rows (or columns) so that the first new one sits at position `at`: things at or after it move down.
// A range that spans the insertion point grows. axis is 'row' or 'col'.
export function rewriteForInsert(text, axis, at, count) {
  const move = (p) => (p[axis] >= at ? { ...p, [axis]: p[axis] + count } : p);
  const ok = (p) => withinLimits(p.row, p.col);
  return rewrite(text, (item) => {
    if (item.kind === 'ref') {
      const n = move(item.ref);
      if (n === item.ref) return undefined;
      return ok(n) ? refText(n) : BROKEN;
    }
    const a = move(item.a);
    const b = move(item.b);
    if (a === item.a && b === item.b) return undefined;
    return ok(a) && ok(b) ? `${refText(a)}:${refText(b)}` : BROKEN;
  });
}

// Delete the rows (or columns) at these positions. A reference to one becomes #REF!; the rest move up. A range loses its
// deleted rows and shrinks; a range with none left becomes #REF!.
export function rewriteForDelete(text, axis, deleted) {
  const gone = [...new Set(deleted)].filter(Number.isInteger).sort((x, y) => x - y);
  if (gone.length === 0) return text;
  const goneSet = new Set(gone);
  const before = (x) => lowerBound(gone, x); // how many deleted positions are below x
  const upTo = (x) => lowerBound(gone, x + 1); // how many are at or below x
  return rewrite(text, (item) => {
    if (item.kind === 'ref') {
      const p = item.ref[axis];
      if (goneSet.has(p)) return BROKEN;
      const n = p - before(p);
      return n === p ? undefined : refText({ ...item.ref, [axis]: n });
    }
    const pa = item.a[axis];
    const pb = item.b[axis];
    const lo = Math.min(pa, pb);
    const hi = Math.max(pa, pb);
    if (hi - lo + 1 - (upTo(hi) - before(lo)) <= 0) return BROKEN;
    const newLo = lo - before(lo);
    const newHi = hi - upTo(hi);
    if (newLo === lo && newHi === hi) return undefined;
    const a = { ...item.a, [axis]: pa <= pb ? newLo : newHi };
    const b = { ...item.b, [axis]: pa <= pb ? newHi : newLo };
    return `${refText(a)}:${refText(b)}`;
  });
}

// A formula copied by (dRow, dCol): parts without a $ move by the offset, parts with a $ stay. Landing outside the largest
// possible sheet makes the reference #REF!.
export function translateFormula(text, dRow, dCol) {
  const shift = (p) => ({ ...p, row: p.absRow ? p.row : p.row + dRow, col: p.absCol ? p.col : p.col + dCol });
  return rewrite(text, (item) => {
    if (dRow === 0 && dCol === 0) return undefined;
    if (item.kind === 'ref') {
      const n = shift(item.ref);
      return withinLimits(n.row, n.col) ? refText(n) : BROKEN;
    }
    const a = shift(item.a);
    const b = shift(item.b);
    return withinLimits(a.row, a.col) && withinLimits(b.row, b.col) ? `${refText(a)}:${refText(b)}` : BROKEN;
  });
}

function lowerBound(sorted, x) {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export const LIMITS = Object.freeze({ MAX_ROWS, MAX_COLS });
