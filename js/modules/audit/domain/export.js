// The report files: the same tables become CSV or an Excel sheet. Pure: rows in, tables out, no network and no screen.
// Money is added up in whole paisa so a total here equals the Review screen to the paisa. Text that a spreadsheet could read as a
// formula is made safe in CSV (see report.js); in Excel text is never a formula, so it is written as it is.
import { toPaisa } from './count.js';
import { csvCell, csvText } from './report.js';

const CONFLICT = { a: 'kept this round', b: 'kept the earlier round' };
const rupee = (paisa) => paisa / 100;
const milli = (qty) => Math.round(Number(qty ?? 0) * 1000);

/**
 * One line in the shape every report uses. `raw` is a compiled row (counted_qty, auditor_id) or a final line (final_qty, auditor_name);
 * `nameOf` turns a counter's id into a name for compiled rows.
 */
export function normalizeLine(raw, nameOf = () => '') {
  const final = Object.hasOwn(raw, 'final_qty');
  return {
    company: raw.company ?? '',
    code: raw.code ?? '',
    name: raw.name ?? '',
    retail: raw.retail_price === null || raw.retail_price === undefined ? null : Number(raw.retail_price),
    system: Number(raw.system_qty ?? 0),
    counted: Number((final ? raw.final_qty : raw.counted_qty) ?? 0),
    variance: Number(raw.variance ?? 0),
    value: Number(raw.variance_value ?? 0),
    counter: final ? (raw.auditor_name ?? '') : raw.auditor_id ? nameOf(raw.auditor_id) : '',
    notCounted: Boolean(raw.missing && !raw.auto_matched),
    assumed: Boolean(raw.auto_matched),
    corrected: Boolean(raw.corrected_by),
    conflict: raw.conflict_side ? (CONFLICT[raw.conflict_side] ?? '') : '',
    note: raw.note ?? '',
  };
}

const yes = (v) => (v ? 'yes' : '');
const LINE_COLUMNS = [
  { header: 'Code', width: 14 },
  { header: 'Product', width: 36 },
  { header: 'Company', width: 22 },
  { header: 'Retail price', kind: 'money', width: 13 },
  { header: 'System quantity', kind: 'qty', width: 15 },
  { header: 'Counted quantity', kind: 'qty', width: 16 },
  { header: 'Variance', kind: 'qty', width: 11 },
  { header: 'Variance value', kind: 'money', width: 15 },
  { header: 'Counter', width: 20 },
  { header: 'Not counted', width: 12 },
  { header: 'Assumed to match', width: 17 },
  { header: 'Corrected', width: 10 },
  { header: 'Conflict', width: 22 },
  { header: 'Note', width: 30 },
];
const lineCells = (l) => [
  l.code,
  l.name,
  l.company,
  l.retail,
  l.system,
  l.counted,
  l.variance,
  l.value,
  l.counter,
  yes(l.notCounted),
  yes(l.assumed),
  yes(l.corrected),
  l.conflict,
  l.note,
];

/** The variance report of one round: every line that differs. */
export const varianceTable = (lines, name = 'Variance') => ({ name, columns: LINE_COLUMNS, rows: lines.map((l) => lineCells(l)) });

/** What the counters wrote in their notes, one row each. */
export const notesTable = (notes, name = 'Auditor Notes') => ({
  name,
  columns: [
    { header: 'Counter', width: 24 },
    { header: 'Note', width: 80 },
  ],
  rows: notes.map((n) => [n.name, n.note]),
});

/** Items whose count differed between two rounds, and which one was kept. */
export const conflictsTable = (conflicts, name = 'Conflicts') => ({
  name,
  columns: [
    { header: 'Code', width: 14 },
    { header: 'Product', width: 36 },
    { header: 'Company', width: 22 },
    { header: 'Later round', width: 12 },
    { header: 'Later quantity', kind: 'qty', width: 15 },
    { header: 'Later counter', width: 20 },
    { header: 'Earlier round', width: 14 },
    { header: 'Earlier quantity', kind: 'qty', width: 16 },
    { header: 'Earlier counter', width: 20 },
    { header: 'Kept', width: 22 },
    { header: 'Reason', width: 40 },
    { header: 'Settled by', width: 20 },
  ],
  rows: conflicts.map((k) => [
    k.code,
    k.name,
    k.company,
    k.a_round,
    Number(k.a_qty),
    k.a_name ?? '',
    k.b_round,
    Number(k.b_qty),
    k.b_name ?? '',
    k.resolved_side ? `Round ${k.resolved_side === 'a' ? k.a_round : k.b_round}` : 'Not settled yet',
    k.resolved_reason ?? '',
    k.resolved_by ?? '',
  ]),
});

/** Every round's differing lines in one table, with the round named on each line. */
export const combinedTable = (rounds, name = 'Combined') => ({
  name,
  columns: [{ header: 'Round', width: 10 }, ...LINE_COLUMNS],
  rows: rounds.flatMap((r) => r.lines.map((l) => [r.label, ...lineCells(l)])),
});

