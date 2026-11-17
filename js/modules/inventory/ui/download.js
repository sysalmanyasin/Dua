// Hand a CSV file to the person: build it in memory and let the browser save it. Nothing is sent anywhere.
import { toCsv } from '../domain/csv.js';

export function downloadCsv(filename, table) {
  const url = URL.createObjectURL(new Blob([toCsv(table)], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** inventory-ledger-never-sold-2026-11-14.csv */
export const stamp = (name, now = new Date()) => `inventory-${name}-${now.toISOString().slice(0, 10)}.csv`;
