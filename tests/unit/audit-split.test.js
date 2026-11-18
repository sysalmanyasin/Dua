import { describe, expect, it } from 'vitest';
import { planAutoSplit } from '../../js/modules/audit/domain/split.js';

// Mirrors supabase/tests/0401_audit_core_test.sql (block 8) and 0404_audit_split_order_test.sql so the preview and the database agree.
const companies = [
  { company: 'Acme', items: 4 },
  { company: 'Beta', items: 2 },
  { company: 'Cura', items: 1 },
];
const sum = (plan) => Object.fromEntries(plan.map((p) => [p.auditorId, p.items]));

describe('auto-split preview', () => {
  it('company split: the biggest company first, a tie goes to the first listed', () => {
    expect(sum(planAutoSplit({ companies, auditors: ['c1', 'c2'], split: 'company' }))).toEqual({ c1: 5, c2: 2 });
  });
  it('volume split balances items', () => {
    expect(sum(planAutoSplit({ companies, auditors: ['c1', 'c2'], split: 'volume' }))).toEqual({ c1: 4, c2: 3 });
  });
  it('item unit deals every item one by one', () => {
    expect(sum(planAutoSplit({ companies, auditors: ['c1', 'c2'], split: 'company', unit: 'item' }))).toEqual({ c1: 4, c2: 3 });
  });
  it('equal-sized companies go in plain character order (capitals first)', () => {
    const plan = planAutoSplit({
      companies: [
        { company: 'apple', items: 1 },
        { company: 'Zed', items: 1 },
        { company: 'Mango', items: 1 },
      ],
      auditors: ['c1', 'c2'],
    });
    expect(plan.find((p) => p.auditorId === 'c1').companies).toEqual(['Mango', 'apple']);
    expect(plan.find((p) => p.auditorId === 'c2').companies).toEqual(['Zed']);
  });
  it('a person who gets nothing is left out, and a repeated person counts once', () => {
    expect(planAutoSplit({ companies: [{ company: 'Acme', items: 3 }], auditors: ['c1', 'c2', 'c1'] })).toEqual([
      { auditorId: 'c1', items: 3, companies: ['Acme'] },
    ]);
  });
  it('handles no people and no companies', () => {
    expect(planAutoSplit({ companies, auditors: [] })).toEqual([]);
    expect(planAutoSplit({ companies: [], auditors: ['c1'] })).toEqual([]);
  });
  it('every item is given to exactly one person', () => {
    for (const unit of ['company', 'item'])
      for (const split of ['company', 'volume']) {
        const plan = planAutoSplit({ companies, auditors: ['a', 'b', 'c'], split, unit });
        expect(plan.reduce((t, p) => t + p.items, 0)).toBe(7);
      }
  });
});
