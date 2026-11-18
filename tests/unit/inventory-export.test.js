// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { stamp, stampAs } from '../../js/modules/inventory/ui/download.js';
import { exportReport, KINDS } from '../../js/modules/inventory/ui/export.js';
import { PRINT_LIMIT, printCell, printReport } from '../../js/modules/inventory/ui/print.js';

afterEach(() => {
  window.dispatchEvent(new Event('afterprint'));
  document.body.innerHTML = '';
});

describe('file names', () => {
  it('put the report and the day in the name', () => {
    const d = new Date('2026-11-17T08:00:00Z');
    expect(stamp('reorder-60d-cover30', d)).toBe('inventory-reorder-60d-cover30-2026-11-17.csv');
    expect(stampAs('excess-working', 'xlsx', d)).toBe('inventory-excess-working-2026-11-17.xlsx');
  });
});

describe('exportReport', () => {
  it('offers csv, xlsx and pdf, and refuses anything else', () => {
    expect(KINDS).toEqual(['csv', 'xlsx', 'pdf']);
    expect(() => exportReport('docx', { name: 'x', title: 'X', table: [['A']] })).toThrow(/Unknown export kind/);
  });
});

describe('printReport', () => {
  const head = ['Code', 'Name', 'Stock', 'Price'];
  it('formats numbers, leaves blanks empty and right-aligns numbers', () => {
    window.print = vi.fn();
    printReport({ title: 'T', subtitle: 'S', head, rows: [['A1', '<b>Name</b>', 1234567.891, null]] });
    const cells = [...document.querySelectorAll('#inv-print-root tbody td')];
    expect(cells.map((c) => c.textContent)).toEqual(['A1', '<b>Name</b>', '1,234,567.89', '']);
    expect(cells[2].className).toBe('num');
    expect(cells[1].querySelector('b')).toBeNull(); // product names are text, never markup
  });
  it('prints at most PRINT_LIMIT rows and says the Excel file has the rest', () => {
    window.print = vi.fn();
    const rows = Array.from({ length: PRINT_LIMIT + 5 }, (_, i) => [`C${i}`, `Item ${i}`, i, 1]);
    const out = printReport({ title: 'Big', head, rows });
    expect(out).toEqual({ printed: PRINT_LIMIT, total: PRINT_LIMIT + 5 });
    expect(document.querySelectorAll('#inv-print-root tbody tr').length).toBe(PRINT_LIMIT);
    expect(document.querySelector('.inv-print-foot').textContent).toContain('The Excel file has the full list');
  });
  it('says how many rows when it prints them all', () => {
    window.print = vi.fn();
    printReport({ title: 'One', head, rows: [['A', 'B', 1, 2]] });
    expect(document.querySelector('.inv-print-foot').textContent.trim()).toBe('1 row.');
  });
  it('printCell handles odd values', () => {
    expect([printCell(0), printCell(Number.NaN), printCell(undefined), printCell('x'), printCell(1.005)]).toEqual([
      '0',
      '',
      '',
      'x',
      '1.01',
    ]);
  });
});
