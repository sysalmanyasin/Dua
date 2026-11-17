// One place that turns a report table into a CSV, Excel or PDF (print) file, so the screens only say what the table is.
import { downloadCsv, downloadXlsx, stamp, stampAs } from './download.js';
import { dayTime } from './fmt.js';
import { printReport } from './print.js';

export const KINDS = ['csv', 'xlsx', 'pdf'];

/**
 * @param {'csv'|'xlsx'|'pdf'} kind
 * @param {{ name: string, title: string, filters?: string, asOf?: string|null, table: Array<Array<unknown>>, now?: Date }} report
 *   name: file name stem; title: heading and sheet name; filters: the settings the list was made with;
 *   asOf: when the stock data was last synced (ISO); table: header row first.
 */
export function exportReport(kind, { name, title, filters = '', asOf = null, table, now = new Date() }) {
  if (!KINDS.includes(kind)) throw new Error(`Unknown export kind: ${kind}`);
  if (kind === 'csv') return downloadCsv(stamp(name, now), table);
  const [head, ...rows] = table;
  const fresh = asOf ? `Stock data as of ${dayTime(asOf)}` : '';
  if (kind === 'xlsx') {
    const about = [
      ['Item', 'Value'],
      ['Report', title],
      ['Created', dayTime(now.toISOString())],
      ['Stock data as of', asOf ? dayTime(asOf) : 'unknown'],
      ['Settings', filters || 'none'],
      ['Rows', rows.length],
      ['Source', 'Candela export, updated hourly'],
    ];
    return downloadXlsx(stampAs(name, 'xlsx', now), [
      { name: title, table },
      { name: 'About', table: about },
    ]);
  }
  return printReport({ title, subtitle: [fresh, filters].filter(Boolean).join(' · '), head, rows });
}
