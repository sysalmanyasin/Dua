// The report tables and CSV (js/modules/audit/domain/export.js).
import { describe, expect, it } from 'vitest';
import {
  barcodeConflictsTable,
  barcodeMasterTable,
  barcodeVerificationTable,
  combinedTable,
  conflictsTable,
  normalizeLine,
  notesTable,
  roundTotals,
  scanHistoryTable,
  summaryTable,
  tableCsv,
  varianceTable,
} from '../../js/modules/audit/domain/export.js';

const compiledRow = (over = {}) => ({
  company: 'Acme',
  code: 'A1',
  name: 'Alpha one',
  system_qty: 10,
  retail_price: 55.5,
  counted_qty: 8,
  variance: -2,
  variance_value: -111,
  missing: false,
  auto_matched: false,
  auditor_id: 'u1',
  note: null,
  corrected_by: null,
  ...over,
});
const nameOf = (id) => ({ u1: 'Count One' })[id] ?? 'Someone';

describe('a line', () => {
  it('reads a compiled row, naming the counter', () => {
    expect(normalizeLine(compiledRow(), nameOf)).toEqual({
      company: 'Acme',
      code: 'A1',
      name: 'Alpha one',
      retail: 55.5,
      system: 10,
      counted: 8,
      variance: -2,
      value: -111,
      counter: 'Count One',
      notCounted: false,
      assumed: false,
      corrected: false,
      conflict: '',
      note: '',
    });
  });

  it('reads a final line: the final quantity is the counted one, the counter is already a name, and a conflict is worded', () => {
    const l = normalizeLine({
      ...compiledRow(),
      counted_qty: 8,
      final_qty: 9,
      auditor_name: 'Dee',
      conflict_side: 'b',
      variance: -1,
      variance_value: -55.5,
    });
    expect(l).toMatchObject({ counted: 9, counter: 'Dee', conflict: 'kept the earlier round', variance: -1 });
    expect(normalizeLine({ ...compiledRow(), final_qty: 9, conflict_side: 'a' }).conflict).toBe('kept this round');
  });

  it('tells apart not counted, assumed to match and corrected, and keeps a missing price empty', () => {
    expect(normalizeLine(compiledRow({ missing: true }), nameOf)).toMatchObject({ notCounted: true, assumed: false });
    expect(normalizeLine(compiledRow({ missing: true, auto_matched: true }), nameOf)).toMatchObject({ notCounted: false, assumed: true });
    expect(normalizeLine(compiledRow({ corrected_by: 'u9', retail_price: null, auditor_id: null }), nameOf)).toMatchObject({
      corrected: true,
      retail: null,
      counter: '',
    });
  });
});

