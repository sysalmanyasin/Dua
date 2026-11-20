// Turns the server's report (ebill_report) into the tables and files a manager takes away: CSV, Excel and PDF.
// Pure: no screen, no network. The CSV and Excel writers are Inventory's and the PDF writer is Closing's (small, tested, no libraries,
// work offline); money stays a real number in the sheets so Excel can add it up.
import { toCsv } from '../../inventory/domain/csv.js';
import { toXlsx, XLSX_MIME } from '../../inventory/domain/xlsx.js';
import { fit, Pdf } from '../../closing/domain/pdf.js';
import { STATUS_WORDS } from './refund.js';
import { receiptTime } from './receipt.js';

export { XLSX_MIME };
const n = (v) => Math.round((Number(v) || 0) * 100) / 100;
const MODES = ['Cash', 'Card', 'Credit'];

/** Daily totals: one row per day, then a total row. */
export function dailyTable(report) {
  const head = ['Date', 'Invoices', 'Gross', 'Discounts', 'Net', 'Refunded', 'Net after refunds', ...MODES];
  const rows = report.days.map((d) => [
    d.date,
    Number(d.count),
    n(d.gross),
    n(d.discounts),
    n(d.net),
    n(d.refunded),
    n(d.net_after_refunds),
    ...MODES.map((m) => n(d.by_mode?.[m])),
  ]);
  const t = report.totals;
  const sumMode = (m) => n(report.days.reduce((s, d) => s + (Number(d.by_mode?.[m]) || 0), 0));
  rows.push(['TOTAL', Number(t.count), n(t.gross), n(t.discounts), n(t.net), n(t.refunded), n(t.net_after_refunds), ...MODES.map(sumMode)]);
  return [head, ...rows];
}

/** One row per invoice. */
export function invoiceTable(report) {
  const head = [
    'Invoice',
    'Date',
    'Time',
    'Staff',
    'Customer',
    'Payment',
    'Items',
    'Gross',
    'Discounts',
    'Net',
    'Refunded',
    'Status',
    'Device',
    'PIN checked on',
  ];
  const rows = report.rows.map((r) => [
    r.invoice_no,
    r.business_date,
    receiptTime(r.client_created_at).split(' ').slice(1).join(' '),
    r.staff_name,
    r.customer,
    r.payment_mode,
    Number(r.items),
    n(r.gross_total),
    n(r.discounts),
    n(r.net_total),
    n(r.refunded_amount),
    STATUS_WORDS[r.status] || r.status,
    r.device_label || '',
    r.pin_check === 'device' ? 'This device' : 'Server',
  ]);
  return [head, ...rows];
}

export const csvOf = (table) => new Blob([toCsv(table)], { type: 'text/csv;charset=utf-8' });
export const xlsxOf = (report, notes = []) =>
  new Blob(
    [
      toXlsx([
        { name: 'Daily totals', table: dailyTable(report), widths: [12, 9, 12, 12, 12, 12, 16, 12, 12, 12] },
        { name: 'Invoices', table: invoiceTable(report), widths: [18, 12, 10, 16, 18, 9, 7, 12, 12, 12, 12, 14, 16, 14] },
        ...(notes.length ? [{ name: 'Read me', table: [['Please note'], ...notes.map((x) => [x])], widths: [110] }] : []),
      ]),
    ],
    { type: XLSX_MIME },
  );

