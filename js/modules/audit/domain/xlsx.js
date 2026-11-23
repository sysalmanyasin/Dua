// Writes an Excel workbook (.xlsx) with no library: an .xlsx file is a zip of small XML files, and this writes it directly.
// Text goes in as plain text cells, never as a formula, so a product called "=1+1" stays a product name. Numbers go in as numbers.
// Pure: it returns the bytes; the caller hands them to the person. The zip is stored without compression, which every spreadsheet
// program reads, and the output is the same every time for the same input (the file dates are fixed).

const MAX_ROWS = 1048576; // the most rows a sheet can hold
const MAX_CELL_TEXT = 32767;
const MAX_NAME = 31;

// ── zip ──
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

const utf8 = new TextEncoder();

/** Squeezes bytes with deflate where the browser can (every current phone and desktop browser); null where it cannot. */
export async function deflateRaw(bytes) {
  if (typeof CompressionStream === 'undefined' || typeof Response === 'undefined') return null;
  try {
    const stream = new CompressionStream('deflate-raw');
    const writer = stream.writable.getWriter();
    writer.write(bytes).catch(() => {});
    writer.close().catch(() => {});
    return new Uint8Array(await new Response(stream.readable).arrayBuffer());
  } catch {
    return null;
  }
}

const u16 = (v) => [v & 0xff, (v >>> 8) & 0xff];
const u32 = (v) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];

/**
 * A zip of files: [{ name, data: Uint8Array, packed?: Uint8Array }] in, bytes out. A file with `packed` (its deflated bytes) is stored
 * compressed; one without is stored as it is. The file dates are fixed (1 January 1980), so the same input gives the same bytes.
 */
export function zipStore(files) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const name = utf8.encode(f.name);
    const crc = crc32(f.data);
    const size = f.data.length;
    const body = f.packed ?? f.data;
    const method = f.packed ? 8 : 0;
    const common = [
      ...u16(0x0800),
      ...u16(method),
      ...u16(0),
      ...u16(0x21),
      ...u32(crc),
      ...u32(body.length),
      ...u32(size),
      ...u16(name.length),
      ...u16(0),
    ];
    const header = [...u32(0x04034b50), ...u16(20), ...common];
    parts.push(Uint8Array.from(header), name, body);
    central.push(
      Uint8Array.from([...u32(0x02014b50), ...u16(20), ...u16(20), ...common, ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset)]),
      name,
    );
    offset += header.length + name.length + body.length;
  }
  const centralSize = central.reduce((t, p) => t + p.length, 0);
  const end = Uint8Array.from([
    ...u32(0x06054b50),
    ...u16(0),
    ...u16(0),
    ...u16(files.length),
    ...u16(files.length),
    ...u32(centralSize),
    ...u32(offset),
    ...u16(0),
  ]);
  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((t, p) => t + p.length, 0));
  let at = 0;
  for (const p of all) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