describe('the tables and their files', () => {
  const lines = [
    normalizeLine(compiledRow(), nameOf),
    normalizeLine(
      compiledRow({ code: 'B2', name: '=SUM(A1)', variance: 3, variance_value: 166.5, counted_qty: 13, missing: true, auto_matched: true }),
      nameOf,
    ),
  ];

  it('variance: code, product, company, price, system, counted, variance, value, counter, then the flags', () => {
    const t = varianceTable(lines);
    expect(t.columns.slice(0, 9).map((c) => c.header)).toEqual([
      'Code',
      'Product',
      'Company',
      'Retail price',
      'System quantity',
      'Counted quantity',
      'Variance',
      'Variance value',
      'Counter',
    ]);
    expect(t.rows[0].slice(0, 9)).toEqual(['A1', 'Alpha one', 'Acme', 55.5, 10, 8, -2, -111, 'Count One']);
    expect(t.rows[1][10]).toBe('yes'); // assumed to match
  });

  it('CSV writes numbers as numbers (a negative stays negative), money with two decimals, and makes formula-looking text safe', () => {
    const csv = tableCsv(varianceTable(lines));
    const [head, first, second] = csv.trim().split('\r\n');
    expect(head.startsWith('Code,Product,Company,Retail price,System quantity')).toBe(true);
    expect(first).toBe('A1,Alpha one,Acme,55.50,10,8,-2,-111.00,Count One,,,,,');
    expect(second).toContain("B2,'=SUM(A1)");
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  it('CSV quotes commas, quotes and line breaks', () => {
    const csv = tableCsv(notesTable([{ name: 'Dee, Jr', note: 'He said "ok"\nthen left' }]));
    expect(csv).toBe('Counter,Note\r\n"Dee, Jr","He said ""ok""\nthen left"\r\n');
  });

  it('conflicts: both rounds side by side, and which was kept, or that it is not settled', () => {
    const k = {
      code: 'A1',
      name: 'Alpha',
      company: 'Acme',
      a_round: '1A',
      a_qty: 7,
      a_name: 'Two',
      b_round: '1',
      b_qty: 9,
      b_name: 'One',
      resolved_side: 'b',
      resolved_reason: 'recount',
      resolved_by: 'Owner',
    };
    const t = conflictsTable([k, { ...k, resolved_side: null, resolved_reason: null, resolved_by: null }]);
    expect(t.rows[0]).toEqual(['A1', 'Alpha', 'Acme', '1A', 7, 'Two', '1', 9, 'One', 'Round 1', 'recount', 'Owner']);
    expect(t.rows[1][9]).toBe('Not settled yet');
    expect(t.rows[1][10]).toBe('');
  });

  it('combined: every round’s lines with the round named, and summary: one row per round plus a total', () => {
    const rounds = [
      { label: '1', state: 'final', items: 6, lines: [lines[0]] },
      { label: '1A', state: 'compiled', items: 2, lines: [lines[1]] },
    ];
    const c = combinedTable(rounds);
    expect(c.columns[0].header).toBe('Round');
    expect(c.rows.map((r) => r[0])).toEqual(['1', '1A']);
    const s = summaryTable(rounds);
    expect(s.rows).toEqual([
      ['1', 'final', 6, 1, -2, -111, 0, 0, 0],
      ['1A', 'compiled', 2, 1, 3, 166.5, 0, 1, 0],
      ['All rounds', '', 8, 2, 1, 55.5, 0, 1, 0],
    ]);
  });

  it('adds money in whole paisa, so 0.1 + 0.2 is 0.3 and a total matches the Review screen', () => {
    const l = (v, q) => ({ ...lines[0], value: v, variance: q });
    const t = roundTotals([l(0.1, 0.1), l(0.2, 0.2), l(-301.5, -1)]);
    expect(t.paisa).toBe(-30120);
    expect(t.value).toBe(-301.2);
    expect(t.quantity).toBe(-0.7);
    expect(roundTotals([])).toMatchObject({ lines: 0, paisa: 0, quantity: 0 });
  });
});

describe('barcode tables', () => {
  const rows = [
    {
      barcode: '590',
      product_code: 'A1',
      product_name: 'Alpha',
      barcode_type: 'ean13',
      status: 'verified',
      registered_by_name: 'R',
      verified_by_name: 'V',
      verified_at: '2026-11-17T08:00:00+00:00',
      notes: null,
      updated_at: '2026-11-17T09:00:00.123Z',
    },
    {
      barcode: '591',
      product_code: 'A2',
      product_name: 'Beta',
      barcode_type: 'unknown',
      status: 'unverified',
      registered_by_name: 'R',
      verified_by_name: null,
      verified_at: null,
      notes: 'n',
      updated_at: '2026-11-18T09:00:00Z',
    },
    {
      barcode: '592',
      product_code: 'A3',
      product_name: 'Gamma',
      barcode_type: 'ean8',
      status: 'conflict',
      conflict_product_code: 'A9',
      conflict_product_name: 'Other',
      conflict_note: 'twice',
      updated_at: '2026-11-18T10:00:00Z',
    },
  ];
  it('master lists everything with the status in words and dates readable', () => {
    const t = barcodeMasterTable(rows);
    expect(t.rows).toHaveLength(3);
    expect(t.rows[0]).toEqual([
      '590',
      'A1',
      'Alpha',
      'ean13',
      'Verified',
      'R',
      'V',
      '2026-11-17 08:00:00 UTC',
      '',
      '2026-11-17 09:00:00 UTC',
    ]);
    expect(t.rows[1][4]).toBe('Not verified yet');
  });
  it('verification keeps only the unverified, conflicts only those in conflict', () => {
    expect(barcodeVerificationTable(rows).rows.map((r) => r[0])).toEqual(['591']);
    expect(barcodeConflictsTable(rows).rows).toEqual([['592', 'A3', 'Gamma', 'A9', 'Other', 'twice', '2026-11-18 10:00:00 UTC']]);
  });
  it('scan history has when, person, kind, barcode, product and result', () => {
    const t = scanHistoryTable([
      { scanned_at: '2026-11-17T08:00:00Z', user_name: 'Dee', scan_type: 'count', barcode: '590', product_code: null, result: 'matched' },
    ]);
    expect(t.rows).toEqual([['2026-11-17 08:00:00 UTC', 'Dee', 'count', '590', '', 'matched']]);
  });
});
