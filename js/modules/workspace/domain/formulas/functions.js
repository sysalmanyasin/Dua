// The eleven functions. Each has { min, max, call(argNodes, h) } where h comes from the evaluator:
//   h.scalar(node)            the value of one expression (a range here is #VALUE!)
//   h.each(node, fn)          walks an argument: a range or a cell gives its non-empty cells one by one with direct = false;
//                             any other expression gives its one value with direct = true. fn returns true to stop.
// Errors are returned as values. Argument counts are checked by the evaluator before call() runs.
import { ERR, MAX_TEXT, finite, isError, roundHalfAway, toBool, toNumber, toText } from './values.js';

const many = (min = 1) => ({ min, max: Infinity });

// Runs `visit(value, direct)` over every argument in order; the first error found in `visit` (returned as a value) wins.
function walk(args, h, visit) {
  let found = null;
  for (const a of args) {
    const stopped = h.each(a, (v, direct) => {
      const r = visit(v, direct);
      if (r !== undefined && r !== null && isError(r)) {
        found = r;
        return true;
      }
      return false;
    });
    if (stopped) break;
  }
  return found;
}

// A typed value is converted strictly; a cell value only counts when it already is a number. Errors are returned.
function numbersOf(args, h, onNumber) {
  return walk(args, h, (v, direct) => {
    if (isError(v)) return v;
    if (direct) {
      const n = toNumber(v);
      if (isError(n)) return n;
      onNumber(n);
    } else if (typeof v === 'number') {
      onNumber(v);
    }
    return null;
  });
}

export const FUNCTIONS = {
  SUM: {
    ...many(),
    call(args, h) {
      let sum = 0;
      return numbersOf(args, h, (n) => (sum += n)) ?? finite(sum);
    },
  },
  AVERAGE: {
    ...many(),
    call(args, h) {
      let sum = 0;
      let count = 0;
      const err = numbersOf(args, h, (n) => {
        sum += n;
        count += 1;
      });
      if (err) return err;
      return count === 0 ? ERR.DIV0 : finite(sum / count);
    },
  },
  MIN: {
    ...many(),
    call(args, h) {
      let best = null;
      const err = numbersOf(args, h, (n) => (best = best === null || n < best ? n : best));
      return err ?? (best === null ? 0 : best);
    },
  },
  MAX: {
    ...many(),
    call(args, h) {
      let best = null;
      const err = numbersOf(args, h, (n) => (best = best === null || n > best ? n : best));
      return err ?? (best === null ? 0 : best);
    },
  },
  // COUNT and COUNTA never return an error from their arguments.
  COUNT: {
    ...many(),
    call(args, h) {
      let count = 0;
      walk(args, h, (v, direct) => {
        if (isError(v) || v === null) return null;
        if (direct ? !isError(toNumber(v)) : typeof v === 'number') count += 1;
        return null;
      });
      return count;
    },
  },
  COUNTA: {
    ...many(),
    call(args, h) {
      let count = 0;
      walk(args, h, (v) => {
        if (v !== null) count += 1;
        return null;
      });
      return count;
    },
  },
  IF: {
    min: 2,
    max: 3,
    call(args, h) {
      const test = h.scalar(args[0]);
      if (isError(test)) return test;
      const t = toBool(test);
      if (isError(t)) return t;
      if (t) return h.scalar(args[1]);
      return args.length === 3 ? h.scalar(args[2]) : false;
    },
  },
  AND: { ...many(), call: (args, h) => logical(args, h, true) },
  OR: { ...many(), call: (args, h) => logical(args, h, false) },
  ROUND: {
    min: 1,
    max: 2,
    call(args, h) {
      const x = toNumber(h.scalar(args[0]));
      if (isError(x)) return x;
      const d = args.length === 2 ? toNumber(h.scalar(args[1])) : 0;
      if (isError(d)) return d;
      return finite(roundHalfAway(x, d));
    },
  },
  ABS: {
    min: 1,
    max: 1,
    call(args, h) {
      const x = toNumber(h.scalar(args[0]));
      return isError(x) ? x : finite(Math.abs(x));
    },
  },
  CONCAT: {
    ...many(),
    call(args, h) {
      const parts = [];
      let length = 0;
      const err = walk(args, h, (v) => {
        const t = toText(v);
        if (isError(t)) return t;
        parts.push(t);
        length += t.length;
        return length > 4 * MAX_TEXT ? ERR.VALUE : null; // stop early on absurd sizes
      });
      if (err) return err;
      const out = parts.join('');
      return [...out].length > MAX_TEXT ? ERR.VALUE : out;
    },
  },
};

// AND and OR evaluate every argument (a later error still wins). Typed values are converted strictly; in cells and ranges
// only booleans and numbers count, text and empty cells are ignored. At least one logical value is needed.
function logical(args, h, isAnd) {
  let seen = false;
  let result = isAnd;
  const err = walk(args, h, (v, direct) => {
    if (isError(v)) return v;
    let b;
    if (direct) {
      b = toBool(v);
      if (isError(b)) return b;
    } else if (typeof v === 'boolean') b = v;
    else if (typeof v === 'number') b = v !== 0;
    else return null;
    seen = true;
    result = isAnd ? result && b : result || b;
    return null;
  });
  if (err) return err;
  return seen ? result : ERR.VALUE;
}
