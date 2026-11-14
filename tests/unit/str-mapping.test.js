import { describe, expect, it } from 'vitest';
import { numberRows, titleOf, toHeader, toLine, toMetaMap } from '../../js/modules/str/domain/mapping.js';
import { groupBySupplier } from '../../js/modules/str/domain/group.js';

describe('STR row mapping', () => {
  it('maps a header row, with empty text for nulls and a safe stage', () => {
    const h = toHeader({
      str_id: '12',
      str_number: 'T-1',
      str_date: '2026-11-10',
      direction: 'in',
      stage: 'dispatched',
      line_count: '3',
      comments: null,
    });
    expect(h).toMatchObject({
      strId: 12,
      strNumber: 'T-1',
      strDate: '2026-11-10',
      direction: 'in',
      stage: 'dispatched',
      lineCount: 3,
      comments: '',
      refNo: '',
    });
    expect(toHeader({ str_id: 1, stage: 'bogus' }).stage).toBe('awaited');
    expect(toHeader({ str_id: 1 }).strDate).toBeNull();
  });
  it('maps a line row and keeps a missing dispatch or receive quantity as null', () => {
    const l = toLine({
      str_id: 1,
      str_item_id: 2,
      product_code: 'P1',
      product_name: 'Test',
      str_qty: '10',
      dispatch_qty: null,
      receive_qty: '0',
      product_price: '12.5',
    });
    expect(l).toMatchObject({ itemId: 2, strQty: 10, dispatchQty: null, receiveQty: 0, productPrice: 12.5 });
  });
  it('never carries a cost field', () => {
    expect(Object.keys(toLine({ str_id: 1, str_item_id: 1, cost_price: 5 }))).not.toContain('costPrice');
  });
  it('turns Inventory lookup rows into a map and leaves unknown codes out', () => {
    const m = toMetaMap([
      { code: 'P1', supplier: 'Alpha', conversion_factor: 10, found: true },
      { code: 'ZZ', found: false },
      { code: '' },
    ]);
    expect(m).toEqual({ P1: { supplier: 'Alpha', factor: 10 } });
    expect(toMetaMap(null)).toEqual({});
  });
  it('numbers rows continuously across supplier groups', () => {
    const groups = numberRows(
      groupBySupplier(
        [
          { productCode: 'A', strQty: 1 },
          { productCode: 'B', strQty: 1 },
          { productCode: 'C', strQty: 1 },
        ],
        { A: { supplier: 'S2' }, B: { supplier: 'S1' }, C: { supplier: 'S1' } },
      ),
    );
    expect(groups.flatMap((g) => g.rows.map((r) => r.sr))).toEqual([1, 2, 3]);
  });
  it('titles an STR by number, else by id', () => {
    expect(titleOf({ strNumber: 'T-9', strId: 1 })).toBe('STR #T-9');
    expect(titleOf({ strNumber: '', strId: 7 })).toBe('STR #7');
  });
});
