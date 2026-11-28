import { describe, expect, it } from 'vitest';
import { renderInvoice } from '../../js/modules/invoice-desk/ui/renderers.js';
import { pageHeightMm } from '../../js/modules/invoice-desk/ui/print.js';

const base = {
  invoice_number: '810',
  invoice_date: '2026-11-20',
  subtotal: '360.00',
  discount: '0.00',
  grand_total: '360.00',
  amount_words: 'RUPEES THREE HUNDRED SIXTY ONLY',
  printed_fields: { cash: '1000', change: '640', cashier: 'P1', shift: 'EVE', time: '16:40:40 PM' },
  lines: [{ description: 'DD CELL (PAIR)', quantity: '2.000', unit_price: '180.00', line_total: '360.00' }],
};
const out = (id, extra = {}) => String(renderInvoice({ ...base, template_id: id, ...extra }));

describe('invoice slips follow their worksheets', () => {
  it('B.S Mart: 20 Nov 2026, time without PM, 2 not 2.000, cash and change to two decimals', () => {
    const h = out('bs-mart-v1');
    expect(h).toContain('20 Nov 2026');
    expect(h).toContain('>16:40:40<');
    expect(h).toContain('>2<');
    expect(h).toContain('1000.00');
    expect(h).toContain('640.00');
    expect(h).toContain('ORIGINIAL');
  });
  it('Safari: dd/Mon/yy date and the logo', () => {
    const h = out('safari-book-land-v1');
    expect(h).toContain('20/Nov/26');
    expect(h).toContain('id-logo');
  });
  it('Best Choice: dd-mm-yyyy and whole amounts without decimals', () => {
    const h = out('best-choice-store-v1');
    expect(h).toContain('DATE: 20-11-2026');
    expect(h).toContain('>180<');
    expect(h).not.toContain('180.00');
  });
  it('unknown template still throws', () => {
    expect(() => renderInvoice({ ...base, template_id: 'x' })).toThrow();
  });
});
describe('thermal page height', () => {
  it('rounds up to whole mm plus 1', () => {
    expect(pageHeightMm(96)).toBe(Math.ceil(96 / (96 / 25.4)) + 1);
  });
});
