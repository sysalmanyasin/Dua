// The counting calculator's arithmetic (js/modules/audit/domain/calc.js).
import { describe, expect, it } from 'vitest';
import {
  displayText,
  expressionText,
  formatFraction,
  initialCalc,
  insertable,
  press,
  previewText,
} from '../../js/modules/audit/domain/calc.js';

/** Types a sum as a string of keys, e.g. keys('6*10+4='). */
const keys = (text, from = initialCalc()) => [...text].reduce((s, k) => press(s, k), from);
const total = (text) => {
  const r = insertable(keys(text));
  return r.ok ? r.text : r.reason;
};

describe('the sums a counter types', () => {
  it('6 boxes × 10 + 4 loose is 64, and it can be inserted as 64', () => {
    const s = keys('6*10+4');
    expect(insertable(s)).toEqual({ ok: true, qty: 64, text: '64' });
    expect(displayText(keys('6*10+4='))).toBe('64');
  });

  it('does × and ÷ before + and −, as a printed sum reads', () => {
    expect(total('4+6*10')).toBe('64');
    expect(total('100-5*10')).toBe('50');
    expect(total('2+12/4')).toBe('5');
    expect(total('10-2-3')).toBe('5'); // equal rank goes left to right
    expect(total('24/4/2')).toBe('3');
  });

  it('is exact: no float noise, and 10 ÷ 3 × 3 is 10', () => {
    expect(total('0.1+0.2')).toBe('0.3');
    expect(total('10/3*3')).toBe('10');
    expect(total('1.1*3')).toBe('3.3');
    expect(total('0.5*4')).toBe('2');
  });

  it('accepts the keyboard spellings of the operators', () => {
    expect(total('6x10+4')).toBe('64');
    expect(total('6X10+4')).toBe('64');
    expect(total('6×10−4')).toBe('56');
    expect(total('9÷3')).toBe('3');
  });

  it('a number alone can be inserted, and "=" keeps going from the result', () => {
    expect(total('12')).toBe('12');
    expect(total('0')).toBe('0');
    const s = keys('6*10=');
    expect(displayText(s)).toBe('60');
    expect(total('+4=')).toBe('4'); // a fresh sum cannot start with an operator: it is ignored
    expect(insertable(keys('+4', s))).toEqual({ ok: true, qty: 64, text: '64' }); // but the result can be continued
  });

  it('typing a digit after "=" starts a new sum', () => {
    expect(insertable(keys('7', keys('6*10=')))).toEqual({ ok: true, qty: 7, text: '7' });
  });
});

describe('what can and cannot be inserted', () => {
  it('refuses a sum that is not finished, or has nothing in it', () => {
    expect(insertable(initialCalc()).reason).toBe('Enter a number first.');
    expect(total('6*')).toBe('Finish the sum first.');
    expect(total('6*10+')).toBe('Finish the sum first.');
  });

  it('refuses a result below zero', () => {
    expect(total('3-5')).toBe('A count cannot be below zero.');
    expect(total('5-5')).toBe('0'); // zero is a valid count
  });

  it('refuses more than 3 decimals and never rounds the number on the way in', () => {
    expect(total('10/3')).toBe('3.333333 has more than 3 decimals. A count can have up to 3.');
    expect(total('1/8')).toBe('0.125'); // exactly 3 decimals is fine
    expect(total('1/16')).toBe('0.0625 has more than 3 decimals. A count can have up to 3.');
    expect(total('2/3*3')).toBe('2'); // exact again once the third is multiplied back
  });

  it('refuses a result above the largest count', () => {
    expect(total('999999999+1')).toBe('A count can be at most 999,999,999.');
    expect(total('999999999')).toBe('999999999');
  });

  it('division by zero is an error that clears on the next digit or Clear', () => {
    const s = keys('5/0=');
    expect(s.error).toBe('Cannot divide by zero.');
    expect(displayText(s)).toBe('Error');
    expect(insertable(s).reason).toBe('Cannot divide by zero.');
    expect(press(s, '+')).toBe(s); // other keys do nothing until it is cleared
    expect(displayText(press(s, '7'))).toBe('7');
    expect(press(s, 'clear')).toEqual(initialCalc());
    expect(total('5/0')).toBe('Cannot divide by zero.'); // refused without pressing "="
    expect(total('0/5')).toBe('0');
  });

  it('a result of 1 000 000 000 000 or more is "too big", not a wrong number', () => {
    expect(total('999999999999*999999999999')).toBe('The result is too big.');
    expect(keys('999999999999*999999999999=').error).toBe('The result is too big.');
  });
});

