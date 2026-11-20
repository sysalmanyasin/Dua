import { describe, expect, it } from 'vitest';
import {
  buildReceipt,
  normalizeReceiptSettings,
  receiptFromLocal,
  receiptFromServer,
  receiptTime,
} from '../../js/modules/ebill/domain/receipt.js';

const settings = {
  shop_name: "FAZAL DIN'S PHARMA PLUS",
  address: 'Bahria Town Commercial 1 Shaheen Block, Sector-8\nDrug Sales Licence No. 05-352-0065-028057P',
  tax_no: '0870213-3',
  pos_no: '132070',
  footer: 'E & E\nPlease check your medicines.',
};
// the slip: 7 Panadol at 3.81 = 26.67, paid in cash
const data = {
  no: 'EB-261119-00001',
  time: '2026-11-19T17:26:19Z', // 10:26:19 PM in Pakistan
  staff: 'J One',
  customer: '',
  mode: 'Cash',
  local: false,
  lines: [{ code: 'P1', name: 'Panadol 500mg Tab 200’s', generic: 'Paracetamol', unit: 'unit', qty: 7, rate: 3.81, total: 26.67 }],
  gross: 26.67,
  customerDiscount: 0,
  receiptDiscount: 0,
  tax: 0,
  adjustment: 0,
  net: 26.67,
  cash: 30,
  refunded: 0,
};

describe('receiptTime', () => {
  it('uses Pakistan time in the slip’s format', () => {
    expect(receiptTime('2026-11-19T17:26:19Z')).toBe('11/19/2026 10:26:19 PM');
    expect(receiptTime('')).toBe('');
    expect(receiptTime('nonsense')).toBe('');
  });
});

describe('Primary receipt (the shop’s slip)', () => {
  const r = buildReceipt(data, settings);
  it('has the slip’s header and rows', () => {
    expect(r.title).toBe('Purchase Slip');
    expect(r.duplicate).toBe(false);
    expect(r.shop).toBe("FAZAL DIN'S PHARMA PLUS");
    expect(r.address).toEqual(['Bahria Town Commercial 1 Shaheen Block, Sector-8', 'Drug Sales Licence No. 05-352-0065-028057P']);
    expect(r.info[0]).toEqual({ left: 'STN/NTN# 0870213-3', right: 'MOP. Cash Sales' });
    expect(r.info[1]).toEqual({ left: 'Receipt# EB-261119-00001', right: 'Bill Date 11/19/2026 10:26:19 PM' });
    expect(r.info[2].left).toBe('POS NO: 132070');
  });
  it('lists the item with two-decimal qty, price and total', () => {
    expect(r.rows).toEqual([{ name: 'Panadol 500mg Tab 200’s', generic: '', unit: 'L', qty: '7.00', rate: '3.81', total: '26.67' }]);
  });
  it('ends with Total, Net Payable, item count and the footer — no FBR parts', () => {
    expect(r.totals.map((t) => [t.label, t.value])).toEqual([
      ['Total', '26.67'],
      ['Net Payable', '26.67'],
      ['Cash Received', '30.00'],
      ['Change', '3.33'],
    ]);
    expect(r.itemsLine).toBe('Total No. of Items : 1');
    expect(r.footer).toEqual(['E & E', 'Please check your medicines.']);
    expect(JSON.stringify(r)).not.toMatch(/FBR|QR/i);
  });
});

