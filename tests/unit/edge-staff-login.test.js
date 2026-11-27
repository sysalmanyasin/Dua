// Handler-level tests for the staff-login Edge Function (Audit 0, T2): lockout, IP limit, disabled/admin/expired accounts,
// generic errors, and what a successful sign-in changes. The Supabase clients are fakes (tests/helpers/edgeHarness.js).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ENV, fakeDb, loadHandler, post } from '../helpers/edgeHarness.js';

const GOOD = { username: 'ali.khan', pin: '4827' };
const SESSION = { access_token: 'at', refresh_token: 'rt', expires_in: 3600 };
const future = new Date(Date.now() + 86_400_000).toISOString();
const past = new Date(Date.now() - 86_400_000).toISOString();

async function setup({
  userFails = 0,
  ipFails = 0,
  profile = { user_id: 'u1', role_template: 'junior', disabled_at: null, expires_at: null },
  signIn,
} = {}) {
  const db = fakeDb({
    counts: (q) => (q.filters.username ? userFails : ipFails),
    single: { profiles: () => ({ data: profile, error: null }) },
  });
  const signInWithPassword = vi.fn(signIn ?? (async () => ({ data: { session: SESSION }, error: null })));
  const handler = await loadHandler('staff-login', {
    env: ENV,
    clients: { serviceClient: () => db, anonClient: () => ({ auth: { signInWithPassword } }) },
  });
  return { handler, db, signInWithPassword };
}
const attempts = (db) => db.calls.filter((c) => c.table === 'login_attempts');
const inserted = (db) => attempts(db).find((c) => c.kind === 'insert');

