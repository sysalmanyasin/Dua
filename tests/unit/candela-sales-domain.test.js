import { describe, expect, it } from 'vitest';
import {
  addDays,
  compareTotals,
  customerKey,
  filterCreditRows,
  filterPaymentDays,
  fromPaisa,
  groupCreditByCustomer,
  groupPaymentsByMonth,
  monthStart,
  percentOf,
  summarizeCredit,
  summarizePayments,
  toPaisa,
} from '../../js/modules/candela-sales/domain/summary.js';

const paymentRow = (sale_day, cash_sale, card_sale, credit_sale, total_sale) => ({
  sale_day,
  cash_sale,
  card_sale,
  credit_sale,
  total_sale,
});

const creditRow = (sale_day, customer_name, credit_amount, receipt_count) => ({
  sale_day,
  customer_name,
  credit_amount,
  receipt_count,
});

const paymentRows = [
  paymentRow('2026-11-13', '178688.80', '268611.46', '30743.09', '478043.35'),
  paymentRow('2026-11-12', '296004.62', '271289.50', '30512.98', '597807.10'),
  paymentRow('2026-10-31', '1.10', '2.20', '3.30', '6.60'),
];

const creditRows = [
  creditRow('2026-11-13', 'Test Customer A', '100.10', 2),
  creditRow('2026-11-12', 'Test Customer B', '25.25', 1),
  creditRow('2026-10-31', 'Test Customer A', '5.05', 1),
];

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
  it('sums each source field independently in paisa', () => {
    expect(summarizePayments(paymentRows)).toEqual({
      cash_sale: 474694.52,
      card_sale: 539903.16,
      credit_sale: 61259.37,
      total_sale: 1075857.05,
    });
  });

  it('filters inclusive dates and returns newest day first without mutating source', () => {
    const result = filterPaymentDays(paymentRows, '2026-11-12', '2026-11-13');
    expect(result.map((row) => row.sale_day)).toEqual(['2026-11-13', '2026-11-12']);
    expect(paymentRows.map((row) => row.sale_day)).toEqual(['2026-11-13', '2026-11-12', '2026-10-31']);
  });
});

describe('Candela customer credit summaries', () => {
  it('filters by inclusive date and case-insensitive customer search', () => {
    expect(filterCreditRows(creditRows, '2026-11-01', null, 'customer a')).toEqual([creditRows[0]]);
  });

  it('keeps source customer rows separate and sorts newest first', () => {
    expect(filterCreditRows(creditRows).map((row) => row.sale_day)).toEqual(['2026-11-13', '2026-11-12', '2026-10-31']);
  });

  it('sums credit and receipt count accurately', () => {
    expect(summarizeCredit(creditRows)).toEqual({
      credit_amount: 130.4,
      receipt_count: 4,
      rows: 3,
    });
  });

  it('rejects invalid receipt counts', () => {
    expect(() => summarizeCredit([{ credit_amount: 10, receipt_count: -1 }])).toThrow(TypeError);
  });
});

describe('Candela history roll-ups', () => {
  it('treats the same name written differently as one customer', () => {
    expect(customerKey('  Test   Customer A ')).toBe('test customer a');
    expect(customerKey(null)).toBe('');
  });

  it('adds daily rows into months, newest first, exactly', () => {
    const months = groupPaymentsByMonth(paymentRows);
    expect(months.map((m) => m.month)).toEqual(['2026-11', '2026-10']);
    expect(months[0]).toEqual({
      month: '2026-11',
      days: 2,
      cash_sale: 474693.42,
      card_sale: 539900.96,
      credit_sale: 61256.07,
      total_sale: 1075850.45,
    });
  });

  it('adds one customer across days, biggest first', () => {
    const rows = [
      { customer_key: 'a', customer_name: 'A', credit_amount: '10.10', receipt_count: 1 },
      { customer_key: 'b', customer_name: 'B', credit_amount: '50.00', receipt_count: 2 },
      { customer_key: 'a', customer_name: 'A', credit_amount: '20.20', receipt_count: 3 },
    ];
    expect(groupCreditByCustomer(rows)).toEqual([
      { customer_key: 'b', customer_name: 'B', credit_amount: 50, receipt_count: 2, days: 1 },
      { customer_key: 'a', customer_name: 'A', credit_amount: 30.3, receipt_count: 4, days: 2 },
    ]);
  });

  it('computes shares and day comparisons without drift', () => {
    expect(percentOf('25.00', '100.00')).toBe(25);
    expect(percentOf('1', '0')).toBe(0);
    expect(compareTotals('150.50', '100.00')).toEqual({ change: 50.5, percent: 51 });
    expect(compareTotals('10', '0')).toEqual({ change: 10, percent: null });
  });
});

describe('Candela date helpers', () => {
  it('moves days across month and year ends', () => {
    expect(addDays('2026-11-01', -1)).toBe('2026-10-31');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(monthStart('2026-11-14')).toBe('2026-11-01');
  });
});
