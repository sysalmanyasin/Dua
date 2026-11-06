import { describe, expect, it } from 'vitest';
import { isoParts, longDate, money, monthLabel, parseAmount, shortDate, signed, todayPkt, weekday } from '../../js/shared/format.js';

describe('money', () => {
  it('groups thousands, shows a real minus, and a dash for missing', () => {
    expect(money(437288)).toBe('437,288');
    expect(money(-5674)).toBe('−5,674');
    expect(money(0)).toBe('0');
    expect(money(null)).toBe('–');
    expect(money('')).toBe('–');
    expect(money(1234.5, { decimals: true })).toBe('1,234.50');
  });
  it('never shows a minus sign on a value that rounds to zero', () => {
    expect(money(-0.2)).toBe('0');
  });
  it('signed shows plus for gains', () => {
    expect(signed(4501)).toBe('+4,501');
    expect(signed(-12)).toBe('−12');
    expect(signed(0)).toBe('0');
  });
});

describe('dates', () => {
  it('formats iso dates', () => {
    expect(monthLabel('2026-09-25')).toBe('September 2026');
    expect(weekday('2026-11-05')).toBe('Thu');
    expect(longDate('2026-11-05')).toBe('Thu, 5 Nov 2026');
    expect(shortDate('2020-04-01')).toBe('01 Apr 2020');
    expect(isoParts('2026-11-05')).toEqual({ y: 2026, m: 11, d: 5 });
  });
  it('today is the Pakistan date, which changes at midnight PKT (19:00 UTC)', () => {
    expect(todayPkt(new Date('2026-11-05T18:59:00Z'))).toBe('2026-11-05');
    expect(todayPkt(new Date('2026-11-05T19:00:00Z'))).toBe('2026-11-06');
  });
});

describe('parseAmount', () => {
  it('reads what people type', () => {
    expect(parseAmount('1,234')).toBe(1234);
    expect(parseAmount(' 12 500.5 ')).toBe(12500.5);
    expect(parseAmount('-300')).toBe(-300);
    expect(parseAmount('−300')).toBe(-300);
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('  ')).toBeNull();
  });
  it('flags junk instead of guessing', () => {
    for (const bad of ['12a', '1.234', '--5', '1e5', '5,5,5.']) expect(Number.isNaN(parseAmount(bad))).toBe(true);
  });
});
