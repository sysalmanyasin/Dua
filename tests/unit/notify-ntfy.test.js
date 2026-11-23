import { describe, expect, it } from 'vitest';
import {
  buildPublish,
  cleanBackupReport,
  canEnqueue,
  cleanExternalPayload,
  closingMessage,
  messageFor,
  rs,
  safeEqual,
  scrubError,
  validServer,
} from '../../supabase/functions/_shared/ntfy.ts';

describe('push text', () => {
  it('is generic and shows only a plain date', () => {
    const m = messageFor('closing.submitted', { date: '2026-11-11', total: 123456, staff: 'Ali' });
    expect(m.message).toContain('2026-11-11');
    expect(JSON.stringify(m)).not.toMatch(/123456|Ali/);
  });
  it('ignores a date that is not plainly a date', () => {
    expect(messageFor('backup.failed', { date: 'x'.repeat(50) }).message).not.toContain('xxxx');
  });
  it('gives unknown kinds a safe generic message', () => {
    const m = messageFor('some.new_kind', {});
    expect(m.message).toContain('some.new_kind');
    expect(messageFor('Bad Kind <script>', {}).message).toContain('unknown');
  });
  it('words the audit alerts without any name or amount', () => {
    for (const k of ['audit.submitted', 'audit.compiled', 'audit.conflict', 'audit.finalized']) {
      const m = messageFor(k, { company: 'Acme', total: 99999 });
      expect(m.title.startsWith('Dua: audit')).toBe(true);
      expect(JSON.stringify(m)).not.toMatch(/Acme|99999/);
      expect(canEnqueue(k)).toBe(false);
    }
  });
  it('treats backup failures as the highest priority', () => {
    expect(messageFor('backup.failed', {}).priority).toBe(5);
  });
});

describe('what may be queued from outside the database', () => {
  it('allows only the backup and restore-drill failure kinds', () => {
    expect(canEnqueue('backup.failed')).toBe(true);
    expect(canEnqueue('restore_drill.failed')).toBe(true);
    for (const k of ['closing.submitted', 'inventory.sync_stale', '', null, 5]) expect(canEnqueue(k)).toBe(false);
  });
  it('keeps payloads short and plain', () => {
    const out = cleanExternalPayload({ date: '2026-11-11', Bad: 1, n: 3, nested: { a: 1 }, long: 'y'.repeat(500), ok: true });
    expect(out).toEqual({ date: '2026-11-11', n: 3, long: 'y'.repeat(120), ok: true });
    expect(cleanExternalPayload(null)).toEqual({});
  });
});

describe('publishing', () => {
  it('keeps the topic out of the URL', () => {
    const r = buildPublish('https://ntfy.sh/', 'secret-topic-123', null, messageFor('backup.failed', {}));
    expect(r.url).toBe('https://ntfy.sh/');
    expect(JSON.parse(r.init.body).topic).toBe('secret-topic-123');
    expect(r.init.headers.Authorization).toBeUndefined();
  });
  it('sends a token only when one is set', () => {
    const r = buildPublish('https://ntfy.sh', 't', 'tk_abc', messageFor('backup.failed', {}));
    expect(r.init.headers.Authorization).toBe('Bearer tk_abc');
  });
  it('accepts only https servers', () => {
    expect(validServer('https://ntfy.sh')).toBe(true);
    for (const s of ['http://ntfy.sh', 'ntfy.sh', '', 'javascript:alert(1)']) expect(validServer(s)).toBe(false);
  });
});

describe('error text', () => {
  it('never contains the topic or token', () => {
    const e = new Error('request to https://ntfy.sh/my-private-topic failed with tk_secret99');
    const text = scrubError(e, ['my-private-topic', 'tk_secret99', null]);
    expect(text).not.toContain('my-private-topic');
    expect(text).not.toContain('tk_secret99');
  });
  it('is short', () => {
    expect(scrubError('z'.repeat(1000), []).length).toBe(300);
  });
});

