// Barcode rules with no screen: cleaning, check digits, when a camera read is trusted, lookup, and what a scan means.
import { describe, expect, it, vi } from 'vitest';
import {
  applyDelta,
  buildIndex,
  cleanBarcode,
  createReadGate,
  flushScans,
  gtinValid,
  guessType,
  isValidBarcode,
  lookup,
  makeScanEvent,
  normalizeFormat,
  readsNeeded,
  refreshFrom,
  resolveScan,
  scanMessage,
  scanToWire,
  variants,
} from '../../js/modules/audit/domain/barcode.js';

describe('cleaning and shape', () => {
  it('cleans like the database: no spaces, capitals', () => {
    expect(cleanBarcode(' 5901234 123457\n')).toBe('5901234123457');
    expect(cleanBarcode('ab-12 cd')).toBe('AB-12CD');
    expect(cleanBarcode(null)).toBe('');
  });
  it('accepts 4 to 48 letters, digits, dot, dash and underscore', () => {
    expect(isValidBarcode('ABCD')).toBe(true);
    expect(isValidBarcode('ABC')).toBe(false);
    expect(isValidBarcode('A'.repeat(48))).toBe(true);
    expect(isValidBarcode('A'.repeat(49))).toBe(false);
    expect(isValidBarcode('AB$D')).toBe(false);
    expect(isValidBarcode('ab-cd')).toBe(false); // cleaning comes first
  });
});

describe('check digits', () => {
  it.each(['5901234123457', '4006381333931', '036000291452', '96385074', '00012345600012'])('%s is a valid GTIN', (code) => {
    expect(gtinValid(code)).toBe(true);
  });
  it.each(['5901234123458', '4006381333932', '036000291453', '96385075', '123', 'ABC123456789', '590123412345'])('%s is not', (code) => {
    expect(gtinValid(code)).toBe(false);
  });
});

describe('formats and types', () => {
  it("maps both engines' names to the stored ones", () => {
    expect(normalizeFormat('ean_13')).toBe('ean13');
    expect(normalizeFormat('EAN-13')).toBe('ean13');
    expect(normalizeFormat('Code128')).toBe('code128');
    expect(normalizeFormat('QRCode')).toBe('qr');
    expect(normalizeFormat('DataBar')).toBe('other');
    expect(normalizeFormat(undefined)).toBe('other');
  });
  it('guesses the type from the engine, else from valid digits, else unknown', () => {
    expect(guessType('X', 'code_128')).toBe('code128');
    expect(guessType('5901234123457')).toBe('ean13');
    expect(guessType('96385074')).toBe('ean8');
    expect(guessType('036000291452')).toBe('upca');
    expect(guessType('ABC-123')).toBe('unknown');
    expect(guessType('5901234123458', 'manual')).toBe('unknown');
  });
});

describe('how many reads are needed', () => {
  it('one read for a retail number with a correct check digit', () => {
    expect(readsNeeded('5901234123457', 'ean_13')).toBe(1);
    expect(readsNeeded('5901234123457', 'unknown')).toBe(1);
  });
  it('two reads for a wrong check digit, and for every other symbology', () => {
    expect(readsNeeded('5901234123458', 'ean_13')).toBe(2);
    expect(readsNeeded('ABC12345', 'code_128')).toBe(2);
    expect(readsNeeded('5901234123457', 'qr_code')).toBe(2);
  });
});

