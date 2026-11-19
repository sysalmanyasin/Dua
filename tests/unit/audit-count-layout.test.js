import { describe, expect, it } from 'vitest';
import { groupByCompany, impactPaisa, varianceView } from '../../js/modules/audit/domain/count.js';
import { parseTemplateImport } from '../../js/modules/audit/domain/templateImport.js';

const it1 = { round_item_id: 'a', company: 'Acme', name: 'Zeta', code: '1', system_qty: 10, retail_price: 100.5 };
const it2 = { round_item_id: 'b', company: 'Acme', name: 'Alpha', code: '2', system_qty: 5, retail_price: 20 };
const it3 = { round_item_id: 'c', company: 'Beta', name: 'Mid', code: '3', system_qty: 8, retail_price: 55 };

describe('counting layout logic', () => {
  it('reads an item not counted yet as zero in stock, marked assumed', () => {
    expect(varianceView(it1, undefined)).toMatchObject({ counted: false, delta: -10, value: -100500, hint: 'assumed' });
  });
  it('reads a count as the difference, and a match as no difference', () => {
    expect(varianceView(it1, { qty: 12, auto: false })).toMatchObject({ counted: true, delta: 2, value: 20100, hint: '' });
    expect(varianceView(it1, { qty: 10, auto: true })).toMatchObject({ delta: 0, value: 0, hint: 'auto-matched' });
  });
  it('totals a company with uncounted items as shortages, and shrinks as items are counted', () => {
    expect(impactPaisa([it1, it2], {})).toBe(-100500 - 10000);
    expect(impactPaisa([it1, it2], { a: { qty: 10, auto: false } })).toBe(-10000);
  });
  it('groups by company in name order, and not at all for one company', () => {
    const g = groupByCompany([it3, it1, it2]);
    expect(g.map((x) => x.company)).toEqual(['Acme', 'Beta']);
    expect(g[0].items.map((x) => x.name)).toEqual(['Alpha', 'Zeta']);
    expect(groupByCompany([it1, it2])).toEqual([{ company: null, items: [it2, it1] }]);
  });
});

describe('template import', () => {
  it('reads names and codes, as a list or one string, and skips names already there and empty ones', () => {
    const r = parseTemplateImport(
      JSON.stringify([
        { name: 'Syrups', codes: ['040700', '078751'] },
        { name: 'strips', codes: '14 15, 16' },
        { name: 'Fridge', codes: ['1'] },
        { name: 'Empty', codes: [] },
        { name: 'x', codes: ['1'] },
      ]),
      ['fridge'],
    );
    expect(r.templates).toEqual([
      { name: 'Syrups', codes: ['040700', '078751'] },
      { name: 'strips', codes: ['14', '15', '16'] },
    ]);
    expect(r.skipped).toBe(3);
  });
  it('refuses text that is not an export', () => {
    expect(parseTemplateImport('hello').error).toMatch(/not valid JSON/);
    expect(parseTemplateImport('{"a":1}').error).toMatch(/list of templates/);
  });
});
