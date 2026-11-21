import { friendlyError } from './errors.js';

// Barcode rules that need no screen and no network: cleaning, check digits, when a camera read can be trusted, finding a barcode in
// the phone's copy of the list, and what a scan means for the items one counter was given. A scan only FINDS an item: it never
// adds a quantity, so counting stays deliberate (AUD-4) and a counter only ever sees their own assignment (AUD-5).

/** Same cleaning as the database (audit_barcode_clean): trimmed, no spaces, capitals. */
export const cleanBarcode = (text) =>
  String(text ?? '')
    .replace(/\s+/g, '')
    .toUpperCase();

/** The shape the database accepts. */
export const isValidBarcode = (code) => /^[A-Z0-9._-]{4,48}$/.test(code);

/** True when `digits` is an 8, 12, 13 or 14 digit GTIN whose last digit is the right check digit. */
export function gtinValid(digits) {
  if (!/^\d+$/.test(digits) || ![8, 12, 13, 14].includes(digits.length)) return false;
  const body = digits.slice(0, -1);
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    const d = Number(body[body.length - 1 - i]);
    sum += i % 2 === 0 ? d * 3 : d;
  }
  return (10 - (sum % 10)) % 10 === Number(digits.at(-1));
}

/** Names the two scanning engines use for the same symbology, mapped to the names the database stores. */
const FORMATS = {
  ean_13: 'ean13',
  'ean-13': 'ean13',
  ean13: 'ean13',
  ean_8: 'ean8',
  'ean-8': 'ean8',
  ean8: 'ean8',
  upc_a: 'upca',
  'upc-a': 'upca',
  upca: 'upca',
  upc_e: 'upce',
  'upc-e': 'upce',
  upce: 'upce',
  code_128: 'code128',
  code128: 'code128',
  'code-128': 'code128',
  code_39: 'code39',
  code39: 'code39',
  'code-39': 'code39',
  itf: 'itf',
  qr_code: 'qr',
  qrcode: 'qr',
  'qr-code': 'qr',
};
export const normalizeFormat = (name) => FORMATS[String(name ?? '').toLowerCase()] ?? 'other';

/** The type to store for a barcode. A format the engine named wins; otherwise guessed from the digits; otherwise unknown. */
export function guessType(code, engineFormat) {
  const f = normalizeFormat(engineFormat);
  if (engineFormat && f !== 'other') return f;
  if (gtinValid(code)) return { 13: 'ean13', 8: 'ean8', 12: 'upca', 14: 'other' }[code.length];
  return 'unknown';
}

/**
 * How many matching camera reads are needed before a code is believed. A retail number with a correct check digit is accepted on
 * the first read, because a misread almost never keeps a valid check digit. Everything else needs the same value twice.
 */
export function readsNeeded(code, engineFormat) {
  const f = normalizeFormat(engineFormat);
  const retail = ['ean13', 'ean8', 'upca', 'upce'].includes(f) || (f === 'other' && /^\d+$/.test(code));
  return retail && gtinValid(code) ? 1 : 2;
}

/**
 * Feeds camera reads in one at a time. Returns the code when it is trusted, otherwise null. After a code is accepted the same code
 * is ignored for `cooldownMs`, so holding the phone still does not count the same box repeatedly. Two reads must be within
 * `windowMs` of each other to count as matching.
 */
export function createReadGate({ windowMs = 1500, cooldownMs = 2500 } = {}) {
  let last = null;
  const accepted = new Map();
  return {
    push(raw, format, now = Date.now()) {
      const code = cleanBarcode(raw);
      if (!isValidBarcode(code)) return null;
      const doneAt = accepted.get(code);
      if (doneAt !== undefined && now - doneAt < cooldownMs) return null;
      const need = readsNeeded(code, format);
      let n = 1;
      if (last && last.code === code && now - last.at <= windowMs) n = last.n + 1;
      last = { code, n, at: now };
      if (n < need) return null;
      accepted.set(code, now);
      last = null;
      return { code, format: normalizeFormat(format) };
    },
    reset() {
      last = null;
      accepted.clear();
    },
  };
}

// ───────── the phone's copy of the list ─────────
/** Map from barcode to its row. Later rows replace earlier ones with the same barcode (a changed row arrives again in a delta). */
export const buildIndex = (rows) => new Map(rows.map((r) => [r.barcode, r]));

/** Adds a delta (changed rows) to an index and returns the cursor { since, after } to ask from next time. */
export function applyDelta(index, rows, cursor = { since: null, after: null }) {
  let next = cursor;
  for (const r of rows) {
    index.set(r.barcode, r);
    next = { since: r.updated_at, after: r.id };
  }
  return next;
}

