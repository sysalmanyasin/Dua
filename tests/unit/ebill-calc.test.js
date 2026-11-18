import { describe, expect, it } from 'vitest';
import { billTotals, lineTotals, payment, resolveDiscount, round2, unitsOf } from '../../js/modules/ebill/domain/calc.js';
import { addProduct, emptyCart, removeLine, setLineDiscount, setQty, stockIssue } from '../../js/modules/ebill/domain/cart.js';

const prod = { code: 'A1', name: 'Test Tablet', generic: 'Alphamol', qty: 10, price: 12.5, pack: 10 };

describe('discounts', () => {
  it('resolves a percentage or a flat amount to one amount', () => {
    expect(resolveDiscount(200, { mode: 'pct', value: 10 })).toBe(20);
    expect(resolveDiscount(200, { mode: 'amt', value: 15 })).toBe(15);
  });
  it('never goes below zero or above the base', () => {
    expect(resolveDiscount(100, { mode: 'amt', value: 500 })).toBe(100);
    expect(resolveDiscount(100, { mode: 'pct', value: 250 })).toBe(100);
    expect(resolveDiscount(100, { mode: 'amt', value: -5 })).toBe(0);
    expect(resolveDiscount(-50, { mode: 'pct', value: 10 })).toBe(0);
    expect(resolveDiscount(100, null)).toBe(0);
    expect(resolveDiscount(100, { mode: 'pct', value: 'abc' })).toBe(0);
  });
});

describe('lines and bill', () => {
  it('rounds to the paisa at every step', () => {
    expect(round2(1.005)).toBe(1.01);
    expect(lineTotals({ rate: 3.33, qty: 3, discount: { mode: 'pct', value: 10 } })).toEqual({ gross: 9.99, discount: 1, total: 8.99 });
  });
  it('follows the documented order: lines, customer %, receipt discount, tax, adjustment', () => {
    const t = billTotals({
      lines: [
        { rate: 100, qty: 2, discount: { mode: 'pct', value: 10 } }, // 200 - 20 = 180
        { rate: 50, qty: 1, discount: { mode: 'amt', value: 0 } }, // 50
      ],
      customerDiscountPct: 10, // 230 -> 23
      receiptDiscount: { mode: 'amt', value: 7 },
      taxPct: 5,
      adjustment: -0.5,
    });
    expect(t.grossTotal).toBe(230);
    expect(t.lineDiscounts).toBe(20);
    expect(t.customerDiscount).toBe(23);
    expect(t.receiptDiscount).toBe(7);
    expect(t.netGross).toBe(200);
    expect(t.tax).toBe(10);
    expect(t.netTotal).toBe(209.5);
  });
  it('can round to a whole rupee, and never goes negative', () => {
    expect(billTotals({ lines: [{ rate: 10.4, qty: 1 }], roundToRupee: true }).netTotal).toBe(10);
    expect(billTotals({ lines: [{ rate: 10, qty: 1 }], adjustment: -99 }).netTotal).toBe(0);
  });
  it('an empty bill is all zeros', () => {
    expect(billTotals({}).netTotal).toBe(0);
  });
});

describe('payment and change', () => {
  it('gives change when more is handed over, and the amount due when less', () => {
    expect(payment(209.5, 500)).toEqual({ received: 500, change: 290.5, due: 0 });
    expect(payment(209.5, 200)).toEqual({ received: 200, change: 0, due: 9.5 });
    expect(payment(100, '')).toEqual({ received: 0, change: 0, due: 100 });
  });
});

describe('cart', () => {
  it('adds a product once per unit and raises the quantity when added again', () => {
    let c = addProduct(emptyCart(), prod, { qty: 2 });
    c = addProduct(c, prod, { qty: 3 });
    expect(c.lines).toHaveLength(1);
    expect(c.lines[0].qty).toBe(5);
    c = addProduct(c, prod, { qty: 1, unit: 'pack' });
    expect(c.lines).toHaveLength(2);
    expect(c.lines[1].rate).toBe(125); // 12.50 x pack of 10
  });
  it('ignores a bad quantity and keeps the original cart untouched', () => {
    const base = addProduct(emptyCart(), prod);
    expect(setQty(base, base.lines[0].id, 0)).toBe(base);
    expect(setQty(base, base.lines[0].id, -2)).toBe(base);
    const next = setQty(base, base.lines[0].id, 4);
    expect(next.lines[0].qty).toBe(4);
    expect(base.lines[0].qty).toBe(1);
  });
  it('sets a line discount and removes a line', () => {
    let c = addProduct(emptyCart(), prod, { qty: 2 });
    c = setLineDiscount(c, c.lines[0].id, 'amt', 5);
    expect(lineTotals(c.lines[0]).total).toBe(20);
    expect(removeLine(c, c.lines[0].id).lines).toEqual([]);
  });
  it('packs convert to units; a bad pack counts as 1', () => {
    expect(unitsOf(2, 'pack', 10)).toBe(20);
    expect(unitsOf(2, 'pack', 0)).toBe(2);
    expect(unitsOf(2, 'unit', 10)).toBe(2);
  });
  it('warns about no stock, short stock and unknown products, never calling the copy live', () => {
    const line = (qty, unit = 'unit') => ({ qty, unit, pack: 10 });
    expect(stockIssue(line(5), prod)).toBeNull();
    expect(stockIssue(line(11), prod).kind).toBe('short');
    expect(stockIssue(line(2, 'pack'), prod).kind).toBe('short'); // 20 > 10
    expect(stockIssue(line(1), { ...prod, qty: 0 }).kind).toBe('none');
    expect(stockIssue(line(1), { ...prod, qty: -3 }).kind).toBe('none');
    expect(stockIssue(line(1), undefined).kind).toBe('unknown');
    expect(stockIssue(line(11), prod).text).toMatch(/this device/);
  });
});
