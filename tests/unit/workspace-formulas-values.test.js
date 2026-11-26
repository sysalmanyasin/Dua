import { describe, expect, it } from 'vitest';
import {
  ERR,
  compare,
  errorFromText,
  finite,
  isError,
  roundHalfAway,
  toBool,
  toNumber,
  toText,
} from '../../js/modules/workspace/domain/formulas/values.js';

describe('error values', () => {
  it('are frozen values, recognised by shape, never exceptions', () => {
    expect(Object.values(ERR).map((e) => e.error)).toEqual(['#REF!', '#VALUE!', '#DIV/0!', '#NAME?', '#CIRC!']);
    expect(Object.values(ERR).every((e) => Object.isFrozen(e))).toBe(true);
    expect(isError(ERR.REF)).toBe(true);
    for (const v of [null, undefined, 0, '', 'x', true, {}, { error: 5 }, [], NaN]) expect(isError(v), String(v)).toBe(false);
    expect(errorFromText('#DIV/0!')).toBe(ERR.DIV0);
    expect(errorFromText('#WHAT?')).toBe(ERR.VALUE);
  });
});

describe('to a number', () => {
  it.each([
    [null, 0],
    [undefined, 0],
    [5, 5],
    [-2.5, -2.5],
    [true, 1],
    [false, 0],
    ['7', 7],
    [' 7 ', 7],
    ['+7', 7],
    ['-7.5', -7.5],
    ['.5', 0.5],
    ['5.', 5],
    ['1e3', 1000],
    ['2E-2', 0.02],
  ])('%j gives %j', (input, out) => expect(toNumber(input)).toBe(out));
  it.each([
    [''],
    [' '],
    ['abc'],
    ['1,200'],
    ['5%'],
    ['0x10'],
    ['Infinity'],
    ['NaN'],
    ['1 2'],
    ['--1'],
    ['1e'],
    ['e5'],
    ['1e999'],
    ['\u0661\u0662'],
  ])('%j is #VALUE!', (input) => expect(toNumber(input)).toBe(ERR.VALUE));
  it('passes errors on and refuses other kinds of value', () => {
    expect(toNumber(ERR.DIV0)).toBe(ERR.DIV0);
    expect(toNumber({})).toBe(ERR.VALUE);
  });
});

describe('to text', () => {
  it.each([
    [null, ''],
    ['x', 'x'],
    [true, 'TRUE'],
    [false, 'FALSE'],
    [3, '3'],
    [0.1 + 0.2, '0.3'],
    [1 / 3, '0.333333333333333'],
    [4005808123456, '4005808123456'],
    [-0.5, '-0.5'],
  ])('%j gives %j', (input, out) => expect(toText(input)).toBe(out));
  it('passes errors on', () => expect(toText(ERR.REF)).toBe(ERR.REF));
});

describe('to true or false', () => {
  it.each([
    [null, false],
    [true, true],
    [false, false],
    [0, false],
    [2, true],
    [-1, true],
    ['TRUE', true],
    [' true ', true],
    ['False', false],
  ])('%j gives %j', (input, out) => expect(toBool(input)).toBe(out));
  it('refuses other text', () => {
    expect(toBool('yes')).toBe(ERR.VALUE);
    expect(toBool('')).toBe(ERR.VALUE);
    expect(toBool(ERR.NAME)).toBe(ERR.NAME);
  });
});

describe('finite', () => {
  it('keeps numbers, turns negative zero into 0 and everything else into #VALUE!', () => {
    expect(finite(2)).toBe(2);
    expect(Object.is(finite(-0), 0)).toBe(true);
    for (const bad of [Infinity, -Infinity, NaN]) expect(finite(bad)).toBe(ERR.VALUE);
  });
});

