// @vitest-environment jsdom
import { crc32 as nodeCrc32 } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { colName, crc32, sheetName, toXlsx, xmlText, zipStore } from '../../js/modules/inventory/domain/xlsx.js';

// A tiny reader for stored (uncompressed) zips, written separately from the writer so the two check each other.
function readZip(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const dec = new TextDecoder();
  let end = bytes.length - 22;
  expect(dv.getUint32(end, true)).toBe(0x06054b50);
  const count = dv.getUint16(end + 10, true);
  let at = dv.getUint32(end + 16, true);
  const files = {};
  for (let i = 0; i < count; i++) {
    expect(dv.getUint32(at, true)).toBe(0x02014b50);
    const crc = dv.getUint32(at + 16, true);
    const size = dv.getUint32(at + 20, true);
    const nameLen = dv.getUint16(at + 28, true);
    const offset = dv.getUint32(at + 42, true);
    const name = dec.decode(bytes.subarray(at + 46, at + 46 + nameLen));
    expect(dv.getUint32(offset, true)).toBe(0x04034b50);
    const dataAt = offset + 30 + dv.getUint16(offset + 26, true) + dv.getUint16(offset + 28, true);
    const data = bytes.subarray(dataAt, dataAt + size);
    expect(nodeCrc32(data) >>> 0).toBe(crc);
    files[name] = dec.decode(data);
    at += 46 + nameLen;
  }
  return files;
}

describe('zip writer', () => {
  it('crc32 agrees with the platform implementation', () => {
    const data = new TextEncoder().encode('The quick brown fox, پیراسیٹامول 0123456789');
    expect(crc32(data)).toBe(nodeCrc32(data) >>> 0);
    expect(crc32(new Uint8Array(0))).toBe(0);
  });
  it('stores files that a reader finds again, with correct sizes and checksums', () => {
    const enc = new TextEncoder();
    const out = readZip(
      zipStore([
        { name: 'a.txt', data: enc.encode('hello') },
        { name: 'dir/b.txt', data: enc.encode('') },
        { name: 'ü.txt', data: enc.encode('x'.repeat(70000)) },
      ]),
    );
    expect(Object.keys(out)).toEqual(['a.txt', 'dir/b.txt', 'ü.txt']);
    expect(out['a.txt']).toBe('hello');
    expect(out['ü.txt'].length).toBe(70000);
  });
});

describe('helpers', () => {
  it('names columns like a spreadsheet', () => {
    expect([0, 1, 25, 26, 27, 51, 52, 701, 702].map(colName)).toEqual(['A', 'B', 'Z', 'AA', 'AB', 'AZ', 'BA', 'ZZ', 'AAA']);
  });
  it('escapes markup and drops characters XML cannot hold', () => {
    expect(xmlText('a & b <c> "d"')).toBe('a &amp; b &lt;c&gt; &quot;d&quot;');
    expect(xmlText('ok\u0000\u0001\u000b\uFFFEdone')).toBe('okdone');
    expect(xmlText('tab\tnewline\nkept')).toBe('tab\tnewline\nkept');
  });
  it('makes legal, unique sheet names of at most 31 characters', () => {
    const taken = new Set();
    expect(sheetName('Reorder: 30/60?', taken)).toBe('Reorder 30 60');
    expect(sheetName('reorder 30 60', taken)).toBe('reorder 30 60 2');
    expect(sheetName('', taken)).toBe('Sheet');
    expect(sheetName('x'.repeat(50)).length).toBe(31);
    expect(sheetName('[bad]*name\\', new Set())).toBe('bad name');
  });
});

