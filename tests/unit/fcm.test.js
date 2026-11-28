import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  b64url,
  buildFcmMessage,
  notificationText,
  channelFor,
  classifyFcmResponse,
  fitBytes,
  forgetAccessToken,
  getAccessToken,
  hrefFor,
  parseServiceAccount,
  plainText,
  sendFcm,
  signJwt,
} from '../../supabase/functions/_shared/fcm.ts';
import { messageFor } from '../../supabase/functions/_shared/ntfy.ts';
import { parseWidgetRequest, sha256Hex } from '../../supabase/functions/_shared/widget.ts';
import { parseAttendanceEvent, parseAttendanceHealth } from '../../supabase/functions/_shared/attendance.ts';

let publicKey;
let sa;
beforeAll(async () => {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  );
  publicKey = pair.publicKey;
  const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  const b64 = btoa(String.fromCharCode(...der)).replace(/(.{64})/g, '$1\n');
  sa = {
    client_email: 'push@test-project.iam.gserviceaccount.com',
    project_id: 'test-project',
    private_key: `-----BEGIN PRIVATE KEY-----\n${b64}\n-----END PRIVATE KEY-----\n`,
  };
});
beforeEach(() => forgetAccessToken());

describe('service account secret', () => {
  it('accepts the Firebase JSON and nothing else', () => {
    expect(parseServiceAccount(JSON.stringify(sa))).toEqual(sa);
    expect(parseServiceAccount(JSON.stringify({ ...sa, extra: 'ignored' }))).toEqual(sa);
    for (const bad of [
      undefined,
      '',
      'not json',
      '{}',
      JSON.stringify({ ...sa, private_key: 'x' }),
      JSON.stringify({ ...sa, project_id: 'Bad Id!' }),
      JSON.stringify({ ...sa, client_email: 'nope' }),
    ])
      expect(parseServiceAccount(bad)).toBeNull();
  });
});

describe('signed assertion', () => {
  it('is a real RS256 JWT that the public key verifies, with the right claims', async () => {
    const jwt = await signJwt(sa, 1_800_000_000);
    const [h, c, s] = jwt.split('.');
    const dec = (x) => JSON.parse(atob(x.replace(/-/g, '+').replace(/_/g, '/')));
    expect(dec(h)).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(dec(c)).toEqual({
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat: 1_800_000_000,
      exp: 1_800_003_600,
    });
    const sig = Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (ch) => ch.charCodeAt(0));
    expect(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', publicKey, sig, new TextEncoder().encode(`${h}.${c}`))).toBe(true);
  });
  it('base64url has no padding or + /', () => {
    expect(b64url('???>>>~~~')).not.toMatch(/[+/=]/);
  });
});