describe('secret comparison', () => {
  it('matches equal values and rejects others, including empty ones', () => {
    expect(safeEqual('abcdef', 'abcdef')).toBe(true);
    expect(safeEqual('abcdef', 'abcdeg')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(safeEqual('', '')).toBe(false);
  });
});

describe('backup reports from the workflow', () => {
  const sha = 'a'.repeat(64);
  const good = {
    kind: 'daily',
    status: 'ok',
    day: '2026-11-12',
    size_bytes: 184552,
    sha256: sha,
    manifest: { 'table:sales': { rows: '5883', md5: 'b'.repeat(32) }, registry: { rows: '12', md5: 'empty' } },
  };
  it('accepts a complete success', () => {
    expect(cleanBackupReport(good)).toMatchObject({ kind: 'daily', status: 'ok', size: 184552, sha });
  });
  it('accepts a failure with just an error line, and trims it', () => {
    const r = cleanBackupReport({ kind: 'daily', status: 'failed', error: 'x'.repeat(900) });
    expect(r.status).toBe('failed');
    expect(r.error.length).toBe(500);
  });
  it('refuses a success that does not say what it saved', () => {
    expect(cleanBackupReport({ kind: 'daily', status: 'ok', day: '2026-11-12' })).toBeNull();
    expect(cleanBackupReport({ ...good, sha256: 'nope' })).toBeNull();
  });
  it('refuses unknown kinds, statuses and malformed manifests', () => {
    expect(cleanBackupReport({ ...good, kind: 'hourly' })).toBeNull();
    expect(cleanBackupReport({ ...good, status: 'maybe' })).toBeNull();
    expect(cleanBackupReport({ ...good, manifest: { 'Bad Name': { rows: '1', md5: 'empty' } } })).toBeNull();
    expect(cleanBackupReport({ ...good, manifest: { a: { rows: 'DROP', md5: 'empty' } } })).toBeNull();
    expect(cleanBackupReport(null)).toBeNull();
  });
});

describe('closing summary push', () => {
  const page = {
    kind: 'night', mode: 'shift', business_date: '2026-11-22',
    credit: [
      { kind: 'tier', label: 'Evening Shift \u2014 Salman Ghulam Ali', amount: 350 },
      { kind: 'named', label: 'Salman Jazz Cash', amount: 1227 },
      { kind: 'named', label: 'Pharmacy Use', amount: 0 },
      { kind: 'free', label: 'STRIPS LESS', amount: -3000 },
    ],
    inputs: { prev_cc: 19872, credit_adj: 0, book_bill_1: 0, book_bill_2: 0, ret_manual_1: 585, ret_manual_2: 157, ret_manual_3: 0, prev_credit: 85050 },
    results: { net_cash: 32179, net_sale: 32204, shift_variance: -25, deposits_f: 455000, debt_e: 83627, final_net_sale: -8849, final_variance: null },
  };

  it('matches the owner\'s format line for line', () => {
    const m = closingMessage(page);
    expect(m.title).toBe('Closing - Night 2026-11-22');
    expect(m.message).toBe([
      'Net cash: Rs. 32,179', 'Target sale: Rs. 32,204', 'Variance: Rs. 25 (Less:)', '',
      'Book Bills: Rs. 0', 'Manual Returns: Rs. 742', 'Carried CC: Rs. 19,872', 'Total Deposits: Rs. 455,000', '',
      'Opening Credit: Rs. 85,050', 'Salman Jazz Cash: Rs. 1,227', 'Salman Ghulam Ali: Rs. 350', 'STRIPS LESS: Rs. -3,000',
      'Total Credit: Rs. 83,627',
    ].join('\n'));
  });
  it('says Excess for a surplus, Even for none, and uses the final figures for a final closing', () => {
    expect(closingMessage({ ...page, results: { ...page.results, shift_variance: 40 } }).message).toContain('Variance: Rs. 40 (Excess:)');
    expect(closingMessage({ ...page, results: { ...page.results, shift_variance: 0 } }).message).toContain('Variance: Rs. 0 (Even)');
    const f = closingMessage({ ...page, mode: 'final', results: { ...page.results, final_net_sale: 163334, final_variance: -2788 } });
    expect(f.title).toBe('Closing - Night 2026-11-22 (Final)');
    expect(f.message).toContain('Target sale: Rs. 163,334');
    expect(f.message).toContain('Variance: Rs. 2,788 (Less:)');
  });
  it('shows a credit adjustment so the total still ties', () => {
    const m = closingMessage({ ...page, inputs: { ...page.inputs, credit_adj: -121320 } });
    expect(m.message).toContain('Credit adjustment: Rs. -121,320');
  });
  it('cleans staff-typed labels', () => {
    const m = closingMessage({ ...page, credit: [{ kind: 'free', label: 'A\nB\u0007 ' + 'x'.repeat(100), amount: 5 }] });
    expect(m.message).not.toMatch(/\u0007/);
    expect(m.message.split('\n').filter((l) => l.startsWith('A B')).every((l) => l.length < 90)).toBe(true);
  });
  it('returns null (so the generic text is used) when the closing JSON is unusable', () => {
    for (const bad of [null, {}, { ...page, business_date: 'x' }, { ...page, inputs: undefined }, { ...page, results: undefined }]) {
      expect(closingMessage(bad)).toBeNull();
    }
  });
  it('formats rupees', () => {
    expect(rs(32179)).toBe('Rs. 32,179');
    expect(rs(-3000)).toBe('Rs. -3,000');
    expect(rs('1227.50')).toBe('Rs. 1,227.5');
    expect(rs(null)).toBe('Rs. 0');
  });
  it('leaves the generic closing text alone for the fallback', () => {
    expect(messageFor('closing.submitted', { closing_id: 'abc' }).message).toBe('A closing was submitted.');
  });
});
