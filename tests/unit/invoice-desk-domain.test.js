import { describe, expect, it } from 'vitest';
import { amountInWords } from '../../js/modules/invoice-desk/domain/amount-in-words.js';
import { calculateInvoice, lineTotalPaisa, quantityMilli, toPaisa } from '../../js/modules/invoice-desk/domain/calculations.js';
import { validateInvoiceHeader, validateLine } from '../../js/modules/invoice-desk/domain/validation.js';
import { templateForBusiness } from '../../js/modules/invoice-desk/domain/templates.js';

describe('Invoice Desk calculations', () => {
  it('parses PKR into integer paisa without floating point', () => {
    expect(toPaisa('1.25')).toBe(125);
    expect(toPaisa('0')).toBe(0);
    expect(() => toPaisa('1.234')).toThrow();
    expect(() => toPaisa('-1')).toThrow();
  });
  it('supports three decimal quantity precision and rounds line totals to paisa', () => {
    expect(quantityMilli('1.125')).toBe(1125);
    expect(lineTotalPaisa('1.125', 100)).toBe(113);
    expect(() => quantityMilli('0')).toThrow();
  });
  it('calculates subtotal and Best Choice discount', () => {
    const r = calculateInvoice([{ description: 'Book', quantity: '2', unitPrice: '125.50' }], 500);
    expect(r.subtotalPaisa).toBe(25100);
    expect(r.grandTotalPaisa).toBe(24600);
    expect(() => calculateInvoice([{ quantity: '1', unitPrice: '10' }], 1001)).toThrow();
  });
});
describe('Invoice Desk validation and template mapping', () => {
  it('keeps invoice numbers as exact strings including leading zeros', () => {
    expect(validateInvoiceHeader({ businessId: 'bs-mart', invoiceNumber: '000012', invoiceDate: '2026-11-17' })).toEqual({});
  });
  it('validates lines', () => {
    expect(validateLine({ description: 'Pen', quantity: '1.5', unitPrice: '12.00' })).toEqual({});
    expect(validateLine({ description: '', quantity: '0', unitPrice: '-1' })).toHaveProperty('description');
  });
  it('maps each business to its own versioned template', () => {
    expect(templateForBusiness('bs-mart').id).toBe('bs-mart-v1');
    expect(templateForBusiness('safari-book-land').id).toBe('safari-book-land-v1');
    expect(templateForBusiness('best-choice-store').discount).toBe(true);
  });
});
describe('PKR amount in words', () => {
  it.each([
    [0, 'Zero Pakistani Rupees Only'],
    [1234, 'Twelve Pakistani Rupees And Thirty Four Paisa Only'],
    [10000000, 'One Lakh Pakistani Rupees Only'],
    [1234567890, 'One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight Pakistani Rupees And Ninety Paisa Only'],
  ])('formats %i paisa', (paisa, expected) => expect(amountInWords(paisa)).toBe(expected));
});
