// @vitest-environment jsdom
// The Excel workbook writer (js/modules/audit/domain/xlsx.js).
import { describe, expect, it } from 'vitest';
import { buildXlsx, crc32, sheetName, xmlText } from '../../js/modules/audit/domain/xlsx.js';
import { readWorkbook, unzip } from '../helpers/unzip.js';

const col = (header, kind, width) => ({ header, kind, width });

describe('the workbook file', () => {
  it('squeezes the sheets where the browser can, and the file still reads back the same', async () => {
    const rows = Array.from({ length: 500 }, (_, i) => [`Product ${i}`, i]);
    const sheets = [{ name: 'A', columns: [col('Name'), col('Qty', 'qty')], rows }];
    const { bytes } = await buildXlsx(sheets);
    expect(bytes.length).toBeLessThan(20000); // 500 rows are about 30 000 bytes of XML before squeezing
    expect(readWorkbook(bytes)[0].rows).toHaveLength(501);
  });

  it('is a zip that holds the parts a spreadsheet needs, each with a correct checksum', async () => {
    const { bytes } = await buildXlsx([{ name: 'A', columns: [col('x')], rows: [['y']] }]);
    expect([bytes[0], bytes[1]]).toEqual([0x50, 0x4b]); // "PK"
    const files = unzip(bytes); // throws on a bad checksum or directory
    expect(Object.keys(files).sort()).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/_rels/workbook.xml.rels',
      'xl/styles.xml',
      'xl/workbook.xml',
      'xl/worksheets/sheet1.xml',
    ]);
  });

  it('knows the standard checksum value', async () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('writes the same bytes every time for the same input', async () => {
    const sheets = [{ name: 'A', columns: [col('x')], rows: [['y'], [1]] }];
    expect((await buildXlsx(sheets)).bytes).toEqual((await buildXlsx(sheets)).bytes);
  });

  it('keeps text as text, numbers as numbers, and leaves empty cells out', async () => {
    const { bytes } = await buildXlsx([
      {
        name: 'A',
        columns: [col('Name'), col('Qty', 'qty'), col('Value', 'money'), col('N', 'int')],
        rows: [
          ['=1+1', 2.5, -301.5, 7],
          [null, null, '', Number.NaN],
        ],
      },
    ]);
    const [sheet] = readWorkbook(bytes);
    expect(sheet.rows[0]).toEqual(['Name', 'Qty', 'Value', 'N']);
    expect(sheet.rows[1]).toEqual(['=1+1', 2.5, -301.5, 7]);
    expect(sheet.rows[2]).toEqual([]);
    expect(sheet.xml).not.toContain('<f>'); // nothing is ever a formula
    expect(sheet.xml).toContain('t="inlineStr"');
  });

  it('escapes markup and drops characters XML cannot hold', async () => {
    expect(xmlText('Tom & "Jerry" <x>')).toBe('Tom &amp; &quot;Jerry&quot; &lt;x&gt;');
    expect(xmlText('a\u0000b\u0008c퟿d')).toBe('abc퟿d');
    const { bytes } = await buildXlsx([{ name: 'A', columns: [col('x')], rows: [['Tom & <b>\u0001é 中文']] }]);
    expect(readWorkbook(bytes)[0].rows[1][0]).toBe('Tom & <b>é 中文');
  });

  it('freezes and filters the header row and sets column widths', async () => {
    const { bytes } = await buildXlsx([
      {
        name: 'A',
        columns: [col('a', 'text', 30), col('b')],
        rows: [
          ['1', '2'],
          ['3', '4'],
        ],
      },
    ]);
    const xml = readWorkbook(bytes)[0].xml;
    expect(xml).toContain('state="frozen"');
    expect(xml).toContain('<autoFilter ref="A1:B3"/>');
    expect(xml).toContain('width="30"');
    expect(xml).toContain('<dimension ref="A1:B3"/>');
  });

  it('refuses a sheet over the row limit, and an empty workbook', async () => {
    await expect(buildXlsx([])).rejects.toThrow(/at least one sheet/);
    await expect(buildXlsx([{ name: 'A', columns: [col('x')], rows: { length: 1048576 } }])).rejects.toThrow(/at most/);
  });

  it('holds a sheet per round: 46 rounds plus Summary and Combined make 48', async () => {
    const sheets = [
      { name: 'Summary', columns: [col('x')], rows: [] },
      { name: 'Combined', columns: [col('x')], rows: [] },
    ];
    for (let i = 1; i <= 46; i++) sheets.push({ name: `Round ${i}`, columns: [col('x')], rows: [[i]] });
    const { bytes, names } = await buildXlsx(sheets);
    expect(names).toHaveLength(48);
    expect(new Set(names.map((n) => n.toLowerCase())).size).toBe(48);
    expect(readWorkbook(bytes)).toHaveLength(48);
  });
});

describe('sheet names', () => {
  it('replaces the characters Excel refuses and stops at 31 characters', async () => {
    expect(sheetName('A:B/C\\D?E*F[G]H')).toBe('A-B-C-D-E-F-G-H');
    expect(sheetName('x'.repeat(40))).toHaveLength(31);
  });

  it('is never empty, never "History", and never starts or ends with an apostrophe', async () => {
    expect(sheetName('')).toBe('Sheet');
    expect(sheetName('   ')).toBe('Sheet');
    expect(sheetName(null)).toBe('Sheet');
    expect(sheetName('History')).toBe('History 1');
    expect(sheetName("'Round'")).toBe('Round');
  });

  it('makes a repeat different, ignoring case, and still within 31 characters', async () => {
    expect(sheetName('Round 1', ['Round 1'])).toBe('Round 1 (2)');
    expect(sheetName('round 1', ['Round 1', 'Round 1 (2)'])).toBe('round 1 (3)');
    const long = 'y'.repeat(31);
    const second = sheetName(long, [long]);
    expect(second).toHaveLength(31);
    expect(second.endsWith(' (2)')).toBe(true);
  });
});