/** @param {{ from: string, to: string, filters?: string, printedAt?: string }} meta */
export function pdfOf(report, meta) {
  const pdf = new Pdf({ title: `Emergency Billing report ${meta.from} to ${meta.to}` });
  const W = 297;
  const H = 210;
  const M = 10;
  let page;
  let y;
  const head = (title) => {
    page = pdf.addPage(W, H);
    page.text(title, M, 14, { font: 'helvB', size: 13 });
    page.text(`${meta.from} to ${meta.to}${meta.filters ? `   ·   ${meta.filters}` : ''}`, M, 20, { size: 8.5, color: '#444444' });
    page.text(`Printed ${meta.printedAt || ''}`, W - M, 14, { size: 8, align: 'right', color: '#444444' });
    y = 28;
  };
  /** cols: [{ label, x (left, or right edge when right), right?: bool, w }] */
  const table = (cols, rows, { boldLast = false } = {}) => {
    const header = () => {
      page.rect(M, y - 4, W - 2 * M, 6, { fill: '#e8ecf1' });
      for (const c of cols) page.text(c.label, c.right ? c.x + c.w : c.x, y, { font: 'helvB', size: 8, align: c.right ? 'right' : 'left' });
      y += 6;
    };
    header();
    rows.forEach((r, i) => {
      if (y > H - 14) {
        head('Emergency Billing report (continued)');
        header();
      }
      const strong = boldLast && i === rows.length - 1;
      if (strong) page.line(M, y - 3.8, W - M, y - 3.8, { lw: 0.3 });
      cols.forEach((c, k) => {
        const text = fit(String(r[k] ?? ''), strong ? 'helvB' : 'helv', 8, c.w - 1);
        page.text(text, c.right ? c.x + c.w : c.x, y, { font: strong ? 'helvB' : 'helv', size: 8, align: c.right ? 'right' : 'left' });
      });
      y += 5;
    });
  };
  const money = (v) => (typeof v === 'number' ? v.toFixed(2) : v);

  head('Emergency Billing report');
  const t = report.totals;
  page.text(
    `${t.count} invoices   ·   Gross ${n(t.gross).toFixed(2)}   ·   Discounts ${n(t.discounts).toFixed(2)}   ·   Net ${n(t.net).toFixed(2)}   ·   Refunded ${n(t.refunded).toFixed(2)}   ·   Net after refunds ${n(t.net_after_refunds).toFixed(2)}`,
    M,
    y,
    { font: 'helvB', size: 9 },
  );
  y += 4;
  if (meta.warning) {
    page.text(meta.warning, M, y + 2, { font: 'helvB', size: 8.5, color: '#b00020' });
    y += 6;
  }
  y += 6;
  const d = dailyTable(report).map((r) => r.map(money));
  table(
    [
      { label: 'Date', x: M, w: 26 },
      { label: 'Invoices', x: 38, w: 22, right: true },
      { label: 'Gross', x: 62, w: 30, right: true },
      { label: 'Discounts', x: 94, w: 30, right: true },
      { label: 'Net', x: 126, w: 30, right: true },
      { label: 'Refunded', x: 158, w: 30, right: true },
      { label: 'Net after refunds', x: 190, w: 34, right: true },
      { label: 'Cash', x: 226, w: 20, right: true },
      { label: 'Card', x: 248, w: 18, right: true },
      { label: 'Credit', x: 268, w: 19, right: true },
    ],
    d.slice(1),
    { boldLast: true },
  );

  if (report.rows.length) {
    head('Invoices');
    const inv = invoiceTable(report)
      .slice(1)
      .map((r) => r.map(money));
    table(
      [
        { label: 'Invoice', x: M, w: 34 },
        { label: 'Date', x: 46, w: 21 },
        { label: 'Staff', x: 69, w: 28 },
        { label: 'Customer', x: 99, w: 38 },
        { label: 'Pay', x: 139, w: 14 },
        { label: 'Items', x: 154, w: 12, right: true },
        { label: 'Gross', x: 168, w: 24, right: true },
        { label: 'Discounts', x: 194, w: 24, right: true },
        { label: 'Net', x: 220, w: 24, right: true },
        { label: 'Refunded', x: 246, w: 20, right: true },
        { label: 'Status', x: 268, w: 20 },
      ],
      inv.map((r) => [r[0], r[1], r[3], r[4], r[5], r[6], r[7], r[8], r[9], r[10], r[11]]),
    );
  }
  return pdf.toBlob();
}

/** ebill-report-2026-11-19_to_2026-11-19.csv */
export const reportFileName = (kind, from, to, ext) => `ebill-${kind}-${from}${from === to ? '' : `_to_${to}`}.${ext}`;
