// Evaluates a parsed formula against a sheet, through a small context object. Errors are values; nothing here throws.
//   ctx.rows, ctx.cols                    the size of the sheet (a reference outside it is #REF!)
//   ctx.value(row, col)                   the value of one cell (null when empty), already calculated
//   ctx.eachInRange(r1, c1, r2, c2, fn)   calls fn(value) for each NON-EMPTY cell of the rectangle in row order; fn returns
//                                         true to stop
import { FUNCTIONS } from './functions.js';
import { parseFormula } from './parser.js';
import { ERR, MAX_TEXT, compare, errorFromText, finite, isError, toNumber, toText } from './values.js';

// Calculates formula text. Text that is not a valid formula is #NAME?.
export function calculate(text, ctx) {
  const parsed = parseFormula(text);
  return parsed.ok ? evaluate(parsed.ast, ctx) : ERR.NAME;
}

export function evaluate(ast, ctx) {
  const inSheet = (row, col) => row >= 0 && col >= 0 && row < ctx.rows && col < ctx.cols;

  const h = {
    scalar,
    each(node, fn) {
      if (node.t === 'range') {
        const [r1, r2] = node.a.row <= node.b.row ? [node.a.row, node.b.row] : [node.b.row, node.a.row];
        const [c1, c2] = node.a.col <= node.b.col ? [node.a.col, node.b.col] : [node.b.col, node.a.col];
        if (!inSheet(r1, c1) || !inSheet(r2, c2)) return fn(ERR.REF, false) === true;
        let stopped = false;
        ctx.eachInRange(r1, c1, r2, c2, (v) => {
          stopped = fn(v, false) === true;
          return stopped;
        });
        return stopped;
      }
      if (node.t === 'ref') {
        if (!inSheet(node.row, node.col)) return fn(ERR.REF, false) === true;
        const v = ctx.value(node.row, node.col);
        return v === null || v === undefined ? false : fn(v, false) === true;
      }
      return fn(scalar(node), true) === true;
    },
  };

  function arith(op, a, b) {
    const x = toNumber(a);
    if (isError(x)) return x;
    const y = toNumber(b);
    if (isError(y)) return y;
    switch (op) {
      case '+':
        return finite(x + y);
      case '-':
        return finite(x - y);
      case '*':
        return finite(x * y);
      case '/':
        return y === 0 ? ERR.DIV0 : finite(x / y);
      default: // '^'
        return x === 0 && y < 0 ? ERR.DIV0 : finite(x ** y);
    }
  }

  function scalar(node) {
    switch (node.t) {
      case 'num':
      case 'str':
      case 'bool':
        return node.v;
      case 'err':
        return errorFromText(node.v);
      case 'ref':
        return inSheet(node.row, node.col) ? ctx.value(node.row, node.col) : ERR.REF;
      case 'range':
        return ERR.VALUE; // a range where one value is needed (no implicit intersection)
      case 'name':
        return ERR.NAME;
      case 'un': {
        const v = scalar(node.x);
        if (node.op === '+') return v;
        const n = toNumber(v);
        return isError(n) ? n : finite(-n);
      }
      case 'bin': {
        const l = scalar(node.l);
        if (isError(l)) return l;
        const r = scalar(node.r);
        if (isError(r)) return r;
        if (node.op === '&') {
          const a = toText(l);
          const b = toText(r);
          return [...a, ...b].length > MAX_TEXT ? ERR.VALUE : a + b;
        }
        if (node.op === '+' || node.op === '-' || node.op === '*' || node.op === '/' || node.op === '^') return arith(node.op, l, r);
        const c = compare(l, r);
        if (isError(c)) return c;
        switch (node.op) {
          case '=':
            return c === 0;
          case '<>':
            return c !== 0;
          case '<':
            return c < 0;
          case '>':
            return c > 0;
          case '<=':
            return c <= 0;
          default:
            return c >= 0;
        }
      }
      case 'call': {
        const fn = Object.hasOwn(FUNCTIONS, node.name) ? FUNCTIONS[node.name] : null;
        if (!fn) return ERR.NAME;
        if (node.args.length < fn.min || node.args.length > fn.max) return ERR.VALUE;
        return fn.call(node.args, h);
      }
      default:
        return ERR.VALUE;
    }
  }

  let result = scalar(ast);
  if (result === null || result === undefined) result = 0; // a formula never ends as empty
  if (typeof result === 'number') return finite(result);
  if (typeof result === 'string' && [...result].length > MAX_TEXT) return ERR.VALUE;
  return result;
}
