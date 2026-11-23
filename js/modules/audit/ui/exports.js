// Gathers what a report file needs from the database, builds it with the pure helpers, and hands it to the person.
// Every read is one that the Review and Final pages already make, so who may export is who may see the results: the database decides.
import * as api from '../data/api.js';
import {
  barcodeConflictsTable,
  barcodeMasterTable,
  barcodeVerificationTable,
  combinedTable,
  conflictsTable,
  normalizeLine,
  notesTable,
  scanHistoryTable,
  summaryTable,
  tableCsv,
  varianceTable,
} from '../domain/export.js';
import { safeFileName } from '../domain/report.js';
import { XLSX_TYPE, buildXlsx } from '../domain/xlsx.js';
import { downloadBytes, downloadText } from './print.js';

const hasResults = (r) => r.state === 'compiled' || r.state === 'final';
export const exportable = (rounds) => rounds.filter(hasResults);

/** One round's lines, counters' notes and conflicts. `round` is { id, label, state, items } from the audit report. */
export async function loadRound(round) {
  const ov = await api.compileOverview(round.id);
  const comp = ov.compilation;
  if (!comp) return null;
  const names = new Map(ov.assignments.map((a) => [a.auditor_id, a.name]));
  const nameOf = (id) => names.get(id) ?? 'Someone';
  const raw = round.state === 'final' ? await api.finalLinesAll(round.id, true) : await api.compiledRowsAll(comp.id, 'diff');
  return {
    label: round.label,
    state: round.state,
    items: round.items,
    lines: raw.map((r) => normalizeLine(r, nameOf)),
    notes: (comp.auditor_notes ?? []).map((n) => ({ name: nameOf(n.auditor_id), note: n.note })),
    conflicts: ov.conflicts ?? [],
  };
}

const sendCsv = (name, table) => downloadText(name, tableCsv(table));
const sendWorkbook = async (name, tables) => {
  const { bytes } = await buildXlsx(tables);
  downloadBytes(name, bytes, XLSX_TYPE);
};

/** kind: 'variance' | 'notes' | 'conflicts' (CSV) or 'xlsx' (all three on sheets of one workbook). */
export async function exportRound(auditName, round, kind) {
  const data = await loadRound(round);
  if (!data) throw new Error('This round has not been compiled yet.');
  const base = `${auditName} round ${data.label}`;
  const tables = {
    variance: varianceTable(data.lines),
    notes: notesTable(data.notes),
    conflicts: conflictsTable(data.conflicts),
  };
  if (kind === 'xlsx') return await sendWorkbook(safeFileName(`${base} variance`, 'xlsx'), Object.values(tables));
  return sendCsv(
    safeFileName(`${base} ${kind === 'variance' ? 'variance' : kind === 'notes' ? 'auditor notes' : 'conflicts'}`, 'csv'),
    tables[kind],
  );
}

/** Every compiled or final round of an audit. kind: 'combined' | 'summary' (CSV) or 'xlsx'. Returns how many rounds were left out. */
export async function exportAllRounds(auditName, rounds, kind, onProgress = () => {}) {
  const ready = exportable(rounds);
  const loaded = [];
  for (const [i, r] of ready.entries()) {
    onProgress(`Reading round ${i + 1} of ${ready.length}…`);
    const data = await loadRound(r);
    if (data) loaded.push(data);
  }
  if (loaded.length === 0) throw new Error('No round has been compiled yet.');
  const base = `${auditName} all rounds`;
  if (kind === 'summary') sendCsv(safeFileName(`${base} summary`, 'csv'), summaryTable(loaded));
  else if (kind === 'combined') sendCsv(safeFileName(`${base} combined`, 'csv'), combinedTable(loaded));
  else {
    await sendWorkbook(safeFileName(base, 'xlsx'), [
      summaryTable(loaded),
      combinedTable(loaded),
      ...loaded.map((d) => varianceTable(d.lines, `Round ${d.label}`)),
    ]);
  }
  return rounds.length - loaded.length;
}

/** The barcode files. kind: 'master' | 'verification' | 'conflicts' | 'history' (CSV) or 'xlsx' (all four in one workbook). */
export async function exportBarcodes(kind, onProgress = () => {}) {
  const wantsList = kind !== 'history';
  const wantsHistory = kind === 'history' || kind === 'xlsx';
  onProgress('Reading the barcodes…');
  const list = wantsList || kind === 'xlsx' ? await api.listBarcodesAll('') : [];
  onProgress('Reading the scan history…');
  const history = wantsHistory ? await api.scanHistoryAll() : [];
  const tables = {
    master: barcodeMasterTable(list),
    verification: barcodeVerificationTable(list),
    conflicts: barcodeConflictsTable(list),
    history: scanHistoryTable(history),
  };
  if (kind === 'xlsx') return await sendWorkbook('barcodes.xlsx', Object.values(tables));
  const file = {
    master: 'barcode-master',
    verification: 'barcode-verification',
    conflicts: 'barcode-conflicts',
    history: 'barcode-scan-history',
  }[kind];
  return sendCsv(`${file}.csv`, tables[kind]);
}
