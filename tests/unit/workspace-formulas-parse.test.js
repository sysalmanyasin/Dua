import { describe, expect, it } from 'vitest';
import {
  MAX_COLS,
  MAX_ROWS,
  colIndex,
  colLetters,
  keyOf,
  colOfKey,
  rowOfKey,
  parseRef,
  refText,
  withinLimits,
} from '../../js/modules/workspace/domain/formulas/a1.js';
import { ERROR_LITERALS, tokenize } from '../../js/modules/workspace/domain/formulas/lexer.js';
import { MAX_DEPTH, MAX_FORMULA_LENGTH, parseFormula } from '../../js/modules/workspace/domain/formulas/parser.js';
import { collectDeps, components } from '../../js/modules/workspace/domain/formulas/dependencies.js';

const ast = (text) => {
  const r = parseFormula(text);
  if (!r.ok) throw new Error(`${text}: ${r.error.message}`);
  return r.ast;
};
const fail = (text) => {
  const r = parseFormula(text);
  expect(r.ok, text).toBe(false);
  return r.error;
};
// A compact picture of a tree: (1 + (2 * 3))
const show = (n) => {
  switch (n.t) {
    case 'num':
      return String(n.v);
    case 'str':
      return JSON.stringify(n.v);
    case 'bool':
      return n.v ? 'TRUE' : 'FALSE';
    case 'err':
      return n.v;
    case 'ref':
      return refText(n);
    case 'range':
      return `${refText(n.a)}:${refText(n.b)}`;
    case 'name':
      return `name:${n.name}`;
    case 'call':
      return `${n.name}(${n.args.map(show).join(', ')})`;
    case 'un':
      return `(${n.op}${show(n.x)})`;
    default:
      return `(${show(n.l)} ${n.op} ${show(n.r)})`;
  }
};

describe('A1 helpers', () => {
  it('converts columns both ways for every column that can exist', () => {
    for (let i = 0; i < MAX_COLS; i += 1) expect(colIndex(colLetters(i))).toBe(i);
    expect([colLetters(0), colLetters(25), colLetters(26), colLetters(51), colLetters(52), colLetters(99)]).toEqual([
      'A',
      'Z',
      'AA',
      'AZ',
      'BA',
      'CV',
    ]);
    expect(colIndex('cv')).toBe(99);
    expect([colIndex(''), colIndex('A1'), colIndex('ABCD'), colIndex('1')]).toEqual([-1, -1, -1, -1]);
  });
  it('reads references with their $ marks, and refuses what is not one', () => {
    expect(parseRef('$B$12')).toEqual({ row: 11, col: 1, absRow: true, absCol: true });
    expect(parseRef('c3')).toEqual({ row: 2, col: 2, absRow: false, absCol: false });
    expect(parseRef('A$1')).toMatchObject({ absRow: true, absCol: false });
    for (const bad of ['A0', 'A', '1', 'AAAA1', 'A1B', '$$A1', 'A-1', 'A1.5', '']) expect(parseRef(bad), bad).toBeNull();
    expect(parseRef('ZZZ9999999')).not.toBeNull(); // shaped like a reference; beyond every sheet
  });
  it('writes references back, and knows the limits', () => {
    expect(refText({ row: 11, col: 1, absRow: true, absCol: true })).toBe('$B$12');
    expect(withinLimits(0, 0)).toBe(true);
    expect(withinLimits(MAX_ROWS - 1, MAX_COLS - 1)).toBe(true);
    expect([withinLimits(MAX_ROWS, 0), withinLimits(0, MAX_COLS), withinLimits(-1, 0)]).toEqual([false, false, false]);
  });
  it('keys are unique and ordered by row then column', () => {
    expect(keyOf(3, 7)).toBeLessThan(keyOf(4, 0));
    expect(keyOf(3, 7)).toBeLessThan(keyOf(3, 8));
    expect([rowOfKey(keyOf(9999, 99)), colOfKey(keyOf(9999, 99))]).toEqual([9999, 99]);
  });
});