describe('comparing', () => {
  const sample = [null, 0, -3.5, 7, '', 'a', 'A', 'b', 'abc', '\u00e9', false, true];
  it('orders numbers before text before booleans, text without regard to case', () => {
    expect(compare(5, 'a')).toBe(-1);
    expect(compare('a', true)).toBe(-1);
    expect(compare(5, true)).toBe(-1);
    expect(compare('a', 'A')).toBe(0);
    expect(compare('abc', 'abd')).toBe(-1);
    expect(compare('2', '10')).toBe(1); // text, not numbers
    expect(compare(2, 10)).toBe(-1);
    expect(compare(false, true)).toBe(-1);
    expect(compare('\u00e9', 'e')).toBe(1);
    expect(compare('\u{1F600}', '\uffff')).toBe(1); // by code point, so a character outside the basic plane sorts after
  });
  it('lets an empty cell take the kind of the other side', () => {
    expect(compare(null, 0)).toBe(0);
    expect(compare(null, '')).toBe(0);
    expect(compare(null, false)).toBe(0);
    expect(compare(null, null)).toBe(0);
    expect(compare(null, 1)).toBe(-1);
    expect(compare('a', null)).toBe(1);
  });
  it('returns the error when either side is one, the left one first', () => {
    expect(compare(ERR.REF, 1)).toBe(ERR.REF);
    expect(compare(1, ERR.NAME)).toBe(ERR.NAME);
    expect(compare(ERR.REF, ERR.NAME)).toBe(ERR.REF);
  });
  it('is reflexive, antisymmetric and transitive over a mixed sample', () => {
    for (const a of sample) {
      expect(compare(a, a), String(a)).toBe(0);
      for (const b of sample) {
        expect(compare(a, b), `${a} ${b}`).toBe(-compare(b, a) || 0);
        for (const c of sample) {
          // empty cells change kind depending on the other side, so transitivity is only promised among non-empty values
          if (a === null || b === null || c === null) continue;
          if (compare(a, b) <= 0 && compare(b, c) <= 0) expect(compare(a, c), `${a} ${b} ${c}`).toBeLessThanOrEqual(0);
        }
      }
    }
  });
});

describe('ROUND: half away from zero on the decimal reading', () => {
  it.each([
    [2.5, 0, 3],
    [-2.5, 0, -3],
    [0.5, 0, 1],
    [-0.5, 0, -1],
    [1.5, 0, 2],
    [1.005, 2, 1.01],
    [2.675, 2, 2.68],
    [-2.675, 2, -2.68],
    [1.2345, 3, 1.235],
    [1234.5678, 2, 1234.57],
    [1250, -2, 1300],
    [-1250, -2, -1300],
    [15, -1, 20],
    [14.999, -1, 10],
    [0.049, 1, 0],
    [3.14159, 4, 3.1416],
    [5, 1.9, 5],
    [1e20, 2, 1e20],
    [123456789.5, 0, 123456790],
    [0.285, 2, 0.29],
    [1.45, 1, 1.5],
    [8.345, 2, 8.35],
    [-8.345, 2, -8.35],
    [2.5, 20, 2.5],
    [1234, -20, 0],
  ])('ROUND(%j, %j) = %j', (x, d, out) => expect(roundHalfAway(x, d)).toBe(out));
  it('never returns negative zero', () => {
    expect(Object.is(roundHalfAway(-0.049, 1), 0)).toBe(true);
    expect(Object.is(roundHalfAway(-0, 2), 0) || Object.is(roundHalfAway(-0, 2), -0)).toBe(true);
  });
  it('is symmetric, idempotent, and moves a value by at most half a unit', () => {
    let seed = 12345;
    const next = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
    for (let i = 0; i < 3000; i += 1) {
      const x = Math.round((next() - 0.5) * 2e6) / 1000 + (next() < 0.3 ? 0.0005 : 0);
      const d = Math.floor(next() * 6) - 2;
      const r = roundHalfAway(x, d);
      expect(roundHalfAway(-x, d), `${x} ${d}`).toBe(r === 0 ? 0 : -r);
      expect(roundHalfAway(r, d), `${x} ${d}`).toBe(r);
      expect(Math.abs(r - x)).toBeLessThanOrEqual(0.5 * 10 ** -d + 1e-9);
    }
  });
});
