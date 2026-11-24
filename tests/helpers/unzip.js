// A tiny reader for the stored zips the audit module writes, so tests can look inside a workbook. Not for use in the app.
import { inflateRawSync } from 'node:zlib';
import { crc32 } from '../../js/modules/audit/domain/xlsx.js';

export function unzip(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  while (end >= 0 && dv.getUint32(end, true) !== 0x06054b50) end--;
  if (end < 0) throw new Error('not a zip');
  const count = dv.getUint16(end + 10, true);
  let at = dv.getUint32(end + 16, true);
  const files = {};
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(at, true) !== 0x02014b50) throw new Error('bad central directory');
    const method = dv.getUint16(at + 10, true);
    const crc = dv.getUint32(at + 16, true);
    const packedSize = dv.getUint32(at + 20, true);
    const nameLen = dv.getUint16(at + 28, true);
    const extraLen = dv.getUint16(at + 30, true);
    const commentLen = dv.getUint16(at + 32, true);
    const local = dv.getUint32(at + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLen));
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    const body = bytes.subarray(start, start + packedSize);
    if (method !== 0 && method !== 8) throw new Error('unknown method');
    const data = method === 8 ? new Uint8Array(inflateRawSync(body)) : body;
    if (crc32(data) !== crc) throw new Error(`bad crc for ${name}`);
    files[name] = new TextDecoder().decode(data);
    at += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

/** The sheets of a workbook as { name, rows: [[cell, ...]] } (text and numbers), read from the XML. */
export function readWorkbook(bytes) {
  const files = unzip(bytes);
  const parse = (xml) => new DOMParser().parseFromString(xml, 'application/xml');
  const wb = parse(files['xl/workbook.xml']);
  return [...wb.getElementsByTagName('sheet')].map((s, i) => {
    const sheet = parse(files[`xl/worksheets/sheet${i + 1}.xml`]);
    const rows = [...sheet.getElementsByTagName('row')].map((row) =>
      [...row.getElementsByTagName('c')].map((c) => {
        const t = c.getElementsByTagName('t')[0];
        if (t) return t.textContent;
        const v = c.getElementsByTagName('v')[0];
        return v ? Number(v.textContent) : null;
      }),
    );
    return { name: s.getAttribute('name'), rows, xml: files[`xl/worksheets/sheet${i + 1}.xml`] };
  });
}
