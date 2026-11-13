import { describe, expect, it } from 'vitest';
import { KINDS, addDays, slotLabel, slotOrder, suggestNext } from '../../js/modules/closing/domain/slots.js';
import { SECTIONS, clampSection, sectionIndex } from '../../js/modules/closing/domain/sections.js';

describe('closing slots', () => {
  it('suggests the slot the database will accept next', () => {
    expect(suggestNext({ business_date: '2026-11-05', kind: 'evening', seq: 9999 })).toEqual({ date: '2026-11-06', kind: 'night' });
    expect(suggestNext({ business_date: '2026-11-06', kind: 'night', seq: 10 })).toEqual({ date: '2026-11-06', kind: 'morning' });
    expect(suggestNext({ business_date: '2026-11-06', kind: 'morning', seq: 20 })).toEqual({ date: '2026-11-06', kind: 'evening' });
    expect(suggestNext({ business_date: '2026-11-06', kind: 'handover', seq: 30 })).toEqual({ date: '2026-11-06', kind: 'evening' });
    expect(suggestNext(null)).toBeNull();
  });
  it('rolls the date over month and year ends', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
  it('numbers handovers from 1', () => {
    expect(slotLabel('handover', 30)).toBe('Handover 1');
    expect(slotLabel('handover', 40)).toBe('Handover 2');
    expect(slotLabel('night', 10)).toBe('Night');
  });
  it('orders slots by date, then by position in the day', () => {
    const slots = [
      { business_date: '2026-11-06', seq: 9999 },
      { business_date: '2026-11-06', seq: 10 },
      { business_date: '2026-11-05', seq: 9999 },
      { business_date: '2026-11-06', seq: 30 },
    ];
    expect(slots.sort((a, b) => slotOrder(a).localeCompare(slotOrder(b))).map((s) => `${s.business_date}/${s.seq}`)).toEqual([
      '2026-11-05/9999',
      '2026-11-06/10',
      '2026-11-06/30',
      '2026-11-06/9999',
    ]);
  });
  it('knows the four kinds', () => {
    expect(KINDS.map((k) => k.kind)).toEqual(['night', 'morning', 'handover', 'evening']);
  });
});

describe('closing sections', () => {
  it('keeps the original order of the 14 sections', () => {
    expect(SECTIONS.map((s) => s.key)).toEqual([
      'pos',
      'mediq',
      'shift',
      'hs',
      'strips',
      'invaudit',
      'misc',
      'cc',
      'till',
      'vault',
      'credit',
      'deposits',
      'audit',
      'final-agg',
    ]);
  });
  it('clamps navigation to the ends', () => {
    expect(clampSection(-3)).toBe(0);
    expect(clampSection(99)).toBe(13);
    expect(sectionIndex('strips')).toBe(4);
    expect(sectionIndex('nope')).toBe(0);
  });
  it('builds all 14 sections', () => {
    expect(SECTIONS.filter((s) => s.built)).toHaveLength(14);
  });
});
