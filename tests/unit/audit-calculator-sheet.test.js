// @vitest-environment jsdom
// The calculator panel on its own: keypad, keyboard, what it will and will not hand over, how it follows the count box, and how it closes.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openCalculator } from '../../js/modules/audit/ui/calculator.js';

const sheet = () => document.querySelector('.aud-calc');
const q = (sel) => sheet().querySelector(sel);
const tap = (...keys) => keys.forEach((k) => q(`button[data-k="${k}"]`).click());
const press = (key, target = q('[data-screen]'), init = {}) => {
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(e);
  return e;
};
const main = () => q('[data-main]').textContent;
const noteText = () => q('[data-note]').textContent;

beforeEach(() => {
  document.body.innerHTML = '<button id="opener">Calculator</button>';
  document.getElementById('opener').focus();
});

describe('opening', () => {
  it('is a floating, non-modal panel with a keypad, says where the answer goes, and starts empty', () => {
    openCalculator({ target: 'Alpha one (A1)', onInsert: vi.fn() });
    expect(sheet().getAttribute('role')).toBe('dialog');
    expect(sheet().getAttribute('aria-modal')).toBe('false');
    expect(q('.aud-calc-target').textContent).toContain('Alpha one (A1)');
    expect(main()).toBe('0');
    expect(q('[data-expr]').textContent).toBe('');
    expect(sheet().querySelectorAll('button[data-k]')).toHaveLength(18);
    expect(document.activeElement).toBe(document.getElementById('opener')); // the cursor stays where it was: in the count box
  });

  it('has an accessible name on every key that is not a plain digit', () => {
    openCalculator({ target: 'x', onInsert: vi.fn() });
    const names = ['÷', '×', '−', '+', '=', 'back', 'clear', '.'].map((k) => q(`button[data-k="${k}"]`).getAttribute('aria-label'));
    expect(names).toEqual(['Divide', 'Times', 'Minus', 'Plus', 'Equals', 'Delete last', 'Clear', 'Point']);
  });

  it('with no count box chosen it still works as a calculator but cannot insert', () => {
    const onInsert = vi.fn();
    openCalculator({ target: '', onInsert });
    expect(q('.aud-calc-target').textContent).toContain('Tap a count box');
    expect(q('[data-s="insert"]').disabled).toBe(true);
    tap('6', '×', '1', '0');
    expect(q('[data-total]').textContent).toBe('= 60');
    expect(onInsert).not.toHaveBeenCalled();
  });
});

describe('working out a sum', () => {
  it('6 × 10 + 4 shows the sum, a live total, and 64 on "="', () => {
    openCalculator({ target: 'A', onInsert: vi.fn() });
    tap('6', '×', '1', '0', '+', '4');
    expect(q('[data-expr]').textContent).toBe('6 × 10 +');
    expect(main()).toBe('4');
    expect(q('[data-total]').textContent).toBe('= 64');
    expect(q('[data-s="insert"]').textContent).toBe('Put 64 in the count box');
    tap('=');
    expect(main()).toBe('64');
    expect(noteText()).toBe('Equals 64.');
    expect(q('[data-total]').textContent).toBe('');
  });

  it('shows the reason in words for a sum that cannot be a count, and does not insert it', () => {
    const onInsert = vi.fn();
    openCalculator({ target: 'A', onInsert });
    tap('3', '−', '5');
    q('[data-s="insert"]').click();
    expect(noteText()).toBe('A count cannot be below zero.');
    tap('clear', '1', '0', '÷', '3');
    q('[data-s="insert"]').click();
    expect(noteText()).toBe('3.333333 has more than 3 decimals. A count can have up to 3.');
    tap('clear', '6', '×');
    q('[data-s="insert"]').click();
    expect(noteText()).toBe('Finish the sum first.');
    expect(onInsert).not.toHaveBeenCalled();
    expect(sheet()).not.toBeNull(); // it stays open so the person can fix the sum
  });

  it('division by zero shows Error and the reason, and the next digit starts again', () => {
    openCalculator({ target: 'A', onInsert: vi.fn() });
    tap('5', '÷', '0', '=');
    expect(main()).toBe('Error');
    expect(noteText()).toBe('Cannot divide by zero.');
    tap('7');
    expect(main()).toBe('7');
    expect(noteText()).toBe('');
  });
});