describe('lexer', () => {
  it('reads every kind of token with its position in the full text', () => {
    const { tokens, error } = tokenize('SUM(A1:B2, 1.5e2, "a""b") <> #REF!', 1);
    expect(error).toBeNull();
    expect(tokens.map((t) => [t.type, t.text, t.start, t.end])).toEqual([
      ['word', 'SUM', 1, 4],
      ['op', '(', 4, 5],
      ['word', 'A1', 5, 7],
      ['op', ':', 7, 8],
      ['word', 'B2', 8, 10],
      ['op', ',', 10, 11],
      ['num', '1.5e2', 12, 17],
      ['op', ',', 17, 18],
      ['str', '"a""b"', 19, 25],
      ['op', ')', 25, 26],
      ['op', '<>', 27, 29],
      ['err', '#REF!', 30, 35],
    ]);
    expect(tokens[6].value).toBe(150);
    expect(tokens[8].value).toBe('a"b');
  });
  it('knows the error literals in any case and refuses other # words', () => {
    for (const e of ERROR_LITERALS) expect(tokenize(e.toLowerCase()).tokens[0].value).toBe(e);
    expect(tokenize('#NOPE!').error.message).toMatch(/#REF!/);
  });
  it('gives a plain reason and position for every problem', () => {
    expect(tokenize('"abc').error).toMatchObject({ message: expect.stringMatching(/closing quote/), pos: 1 });
    expect(tokenize('1+Sheet2!A1').error.message).toMatch(/other sheets/);
    expect(tokenize('1;2').error.message).toMatch(/comma/);
    expect(tokenize('5%').error.message).toMatch(/% sign/);
    expect(tokenize('1e999').error.message).toMatch(/too large/);
    expect(tokenize('1 @ 2').error).toMatchObject({ pos: 3 });
    expect(tokenize('\u00e9').error).toBeTruthy(); // names are plain letters
  });
  it('ignores spaces, tabs and line breaks outside text', () => {
    expect(tokenize(' 1\t+\n2 ').tokens.map((t) => t.text)).toEqual(['1', '+', '2']);
    expect(tokenize('"a  b"').tokens[0].value).toBe('a  b');
  });
});

describe('parser: precedence and shape', () => {
  it.each([
    ['=1+2*3', '(1 + (2 * 3))'],
    ['=(1+2)*3', '((1 + 2) * 3)'],
    ['=1-2-3', '((1 - 2) - 3)'],
    ['=8/4/2', '((8 / 4) / 2)'],
    ['=2^3^2', '((2 ^ 3) ^ 2)'],
    ['=-2^2', '((-2) ^ 2)'],
    ['=2^-2', '(2 ^ (-2))'],
    ['=--5', '(-(-5))'],
    ['=+A1', '(+A1)'],
    ['=1+2&3', '((1 + 2) & 3)'],
    ['="a"&1=2', '(("a" & 1) = 2)'],
    ['=1<2=TRUE', '((1 < 2) = TRUE)'],
    ['=1+2<>3*4', '((1 + 2) <> (3 * 4))'],
    ['=A1:B2', 'A1:B2'],
    ['=$A$1:b$2', '$A$1:B$2'],
    ['=sum(a1:a3, 2)', 'SUM(A1:A3, 2)'],
    ['=IF(A1>0, "y", "n")', 'IF((A1 > 0), "y", "n")'],
    ['=SUM()', 'SUM()'],
    ['=true', 'TRUE'],
    ['=#ref!', '#REF!'],
    ['=foo', 'name:foo'],
    ['=LOG10(3)', 'LOG10(3)'],
    ['=(((1)))', '1'],
  ])('%s', (text, picture) => expect(show(ast(text))).toBe(picture));

  it('treats a word shaped like a cell as a cell unless a bracket follows', () => {
    expect(ast('=LOG10').t).toBe('ref');
    expect(ast('=LOG10(1)').t).toBe('call');
  });
});

describe('parser: refusals', () => {
  it.each([
    ['1+1', 'must start with an = sign', 0],
    ['=', 'Type something', 1],
    ['=1+', 'ends too soon', 3],
    ['=(1', 'Expected )', 3],
    ['=1)', 'Unexpected ")"', 2],
    ['=SUM(1,)', 'Unexpected ")"', 7],
    ['=SUM(1 2)', 'Expected , or )', 7],
    ['=1 2', 'Unexpected "2"', 3],
    ['=A1:', 'needs a cell after the colon', 4],
    ['=A1:5', 'needs a cell after the colon', 4],
    ['=:A1', 'Unexpected ":"', 1],
    ['=A1:B2:C3', 'Unexpected ":"', 6],
    ['=()', 'Unexpected ")"', 2],
    ['=SUM(,1)', 'Unexpected ","', 5],
    ['=1,2', 'Unexpected ","', 2],
    ['="abc', 'closing quote', 1],
    ['=Sheet2!A1', 'other sheets', 7],
  ])('%s', (text, message, pos) => {
    const e = fail(text);
    expect(e.message).toContain(message);
    expect(e.pos).toBe(pos);
  });

  it('accepts only text that starts with =', () => {
    for (const v of [null, undefined, 5, {}, [], '', ' =1']) expect(parseFormula(v).ok).toBe(false);
  });
  it('limits length and nesting', () => {
    const longest = '=' + '1+'.repeat((MAX_FORMULA_LENGTH - 2) / 2) + '1'; // exactly 1,000 characters
    expect(parseFormula(longest).ok).toBe(true);
    expect([...longest].length).toBe(MAX_FORMULA_LENGTH);
    expect(fail(longest + '1').message).toMatch(/at most 1,000 characters/);
    expect(parseFormula('=' + '('.repeat(MAX_DEPTH - 1) + '1' + ')'.repeat(MAX_DEPTH - 1)).ok).toBe(true);
    expect(fail('=' + '('.repeat(MAX_DEPTH + 1) + '1' + ')'.repeat(MAX_DEPTH + 1)).message).toMatch(/Too many brackets/);
    expect(fail('=' + '-'.repeat(MAX_DEPTH + 5) + '1').message).toMatch(/Too many brackets/);
    expect(fail('=' + 'SUM('.repeat(MAX_DEPTH + 1) + '1' + ')'.repeat(MAX_DEPTH + 1)).message).toMatch(/Too many brackets/);
  });
  it('counts characters, not UTF-16 units', () => {
    expect(parseFormula('="' + '\u{1F600}'.repeat(500) + '"').ok).toBe(true); // 502 characters, 1,002 units
  });
});

describe('what a formula reads', () => {
  it('lists cells and normalised ranges, and skips references no sheet can hold', () => {
    const d = collectDeps(ast('=A1+SUM(B2:A1,C3)+AAA1+IF(Z9>1,D4:D2,1)'));
    expect(d.cells.map((c) => [c.row, c.col]).sort()).toEqual(
      [
        [0, 0],
        [2, 2],
        [8, 25],
      ].sort(),
    );
    expect(d.ranges).toEqual(
      expect.arrayContaining([
        { r1: 0, c1: 0, r2: 1, c2: 1 },
        { r1: 1, c1: 3, r2: 3, c2: 3 },
      ]),
    );
    expect(d.ranges).toHaveLength(2);
    expect(collectDeps(ast('=1+"a"')).cells).toEqual([]);
  });
});

describe('components (cycle detection)', () => {
  const run = (edges) => {
    const nodes = Object.keys(edges);
    return components(nodes, new Map(nodes.map((n) => [n, edges[n]])));
  };
  it('puts dependencies before the things that depend on them', () => {
    const out = run({ a: ['b'], b: ['c'], c: [] });
    expect(out.map((c) => c.nodes[0])).toEqual(['c', 'b', 'a']);
    expect(out.every((c) => !c.cyclic)).toBe(true);
  });
  it('finds self loops, pairs and longer loops, and nothing else', () => {
    const out = run({ a: ['a'], b: ['c'], c: ['b'], d: ['e'], e: ['f'], f: ['d'], g: ['a'], h: [] });
    const cyclic = out.filter((c) => c.cyclic).map((c) => c.nodes.sort().join(''));
    expect(cyclic.sort()).toEqual(['a', 'bc', 'def']);
    expect(out.find((c) => c.nodes[0] === 'g').cyclic).toBe(false);
    expect(out.find((c) => c.nodes[0] === 'h').cyclic).toBe(false);
  });
  it('handles a chain of 200,000 without recursion', () => {
    const edges = new Map();
    for (let i = 0; i < 200000; i += 1) edges.set(i, i === 0 ? [] : [i - 1]);
    const out = components(edges.keys(), edges);
    expect(out).toHaveLength(200000);
    expect(out[0].nodes[0]).toBe(0);
    expect(out[199999].nodes[0]).toBe(199999);
  });
});
