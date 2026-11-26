// @vitest-environment jsdom
// Gathering, building and handing over the report files, with the database and the download replaced.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readWorkbook } from '../helpers/unzip.js';

const files = vi.hoisted(() => ({ list: [] }));
vi.mock('../../js/modules/audit/ui/print.js', () => ({
  downloadText: vi.fn((name, text) => files.list.push({ name, text })),
  downloadBytes: vi.fn((name, bytes, type) => files.list.push({ name, bytes, type })),
}));
vi.mock('../../js/modules/audit/data/api.js', () => ({
  compileOverview: vi.fn(),
  compiledRowsAll: vi.fn(),
  finalLinesAll: vi.fn(),
  listBarcodesAll: vi.fn(),
  scanHistoryAll: vi.fn(),
}));
const api = await import('../../js/modules/audit/data/api.js');
const { exportAllRounds, exportBarcodes, exportRound, exportable, loadRound } = await import('../../js/modules/audit/ui/exports.js');

const row = (over = {}) => ({
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
const overview = (variance_value = -301.5, over = {}) => ({
  assignments: [{ auditor_id: 'u1', name: 'Count One' }],
  compilation: { id: 'c1', variance_count: 2, variance_value, auditor_notes: [{ auditor_id: 'u1', note: 'Two boxes were damaged' }] },
  conflicts: [
    {
      code: 'A1',
      name: 'Alpha',
      company: 'Acme',
      a_round: '1A',
      a_qty: 7,
      a_name: 'Count One',
      b_round: '1',
      b_qty: 9,
      b_name: 'Count One',
      resolved_side: 'a',
      resolved_reason: 'r',
      resolved_by: 'Owner',
    },
  ],
  ...over,
});
const rounds = [
  { id: 'r1', label: '1', state: 'final', items: 6 },
  { id: 'r2', label: '1A', state: 'compiled', items: 2 },
  { id: 'r3', label: '2', state: 'counting', items: 4 },
];

beforeEach(() => {
  files.list = [];
  vi.clearAllMocks();
  api.compileOverview.mockResolvedValue(overview());
  api.compiledRowsAll.mockResolvedValue([row(), row({ code: 'B2', name: 'Beta', variance: -1, variance_value: -190.5, counted_qty: 4 })]);
  api.finalLinesAll.mockResolvedValue([{ ...row(), final_qty: 8, auditor_name: 'Count One', conflict_side: null }]);
});

describe('one round', () => {
  it('only compiled and final rounds have results', () => {
    expect(exportable(rounds).map((r) => r.label)).toEqual(['1', '1A']);
  });

  it('reads the compiled rows 500 at a time through the existing read and names each counter', async () => {
    const data = await loadRound(rounds[1]);
    expect(api.compiledRowsAll).toHaveBeenCalledWith('c1', 'diff');
    expect(api.finalLinesAll).not.toHaveBeenCalled();
    expect(data.lines.map((l) => l.counter)).toEqual(['Count One', 'Count One']);
    expect(data.notes).toEqual([{ name: 'Count One', note: 'Two boxes were damaged' }]);
  });

  it('a final round is read from its final lines, only those that differ', async () => {
    await loadRound(rounds[0]);
    expect(api.finalLinesAll).toHaveBeenCalledWith('r1', true);
    expect(api.compiledRowsAll).not.toHaveBeenCalled();
  });

  it('a round with no compile has nothing to export', async () => {
    api.compileOverview.mockResolvedValue(overview(0, { compilation: null }));
    expect(await loadRound(rounds[1])).toBeNull();
    await expect(exportRound('Annual audit', rounds[1], 'variance')).rejects.toThrow('not been compiled');
    expect(files.list).toEqual([]);
  });

  it.each([
    ['variance', 'Annual-audit-round-1A-variance.csv', /^Code,Product,Company/],
    ['notes', 'Annual-audit-round-1A-auditor-notes.csv', /^Counter,Note/],
    ['conflicts', 'Annual-audit-round-1A-conflicts.csv', /^Code,Product,Company,Later round/],
  ])('%s is one CSV file with a safe name', async (kind, name, head) => {
    await exportRound('Annual audit', rounds[1], kind);
    expect(files.list).toHaveLength(1);
    expect(files.list[0].name).toBe(name);
    expect(files.list[0].text).toMatch(head);
  });

  it('the Excel file has the three sheets, and its total equals the Review screen to the paisa', async () => {
    await exportRound('Annual audit', rounds[1], 'xlsx');
    const [file] = files.list;
    expect(file.name).toBe('Annual-audit-round-1A-variance.xlsx');
    expect(file.type).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    const sheets = readWorkbook(file.bytes);
    expect(sheets.map((s) => s.name)).toEqual(['Variance', 'Auditor Notes', 'Conflicts']);
    const values = sheets[0].rows.slice(1).map((r) => Math.round(r[7] * 100));
    expect(values.reduce((a, b) => a + b, 0)).toBe(Math.round(-301.5 * 100)); // the compile's own total
    expect(sheets[0].rows.length - 1).toBe(2); // and its own line count
    expect(sheets[1].rows[1]).toEqual(['Count One', 'Two boxes were damaged']);
  });
});

describe('all rounds', () => {
  it('reads each round that has results, reports progress, and leaves out the rest', async () => {
    const progress = vi.fn();
    const left = await exportAllRounds('Annual audit', rounds, 'summary', progress);
    expect(left).toBe(1);
    expect(progress.mock.calls.map((c) => c[0])).toEqual(['Reading round 1 of 2…', 'Reading round 2 of 2…']);
    expect(files.list[0].name).toBe('Annual-audit-all-rounds-summary.csv');
    expect(files.list[0].text).toContain('1A,compiled,2,2,-3,-301.50,0,0,0');
  });

  it('combined CSV names the round on every line', async () => {
    await exportAllRounds('Annual audit', rounds, 'combined');
    const lines = files.list[0].text.trim().split('\r\n');
    expect(lines[0].startsWith('Round,Code,Product')).toBe(true);
    expect(lines[1].startsWith('1,A1,')).toBe(true);
    expect(lines.at(-1).startsWith('1A,B2,')).toBe(true);
  });

  it('a round’s missing-counts file holds only the items nobody counted', async () => {
    api.compiledRowsAll.mockResolvedValue([
      row(),
      row({ code: 'B2', missing: true, counted_qty: 0, variance: -5, variance_value: -277.5 }),
      row({ code: 'C3', missing: true, auto_matched: true }),
    ]);
    await exportRound('Annual audit', { id: 'r2', label: '1A', state: 'compiled', items: 3 }, 'missing');
    const lines = files.list[0].text.trim().split('\r\n');
    expect(files.list[0].name).toContain('missing-counts');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('B2');
  });

  it('the workbook is Summary, Combined, then one sheet per round', async () => {
    await exportAllRounds('Annual audit', rounds, 'xlsx');
    const sheets = readWorkbook(files.list[0].bytes);
    expect(sheets.map((s) => s.name)).toEqual(['Summary', 'Combined', 'Round 1', 'Round 1A']);
    expect(sheets[0].rows.map((r) => r[0])).toEqual(['Round', '1', '1A']); // one row per round, no total across rounds
  });

  it('says so when no round has results', async () => {
    await expect(exportAllRounds('Annual audit', [rounds[2]], 'xlsx')).rejects.toThrow('No round has been compiled');
  });

  it('stops with the database’s refusal and downloads nothing', async () => {
    api.compileOverview.mockRejectedValueOnce(new Error('denied'));
    await expect(exportAllRounds('Annual audit', rounds, 'xlsx')).rejects.toThrow('denied');
    expect(files.list).toEqual([]);
  });
});

describe('barcode files', () => {
  const list = [
    {
      barcode: '590',
      product_code: 'A1',
      product_name: 'Alpha',
      barcode_type: 'ean13',
      status: 'verified',
      updated_at: '2026-11-17T09:00:00Z',
    },
    {
      barcode: '591',
      product_code: 'A2',
      product_name: 'Beta',
      barcode_type: 'unknown',
      status: 'unverified',
      updated_at: '2026-11-17T09:00:00Z',
    },
  ];
  beforeEach(() => {
    api.listBarcodesAll.mockResolvedValue(list);
    api.scanHistoryAll.mockResolvedValue([
      { scanned_at: '2026-11-17T08:00:00Z', user_name: 'Dee', scan_type: 'count', barcode: '590', result: 'matched' },
    ]);
  });

  it('master, verification and conflicts need only the list; the scan history is not asked for', async () => {
    await exportBarcodes('verification');
    expect(files.list[0].name).toBe('barcode-verification.csv');
    expect(files.list[0].text.trim().split('\r\n')).toHaveLength(2);
    expect(api.scanHistoryAll).not.toHaveBeenCalled();
  });

  it('scan history needs only the history', async () => {
    await exportBarcodes('history');
    expect(files.list[0].name).toBe('barcode-scan-history.csv');
    expect(api.listBarcodesAll).not.toHaveBeenCalled();
  });

  it('the workbook has all four sheets', async () => {
    await exportBarcodes('xlsx');
    expect(readWorkbook(files.list[0].bytes).map((s) => s.name)).toEqual(['Master', 'Verification', 'Conflicts', 'Scan history']);
  });
});