describe('the read gate', () => {
  it('accepts a valid retail number at once', () => {
    const g = createReadGate();
    expect(g.push('5901234123457', 'ean_13', 0)).toEqual({ code: '5901234123457', format: 'ean13' });
  });
  it('needs the same Code 128 value twice within the window', () => {
    const g = createReadGate({ windowMs: 1000 });
    expect(g.push('ABC12345', 'code_128', 0)).toBeNull();
    expect(g.push('ABC12345', 'code_128', 500)).toEqual({ code: 'ABC12345', format: 'code128' });
  });
  it('does not join two reads that are too far apart, or different values', () => {
    const g = createReadGate({ windowMs: 1000 });
    g.push('ABC12345', 'code_128', 0);
    expect(g.push('ABC12345', 'code_128', 2500)).toBeNull();
    expect(g.push('XYZ98765', 'code_128', 2600)).toBeNull();
    expect(g.push('ABC12345', 'code_128', 2700)).toBeNull();
  });
  it('ignores the same code for a while after accepting it, then accepts it again', () => {
    const g = createReadGate({ cooldownMs: 2000 });
    expect(g.push('5901234123457', 'ean_13', 0)).not.toBeNull();
    expect(g.push('5901234123457', 'ean_13', 500)).toBeNull();
    expect(g.push('5901234123457', 'ean_13', 2500)).not.toBeNull();
  });
  it('rejects text that is not a barcode shape and a misread number', () => {
    const g = createReadGate();
    expect(g.push('no', 'ean_13', 0)).toBeNull();
    expect(g.push('<script>', 'qr_code', 0)).toBeNull();
    expect(g.push('5901234123458', 'ean_13', 0)).toBeNull(); // wrong check digit: needs a second matching read
  });
});

describe("the phone's copy of the list", () => {
  const row = (barcode, product_code, status = 'verified', updated_at = '2026-11-19T10:00:00Z') => ({
    id: `id-${barcode}`,
    barcode,
    product_code,
    product_name: `Name ${product_code}`,
    status,
    conflict_product_code: null,
    updated_at,
  });
  it('finds a number printed as UPC-A or EAN-13, and a GTIN-14 wrapper', () => {
    expect(variants('036000291452')).toEqual(['036000291452', '0036000291452']);
    expect(variants('0036000291452')).toEqual(['0036000291452', '036000291452']);
    expect(variants('00036000291452')).toEqual(['00036000291452', '0036000291452', '036000291452']);
    expect(variants('ABC12345')).toEqual(['ABC12345']);
    const index = buildIndex([row('0036000291452', 'A1')]);
    expect(lookup(index, '036000291452').product_code).toBe('A1');
    expect(lookup(index, ' 0036000291452 ').product_code).toBe('A1');
    expect(lookup(index, '999999999999')).toBeNull();
  });
  it('applies a delta and moves the cursor to the newest row', () => {
    const index = buildIndex([row('11111111', 'A1')]);
    const cursor = applyDelta(index, [
      row('11111111', 'A2', 'verified', '2026-11-19T11:00:00Z'),
      row('22222222', 'B1', 'verified', '2026-11-19T12:00:00Z'),
    ]);
    expect(index.get('11111111').product_code).toBe('A2');
    expect(index.size).toBe(2);
    expect(cursor).toEqual({ since: '2026-11-19T12:00:00Z', after: 'id-22222222' });
    expect(applyDelta(index, [], cursor)).toEqual(cursor);
  });
  it('asks again from a few minutes before the newest row', () => {
    expect(refreshFrom({ since: '2026-11-19T12:00:00.000Z' })).toEqual({ since: '2026-11-19T11:55:00.000Z', after: null });
    expect(refreshFrom(null)).toEqual({ since: null, after: null });
    expect(refreshFrom({ since: null })).toEqual({ since: null, after: null });
  });
});

