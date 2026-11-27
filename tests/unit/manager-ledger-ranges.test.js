import { describe, expect, it } from 'vitest';
import { daysInMonth, presetRange } from '../../js/modules/manager/domain/ledger.js';

describe('Manager expense card quick date ranges', () => {
  it('counts the days of a month, leap years included', () => {
    expect(daysInMonth('2026-11-01')).toBe(30);
    expect(daysInMonth('2026-12-15')).toBe(31);
    expect(daysInMonth('2028-02-01')).toBe(29);
  });

  it('This Month runs from the 1st of the current month to today', () => {
    expect(presetRange('month', '2026-09-01', '2026-11-27')).toEqual({ from: '2026-11-01', to: '2026-11-27' });
  });

  it('week buttons cover the chosen month, and Wk4 ends on its last day', () => {
    expect(presetRange('wk1', '2026-10-01', '2026-11-27')).toEqual({ from: '2026-10-01', to: '2026-10-07' });
    expect(presetRange('wk2', '2026-10-01', '2026-11-27')).toEqual({ from: '2026-10-08', to: '2026-10-14' });
    expect(presetRange('wk3', '2026-10-01', '2026-11-27')).toEqual({ from: '2026-10-15', to: '2026-10-22' });
    expect(presetRange('wk4', '2026-10-01', '2026-11-27')).toEqual({ from: '2026-10-23', to: '2026-10-31' });
  });

  it('never ends after today', () => {
    expect(presetRange('wk4', '2026-11-01', '2026-11-27')).toEqual({ from: '2026-11-23', to: '2026-11-27' });
    expect(presetRange('wk1', '2026-11-01', '2026-11-03')).toEqual({ from: '2026-11-01', to: '2026-11-03' });
  });

  it('returns null for an unknown button', () => {
    expect(presetRange('nope', '2026-11-01', '2026-11-27')).toBeNull();
  });
});