describe('toXlsx', () => {
  const table = [
    ['Code', 'Name', 'Stock', 'Price'],
    ['00123', '=HYPERLINK("http://x","hi")', 12, 45.5],
    ['A2', 'پیراسیٹامول  ', 0, -3],
    ['A3', 'a & b <c>', 1e6, null],
    ['A4', 'line\nbreak', Number.NaN, ''],
  ];
  const files = readZip(
    toXlsx([
      { name: 'Reorder', table },
      {
        name: 'About',
        table: [
          ['Item', 'Value'],
          ['Rows', 4],
        ],
      },
    ]),
  );

  it('contains the parts of a workbook, one worksheet per sheet', () => {
    expect(Object.keys(files)).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/workbook.xml',
      'xl/_rels/workbook.xml.rels',
      'xl/styles.xml',
      'xl/worksheets/sheet1.xml',
      'xl/worksheets/sheet2.xml',
    ]);
    expect(files['xl/workbook.xml']).toContain('<sheet name="Reorder" sheetId="1" r:id="rId1"/>');
    expect(files['xl/workbook.xml']).toContain('<sheet name="About" sheetId="2" r:id="rId2"/>');
    expect(files['xl/_rels/workbook.xml.rels']).toContain('Target="styles.xml"');
  });
  it('every file is well-formed XML', () => {
    for (const [name, text] of Object.entries(files)) {
      const doc = new DOMParser().parseFromString(text, 'application/xml');
      expect(doc.querySelector('parsererror'), name).toBeNull();
    }
  });
  it('keeps text as text: a product name that looks like a formula never becomes one', () => {
    const s = files['xl/worksheets/sheet1.xml'];
    expect(s).not.toContain('<f>');
    expect(s).toContain('<c r="B2" t="inlineStr"><is><t>=HYPERLINK(&quot;http://x&quot;,&quot;hi&quot;)</t></is></c>');
  });
  it('keeps codes as text and numbers as numbers', () => {
    const s = files['xl/worksheets/sheet1.xml'];
    expect(s).toContain('<c r="A2" t="inlineStr"><is><t>00123</t></is></c>');
    expect(s).toContain('<c r="C2" s="2"><v>12</v></c>');
    expect(s).toContain('<c r="D3" s="2"><v>-3</v></c>');
    expect(s).toContain('<c r="C4" s="2"><v>1000000</v></c>');
  });
  it('leaves empty, null and non-finite values blank', () => {
    const s = files['xl/worksheets/sheet1.xml'];
    expect(s).not.toContain('r="D4"');
    expect(s).not.toContain('r="C5"');
    expect(s).not.toContain('r="D5"');
    expect(s).not.toContain('NaN');
  });
  it('preserves spaces and Unicode', () => {
    const s = files['xl/worksheets/sheet1.xml'];
    expect(s).toContain('<t xml:space="preserve">پیراسیٹامول  </t>');
    expect(s).toContain('<t xml:space="preserve">line\nbreak</t>');
  });
  it('styles and freezes the header and adds filter buttons over the data', () => {
    const s = files['xl/worksheets/sheet1.xml'];
    expect(s).toContain('<c r="A1" s="1" t="inlineStr">');
    expect(s).toContain('<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>');
    expect(s).toContain('<autoFilter ref="A1:D5"/>');
    expect(s).toMatch(/<cols>(<col min="\d+" max="\d+" width="[\d.]+" customWidth="1"\/>){4}<\/cols>/);
  });
  it('a header-only sheet has no filter and no frozen pane', () => {
    const only = readZip(toXlsx([{ name: 'Empty', table: [['A', 'B']] }]));
    expect(only['xl/worksheets/sheet1.xml']).not.toContain('autoFilter');
    expect(only['xl/worksheets/sheet1.xml']).not.toContain('pane');
  });
  it('gives the same bytes for the same data', () => {
    const a = toXlsx([{ name: 'x', table }]);
    const b = toXlsx([{ name: 'x', table }]);
    expect(Array.from(a)).toEqual(Array.from(b));
  });
  it('handles a few thousand rows', () => {
    const big = [['Code', 'Name', 'Stock'], ...Array.from({ length: 6000 }, (_, i) => [`C${i}`, `Item ${i}`, i])];
    const out = readZip(toXlsx([{ name: 'Big', table: big }]));
    expect(out['xl/worksheets/sheet1.xml']).toContain('<row r="6001">');
  });
  it('refuses to write a workbook with no sheets', () => {
    expect(() => toXlsx([])).toThrow();
    expect(() => toXlsx(null)).toThrow();
  });
});
