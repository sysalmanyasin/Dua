import { describe, expect, it } from 'vitest';
import {
  buildPublish,
  canEnqueue,
  cleanExternalPayload,
  messageFor,
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