describe("what a scan means for a counter's own items", () => {
  const items = [
    { round_item_id: 'i1', code: 'A1', name: 'Alpha one', company: 'Acme' },
    { round_item_id: 'i2', code: 'B1', name: 'Beta one', company: 'Beta' },
    { round_item_id: 'i3', code: 'b1 ', name: 'Beta one (second pack)', company: 'Beta' },
  ];
  const row = (status, code = 'A1') => ({
    id: 'x',
    barcode: '123456',
    product_code: code,
    product_name: `Name ${code}`,
    status,
    conflict_product_code: 'Z9',
  });
  it('unknown barcode', () => {
    expect(resolveScan(null, items)).toEqual({ result: 'not_found', items: [], row: null });
  });
  it('anything but verified is never matched, and reveals no item', () => {
    for (const st of ['unverified', 'conflict', 'disabled']) {
      const r = resolveScan(row(st), items);
      expect(r.result).toBe(st);
      expect(r.items).toEqual([]);
    }
  });
  it('verified and in the list: one match', () => {
    const r = resolveScan(row('verified'), items);
    expect(r.result).toBe('matched');
    expect(r.items.map((i) => i.round_item_id)).toEqual(['i1']);
  });
  it("verified but not in this counter's list: says so, shows the product name only", () => {
    const r = resolveScan(row('verified', 'C1'), items);
    expect(r.result).toBe('not_in_assignment');
    expect(r.items).toEqual([]);
  });
  it('the same code on two items is ambiguous: the counter chooses, nothing is guessed', () => {
    const r = resolveScan(row('verified', 'B1'), items);
    expect(r.result).toBe('ambiguous');
    expect(r.items.map((i) => i.round_item_id)).toEqual(['i2', 'i3']);
  });
  it('has a plain sentence for every outcome', () => {
    const out = (r, code = '123456') => scanMessage(r, code);
    expect(out(resolveScan(row('verified'), items))).toMatch(/Alpha one: enter the quantity/);
    expect(out(resolveScan(row('verified', 'B1'), items))).toMatch(/2 items in your list share the code B1/);
    expect(out(resolveScan(row('verified', 'C1'), items))).toMatch(/Name C1 \(C1\) is not in the list given to you/);
    expect(out(resolveScan(row('unverified'), items))).toMatch(/not verified yet/);
    expect(out(resolveScan(row('conflict'), items))).toMatch(/in conflict/);
    expect(out(resolveScan(row('disabled'), items))).toMatch(/switched off/);
    expect(out(resolveScan(null, items))).toMatch(/not in the barcode list/);
  });
});

describe('scan events and sending', () => {
  it('makes an event with its own id, a cleaned barcode and a time', () => {
    const e = makeScanEvent({
      barcode: ' 590 123',
      result: 'matched',
      assignmentId: 'a1',
      code: 'A1',
      now: new Date('2026-11-19T10:00:00Z'),
    });
    expect(e.barcode).toBe('590123');
    expect(e.at).toBe('2026-11-19T10:00:00.000Z');
    expect(e.event_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(makeScanEvent({ barcode: 'X1234', result: 'not_found' }).event_id).not.toBe(e.event_id);
    expect(scanToWire(e)).toEqual({
      id: e.event_id,
      type: 'lookup',
      barcode: '590123',
      result: 'matched',
      assignment: 'a1',
      code: 'A1',
      at: e.at,
    });
  });
  const fakeStore = (events) => ({
    take: async (_g, n) => events.slice(0, n),
    remove: async (ids) =>
      ids.forEach((id) =>
        events.splice(
          events.findIndex((e) => e.event_id === id),
          1,
        ),
      ),
    count: async () => events.length,
  });
  const ev = (n) => makeScanEvent({ barcode: `CODE${1000 + n}`, result: 'matched', id: `00000000-0000-0000-0000-00000000000${n}` });
  it('sends in batches, oldest first, and counts rejected ones', async () => {
    const events = [ev(1), ev(2), ev(3)];
    const send = vi.fn(async (batch) => ({ saved: batch.length, duplicates: 0, rejected: batch.length === 2 ? 1 : 0 }));
    const r = await flushScans({ store: fakeStore(events), send, batchSize: 2 });
    expect(r).toEqual({ sent: 3, rejected: 1, left: 0, error: null });
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0][0].map((e) => e.id)).toEqual([ev(1).event_id, ev(2).event_id]);
  });
  it('keeps everything when the call fails, and reports offline', async () => {
    const events = [ev(1), ev(2)];
    const send = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const r = await flushScans({ store: fakeStore(events), send });
    expect(r.left).toBe(2);
    expect(r.error.kind).toBe('offline');
    expect(events).toHaveLength(2);
  });
  it('does nothing when there is nothing to send', async () => {
    const send = vi.fn();
    expect(await flushScans({ store: fakeStore([]), send })).toEqual({ sent: 0, rejected: 0, left: 0, error: null });
    expect(send).not.toHaveBeenCalled();
  });
});
