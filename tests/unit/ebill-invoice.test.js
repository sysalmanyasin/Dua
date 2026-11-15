import { describe, expect, it } from 'vitest';
import { buildInvoice, isPinRetry, newInvoiceId, refusalText } from '../../js/modules/ebill/domain/invoice.js';
import { addProduct, emptyCart, setLineDiscount } from '../../js/modules/ebill/domain/cart.js';
import { billTotals } from '../../js/modules/ebill/domain/calc.js';

const prod = { code: 'A1', name: 'Test Tablet', generic: 'Alphamol', qty: 10, price: 12.5, pack: 10 };
const bill = {
  customer: 'Mr Ali',
  customerDiscountPct: 5,
  receiptOn: true,
  receiptDiscount: { mode: 'amt', value: 3 },
  adjustment: -1,
  taxPct: 0,
  cash: 100,
  mode: 'Cash',
  comments: ' first ',
  more: 'second',
};

describe('invoice payload', () => {
  it('carries everything the server recomputes from, and the screen totals to compare', () => {
    let cart = addProduct(emptyCart(), prod, { qty: 4 });
    cart = setLineDiscount(cart, cart.lines[0].id, 'pct', 10);
    const totals = billTotals({ lines: cart.lines, customerDiscountPct: 5, receiptDiscount: { mode: 'amt', value: 3 }, adjustment: -1 });
    const inv = buildInvoice({ cart, bill, totals, deviceId: 'dev', invoiceId: 'inv', now: new Date('2026-11-15T10:00:00Z') });
    expect(inv).toMatchObject({
      invoice_id: 'inv',
      device_id: 'dev',
      client_created_at: '2026-11-15T10:00:00.000Z',
      customer: 'Mr Ali',
      payment_mode: 'Cash',
      customer_discount_pct: 5,
      tax_pct: 0,
      adjustment: -1,
      cash_received: 100,
    });
    expect(inv.receipt_discount).toEqual({ mode: 'amt', value: 3 });
    expect(inv.totals.net_total).toBe(totals.netTotal);
    expect(inv.lines).toEqual([
      {
        code: 'A1',
        name: 'Test Tablet',
        generic: 'Alphamol',
        unit: 'unit',
        pack: 10,
        qty: 4,
        rate: 12.5,
        discount: { mode: 'pct', value: 10 },
      },
    ]);
    expect(inv.comments).toBe('first\nsecond');
  });
  it('an unticked receipt discount is sent as zero, not as the typed value', () => {
    const cart = addProduct(emptyCart(), prod);
    const inv = buildInvoice({
      cart,
      bill: { ...bill, receiptOn: false },
      totals: billTotals({ lines: cart.lines }),
      deviceId: 'd',
      invoiceId: 'i',
    });
    expect(inv.receipt_discount).toEqual({ mode: 'amt', value: 0 });
  });
  it('makes unique invoice ids', () => {
    const ids = new Set(Array.from({ length: 500 }, newInvoiceId));
    expect(ids.size).toBe(500);
    expect([...ids][0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});

describe('refusal words', () => {
  it('has a plain sentence for every server code, and prefers the server message', () => {
    for (const code of [
      'invalid',
      'device_unknown',
      'device_inactive',
      'pin_required',
      'no_pin',
      'bad_pin',
      'locked',
      'total_mismatch',
      'discount_limit',
      'id_conflict',
    ]) {
      expect(refusalText({ code }).length).toBeGreaterThanOrEqual(10);
    }
    expect(refusalText({ code: 'bad_pin', message: 'Wrong PIN.' })).toBe('Wrong PIN.');
    expect(refusalText(null)).toBe('The invoice was not saved.');
  });
  it('only a wrong or missing PIN is retried at the prompt', () => {
    expect(isPinRetry({ code: 'bad_pin' })).toBe(true);
    expect(isPinRetry({ code: 'pin_required' })).toBe(true);
    for (const code of ['locked', 'no_pin', 'discount_limit', 'device_inactive']) expect(isPinRetry({ code })).toBe(false);
  });
});
