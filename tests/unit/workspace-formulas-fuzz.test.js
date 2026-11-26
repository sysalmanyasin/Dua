import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createEngine } from '../../js/modules/workspace/domain/formulas/engine.js';
import { calculate } from '../../js/modules/workspace/domain/formulas/evaluator.js';
import { parseFormula } from '../../js/modules/workspace/domain/formulas/parser.js';
import { rewriteForDelete, rewriteForInsert, translateFormula } from '../../js/modules/workspace/domain/formulas/rewrite.js';
import { MAX_TEXT, isError } from '../../js/modules/workspace/domain/formulas/values.js';

function prng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PIECES = [
  '=',
  '=',
  '=',
  '(',
  ')',
  ',',
  ':',
  '+',
  '-',
  '*',
  '/',
  '^',
  '&',
  '<',
  '>',
  '<>',
  '<=',
  '>=',
  ' ',
  '"',
  '""',
  '"a"',
  '1',
  '23',
  '.5',
  '1e3',
  '1e',
  'e5',
  '0',
  'A1',
  'B2',
  '$A$1',
  'A$1',
  'Z9',
  'CV10000',
  'CW1',
  'AAA1',
  'A0',
  'A1:B2',
  'C3:A1',
  'SUM(',
  'AVERAGE(',
  'MIN(',
  'MAX(',
  'COUNT(',
  'COUNTA(',
  'IF(',
  'AND(',
  'OR(',
  'ROUND(',
  'ABS(',
  'CONCAT(',
  'TRUE',
  'false',
  'foo',
  'Sheet1!',
  '!',
  '#REF!',
  '#VALUE!',
  '#DIV/0!',
  '#NAME?',
  '#CIRC!',
  '#',
  '%',
  ';',
  '@',
  '{',
  '}',
  '[',
  ']',
  "'",
  '\\',
  '\n',
  '\t',
  '\u00e9',
  '\u{1F600}',
  '\u0000',
  '\u202e',
  'constructor',
  '__proto__',
  'toString',
  'hasOwnProperty',
  'eval(',
  'Function(',
  'import(',
  'this',
  'window',
  'globalThis',
];
const WORDS = Array.from({ length: 0 });

// a context with a few cells so references resolve to something
const GRID = { '0:0': 5, '0:1': 'x', '1:0': true, '2:2': 7.5, '3:1': 'text' };
const ctx = {
  rows: 10,
  cols: 5,
  value: (r, c) => GRID[`${r}:${c}`] ?? null,
  eachInRange(r1, c1, r2, c2, fn) {
    for (let r = r1; r <= r2; r += 1)
      for (let c = c1; c <= c2; c += 1) if (GRID[`${r}:${c}`] !== undefined && fn(GRID[`${r}:${c}`]) === true) return;
  },
};

const validResult = (v) =>
  (typeof v === 'number' && Number.isFinite(v)) ||
  (typeof v === 'string' && [...v].length <= MAX_TEXT) ||
  typeof v === 'boolean' ||
  (isError(v) && ['#REF!', '#VALUE!', '#DIV/0!', '#NAME?', '#CIRC!'].includes(v.error));

function randomText(rnd) {
  const n = Math.floor(rnd() * 14);
  let out = '=';
  for (let i = 0; i < n; i += 1) out += PIECES[Math.floor(rnd() * PIECES.length)];
  return out;
}

function randomGarbage(rnd) {
  const n = Math.floor(rnd() * 80);
  let out = rnd() < 0.7 ? '=' : '';
  for (let i = 0; i < n; i += 1) out += String.fromCodePoint(rnd() < 0.8 ? 32 + Math.floor(rnd() * 95) : Math.floor(rnd() * 0x2fff));
  return out;
}

function mutate(text, rnd) {
  const chars = [...text];
  const k = 1 + Math.floor(rnd() * 3);
  for (let i = 0; i < k; i += 1) {
    const at = Math.floor(rnd() * (chars.length + 1));
    const m = rnd();
    if (m < 0.3) chars.splice(at, 1);
    else if (m < 0.6) chars.splice(at, 0, PIECES[Math.floor(rnd() * PIECES.length)]);
    else if (m < 0.8 && chars.length > 1) {
      const j = Math.floor(rnd() * chars.length);
      [chars[at % chars.length], chars[j]] = [chars[j], chars[at % chars.length]];
    } else chars.splice(at, 0, ...chars.slice(Math.floor(rnd() * chars.length)).slice(0, 5));
  }
  return chars.join('');
}

function exercise(text) {
  const parsed = parseFormula(text);
  expect(typeof parsed.ok).toBe('boolean');
  if (!parsed.ok) {
    expect(typeof parsed.error.message).toBe('string');
    expect(Number.isInteger(parsed.error.pos)).toBe(true);
  }
  const value = calculate(text, ctx);
  expect(validResult(value), `${JSON.stringify(text)} -> ${JSON.stringify(value)}`).toBe(true);
  for (const out of [rewriteForInsert(text, 'row', 1, 2), rewriteForDelete(text, 'col', [0, 2]), translateFormula(text, 1, -1)])
    expect(typeof out).toBe('string');
}