describe('staff-login handler', () => {
  beforeEach(() => vi.resetModules());

  it('answers the CORS preflight and refuses other methods', async () => {
    const { handler } = await setup();
    const pre = await handler(new Request('https://x/fn', { method: 'OPTIONS', headers: { origin: ENV.ALLOWED_ORIGIN } }));
    expect(pre.status).toBe(204);
    expect(pre.headers.get('Access-Control-Allow-Origin')).toBe(ENV.ALLOWED_ORIGIN);
    expect((await handler(new Request('https://x/fn', { method: 'GET' }))).status).toBe(405);
  });

  it('allows only the configured origin', async () => {
    const { handler } = await setup();
    const res = await handler(post(GOOD, { origin: 'https://evil.example' }));
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('null');
  });

  it.each([
    ['a bad username', { username: 'A!', pin: '4827' }],
    ['a short PIN', { username: 'ali.khan', pin: '482' }],
    ['a non-numeric PIN', { username: 'ali.khan', pin: 'abcd' }],
    ['a PIN sent as a number', { username: 'ali.khan', pin: 4827 }],
    ['an empty body', {}],
  ])('rejects %s with the generic message and never signs in', async (_n, body) => {
    const { handler, signInWithPassword, db } = await setup();
    const res = await handler(post(body));
    expect(res.status).toBe(400);
    expect((await res.json()).message).toBe('Invalid username or PIN.');
    expect(signInWithPassword).not.toHaveBeenCalled();
    expect(attempts(db)).toHaveLength(0);
  });

  it('rejects a body that is not JSON', async () => {
    const { handler } = await setup();
    expect((await handler(post('not json'))).status).toBe(400);
  });

  it('locks a username after 5 wrong PINs and does not even try the PIN', async () => {
    const { handler, signInWithPassword } = await setup({ userFails: 5 });
    const res = await handler(post(GOOD));
    expect(res.status).toBe(429);
    expect((await res.json()).error).toBe('locked');
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it('does not lock at 4 wrong PINs', async () => {
    const { handler } = await setup({ userFails: 4 });
    expect((await handler(post(GOOD))).status).toBe(200);
  });

  it('locks an address after 30 wrong attempts', async () => {
    const { handler, signInWithPassword } = await setup({ ipFails: 30 });
    expect((await handler(post(GOOD))).status).toBe(429);
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it('does not lock an address at 29', async () => {
    const { handler } = await setup({ ipFails: 29 });
    expect((await handler(post(GOOD))).status).toBe(200);
  });

  it.each([
    ['unknown', null],
    ['disabled', { user_id: 'u', role_template: 'junior', disabled_at: past, expires_at: null }],
    ['expired', { user_id: 'u', role_template: 'junior', disabled_at: null, expires_at: past }],
    ['an admin (admins sign in with email, MFA)', { user_id: 'u', role_template: 'admin', disabled_at: null, expires_at: null }],
  ])('refuses %s accounts with the same generic answer and records a failure', async (_n, profile) => {
    const { handler, signInWithPassword, db } = await setup({ profile });
    const res = await handler(post(GOOD));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'invalid', message: 'Invalid username or PIN.' });
    expect(signInWithPassword).not.toHaveBeenCalled();
    expect(inserted(db).payload).toMatchObject({ username: 'ali.khan', success: false });
  });

  it('a wrong PIN and an unknown user cannot be told apart by the response', async () => {
    const wrong = await setup({ signIn: async () => ({ data: { session: null }, error: { message: 'Invalid login' } }) });
    const unknown = await setup({ profile: null });
    const a = await wrong.handler(post(GOOD));
    const b = await unknown.handler(post(GOOD));
    expect(a.status).toBe(b.status);
    expect(await a.json()).toEqual(await b.json());
  });

  it('records a failed attempt on a wrong PIN and keeps no success row', async () => {
    const { handler, db } = await setup({ signIn: async () => ({ data: { session: null }, error: { message: 'x' } }) });
    expect((await handler(post(GOOD))).status).toBe(401);
    expect(inserted(db).payload.success).toBe(false);
    expect(attempts(db).some((c) => c.kind === 'delete')).toBe(false);
  });

  it('a still-valid expiry date does not block sign-in', async () => {
    const { handler } = await setup({ profile: { user_id: 'u', role_template: 'senior', disabled_at: null, expires_at: future } });
    expect((await handler(post(GOOD))).status).toBe(200);
  });

  it('signs in with a derived password, never the PIN itself, and clears earlier failures', async () => {
    const { handler, db, signInWithPassword } = await setup();
    const res = await handler(post(GOOD));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(SESSION);
    const arg = signInWithPassword.mock.calls[0][0];
    expect(arg.email).toBe('ali.khan@staff.dua.invalid');
    expect(arg.password).toMatch(/^[0-9a-f]{64}$/);
    expect(arg.password).not.toContain('4827');
    expect(inserted(db).payload.success).toBe(true);
    const del = attempts(db).find((c) => c.kind === 'delete');
    expect(del.filters).toEqual({ username: 'ali.khan', success: false });
  });

  it('an older 6-digit PIN is passed as typed', async () => {
    const { handler, signInWithPassword } = await setup();
    expect((await handler(post({ username: 'ali.khan', pin: '482719' }))).status).toBe(200);
    expect(signInWithPassword.mock.calls[0][0].password).toBe('482719');
  });

  it('normalises the username (case, spaces)', async () => {
    const { handler, signInWithPassword } = await setup();
    await handler(post({ username: '  ALI.Khan ', pin: '4827' }));
    expect(signInWithPassword.mock.calls[0][0].email).toBe('ali.khan@staff.dua.invalid');
  });

  it('a missing or short PIN_PEPPER is a server error and returns no session', async () => {
    const db = fakeDb({
      counts: () => 0,
      single: { profiles: () => ({ data: { user_id: 'u', role_template: 'junior', disabled_at: null, expires_at: null }, error: null }) },
    });
    const signIn = vi.fn();
    const handler = await loadHandler('staff-login', {
      env: { ...ENV, PIN_PEPPER: 'short' },
      clients: { serviceClient: () => db, anonClient: () => ({ auth: { signInWithPassword: signIn } }) },
    });
    const res = await handler(post(GOOD));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toMatch(/token|short/);
    expect(signIn).not.toHaveBeenCalled();
  });

  it('never caches the answer and never echoes the PIN', async () => {
    const { handler } = await setup();
    const res = await handler(post(GOOD));
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const bad = await (await setup({ profile: null })).handler(post(GOOD));
    expect(JSON.stringify(await bad.json())).not.toContain('4827');
  });
});
