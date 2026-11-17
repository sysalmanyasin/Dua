// Hand a file to the person: build it in memory and let the browser save it. Nothing is sent anywhere.
import { toCsv } from '../domain/csv.js';
import { toXlsx, XLSX_MIME } from '../domain/xlsx.js';

function save(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function downloadCsv(filename, table) {
  save(filename, new Blob([toCsv(table)], { type: 'text/csv;charset=utf-8' }));
}

/** @param {Array<{ name: string, table: Array<Array<unknown>> }>} sheets */
export function downloadXlsx(filename, sheets) {
  save(filename, new Blob([toXlsx(sheets)], { type: XLSX_MIME }));
}

/** inventory-ledger-never-sold-2026-11-14.xlsx */
export const stampAs = (name, ext, now = new Date()) => `inventory-${name}-${now.toISOString().slice(0, 10)}.${ext}`;

/** inventory-ledger-never-sold-2026-11-14.csv */
export const stamp = (name, now = new Date()) => stampAs(name, 'csv', now);