describe('fuzz: nothing throws and nothing is executed', () => {
  it('random token soup (30,000 texts)', () => {
    const evalSpy = vi.spyOn(globalThis, 'eval');
    try {
      const rnd = prng(2026);
      for (let i = 0; i < 30000; i += 1) exercise(randomText(rnd));
      expect(evalSpy).not.toHaveBeenCalled();
    } finally {
      evalSpy.mockRestore();
    }
  });

  it('random characters from across Unicode, controls and emoji (10,000 texts)', () => {
    const rnd = prng(7);
    for (let i = 0; i < 10000; i += 1) exercise(randomGarbage(rnd));
  });

  it('every fixture formula with random damage (20,000 mutations)', () => {
    const { cases } = JSON.parse(readFileSync('tests/fixtures/workspace-formula-cases.json', 'utf8'));
    const formulas = cases
      .flatMap((c) => [c.f, ...Object.values(c.cells ?? {}).filter((v) => typeof v === 'string' && v.startsWith('='))])
      .filter(Boolean);
    const rnd = prng(31);
    for (let i = 0; i < 20000; i += 1) exercise(mutate(formulas[Math.floor(rnd() * formulas.length)], rnd));
  });

  it('names that look like object internals are just names', () => {
    for (const t of [
      '=constructor',
      '=__proto__',
      '=toString(1)',
      '=hasOwnProperty(1)',
      '=valueOf',
      '=eval("1")',
      '=Function("return 1")()',
      '=import("x")',
      '=this',
      '=globalThis',
    ]) {
      const v = calculate(t, ctx);
      expect(v).toEqual({ error: '#NAME?' });
    }
    expect(Object.getPrototypeOf(calculate('=__proto__', ctx))).toBe(Object.prototype);
  });

  it('the engine takes any text as a formula without throwing, and gives text results only as text', () => {
    const rnd = prng(5);
    const e = createEngine({ rows: 6, cols: 4, cells: [{ row: 0, col: 0, value: 1, formula: null }] });
    for (let i = 0; i < 3000; i += 1) {
      const row = Math.floor(rnd() * 6);
      const col = Math.floor(rnd() * 4);
      e.update([{ row, col, value: null, formula: rnd() < 0.8 ? randomText(rnd) : null }]);
      expect(validResult(e.get(row, col)) || e.get(row, col) === null).toBe(true);
    }
    e.recalculateAll();
  });

  it('pathological inputs come back quickly', () => {
    const t0 = performance.now();
    for (const t of [
      '=' + '('.repeat(5000),
      '=' + '-'.repeat(5000) + '1',
      '=' + 'SUM('.repeat(500),
      '=' + '"a"&'.repeat(240) + '"b"',
      '=' + '1+'.repeat(499) + '1',
      '=SUM(A1:CV10000)',
      '=' + 'A1:B2,'.repeat(150),
    ]) {
      const v = calculate(t, ctx);
      expect(validResult(v)).toBe(true);
    }
    expect(performance.now() - t0).toBeLessThan(2000);
  });

  it('a long text cannot grow past the limit', () => {
    const big = (n) => ({ row: 0, col: n, value: 'x'.repeat(16000), formula: null });
    const f = (col, text) => ({ row: 1, col, value: null, formula: text });
    const e = createEngine({
      rows: 4,
      cols: 8,
      cells: [
        big(0),
        big(1),
        big(2),
        f(0, '=A1&B1'),
        f(1, '=A1&B1&C1'),
        f(2, '=CONCAT(A1:C1)'),
        f(3, '=CONCAT(A1:B1)'),
        f(4, '=A1&A1&"xyzxyz"'),
        f(5, '=A1&A1&A1'),
      ],
    });
    expect(e.get(1, 0)).toHaveLength(32000); // allowed: at most 32,767 characters
    expect(e.get(1, 1)).toEqual({ error: '#VALUE!' }); // 48,000
    expect(e.get(1, 2)).toEqual({ error: '#VALUE!' });
    expect(e.get(1, 3)).toHaveLength(32000);
    expect(e.get(1, 4)).toHaveLength(32006);
    expect(e.get(1, 5)).toEqual({ error: '#VALUE!' }); // three cells: 48,000 // two cells of 16,000 plus 6 characters still fits
  });
});

describe('the formula code can only calculate', () => {
  const dir = 'js/modules/workspace/domain/formulas';
  const files = readdirSync(dir).filter((f) => f.endsWith('.js'));
  it('has the files the design lists', () => {
    for (const f of ['lexer.js', 'parser.js', 'evaluator.js', 'functions.js', 'dependencies.js']) expect(files).toContain(f);
  });
  it.each(files)('%s has no eval, no dynamic code, no network, no DOM, no storage, no timers, no dynamic import', (name) => {
    const src = readFileSync(`${dir}/${name}`, 'utf8').replace(/\/\/.*$/gm, ''); // comments may mention the words
    expect(src).not.toMatch(
      /\beval\b|new\s+Function|\bFunction\s*\(|\bimport\s*\(|\brequire\s*\(|document\.|window\.|globalThis|localStorage|sessionStorage|indexedDB|fetch\s*\(|XMLHttpRequest|WebSocket|setTimeout|setInterval|innerHTML|postMessage|navigator|process\./,
    );
  });
  it('imports only from its own folder and the grid number formatter', () => {
    for (const name of files) {
      const src = readFileSync(`${dir}/${name}`, 'utf8');
      for (const m of src.matchAll(/^import .* from '([^']+)';/gm))
        expect(
          ['./', '../grid.js'].some((p) => m[1].startsWith(p)),
          `${name} imports ${m[1]}`,
        ).toBe(true);
    }
  });
  void WORDS;
});
