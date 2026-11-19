// Expiry helpers: month choices, labels and the form check.
import { describe, expect, it } from 'vitest';
import { checkEntry, monthLabel, monthOptions, newKey, shiftMonth, STATUSES } from '../../js/modules/audit/domain/expiry.js';

describe('months', () => {
  it('names a month and leaves anything else alone', () => {
    expect(monthLabel('2026-11')).toBe('November 2026');
    expect(monthLabel('2027-01')).toBe('January 2027');
    expect(monthLabel('2026-13')).toBe('2026-13');
    expect(monthLabel('')).toBe('');
    expect(monthLabel(null)).toBe('');
  });
  it('moves across a year in both directions', () => {
    expect(shiftMonth('2026-11', 3)).toBe('2027-02');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-11', 0)).toBe('2026-11');
    expect(shiftMonth('2026-11', 36)).toBe('2029-11');
    expect(shiftMonth('junk', 1)).toBe('junk');
  });
  it('offers 3 months back to 3 years ahead, like the database', () => {
    const o = monthOptions('2026-11');
    expect(o).toHaveLength(40);
    expect(o[0].value).toBe('2026-08');
    expect(o[3].value).toBe('2026-11');
    expect(o[39].value).toBe('2029-11');
    expect(o[0].label).toBe('August 2026');
  });
});

describe('entry check', () => {
  const ok = { product: { id: 'p' }, qty: '12', month: '2027-01', rack: 'Rack A2' };
  it('passes a complete entry', () => expect(checkEntry(ok)).toBeNull());
  it('asks for each missing part in turn', () => {
    expect(checkEntry({ ...ok, product: null })).toMatch(/product/i);
    expect(checkEntry({ ...ok, qty: '' })).toMatch(/quantity/i);
    expect(checkEntry({ ...ok, qty: '0' })).toMatch(/quantity/i);
    expect(checkEntry({ ...ok, qty: '-3' })).toMatch(/quantity/i);
    expect(checkEntry({ ...ok, qty: 'abc' })).toMatch(/quantity/i);
    expect(checkEntry({ ...ok, month: '' })).toMatch(/month/i);
    expect(checkEntry({ ...ok, rack: '' })).toMatch(/rack/i);
  });
});

describe('keys and statuses', () => {
  it('makes a different key each time', () => {
    expect(newKey()).not.toBe(newKey());
    expect(newKey()).toMatch(/^[0-9a-f-]{36}$/);
  });
  it('has the four statuses of the old app', () => {
    expect(STATUSES).toEqual(['Near Expiry', 'Sold', 'Returned to Warehouse', 'Discarded']);
  });
});