describe('typing numbers', () => {
  it('has no leading zeros, and one decimal point', () => {
    expect(displayText(keys('007'))).toBe('7');
    expect(displayText(keys('0.5'))).toBe('0.5');
    expect(displayText(keys('.5'))).toBe('0.5');
    expect(displayText(keys('1.2.3'))).toBe('1.23');
  });

  it('stops at 12 whole digits and 3 decimals', () => {
    expect(displayText(keys('1234567890123456'))).toBe('123456789012');
    expect(displayText(keys('1.23456'))).toBe('1.234');
  });

  it('shows 0 when nothing is typed, and the last number after an operator', () => {
    expect(displayText(initialCalc())).toBe('0');
    expect(displayText(keys('6*'))).toBe('6');
    expect(expressionText(keys('6*10+'))).toBe('6 × 10 +');
    expect(expressionText(keys('6*10+4'))).toBe('6 × 10 +'); // the number being typed is on the big display
  });

  it('an operator with nothing before it does nothing, and a second operator replaces the first', () => {
    expect(press(initialCalc(), '+')).toEqual(initialCalc());
    expect(expressionText(keys('6+*'))).toBe('6 ×');
    expect(total('6+*10')).toBe('60');
  });

  it('ignores keys it does not know', () => {
    const s = keys('6');
    expect(press(s, 'Shift')).toBe(s);
    expect(press(s, 'constructor')).toBe(s);
    expect(press(s, 'toString')).toBe(s);
  });
});

describe('correcting', () => {
  it('Backspace removes the last digit, then the operator, then the number before it becomes editable', () => {
    let s = keys('12*3');
    s = press(s, 'back');
    expect(s.entry).toBe('');
    s = press(s, 'back'); // the × goes, and the 12 before it can be edited again
    expect(expressionText(s)).toBe('');
    expect(s.entry).toBe('12');
    s = press(s, 'back');
    expect(s.entry).toBe('1');
    expect(displayText(press(keys('6*10+4'), 'back'))).toBe('10'); // the 4 is gone; the last number shows
  });

  it('Backspace on an empty sum or after "=" clears, and Clear always clears', () => {
    expect(press(initialCalc(), 'back')).toEqual(initialCalc());
    expect(press(keys('6*10='), 'back')).toEqual(initialCalc());
    expect(press(keys('6*10+4'), 'clear')).toEqual(initialCalc());
  });
});

describe('the live total', () => {
  it('shows what the sum comes to once there is an operator and a finished sum', () => {
    expect(previewText(keys('6'))).toBeNull();
    expect(previewText(keys('6*'))).toBeNull();
    expect(previewText(keys('6*10'))).toBe('60');
    expect(previewText(keys('6*10+4'))).toBe('64');
    expect(previewText(keys('10/3'))).toBe('3.333333'); // shown to 6 decimals, never inserted
    expect(previewText(keys('6*10+4='))).toBeNull();
    expect(previewText(keys('5/0'))).toBeNull();
  });
});

describe('formatFraction', () => {
  const f = (n, d = 1n) => ({ n, d });
  it('is exact to 6 decimals and rounds half away from zero after that', () => {
    expect(formatFraction(f(1n, 2n))).toBe('0.5');
    expect(formatFraction(f(1n, 3n))).toBe('0.333333');
    expect(formatFraction(f(2n, 3n))).toBe('0.666667');
    expect(formatFraction(f(-2n, 3n))).toBe('-0.666667');
    expect(formatFraction(f(1n, 2000000n))).toBe('0.000001'); // half of the last place rounds away from zero
    expect(formatFraction(f(-1n, 4000000n))).toBe('0');
    expect(formatFraction(f(7n))).toBe('7');
    expect(formatFraction(f(0n))).toBe('0');
  });
});