/** The forms one number can be printed in: UPC-A is the same as EAN-13 with a leading 0, and GTIN-14 wraps either. */
export function variants(code) {
  const out = [code];
  if (/^\d+$/.test(code)) {
    if (code.length === 12) out.push(`0${code}`);
    if (code.length === 13 && code.startsWith('0')) out.push(code.slice(1));
    if (code.length === 14 && code.startsWith('0')) out.push(code.slice(1), code.slice(2));
  }
  return out;
}

/** The row for a scanned code, or null. Tries each printed form of the number. */
export function lookup(index, code) {
  for (const v of variants(cleanBarcode(code))) {
    const row = index.get(v);
    if (row) return row;
  }
  return null;
}

// ───────── what a scan means ─────────
const sameCode = (a, b) =>
  String(a ?? '')
    .trim()
    .toLowerCase() ===
  String(b ?? '')
    .trim()
    .toLowerCase();

/**
 * What a scan means for one counter's items. `row` comes from lookup (null when the barcode is unknown); `items` are the
 * counter's own items, so nothing outside their assignment is ever revealed.
 * @returns {{ result: 'matched'|'not_found'|'unverified'|'conflict'|'disabled'|'not_in_assignment'|'ambiguous', items: object[], row: object|null }}
 */
export function resolveScan(row, items) {
  if (!row) return { result: 'not_found', items: [], row: null };
  if (row.status !== 'verified') return { result: row.status, items: [], row };
  const hits = items.filter((it) => sameCode(it.code, row.product_code));
  if (hits.length === 0) return { result: 'not_in_assignment', items: [], row };
  return { result: hits.length === 1 ? 'matched' : 'ambiguous', items: hits, row };
}

/** One sentence for the person, by result. */
export function scanMessage({ result, items, row }, code) {
  const name = row?.product_name ? `${row.product_name} (${row.product_code})` : '';
  switch (result) {
    case 'matched':
      return `${items[0].name || items[0].code}: enter the quantity.`;
    case 'ambiguous':
      return `${items.length} items in your list share the code ${row.product_code}. Choose the right one.`;
    case 'not_in_assignment':
      return `${name} is not in the list given to you.`;
    case 'unverified':
      return `Barcode ${code} is not verified yet. Find the item by name instead, and ask a deputy to verify the barcode.`;
    case 'conflict':
      return `Barcode ${code} is in conflict between two products. Find the item by name, and tell a deputy.`;
    case 'disabled':
      return `Barcode ${code} was switched off. Find the item by name instead.`;
    default:
      return `Barcode ${code} is not in the barcode list. Find the item by name, and ask a deputy to register it.`;
  }
}

// ───────── scan events kept on the device until sent ─────────
/** One scan, as kept on the device. The id is made here, so a resend is recognised by the database and ignored. */
export function makeScanEvent({ barcode, type = 'lookup', result, assignmentId = null, code = null, now = new Date(), id }) {
  return {
    event_id: id ?? crypto.randomUUID(),
    group: 'scan',
    type,
    barcode: cleanBarcode(barcode),
    result,
    assignment_id: assignmentId,
    code: code ?? null,
    at: now.toISOString(),
  };
}

export const scanToWire = (e) => ({
  id: e.event_id,
  type: e.type,
  barcode: e.barcode,
  result: e.result,
  assignment: e.assignment_id,
  code: e.code,
  at: e.at,
});

/** How many scans one call may carry (the database accepts 200). */
export const SCAN_BATCH = 100;

/**
 * Sends the scans waiting on this device, oldest first. A batch the database answered is removed whatever it says about single
 * events: an event it rejected is unreadable and sending it again can never help, so it is counted and dropped. A failed call keeps
 * everything. Returns { sent, rejected, left, error }.
 */
export async function flushScans({ store, send, batchSize = SCAN_BATCH }) {
  let sent = 0;
  let rejected = 0;
  for (;;) {
    const batch = await store.take('scan', batchSize);
    if (batch.length === 0) return { sent, rejected, left: 0, error: null };
    let answer;
    try {
      answer = await send(batch.map(scanToWire));
    } catch (err) {
      return { sent, rejected, left: await store.count('scan'), error: friendlyError(err) };
    }
    await store.remove(batch.map((e) => e.event_id));
    sent += batch.length;
    rejected += Number(answer?.rejected ?? 0);
  }
}

/** Where to ask from for the next refresh: a few minutes before the newest row seen, so a change that committed late is not missed. */
export function refreshFrom(cursor, overlapMinutes = 5) {
  if (!cursor?.since) return { since: null, after: null };
  return { since: new Date(new Date(cursor.since).getTime() - overlapMinutes * 60000).toISOString(), after: null };
}