describe('access token', () => {
  const reply = (status, body) => vi.fn(async () => new Response(JSON.stringify(body), { status }));
  it('is fetched once and reused until near its end', async () => {
    const f = reply(200, { access_token: 'tok1', expires_in: 3600 });
    expect(await getAccessToken(sa, f, 1_000_000)).toBe('tok1');
    expect(await getAccessToken(sa, f, 1_000_000 + 600_000)).toBe('tok1');
    expect(f).toHaveBeenCalledTimes(1);
    const body = f.mock.calls[0][1].body;
    expect(body.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
    expect(body.get('assertion').split('.')).toHaveLength(3);
    await getAccessToken(sa, f, 1_000_000 + 3_560_000); // within a minute of expiry: fetch a new one
    expect(f).toHaveBeenCalledTimes(2);
  });
  it('fails with a plain reason and never includes the key', async () => {
    const f = reply(400, { error: 'invalid_grant' });
    const err = await getAccessToken(sa, f, 5).catch((e) => e);
    expect(err.message).toBe('Google sign-in for FCM failed (400 invalid_grant)');
    expect(err.message).not.toContain('PRIVATE');
  });
});

describe('message', () => {
  const push = { title: 'Dua: closing submitted', message: 'A closing was submitted (2026-11-25).', priority: 3, tags: [] };
  it('is a high-priority notification on the right channel with a tap target', () => {
    const m = buildFcmMessage('tok', push, 'closing.submitted').message;
    expect(m.token).toBe('tok');
    expect(m.notification).toEqual({ title: 'Dua: closing submitted', body: 'A closing was submitted (2026-11-25).' });
    expect(m.data).toEqual({ kind: 'closing.submitted', href: '#/home' });
    expect(m.android).toMatchObject({ priority: 'HIGH', notification: { channel_id: 'dua_alerts', tag: 'closing.submitted' } });
  });
  it('uses the loud channel for urgent alerts', () => {
    expect(channelFor(5)).toBe('dua_urgent');
    expect(channelFor(4)).toBe('dua_urgent');
    expect(channelFor(3)).toBe('dua_alerts');
    expect(buildFcmMessage('t', { ...push, priority: 5 }, 'backup.failed').message.android.notification.channel_id).toBe('dua_urgent');
  });
  it('opens the right screen when tapped', () => {
    expect(hrefFor('backup.failed')).toBe('#/tools');
    expect(hrefFor('restore_drill.failed')).toBe('#/tools');
    expect(hrefFor('inventory.sync_stale')).toBe('#/tools');
    expect(hrefFor('attendance.rejected')).toBe('#/manager/attendance');
    expect(hrefFor('attendance.tracking_off')).toBe('#/manager/attendance');
    expect(hrefFor('attendance.checkout_missed')).toBe('#/manager/attendance');
    expect(hrefFor('closing.submitted')).toBe('#/home');
    expect(hrefFor('anything.else')).toBe('#/home');
  });
  it("stays inside Firebase's 4096-byte limit even for the longest closing text, including multi-byte characters", () => {
    const long = { title: 'T'.repeat(500), message: 'ر'.repeat(3800), priority: 3, tags: [] };
    const bytes = new TextEncoder().encode(JSON.stringify(buildFcmMessage('x'.repeat(200), long, 'closing.submitted'))).length;
    expect(bytes).toBeLessThan(4096);
  });
  it('shortens text on a character boundary and marks it', () => {
    expect(fitBytes('short', 100)).toBe('short');
    const out = fitBytes('é'.repeat(100), 21);
    expect(new TextEncoder().encode(out).length).toBeLessThanOrEqual(21);
    expect(out.endsWith('…')).toBe(true);
  });
  it('turns the audit alert Markdown into plain text', () => {
    expect(plainText('**Round 3 · Ali \\& Sam**')).toBe('Round 3 · Ali \\& Sam'.replace('\\&', '\\&'));
    expect(plainText('a \\*b\\* c')).toBe('a *b* c');
  });
  it('words the new attendance alert with no names or places', () => {
    const m = messageFor('attendance.rejected', { date: '2026-11-25', reason: 'outside', staff: 'Ali' });
    expect(m.title).toContain('attendance');
    expect(JSON.stringify(m)).not.toMatch(/Ali|outside/);
    expect(m.message).toContain('2026-11-25');
  });
  it('words the tracking and missing check-out alerts with no names', () => {
    for (const kind of ['attendance.tracking_off', 'attendance.checkout_missed']) {
      const m = messageFor(kind, { date: '2026-11-27', staff: 'Ali', state: 'location_off' });
      expect(m.title).not.toBe('Dua: alert');
      expect(JSON.stringify(m)).not.toMatch(/Ali|location_off/);
      expect(m.message).toContain('2026-11-27');
      expect(m.priority).toBe(4);
    }
  });
});

describe("reading Firebase's answer", () => {
  const e = (status, message, code) => ({ error: { status: 'X', message, details: code ? [{ errorCode: code }] : [] } });
  it('treats success as success', () => expect(classifyFcmResponse(200, {})).toEqual({ kind: 'ok' }));
  it('switches off a phone whose address is gone', () => {
    expect(classifyFcmResponse(404, e(404, 'Requested entity was not found.', 'UNREGISTERED'))).toEqual({ kind: 'dead' });
    expect(classifyFcmResponse(400, e(400, 'The registration token is not a valid FCM registration token'))).toEqual({ kind: 'dead' });
  });
  it('reports a credential or project problem as configuration, not a dead phone', () => {
    expect(classifyFcmResponse(401, e(401, 'Request had invalid authentication credentials')).kind).toBe('config');
    expect(classifyFcmResponse(403, e(403, 'Firebase Cloud Messaging API has not been used')).kind).toBe('config');
    expect(classifyFcmResponse(403, e(403, 'x', 'SENDER_ID_MISMATCH')).kind).toBe('config');
  });
  it('retries throttling and server trouble', () => {
    expect(classifyFcmResponse(429, e(429, 'quota')).kind).toBe('retry');
    expect(classifyFcmResponse(503, null).kind).toBe('retry');
    expect(classifyFcmResponse(400, e(400, 'Invalid JSON payload')).kind).toBe('retry');
  });
  it('sends to the project address with the bearer token and survives a network failure', async () => {
    const f = vi.fn(async () => new Response('{}', { status: 200 }));
    expect(await sendFcm('test-project', 'ACCESS', { message: { token: 't' } }, f)).toEqual({ kind: 'ok' });
    expect(f.mock.calls[0][0]).toBe('https://fcm.googleapis.com/v1/projects/test-project/messages:send');
    expect(f.mock.calls[0][1].headers.Authorization).toBe('Bearer ACCESS');
    const down = vi.fn(async () => {
      throw new Error('boom secret');
    });
    const out = await sendFcm('p', 'a', {}, down);
    expect(out.kind).toBe('retry');
    expect(JSON.stringify(out)).not.toContain('secret');
  });
});

describe('widget request', () => {
  const id = '20000000-0000-4000-8000-000000000004';
  const secret = 'a'.repeat(64);
  it('accepts only a device id and a 64-hex secret', () => {
    expect(parseWidgetRequest({ device_id: id, secret })).toEqual({ deviceId: id, secret });
    for (const bad of [
      null,
      {},
      { device_id: id },
      { device_id: 'x', secret },
      { device_id: id, secret: 'short' },
      { device_id: id, secret: 'g'.repeat(64) },
      { device_id: 5, secret },
    ])
      expect(parseWidgetRequest(bad)).toBeNull();
  });
  it('hashes like the database does (SHA-256, lower-case hex)', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('saved alert text', () => {
  it('is exactly what the phone shows', () => {
    const push = { title: '**Round 3** · Ali', message: 'Short **-5** \\_x', priority: 5, tags: [], markdown: true };
    const saved = notificationText(push);
    expect(saved).toEqual(buildFcmMessage('t', push, 'audit.compiled').message.notification);
    expect(saved.body).toBe('Short -5 _x');
  });
  it('keeps to the size limits', () => {
    const saved = notificationText({ title: 'T'.repeat(500), message: 'm'.repeat(9000), priority: 3, tags: [] });
    expect(new TextEncoder().encode(saved.title).length).toBeLessThanOrEqual(120);
    expect(new TextEncoder().encode(saved.body).length).toBeLessThanOrEqual(3200);
  });
});

describe('attendance event request', () => {
  const ok = {
    device_id: '20000000-0000-4000-8000-000000000004',
    secret: 'a'.repeat(64),
    event_id: '30000000-0000-4000-8000-000000000005',
    kind: 'in',
    at: 1_790_000_000_000,
    latitude: 31.387139,
    longitude: 74.189924,
    accuracy: 12.5,
    mock: false,
  };
  it('accepts a complete event and turns the time into ISO text', () => {
    expect(parseAttendanceEvent(ok)).toEqual({
      deviceId: ok.device_id,
      secret: ok.secret,
      eventId: ok.event_id,
      kind: 'in',
      at: new Date(1_790_000_000_000).toISOString(),
      latitude: 31.387139,
      longitude: 74.189924,
      accuracy: 12.5,
      mock: false,
    });
    expect(parseAttendanceEvent({ ...ok, kind: 'out', mock: true })).toMatchObject({ kind: 'out', mock: true });
  });
  it('treats anything but mock === true as not mock', () => {
    expect(parseAttendanceEvent({ ...ok, mock: 'yes' }).mock).toBe(false);
    const { mock, ...without } = ok;
    expect(mock).toBe(false);
    expect(parseAttendanceEvent(without).mock).toBe(false);
  });
  it('refuses a malformed event', () => {
    for (const bad of [
      null,
      {},
      { ...ok, device_id: 'x' },
      { ...ok, secret: 'short' },
      { ...ok, event_id: 'x' },
      { ...ok, kind: 'sideways' },
      { ...ok, kind: undefined },
      { ...ok, at: 'now' },
      { ...ok, at: 5 },
      { ...ok, at: 9_000_000_000_000 },
      { ...ok, latitude: 91 },
      { ...ok, longitude: -181 },
      { ...ok, latitude: '31.3' },
      { ...ok, accuracy: -1 },
      { ...ok, accuracy: Number.NaN },
      { ...ok, accuracy: 1e9 },
    ]) {
      expect(parseAttendanceEvent(bad)).toBeNull();
    }
  });
});

describe("attendance health report (the phone's own tracking state)", () => {
  const ok = {
    device_id: '20000000-0000-4000-8000-0000000000D1',
    secret: 'a'.repeat(64),
    state: null,
    pending: 0,
  };
  it('accepts a good report and a report with a problem', () => {
    expect(parseAttendanceHealth(ok)).toEqual({ deviceId: ok.device_id.toLowerCase(), secret: ok.secret, state: null, pending: 0 });
    expect(parseAttendanceHealth({ ...ok, state: 'location_off', pending: 3 })).toMatchObject({ state: 'location_off', pending: 3 });
    const { state, ...without } = ok;
    expect(state).toBeNull();
    expect(parseAttendanceHealth(without).state).toBeNull();
  });
  it('knows every problem the phone can find', () => {
    for (const state of ['no_precise_location', 'location_off', 'no_background_location', 'background_restricted', 'not_registered']) {
      expect(parseAttendanceHealth({ ...ok, state }).state).toBe(state);
    }
  });
  it('refuses anything else, including a state the server sets itself', () => {
    for (const bad of [
      null,
      {},
      { ...ok, device_id: 'x' },
      { ...ok, secret: 'short' },
      { ...ok, state: 'silent' },
      { ...ok, state: 'ok' },
      { ...ok, state: 5 },
      { ...ok, pending: -1 },
      { ...ok, pending: 1.5 },
      { ...ok, pending: 5000 },
      { ...ok, pending: '1' },
      { ...ok, pending: undefined },
    ]) {
      expect(parseAttendanceHealth(bad)).toBeNull();
    }
  });
});
