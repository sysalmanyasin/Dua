// Turns the text after the "=" into tokens. Never throws: a problem is returned as { error: { message, pos } }.
// Token: { type, text, start, end, value? }; start and end are offsets in the full formula text (the "=" is offset 0).
//   type 'num'  value is the number          type 'str'  value is the text
//   type 'word' a name, function or cell      type 'err'  value is the error text, for example '#REF!'
//   type 'op'   + - * / ^ & = <> < > <= >= : ( ) ,
export const ERROR_LITERALS = Object.freeze(['#REF!', '#VALUE!', '#DIV/0!', '#NAME?', '#CIRC!']);

const NUMBER = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/;
const WORD = /^[A-Za-z_$][A-Za-z0-9_.$]*/;
const SPACE = /^[ \t\r\n\u00a0]+/;
const TWO = new Set(['<>', '<=', '>=']);
const ONE = new Set(['+', '-', '*', '/', '^', '&', '=', '<', '>', ':', '(', ')', ',']);

export function tokenize(body, offset = 1) {
  const tokens = [];
  let i = 0;
  const fail = (message, at) => ({ tokens, error: { message, pos: offset + at } });
  while (i < body.length) {
    const rest = body.slice(i);
    const space = SPACE.exec(rest);
    if (space) {
      i += space[0].length;
      continue;
    }
    const ch = body[i];
    if (ch === '"') {
      let j = i + 1;
      let text = '';
      let closed = false;
      while (j < body.length) {
        if (body[j] === '"') {
          if (body[j + 1] === '"') {
            text += '"';
            j += 2;
            continue;
          }
          closed = true;
          j += 1;
          break;
        }
        text += body[j];
        j += 1;
      }
      if (!closed) return fail('The text starting here is missing its closing quote.', i);
      tokens.push({ type: 'str', text: body.slice(i, j), start: offset + i, end: offset + j, value: text });
      i = j;
      continue;
    }
    if (ch === '#') {
      const lit = ERROR_LITERALS.find((e) => rest.slice(0, e.length).toUpperCase() === e);
      if (!lit) return fail('"#" must be one of #REF!, #VALUE!, #DIV/0!, #NAME? or #CIRC!.', i);
      tokens.push({ type: 'err', text: rest.slice(0, lit.length), start: offset + i, end: offset + i + lit.length, value: lit });
      i += lit.length;
      continue;
    }
    const num = NUMBER.exec(rest);
    if (num) {
      const value = Number(num[0]);
      if (!Number.isFinite(value)) return fail('This number is too large.', i);
      tokens.push({ type: 'num', text: num[0], start: offset + i, end: offset + i + num[0].length, value });
      i += num[0].length;
      continue;
    }
    const word = WORD.exec(rest);
    if (word) {
      tokens.push({ type: 'word', text: word[0], start: offset + i, end: offset + i + word[0].length });
      i += word[0].length;
      continue;
    }
    const two = rest.slice(0, 2);
    if (TWO.has(two)) {
      tokens.push({ type: 'op', text: two, start: offset + i, end: offset + i + 2 });
      i += 2;
      continue;
    }
    if (ONE.has(ch)) {
      tokens.push({ type: 'op', text: ch, start: offset + i, end: offset + i + 1 });
      i += 1;
      continue;
    }
    if (ch === '!') return fail('References to other sheets are not supported yet.', i);
    if (ch === ';') return fail('Separate arguments with a comma (,).', i);
    if (ch === '%') return fail('The % sign is not supported yet.', i);
    return fail(`The character "${ch}" is not allowed here.`, i);
  }
  return { tokens, error: null };
}
