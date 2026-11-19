import { describe, expect, it } from 'vitest';
import { addUpTo, companySummary, visibleCompanies } from '../../js/modules/audit/domain/companies.js';

const list = [
  { company: 'Beta Ltd', skus: 1, value: 1130.4 },
  { company: 'A.Feroz & Company', skus: 10, value: 115769 },
  { company: "A'raf Pharma", skus: 4, value: 13796 },
];

describe('company picker logic', () => {
  it('sorts by name and flips', () => {
    const names = visibleCompanies(list).map((c) => c.company);
    expect(names[2]).toBe('Beta Ltd');
    expect(names.slice(0, 2).sort()).toEqual(["A'raf Pharma", 'A.Feroz & Company'].sort());
    expect(visibleCompanies(list, '', false)[0].company).toBe('Beta Ltd');
  });
  it('searches ignoring case and does not change the list it was given', () => {
    expect(visibleCompanies(list, ' FEROZ ').map((c) => c.company)).toEqual(['A.Feroz & Company']);
    expect(list[0].company).toBe('Beta Ltd');
  });
  it('writes the summary like the old app', () => {
    expect(companySummary(list[1])).toBe('10 SKUs · Rs 115,769');
    expect(companySummary(list[0])).toBe('1 SKU · Rs 1,130');
  });
  it('stops adding at the limit and says so', () => {
    const r = addUpTo(new Set(['x']), ['a', 'b', 'c'], 3);
    expect([...r.next]).toEqual(['x', 'a', 'b']);
    expect(r.hitLimit).toBe(true);
    expect(addUpTo(new Set(), ['a'], 3).hitLimit).toBe(false);
  });
});
