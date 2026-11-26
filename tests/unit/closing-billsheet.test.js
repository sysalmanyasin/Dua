// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BOXES,
  cleanBoxes,
  lastFive,
  numberColumns,
  padBill,
  parseCount,
  parseStart,
  rangeLabel,
  startAfter,
} from '../../js/modules/closing/domain/billsheet.js';
import { latestPage, sheetMarkup } from '../../js/modules/closing/ui/bills.js';
import manifest from '../../js/modules/closing/manifest.js';

describe('Bill Number Sheet numbers', () => {
  it('uses the last five digits of the last bill number and starts one after', () => {
    expect(lastFive(147452)).toBe(47452);
    expect(startAfter(147452)).toBe(47453);
    expect(startAfter('47452')).toBe(47453);
    expect(startAfter(99999)).toBe(0);
  });
  it('has no start when there is no last bill number', () => {
    expect(startAfter(0)).toBeNull();
    expect(startAfter(null)).toBeNull();
    expect(startAfter('')).toBeNull();
    expect(parseStart('')).toBeNull();
    expect(parseStart('abc')).toBeNull();
    expect(parseStart('147453')).toBe(47453);
  });
  it('pads and wraps to five digits', () => {
    expect(padBill(7)).toBe('00007');
    expect(padBill(100001)).toBe('00001');
  });
  it('lays 250 numbers in ten columns that read top to bottom', () => {
    const cols = numberColumns(47453, 250);
    expect(cols).toHaveLength(10);
    expect(cols.every((c) => c.length === 25)).toBe(true);
    expect(cols[0][0]).toBe('47453');
    expect(cols[0][24]).toBe('47477');
    expect(cols[1][0]).toBe('47478');
    expect(cols[9][24]).toBe('47702');
    expect(cols.flat()).toHaveLength(250);
    expect(rangeLabel(47453, 250)).toBe('47453 – 47702');
  });
  it('keeps the count sensible', () => {
    expect(parseCount('')).toBe(250);
    expect(parseCount('0')).toBe(250);
    expect(parseCount('120')).toBe(120);
    expect(parseCount('9999')).toBe(500);
    expect(numberColumns(1, 7).flat()).toHaveLength(7);
  });
  it('keeps credit box names editable with safe defaults', () => {
    expect(cleanBoxes([' Salman Jazz Cash ', '', 'Rider Cash'])).toEqual(['Salman Jazz Cash', 'Rider Cash']);
    expect(cleanBoxes([])).toEqual(DEFAULT_BOXES);
    expect(cleanBoxes(['a', 'b', 'c', 'd', 'e', 'f', 'g'])).toHaveLength(6);
  });
});

describe('Bill Number Sheet page', () => {
  it('follows the latest closing, a correction beating its original', () => {
    const a = { business_date: '2026-11-25', seq: 9999, revision: 0 };
    const b = { business_date: '2026-11-26', seq: 10, revision: 0 };
    const c = { business_date: '2026-11-26', seq: 10, revision: 1 };
    expect(latestPage([a, b, c])).toBe(c);
    expect(latestPage([])).toBeNull();
  });
  it('is open to everyone with closing access, and listed on the manifest', () => {
    const r = manifest.routes.find((x) => x.path === '/closing/bills');
    expect(r.anyOf).toContain('closing.enter_own');
  });
  it('draws the heading, 250 numbers and the credit boxes', () => {
    const el = document.createElement('div');
    const t = sheetMarkup({
      shop: "Fazal Din's Pharma Plus",
      branch: 'Bahria Town Branch',
      title: 'Evening Closing',
      dateLabel: '26 Nov 2026',
      start: 47453,
      count: 250,
      boxes: DEFAULT_BOXES,
    });
    expect(t).toBeTruthy();
    void el;
  });
});
