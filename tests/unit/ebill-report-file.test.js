import { describe, expect, it } from 'vitest';
import { csvOf, dailyTable, invoiceTable, pdfOf, reportFileName, xlsxOf } from '../../js/modules/ebill/domain/reportFile.js';

const report = {
  days: [
    {
      date: '2026-11-18',
      count: 2,
      gross: 200,
      discounts: 10,
      net: 190,
      refunded: 40,
      net_after_refunds: 150,
      by_mode: { Cash: 100, Card: 50 },
    },
    { date: '2026-11-19', count: 1, gross: 100, discounts: 0, net: 100, refunded: 0, net_after_refunds: 100, by_mode: { Credit: 100 } },
  ],
  totals: { count: 3, gross: 300, discounts: 10, net: 290, refunded: 40, net_after_refunds: 250 },
  rows: [
    {
      invoice_no: 'EB-1',
      business_date: '2026-11-18',
      client_created_at: '2026-11-18T10:00:00Z',
      staff_name: 'J One',
      customer: '=cmd|calc',
      payment_mode: 'Cash',
      items: 2,
      gross_total: '120',
      discounts: '10',
      net_total: '110',
      refunded_amount: '40',
      status: 'partially_refunded',
      device_label: 'Counter 1',
      pin_check: 'server',
    },
    {
      invoice_no: 'EB-2',
      business_date: '2026-11-18',
      client_created_at: '2026-11-18T11:00:00Z',
      staff_name: 'J One',
      customer: '',
      payment_mode: 'Card',
      items: 1,
      gross_total: '80',
      discounts: '0',
      net_total: '80',
      refunded_amount: '0',
      status: 'posted',
      device_label: '',
      pin_check: 'device',
    },
  ],
  total_invoices: 3,
  truncated: false,
};
const text = (b) => b.text();

describe('report tables', () => {
  it('daily totals add a total row and split by payment mode', () => {
    const t = dailyTable(report);
    expect(t[0]).toEqual(['Date', 'Invoices', 'Gross', 'Discounts', 'Net', 'Refunded', 'Net after refunds', 'Cash', 'Card', 'Credit']);
    expect(t[1]).toEqual(['2026-11-18', 2, 200, 10, 190, 40, 150, 100, 50, 0]);
    expect(t.at(-1)).toEqual(['TOTAL', 3, 300, 10, 290, 40, 250, 100, 50, 100]);
  });
  it('invoice rows use real numbers, plain status words and say where the PIN was checked', () => {
    const t = invoiceTable(report);
    expect(t[1].slice(0, 2)).toEqual(['EB-1', '2026-11-18']);
    expect(t[1][9]).toBe(110);
    expect(t[1][11]).toBe('Part refunded');
    expect(t[2][11]).toBe('Posted');
    expect(t[2][13]).toBe('This device');
  });
});

describe('files', () => {
  it('CSV carries Urdu-safe BOM, and a customer cannot run as a formula', async () => {
    const blob = csvOf(invoiceTable(report));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]); // the marker Excel needs for Urdu names
    const s = await text(blob);
    expect(s).toContain("'=cmd|calc");
    expect(s).toContain('EB-1,2026-11-18');
  });
  it('Excel is a real zip with the two sheets, and a Read me sheet only when there are notes', async () => {
    const plain = new Uint8Array(await xlsxOf(report).arrayBuffer());
    expect([plain[0], plain[1]]).toEqual([0x50, 0x4b]); // "PK"
    const s = new TextDecoder('latin1').decode(plain);
    expect(s).toContain('Daily totals');
    expect(s).toContain('Invoices');
    expect(s).not.toContain('Read me');
    const noted = new TextDecoder('latin1').decode(new Uint8Array(await xlsxOf(report, ['3 invoices are not included']).arrayBuffer()));
    expect(noted).toContain('Read me');
    expect(noted).toContain('3 invoices are not included');
  });
  it('PDF is a real PDF with the totals, daily table, invoices and any warning', async () => {
    const b = pdfOf(report, {
      from: '2026-11-18',
      to: '2026-11-19',
      printedAt: '20 Nov 2026',
      filters: 'payment Cash',
      warning: '2 invoices on this device are NOT included',
    });
    expect(b.type).toBe('application/pdf');
    const s = new TextDecoder('latin1').decode(new Uint8Array(await b.arrayBuffer()));
    expect(s.startsWith('%PDF-')).toBe(true);
    for (const t of [
      'Emergency Billing report',
      '2026-11-18 to 2026-11-19',
      'payment Cash',
      'Net after refunds',
      'TOTAL',
      'EB-1',
      'NOT included',
    ])
      expect(s).toContain(t);
  });
  it('a long list runs onto more pages instead of off the page', async () => {
    const rows = Array.from({ length: 120 }, (_, i) => ({ ...report.rows[1], invoice_no: `EB-${i}` }));
    const s = new TextDecoder('latin1').decode(new Uint8Array(await pdfOf({ ...report, rows }, { from: 'a', to: 'b' }).arrayBuffer()));
    expect((s.match(/\/Type \/Page /g) || []).length).toBeGreaterThan(3);
  });
  it('file names say what and when', () => {
    expect(reportFileName('report', '2026-11-19', '2026-11-19', 'pdf')).toBe('ebill-report-2026-11-19.pdf');
    expect(reportFileName('report-INCOMPLETE', '2026-11-01', '2026-11-19', 'xlsx')).toBe(
      'ebill-report-INCOMPLETE-2026-11-01_to_2026-11-19.xlsx',
    );
  });
});