describe('other types and marks', () => {
  it('Gift shows items and quantities but never a price or total', () => {
    const r = buildReceipt(data, settings, { type: 'Gift Receipt' });
    expect(r.title).toBe('Gift Slip');
    expect(r.rows[0].rate).toBe('');
    expect(r.rows[0].total).toBe('');
    expect(r.totals).toEqual([]);
    expect(r.showPrices).toBe(false);
    expect(r.info[0].right).toBe(''); // no payment type either
  });
  it('Summary has totals and the item count but no item lines', () => {
    const r = buildReceipt(data, settings, { type: 'Summary Receipt' });
    expect(r.rows).toBeNull();
    expect(r.totals.some((t) => t.label === 'Net Payable')).toBe(true);
    expect(r.itemsLine).toBe('Total No. of Items : 1');
  });
  it('Secondary, a reprint and copies after the first say Duplicate', () => {
    expect(buildReceipt(data, settings, { type: 'Secondary Receipt' }).duplicate).toBe(true);
    expect(buildReceipt(data, settings, { reprint: true }).duplicate).toBe(true);
    expect(buildReceipt(data, settings, { copy: 2, copies: 2 }).duplicate).toBe(true);
    const first = buildReceipt(data, settings, { copy: 1, copies: 2 });
    expect(first.duplicate).toBe(false);
    expect(first.flags).toEqual(['Copy 1 of 2']);
  });
  it('a bill still only on this device says its reference is temporary', () => {
    expect(buildReceipt({ ...data, local: true, no: 'LOCAL-1' }, settings).temporary).toContain('Temporary reference');
    expect(buildReceipt(data, settings).temporary).toBe('');
  });
  it('shows discounts, tax, adjustment and refunds only when there are some', () => {
    const r = buildReceipt(
      { ...data, gross: 100, customerDiscount: 10, tax: 5, adjustment: -0.5, net: 94.5, cash: 0, refunded: 40 },
      settings,
    );
    expect(r.totals.map((t) => t.label)).toEqual([
      'Total',
      'Customer Discount',
      'Tax',
      'Adjustment',
      'Net Payable',
      'Refunded',
      'Net after refund',
    ]);
    expect(r.totals.find((t) => t.label === 'Net after refund').value).toBe('54.50');
  });
  it('hides customer, staff and the POS row when switched off or empty', () => {
    const r = buildReceipt(data, { ...settings, show_customer: false, show_staff: false, pos_no: '' });
    expect(r.info.map((x) => x.left)).toEqual(['STN/NTN# 0870213-3', 'Receipt# EB-261119-00001']);
  });
});

describe('settings and sources', () => {
  it('bad settings fall back to safe ones', () => {
    const n = normalizeReceiptSettings({ width_mm: 70, copies: 9, receipt_type: 'x', auto_print: 'yes', footer: 5 });
    expect([n.width_mm, n.copies, n.receipt_type, n.auto_print, n.footer]).toEqual([80, 1, 'Primary Receipt', false, '']);
    expect(normalizeReceiptSettings(null).slip_title).toBe('Purchase Slip');
  });
  it('the server detail gives the same figures', () => {
    const r = receiptFromServer({
      invoice: {
        invoice_no: 'EB-1',
        client_created_at: data.time,
        staff_name: 'J',
        customer: 'C',
        payment_mode: 'Cash',
        gross_total: '26.67',
        customer_discount: '0',
        receipt_discount: '0',
        tax: '0',
        adjustment: '0',
        net_total: '26.67',
        cash_received: '30',
        refunded_amount: '0',
      },
      lines: [{ code: 'P1', name: 'Panadol', unit: 'unit', qty: '7', rate: '3.81', line_total: '26.67' }],
    });
    expect(r.net).toBe(26.67);
    expect(r.cash).toBe(30);
    expect(r.lines[0].total).toBe(26.67);
  });
  it('an invoice kept on the device is worked out with the billing rules', () => {
    const r = receiptFromLocal({
      local_ref: 'LOCAL-1',
      status: 'pending',
      created_at: data.time,
      staff_name: 'J',
      payload: {
        payment_mode: 'Cash',
        cash_received: 100,
        customer_discount_pct: 10,
        lines: [{ code: 'A', name: 'A', unit: 'unit', qty: 2, rate: 50, discount: { mode: 'pct', value: 0 } }],
      },
    });
    expect([r.no, r.local, r.gross, r.customerDiscount, r.net]).toEqual(['LOCAL-1', true, 100, 10, 90]);
  });
});