describe('inserting', () => {
  it('hands over the number once, stays open, and starts a new sum for the next item', () => {
    const onInsert = vi.fn();
    openCalculator({ target: 'A', onInsert });
    tap('6', '×', '1', '0', '+', '4');
    q('[data-s="insert"]').click();
    expect(onInsert).toHaveBeenCalledTimes(1);
    expect(onInsert).toHaveBeenCalledWith(64);
    expect(sheet()).not.toBeNull();
    expect(main()).toBe('0');
    expect(q('[data-expr]').textContent).toBe('');
  });

  it('follows the count box: the target is read again whenever the panel is told the box changed', () => {
    let where = 'Alpha (A1)';
    const onInsert = vi.fn();
    const c = openCalculator({ getTarget: () => where, onInsert });
    expect(q('.aud-calc-target').textContent).toContain('Alpha (A1)');
    where = '';
    c.refreshTarget();
    expect(q('.aud-calc-target').textContent).toContain('Tap a count box');
    expect(q('[data-s="insert"]').disabled).toBe(true);
    where = 'Beta (B2)';
    c.refreshTarget();
    expect(q('[data-s="insert"]').disabled).toBe(false);
    tap('7');
    q('[data-s="insert"]').click();
    expect(onInsert).toHaveBeenCalledWith(7);
  });

  it('a key press does not take the cursor out of the count box', () => {
    openCalculator({ target: 'A', onInsert: vi.fn() });
    const down = new Event('pointerdown', { bubbles: true, cancelable: true });
    q('button[data-k="7"]').dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
  });

  it('can be minimised to its title bar and expanded again', () => {
    const c = openCalculator({ target: 'A', onInsert: vi.fn() });
    q('[data-s="min"]').click();
    expect(sheet().classList.contains('is-min')).toBe(true);
    expect(q('[data-s="min"]').getAttribute('aria-expanded')).toBe('false');
    c.toggleMinimized();
    expect(sheet().classList.contains('is-min')).toBe(false);
  });

  it('hands over a decimal count as a number', () => {
    const onInsert = vi.fn();
    openCalculator({ target: 'A', onInsert });
    tap('1', '0', '÷', '4');
    q('[data-s="insert"]').click();
    expect(onInsert).toHaveBeenCalledWith(2.5);
  });

  it('a new panel always starts empty: the running sum is not kept', () => {
    openCalculator({ target: 'A', onInsert: vi.fn() }).close();
    openCalculator({ target: 'A', onInsert: vi.fn() });
    expect(main()).toBe('0');
  });
});

describe('the keyboard', () => {
  it('types digits, operators and a point, with Enter as "="', () => {
    openCalculator({ target: 'A', onInsert: vi.fn() });
    for (const k of ['6', '*', '1', '0', '+', '4']) press(k);
    expect(q('[data-total]').textContent).toBe('= 64');
    press('Enter');
    expect(main()).toBe('64');
    press('Backspace');
    expect(main()).toBe('0'); // after "=", Backspace clears
    for (const k of ['2', ',', '5']) press(k); // a comma is a point
    expect(main()).toBe('2.5');
    press('Delete');
    expect(main()).toBe('0');
  });

  it('stops the browser acting on a key it used, and ignores the rest', () => {
    openCalculator({ target: 'A', onInsert: vi.fn() });
    expect(press('7').defaultPrevented).toBe(true);
    expect(press('a').defaultPrevented).toBe(false);
    expect(press('c', q('[data-screen]'), { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(press('7', q('[data-screen]'), { metaKey: true }).defaultPrevented).toBe(false);
    expect(main()).toBe('7');
  });

  it('Enter on a focused key presses that key, not "="', () => {
    openCalculator({ target: 'A', onInsert: vi.fn() });
    tap('6');
    const e = press('Enter', q('button[data-k="7"]'));
    expect(e.defaultPrevented).toBe(false); // the browser's own click on the button goes ahead
    expect(main()).toBe('6');
  });
});

describe('closing and focus', () => {
  it('Escape, Close and leaving the page all close it, and a tap elsewhere does not', () => {
    const onClose = vi.fn();
    openCalculator({ target: 'A', onInsert: vi.fn(), onClose });
    press('Escape');
    expect(sheet()).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);

    openCalculator({ target: 'A', onInsert: vi.fn(), onClose });
    q('[data-s="close"]').click();
    expect(sheet()).toBeNull();

    openCalculator({ target: 'A', onInsert: vi.fn(), onClose });
    sheet().click(); // the panel has no dimmed backdrop to tap
    expect(sheet()).not.toBeNull();
    window.dispatchEvent(new Event('hashchange'));
    expect(sheet()).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('a tap inside the panel does not close it', () => {
    openCalculator({ target: 'A', onInsert: vi.fn() });
    q('.aud-calc-box').click();
    expect(sheet()).not.toBeNull();
  });

  it('closing twice does nothing the second time', () => {
    const onClose = vi.fn();
    const c = openCalculator({ target: 'A', onInsert: vi.fn(), onClose });
    c.close();
    c.close();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not trap Tab: the panel is not a modal, so focus moves on as normal', () => {
    openCalculator({ target: 'A', onInsert: vi.fn() });
    const buttons = [...sheet().querySelectorAll('button:not([disabled])')];
    buttons.at(-1).focus();
    expect(press('Tab', buttons.at(-1)).defaultPrevented).toBe(false);
  });
});