// ── XML text ──
// characters XML cannot hold at all (most control characters) are dropped
// eslint-disable-next-line no-control-regex
const BAD_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;
export const xmlText = (v) =>
  String(v ?? '')
    .replace(BAD_XML, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** A sheet name Excel accepts: no : \ / ? * [ ], at most 31 characters, not empty, not the reserved "History", and different from the others. */
export function sheetName(wanted, used = []) {
  let base = String(wanted ?? '')
    .replace(/[:\\/?*[\]]/g, '-')
    .replace(BAD_XML, '')
    .trim()
    .replace(/^'+|'+$/g, '')
    .trim();
  if (base === '' || base.toLowerCase() === 'history') base = base === '' ? 'Sheet' : 'History 1';
  const taken = new Set(used.map((n) => n.toLowerCase()));
  let name = base.slice(0, MAX_NAME).trim();
  for (let n = 2; taken.has(name.toLowerCase()); n++) {
    const tail = ` (${n})`;
    name = `${base.slice(0, MAX_NAME - tail.length).trim()}${tail}`;
  }
  return name;
}

const colName = (i) => {
  let n = i + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
};

// cell styles in styles.xml: 0 plain, 1 header, 2 money (#,##0.00), 3 whole number (#,##0)
const STYLE = { text: 0, header: 1, money: 2, int: 3, qty: 0 };

/**
 * One sheet. `columns` is [{ header, kind?, width? }] with kind 'text' (default), 'qty', 'money' or 'int'; `rows` is an array of arrays
 * of text, numbers or null. The first row is the header, frozen and filterable.
 */
function sheetXml({ columns, rows }) {
  if (rows.length + 1 > MAX_ROWS) throw new Error(`A sheet holds at most ${MAX_ROWS - 1} rows.`);
  const cell = (r, c, value, style) => {
    const ref = `${colName(c)}${r}`;
    if (value === null || value === undefined || value === '') return '';
    if (typeof value === 'number') return Number.isFinite(value) ? `<c r="${ref}" s="${style}"><v>${value}</v></c>` : '';
    return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlText(String(value).slice(0, MAX_CELL_TEXT))}</t></is></c>`;
  };
  const head = `<row r="1">${columns.map((col, c) => `<c r="${colName(c)}1" s="${STYLE.header}" t="inlineStr"><is><t xml:space="preserve">${xmlText(col.header)}</t></is></c>`).join('')}</row>`;
  const body = rows
    .map((row, i) => `<row r="${i + 2}">${columns.map((col, c) => cell(i + 2, c, row[c], STYLE[col.kind ?? 'text'] ?? 0)).join('')}</row>`)
    .join('');
  const last = `${colName(Math.max(0, columns.length - 1))}${rows.length + 1}`;
  const widths = columns.map((col, c) => `<col min="${c + 1}" max="${c + 1}" width="${col.width ?? 16}" customWidth="1"/>`).join('');
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<dimension ref="A1:${last}"/>` +
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    '<sheetFormatPr defaultRowHeight="15"/>' +
    `<cols>${widths}</cols>` +
    `<sheetData>${head}${body}</sheetData>` +
    `<autoFilter ref="A1:${last}"/>` +
    '</worksheet>'
  );
}

const STYLES_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
  '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FFE8EEF4"/><bgColor indexed="64"/></patternFill></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="4">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' +
  '<xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '</cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  '</styleSheet>';

/**
 * The workbook as bytes. `sheets` is [{ name, columns, rows }]. Names are made valid and unique here; the names used come back
 * in `names`, in order, so a caller can tell the person which sheet is which.
 */
export async function buildXlsx(sheets) {
  if (sheets.length === 0) throw new Error('A workbook needs at least one sheet.');
  const names = [];
  for (const s of sheets) names.push(sheetName(s.name, names));
  const enc = (text) => utf8.encode(text);
  const files = [
    {
      name: '[Content_Types].xml',
      data: enc(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="xml" ContentType="application/xml"/>' +
          '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
          '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
          sheets
            .map(
              (_, i) =>
                `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
            )
            .join('') +
          '</Types>',
      ),
    },
    {
      name: '_rels/.rels',
      data: enc(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
          '</Relationships>',
      ),
    },
    {
      name: 'xl/workbook.xml',
      data: enc(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
          `<sheets>${names.map((n, i) => `<sheet name="${xmlText(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>` +
          '</workbook>',
      ),
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: enc(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          sheets
            .map(
              (_, i) =>
                `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
            )
            .join('') +
          `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
          '</Relationships>',
      ),
    },
    { name: 'xl/styles.xml', data: enc(STYLES_XML) },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: enc(sheetXml(s)) })),
  ];
  // sheet text compresses very well; a file is kept as it is if squeezing does not make it smaller
  for (const f of files) {
    const packed = await deflateRaw(f.data);
    if (packed && packed.length < f.data.length) f.packed = packed;
  }
  return { bytes: zipStore(files), names };
}

export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
