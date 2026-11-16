// A small CSV writer. Values that start with = + - @ are prefixed with an apostrophe so a spreadsheet never runs them as a
// formula (a product name is data, not code). Quotes, commas and line breaks are escaped. A leading BOM keeps Urdu/Unicode
// names readable in Excel.
const guard = (s) => (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? "'" + s : s);

export function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = guard(typeof v === 'number' && !Number.isFinite(v) ? '' : String(v));
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** @param {Array<Array<unknown>>} table first row is the header */
export const toCsv = (table) => '\ufeff' + table.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
