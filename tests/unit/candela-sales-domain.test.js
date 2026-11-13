import { describe, expect, it } from 'vitest';
import {
  filterCreditRows,
  filterPaymentDays,
  fromPaisa,
  monthlyPayments,
  summarizeCredit,
  summarizePayments,
  toPaisa,
} from '../../js/modules/candela-sales/domain/summary.js';

describe('Candela monetary conversion', () => {
  it('converts decimal strings to integer paisa without floating point addition', () => {
    expect(toPaisa('178688.80')).toBe(17868880);
    expect(toPaisa('0.01')).toBe(1);
    expect(toPaisa('-1.25')).toBe(-125);
    expect(fromPaisa(26861146)).toBe(268611.46);
  });

  it('rounds excess fractional precision half away from zero', () => {
    expect(toPaisa('1.004')).toBe(100);
    expect(toPaisa('1.005')).toBe(101);
    expect(toPaisa('-1.005')).toBe(-101);
  });

  it('treats absent values as zero and rejects malformed or unsafe values', () => {
    expect(toPaisa(null)).toBe(0);
    expect(toPaisa('')).toBe(0);
    expect(() => toPaisa('12,000')).toThrow(TypeError);
    expect(() => toPaisa('1e6')).toThrow(TypeError);
    expect(() => toPaisa('999999999999999999999999')).toThrow(RangeError);
  });
});

describe('Candela payment summaries', () => {
  const days = [
    { sale_day: '2026-11-13', cash_sale: '178688.80', card_sale: '268611.46', credit_sale: '30743.09', total_sale: '478043.35' },
    { sale_day: '2026-11-12', cash_sale: '296004.62', card_sale: '271289.50', credit_sale: '30512.98', total_sale: '597807.10' },
    { sale_day: '2026-10-31', cash_sale: '1.10', card_sale: '2.20', credit_sale: '3.30', total_sale: '6.60' },
  ];

  it('sums each source field independently in paisa', () => {
    expect(summarizePayments(days)).toEqual({
      cash_sale: 474694.52,
      card_sale: 539903.16,
      credit_sale: 61259.37,
      total_sale: 1075857.05,
    });
  });

  it('filters inclusive dates and returns newest day first without mutating source', () => {
    const result = filterPaymentDays(days, { from: '2026-11-12', to: '2026-11-13' });
    expect(result.map((r) => r.sale_day)).toEqual(['2026-11-13', '2026-11-12']);
    expect(days.map((r) => r.sale_day)).toEqual(['2026-11-13', '2026-11-12', '2026-10-31']);
  });

  it('builds monthly totals in chronological order', () => {
    expect(monthlyPayments(days)).toEqual([
      { month: '2026-10', days: 1, cash_sale: 1.1, card_sale: 2.2, credit_sale: 3.3, total_sale: 6.6 },
      { month: '2026-11', days: 2, cash_sale: 474693.42, card_sale: 539900.96, credit_sale: 61256.07, total_sale: 1075850.45 },
    ]);
  });
});

describe('Candela customer credit summaries', () => {
  const rows = [
    { sale_day: '2026-11-13', customer_name: 'Test Customer A', credit_amount: '100.10', receipt_count: 2 },
    { sale_day: '2026-11-12', customer_name: 'Test Customer B', credit_amount: '25.25', receipt_count: 1 },
    { sale_day: '2026-10-31', customer_name: 'Test Customer A', credit_amount: '5.05', receipt_count: 1 },
  ];

  it('filters by inclusive date and case-insensitive customer search', () => {
    expect(filterCreditRows(rows, { from: '2026-11-01', search: 'customer a' })).toEqual([rows[0]]);
  });

  it('sorts by date then name without merging customer identities', () => {
    expect(filterCreditRows(rows).map((r) => [r.sale_day, r.customer_name])).toEqual([
      ['2026-11-13', 'Test Customer A'],
      ['2026-11-12', 'Test Customer B'],
      ['2026-10-31', 'Test Customer A'],
    ]);
  });

  it('sums credit and receipt count accurately', () => {
    expect(summarizeCredit(rows)).toEqual({ credit_amount: 130.4, receipt_count: 4, rows: 3 });
  });

  it('rejects invalid receipt counts', () => {
    expect(() => summarizeCredit([{ credit_amount: 10, receipt_count: -1 }])).toThrow(TypeError);
  });
});
