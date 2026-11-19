// Report helpers: the CSV file and the trail wording.
import { describe, expect, it } from 'vitest';
import { actionText, csvCell, csvText, finalCsv, safeFileName } from '../../js/modules/audit/domain/report.js';

describe('csv cells', () => {
  it('quotes commas, quotes and line breaks', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
    expect(csvCell(null)).toBe('');
  });
  it('defuses text a spreadsheet would run as a formula, but leaves numbers alone', () => {
    for (const bad of ['=SUM(A1)', '+1', '-1+2', '@cmd', '\tx']) expect(csvText(bad)).toBe(`'${bad}`);
    expect(csvText('Panadol')).toBe('Panadol');
    expect(csvCell(-4)).toBe('-4');
  });
});

describe('final csv', () => {
  const line = (over = {}) => ({
    company: 'Acme',
    code: 'A1',
    name: 'Alpha, one',
    system_qty: 10,
    retail_price: '100.50',
    counted_qty: 7,
    final_qty: 6,
    variance: -4,
    variance_value: '-402.00',
    missing: false,
    auto_matched: false,
    auditor_name: 'Count One',
    note: '',
    conflict_side: 'b',
    ...over,
  });
  it('has a header, one row per line and CRLF line ends', () => {
    const out = finalCsv([line(), line({ code: 'B1', conflict_side: null, missing: true })]);
    const rows = out.trimEnd().split('\r\n');
    expect(rows).toHaveLength(3);
    expect(rows[0].startsWith('Company,Code,Product')).toBe(true);
    expect(rows[1]).toContain('"Alpha, one"');
    expect(rows[1]).toContain('kept the earlier round');
    expect(rows[1]).toContain('-402.00');
    expect(rows[2].split(',')).toContain('yes');
  });
  it('marks assumed-matching rows separately from rows never counted', () => {
    const r = finalCsv([line({ missing: true, auto_matched: true, conflict_side: null })])
      .trimEnd()
      .split('\r\n')[1]
      .split(',');
    expect(r.slice(-4, -2)).toEqual(['', 'yes']);
  });
  it('defuses a product name that starts with =', () => {
    expect(finalCsv([line({ name: '=HYPERLINK("x")' })])).toContain(`"'=HYPERLINK(""x"")"`);
  });
});

describe('wording', () => {
  it('names a file safely', () => {
    expect(safeFileName('Final audit / Round 1A!', 'csv')).toBe('Final-audit-Round-1A.csv');
    expect(safeFileName('', 'csv')).toBe('audit.csv');
    expect(safeFileName('../../etc', 'csv')).toBe('etc.csv');
  });
  it('turns action codes into words and keeps unknown ones readable', () => {
    expect(actionText('audit.finalized')).toBe('Final snapshot created');
    expect(actionText('audit.correction_approved')).toBe('Correction approved');
    expect(actionText('audit.something_new')).toBe('something new');
  });
});