/** One row per round: how many lines differ and what they come to, in whole paisa so it matches the Review screen. */
export function roundTotals(lines) {
  const paisa = lines.reduce((t, l) => t + toPaisa(l.value), 0);
  const qty = lines.reduce((t, l) => t + milli(l.variance), 0);
  return {
    lines: lines.length,
    quantity: qty / 1000,
    paisa,
    value: rupee(paisa),
    notCounted: lines.filter((l) => l.notCounted).length,
    assumed: lines.filter((l) => l.assumed).length,
    corrected: lines.filter((l) => l.corrected).length,
  };
}

export const summaryTable = (rounds, name = 'Summary') => {
  const rows = rounds.map((r) => {
    const t = roundTotals(r.lines);
    return [r.label, r.state, r.items, t.lines, t.quantity, t.value, t.notCounted, t.assumed, t.corrected];
  });
  const all = roundTotals(rounds.flatMap((r) => r.lines));
  rows.push([
    'All rounds',
    '',
    rounds.reduce((n, r) => n + Number(r.items ?? 0), 0),
    all.lines,
    all.quantity,
    all.value,
    all.notCounted,
    all.assumed,
    all.corrected,
  ]);
  return {
    name,
    columns: [
      { header: 'Round', width: 12 },
      { header: 'State', width: 12 },
      { header: 'Items in round', kind: 'int', width: 15 },
      { header: 'Lines that differ', kind: 'int', width: 17 },
      { header: 'Net quantity difference', kind: 'qty', width: 22 },
      { header: 'Net value difference', kind: 'money', width: 20 },
      { header: 'Not counted', kind: 'int', width: 12 },
      { header: 'Assumed to match', kind: 'int', width: 17 },
      { header: 'Corrected', kind: 'int', width: 10 },
    ],
    rows,
  };
};

// ── barcode files ──
const BARCODE_STATUS = { unverified: 'Not verified yet', verified: 'Verified', conflict: 'In conflict', disabled: 'Switched off' };
const when = (iso) =>
  iso
    ? String(iso)
        .replace('T', ' ')
        .replace(/\.\d+/, '')
        .replace(/(\+00:00|Z)$/, ' UTC')
    : '';

export const barcodeMasterTable = (rows, name = 'Master') => ({
  name,
  columns: [
    { header: 'Barcode', width: 18 },
    { header: 'Product code', width: 14 },
    { header: 'Product', width: 36 },
    { header: 'Type', width: 10 },
    { header: 'Status', width: 16 },
    { header: 'Registered by', width: 20 },
    { header: 'Verified by', width: 20 },
    { header: 'Verified at', width: 22 },
    { header: 'Notes', width: 30 },
    { header: 'Last changed', width: 22 },
  ],
  rows: rows.map((r) => [
    r.barcode,
    r.product_code,
    r.product_name,
    r.barcode_type,
    BARCODE_STATUS[r.status] ?? r.status,
    r.registered_by_name ?? '',
    r.verified_by_name ?? '',
    when(r.verified_at),
    r.notes ?? '',
    when(r.updated_at),
  ]),
});

/** The barcodes still waiting for someone to check them. */
export const barcodeVerificationTable = (rows, name = 'Verification') =>
  barcodeMasterTable(
    rows.filter((r) => r.status === 'unverified'),
    name,
  );

export const barcodeConflictsTable = (rows, name = 'Conflicts') => ({
  name,
  columns: [
    { header: 'Barcode', width: 18 },
    { header: 'Held by code', width: 14 },
    { header: 'Held by product', width: 36 },
    { header: 'Also claimed by code', width: 20 },
    { header: 'Also claimed by product', width: 36 },
    { header: 'Note', width: 36 },
    { header: 'Last changed', width: 22 },
  ],
  rows: rows
    .filter((r) => r.status === 'conflict')
    .map((r) => [
      r.barcode,
      r.product_code,
      r.product_name,
      r.conflict_product_code ?? '',
      r.conflict_product_name ?? '',
      r.conflict_note ?? '',
      when(r.updated_at),
    ]),
});

export const scanHistoryTable = (rows, name = 'Scan history') => ({
  name,
  columns: [
    { header: 'When', width: 22 },
    { header: 'Person', width: 22 },
    { header: 'Kind', width: 12 },
    { header: 'Barcode', width: 18 },
    { header: 'Product code', width: 14 },
    { header: 'Result', width: 18 },
  ],
  rows: rows.map((r) => [when(r.scanned_at), r.user_name ?? '', r.scan_type, r.barcode, r.product_code ?? '', r.result]),
});

// ── CSV ──
const cellCsv = (value, kind) => {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'number') return Number.isFinite(value) ? (kind === 'money' ? value.toFixed(2) : String(value)) : '';
  return csvCell(csvText(value));
};

/** A table as CSV text: header row first, CRLF line ends (the caller adds the byte-order mark so Excel reads UTF-8). */
export function tableCsv(table) {
  const head = table.columns.map((c) => csvCell(c.header)).join(',');
  const rows = table.rows.map((row) => table.columns.map((c, i) => cellCsv(row[i], c.kind)).join(','));
  return [head, ...rows].join('\r\n') + '\r\n';
}
