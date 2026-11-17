// A small Excel (.xlsx) writer with no dependencies, so reports work offline and nothing extra is shipped to the phone.
// An .xlsx file is a zip of a few XML files; this stores them uncompressed (valid, and plenty small for a stock list).
//
//   toXlsx([{ name: 'Reorder', table: [header, ...rows], widths?: [..] }, ...])  ->  Uint8Array
//
// Rules that matter for a pharmacy list:
//   - Text is always written as text, never as a formula, so a product name that starts with = + - @ can never run
//     (the CSV writer needs an apostrophe guard for this; here the cell type does the job).
//   - Codes stay text (so 00123 keeps its zeros); numbers stay numbers (so Excel can sum and sort them).
//   - The header row is bold, frozen and has filter buttons.
//   - Unicode (Urdu names) is kept as is.

const enc = new TextEncoder();

// ── zip (store only) ──
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// 1 Jan 2026 00:00 in MS-DOS date/time form. A fixed stamp keeps the output identical for identical data.
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

/** @param {Array<{name: string, data: Uint8Array}>} files */
export function zipStore(files) {
  const parts = [];
  const central = [];
  let offset = 0;
  const u16 = (v) => [v & 0xff, (v >>> 8) & 0xff];
  const u32 = (v) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const size = f.data.length;
    // 0x0800: names are UTF-8
    const local = new Uint8Array([
      ...u32(0x04034b50),
      ...u16(20),
      ...u16(0x0800),
      ...u16(0),
      ...u16(DOS_TIME),
      ...u16(DOS_DATE),
      ...u32(crc),
      ...u32(size),
      ...u32(size),
      ...u16(name.length),
      ...u16(0),
    ]);
    parts.push(local, name, f.data);
    central.push(
      new Uint8Array([
        ...u32(0x02014b50),
        ...u16(20),
        ...u16(20),
        ...u16(0x0800),
        ...u16(0),
        ...u16(DOS_TIME),
        ...u16(DOS_DATE),
        ...u32(crc),
        ...u32(size),
        ...u32(size),
        ...u16(name.length),
        ...u16(0),
        ...u16(0),
        ...u16(0),
        ...u16(0),
        ...u32(0),
        ...u32(offset),
      ]),
      name,
    );
    offset += local.length + name.length + size;
  }
  const cdSize = central.reduce((s, p) => s + p.length, 0);
  const end = new Uint8Array([
    ...u32(0x06054b50),
    ...u16(0),
    ...u16(0),
    ...u16(files.length),
    ...u16(files.length),
    ...u32(cdSize),
    ...u32(offset),
    ...u16(0),
  ]);
  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0));
  let at = 0;
  for (const p of all) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

// ── xml helpers ──
// Characters XML 1.0 cannot hold are dropped; the five markup characters are escaped.
// eslint-disable-next-line no-control-regex -- matching these control characters is the point
const BAD_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g;
export const xmlText = (s) =>
  String(s).replace(BAD_XML, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** 0 -> A, 25 -> Z, 26 -> AA */
export function colName(i) {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/** Excel sheet names: at most 31 characters, none of [ ] : * ? / \, not empty, unique in the workbook. */
export function sheetName(raw, taken = new Set()) {
  let base =
    String(raw ?? '')
      .replace(/[[\]:*?/\\]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 31) || 'Sheet';
  let name = base;
  for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base.slice(0, 31 - String(n).length - 1)} ${n}`;
  taken.add(name.toLowerCase());
  return name;
}

// Style ids in styles.xml below: 0 normal, 1 header, 2 number
const S_HEADER = 1;
const S_NUMBER = 2;

function cell(ref, v, style) {
  if (v === null || v === undefined || v === '') return style === S_HEADER ? `<c r="${ref}" s="${S_HEADER}"/>` : '';
  if (typeof v === 'number') return Number.isFinite(v) ? `<c r="${ref}" s="${S_NUMBER}"><v>${v}</v></c>` : '';
  if (typeof v === 'boolean') return `<c r="${ref}" t="inlineStr"><is><t>${v ? 'yes' : 'no'}</t></is></c>`;
  const text = xmlText(v instanceof Date ? v.toISOString() : v);
  const s = style ? ` s="${style}"` : '';
  const keep = /^\s|\s$|\n/.test(text) ? ' xml:space="preserve"' : '';
  return `<c r="${ref}"${s} t="inlineStr"><is><t${keep}>${text}</t></is></c>`;
}

function widthsFor(table, given) {
  const cols = Math.max(0, ...table.map((r) => r.length));
  return Array.from({ length: cols }, (_, c) => {
    if (given?.[c]) return given[c];
    let w = 8;
    for (const row of table.slice(0, 500)) {
      const v = row[c];
      const len = typeof v === 'number' ? String(Math.round(v * 100) / 100).length + 2 : String(v ?? '').length;
      if (len > w) w = len;
    }
    return Math.min(60, w + 2);
  });
}

function sheetXml(table, widths) {
  const w = widthsFor(table, widths);
  const rows = table
    .map((row, r) => {
      const cells = row.map((v, c) => cell(`${colName(c)}${r + 1}`, v, r === 0 ? S_HEADER : 0)).join('');
      return cells ? `<row r="${r + 1}">${cells}</row>` : '';
    })
    .join('');
  const last = `${colName(Math.max(0, w.length - 1))}${Math.max(1, table.length)}`;
  const frozen =
    table.length > 1
      ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
      : '<sheetViews><sheetView workbookViewId="0"/></sheetViews>';
  const cols = w.length
    ? `<cols>${w.map((x, i) => `<col min="${i + 1}" max="${i + 1}" width="${x}" customWidth="1"/>`).join('')}</cols>`
    : '';
  const filter = table.length > 1 && w.length ? `<autoFilter ref="A1:${last}"/>` : '';
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `${frozen}${cols}<sheetData>${rows}</sheetData>${filter}</worksheet>`
  );
}

const STYLES =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.##"/></numFmts>' +
  '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
  '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FFE8EEF4"/><bgColor indexed="64"/></patternFill></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' +
  '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

/**
 * @param {Array<{ name: string, table: Array<Array<unknown>>, widths?: number[] }>} sheets first row of each table is its header
 * @returns {Uint8Array} the bytes of an .xlsx file
 */
export function toXlsx(sheets) {
  if (!Array.isArray(sheets) || sheets.length === 0) throw new Error('toXlsx needs at least one sheet');
  const taken = new Set();
  const named = sheets.map((s) => ({ ...s, name: sheetName(s.name, taken) }));
  const head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const files = [
    {
      name: '[Content_Types].xml',
      xml:
        `${head}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        named
          .map(
            (_, i) =>
              `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
          )
          .join('') +
        '</Types>',
    },
    {
      name: '_rels/.rels',
      xml:
        `${head}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    },
    {
      name: 'xl/workbook.xml',
      xml:
        `${head}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>` +
        named.map((s, i) => `<sheet name="${xmlText(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
        '</sheets></workbook>',
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      xml:
        `${head}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        named
          .map(
            (_, i) =>
              `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
          )
          .join('') +
        `<Relationship Id="rId${named.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    },
    { name: 'xl/styles.xml', xml: STYLES },
    ...named.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, xml: sheetXml(s.table ?? [], s.widths) })),
  ];
  return zipStore(files.map((f) => ({ name: f.name, data: enc.encode(f.xml) })));
}

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
