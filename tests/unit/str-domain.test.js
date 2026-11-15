import { describe, expect, it } from 'vitest';
import cases from '../fixtures/str-cases.json';
import { diffQty, diffText, diffTone, packFactor, packQty, toPackQty } from '../../js/modules/str/domain/pack.js';
import { UNASSIGNED, enrichLine, grandTotals, groupBySupplier, groupTotals } from '../../js/modules/str/domain/group.js';

describe('pack quantity', () => {
  for (const c of cases.pack) {
    it(`${JSON.stringify(c.loose)} loose / factor ${JSON.stringify(c.factor)} = ${c.pack}`, () => {
      expect(packQty(c.loose, c.factor)).toBe(c.pack);
    });
  }
  it('falls back to factor 1 for any unreliable factor', () => {
    for (const bad of [0, -1, null, undefined, '', 'x', NaN, Infinity]) expect(packFactor(bad)).toBe(1);
    expect(packFactor(12)).toBe(12);
  });
  it('keeps a missing quantity missing, and counts junk as zero', () => {
    expect(toPackQty(undefined, 10)).toBeNull();
    expect(toPackQty('abc', 10)).toBe(0);
  });
});

describe('difference', () => {
  it('is dispatch pack minus receive pack, blank when either is missing', () => {
    expect(diffQty({ packDispatchQty: 5, packReceiveQty: 3 })).toBe(2);
    expect(diffQty({ packDispatchQty: 3, packReceiveQty: 5 })).toBe(-2);
    expect(diffQty({ packDispatchQty: 3, packReceiveQty: 3 })).toBe(0);
    expect(diffQty({ packDispatchQty: null, packReceiveQty: 3 })).toBeNull();
    expect(diffQty({ packDispatchQty: 3, packReceiveQty: null })).toBeNull();
  });
  it('hides a sub-pack difference, because each side is floored on its own', () => {
    const l = enrichLine({ productCode: 'P1', strQty: 20, dispatchQty: 19, receiveQty: 10 }, { P1: { supplier: 'S', factor: 10 } });
    expect(l.packDispatchQty).toBe(1);
    expect(l.packReceiveQty).toBe(1);
    expect(diffQty(l)).toBe(0);
  });
  it('shows words as well as colour', () => {
    expect(diffTone(-2)).toBe('short');
    expect(diffTone(2)).toBe('over');
    expect(diffTone(0)).toBe('even');
    expect(diffTone(null)).toBe('none');
    expect(diffText(2)).toBe('+2');
    expect(diffText(-2)).toBe('-2');
    expect(diffText(0)).toBe('0');
    expect(diffText(null)).toBe('');
  });
});

const lines = [
  { strId: 1, itemId: 1, productCode: 'P10', productName: 'Test Syrup', strQty: 30, dispatchQty: 30, receiveQty: 20, productPrice: 100 },
  { strId: 1, itemId: 2, productCode: 'P2', productName: 'Test Tablet', strQty: 12, dispatchQty: 12, receiveQty: null, productPrice: 50 },
  { strId: 1, itemId: 3, productCode: 'P9', productName: 'Test Drops', strQty: 5, dispatchQty: 0, receiveQty: null, productPrice: 10 },
  { strId: 1, itemId: 4, productCode: 'ZZ', productName: 'Gone Product', strQty: 8, dispatchQty: 8, receiveQty: 8, productPrice: 7 },
];
const meta = {
  P10: { supplier: 'Beta Supplies', factor: 10 },
  P2: { supplier: 'Alpha Supplies', factor: 4 },
  P9: { supplier: 'Alpha Supplies', factor: 0 },
};

describe('supplier grouping', () => {
  const groups = groupBySupplier(lines, meta);
  it('orders groups by supplier name and rows by code, numerically', () => {
    expect(groups.map((g) => g.supplier)).toEqual(['Alpha Supplies', 'Beta Supplies', UNASSIGNED]);
    expect(groups[0].rows.map((r) => r.productCode)).toEqual(['P2', 'P9']);
  });
  it('puts a product Inventory no longer knows under Unassigned Supplier with factor 1', () => {
    const gone = groups[2].rows[0];
    expect(gone.factor).toBe(1);
    expect(gone.packStrQty).toBe(8);
  });
  it('converts every quantity with the product factor, and a bad factor means 1', () => {
    const p2 = groups[0].rows[0];
    expect([p2.packStrQty, p2.packDispatchQty, p2.packReceiveQty]).toEqual([3, 3, null]);
    expect(groups[0].rows[1].packStrQty).toBe(5);
  });
  it('totals STR and dispatch pack quantities for each group and overall', () => {
    expect(groupTotals(groups[0])).toEqual({ items: 2, str: 8, dispatch: 3 });
    expect(grandTotals(groups)).toEqual({ items: 4, str: 8 + 3 + 8, dispatch: 3 + 3 + 8 });
  });
  it('treats a blank supplier as unassigned', () => {
    expect(enrichLine({ productCode: 'P1', strQty: 1 }, { P1: { supplier: '  ', factor: 1 } }).supplier).toBe(UNASSIGNED);
  });
});
