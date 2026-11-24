import { describe, expect, it } from 'vitest';
import {
  buildPublish,
  cleanBackupReport,
  canEnqueue,
  cleanExternalPayload,
  auditRoundMessage,
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
    kind: 'night',
    mode: 'shift',
    business_date: '2026-11-22',
    credit: [
      { kind: 'tier', label: 'Evening Shift \u2014 Salman Ghulam Ali', amount: 350 },
      { kind: 'named', label: 'Salman Jazz Cash', amount: 1227 },
      { kind: 'named', label: 'Pharmacy Use', amount: 0 },
      { kind: 'free', label: 'STRIPS LESS', amount: -3000 },
    ],
    inputs: {
      prev_cc: 19872,
      credit_adj: 0,
      book_bill_1: 0,
      book_bill_2: 0,
      ret_manual_1: 585,
      ret_manual_2: 157,
      ret_manual_3: 0,
      prev_credit: 85050,
    },
    results: {
      net_cash: 32179,
      net_sale: 32204,
      shift_variance: -25,
      deposits_f: 455000,
      debt_e: 83627,
      final_net_sale: -8849,
      final_variance: null,
    },
  };

  it("matches the owner's format line for line", () => {
    const m = closingMessage(page);
    expect(m.title).toBe('Closing - Night 2026-11-22');
    expect(m.message).toBe(
      [
        'Net cash: Rs. 32,179',
        'Target sale: Rs. 32,204',
        'Variance: Rs. 25 (Less:)',
        '',
        'Book Bills: Rs. 0',
        'Manual Returns: Rs. 742',
        'Carried CC: Rs. 19,872',
        'Total Deposits: Rs. 455,000',
        '',
        'Opening Credit: Rs. 85,050',
        'Salman Jazz Cash: Rs. 1,227',
        'Salman Ghulam Ali: Rs. 350',
        'STRIPS LESS: Rs. -3,000',
        'Total Credit: Rs. 83,627',
      ].join('\n'),
    );
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
    expect(m.message.includes('\u0007')).toBe(false);
    expect(
      m.message
        .split('\n')
        .filter((l) => l.startsWith('A B'))
        .every((l) => l.length < 90),
    ).toBe(true);
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

describe('closing correction push', () => {
  const page = {
    kind: 'night',
    mode: 'shift',
    business_date: '2026-11-22',
    credit: [],
    inputs: {
      revision: 2,
      correction_reason: 'cashier typed the system cash wrong',
      prev_cc: 0,
      credit_adj: 0,
      book_bill_1: 0,
      book_bill_2: 0,
      ret_manual_1: 0,
      ret_manual_2: 0,
      ret_manual_3: 0,
      prev_credit: 100,
    },
    results: { net_cash: 500, net_sale: 480, shift_variance: 20, deposits_f: 0, debt_e: 100 },
  };
  it('says it is a correction and why', () => {
    const m = closingMessage(page);
    expect(m.title).toBe('Closing Corrected - Night 2026-11-22');
    expect(m.message.split('\n')[0]).toBe('Revision 2: cashier typed the system cash wrong');
    expect(m.message).toContain('Variance: Rs. 20 (Excess:)');
    expect(m.tags).toContain('memo');
  });
  it('a first submission has no revision line', () => {
    const m = closingMessage({ ...page, inputs: { ...page.inputs, revision: 1, correction_reason: null } });
    expect(m.title).toBe('Closing - Night 2026-11-22');
    expect(m.message.startsWith('Net cash')).toBe(true);
  });
  it('has a generic fallback that carries only the date', () => {
    expect(messageFor('closing.corrected', { date: '2026-11-22' }).message).toBe('A closing was corrected (2026-11-22).');
  });
});

describe('audit round complete push', () => {
  const data = {
    round: 20,
    suffix: null,
    people: ['Ali Husnain'],
    date: '19 Nov 2026',
    item_count: 84,
    variance_count: 20,
    short: -15240,
    over: 10715,
    net: -4525,
    companies: [
      {
        company: 'HAYAT KIMYA PAKISTAN PRIVATE LIMITED',
        net: -4525,
        items: [
          { code: '891640', name: 'Close Molped Aloevera thick long trio 30s 1s', system: 0, counted: 2, value: 1920 },
          { code: '891639', name: 'Close Molped Alovera thick long 18s1s', system: -1, counted: 1, value: 1260 },
          { code: '893536', name: 'Good Care Diaper XX Large 56pcs 1s', system: 2, counted: 1, value: -2470 },
        ],
      },
    ],
  };
  it("matches the owner's format", () => {
    const m = auditRoundMessage(data);
    expect(m.title).toBe('Audit Round Complete');
    expect(m.markdown).toBe(true);
    expect(m.message).toBe(
      [
        '**Round 20 \u00b7 Ali Husnain \u00b7 19 Nov 2026**',
        '',
        '**20 / 84 items differ**  ',
        'Short **\u221215,240** \u00b7 Over **+10,715**  ',
        'Net **\u22124,525**',
        '',
        '\ud83c\udfe2 **HAYAT KIMYA PAKISTAN PRIVATE LIMITED \u00b7 \u2212Rs 4,525**',
        '- 891640 \u00b7 Close Molped Aloevera thick long trio 30s 1s: 0 \u2192 2 \u00b7 +Rs 1,920',
        '- 891639 \u00b7 Close Molped Alovera thick long 18s1s: -1 \u2192 1 \u00b7 +Rs 1,260',
        '- 893536 \u00b7 Good Care Diaper XX Large 56pcs 1s: 2 \u2192 1 \u00b7 \u2212Rs 2,470',
      ].join('\n'),
    );
  });
  it('names several counters, a sub-round letter and a clean round', () => {
    const m = auditRoundMessage({
      ...data,
      round: 3,
      suffix: 'B',
      people: ['A', 'B', 'C', 'D'],
      variance_count: 0,
      short: 0,
      over: 0,
      net: 0,
      companies: [],
    });
    expect(m.message.split('\n')[0]).toBe('**Round 3B \u00b7 A & B +2 \u00b7 19 Nov 2026**');
    expect(m.message).toContain('Short **0** \u00b7 Over **0**');
    expect(m.message).toContain('Net **0**');
  });
  it('keeps staff-typed names from becoming Markdown', () => {
    const m = auditRoundMessage({
      ...data,
      companies: [{ company: 'A*B', net: 1, items: [{ code: 'x', name: 'Cream _50g_ [new]', system: 1, counted: 2, value: 5 }] }],
    });
    expect(m.message).toContain('A\\*B');
    expect(m.message).toContain('Cream \\_50g\\_ \\[new\\]');
  });
  it('drops the smallest differences when the round is too long, and says so', () => {
    const items = Array.from({ length: 200 }, (_, i) => ({
      code: String(100000 + i),
      name: `Product number ${i} with a fairly long name for the test`,
      system: 1,
      counted: 2,
      value: i + 1,
    }));
    const m = auditRoundMessage({ ...data, companies: [{ company: 'BIG', net: 20100, items }] });
    expect(new TextEncoder().encode(m.message).length).toBeLessThanOrEqual(3800);
    expect(m.message).toMatch(/_\+\d+ smaller differences not shown\. Open the Audit app\._/);
    expect(m.message).toContain('Product number 199 '); // the biggest stays
    expect(m.message).not.toContain('Product number 0 ');
  });
  it('returns null when the data is unusable', () => {
    for (const bad of [null, {}, { ...data, date: 5 }, { ...data, companies: 'x' }]) expect(auditRoundMessage(bad)).toBeNull();
  });
  it('asks ntfy to render Markdown only for messages that say so', () => {
    const on = JSON.parse(buildPublish('https://ntfy.sh', 't', null, auditRoundMessage(data)).init.body);
    expect(on.markdown).toBe(true);
    const off = JSON.parse(
      buildPublish(
        'https://ntfy.sh',
        't',
        null,
        closingMessage({ kind: 'night', mode: 'shift', business_date: '2026-11-22', credit: [], inputs: {}, results: {} }),
      ).init.body,
    );
    expect('markdown' in off).toBe(false);
  });
});
