// Handler-level tests for the admin-users Edge Function (Audit 0, T2): who may call it, what each action refuses, and that a PIN is
// never written to the activity log or returned. The Supabase clients are fakes (tests/helpers/edgeHarness.js).
import { describe, expect, it, vi } from 'vitest';
import { ENV, fakeDb, loadHandler, post } from '../helpers/edgeHarness.js';

const BEARER = { authorization: 'Bearer user-jwt' };

async function setup({ user = { id: 'owner-1' }, allowed = true, single = {}, result = {}, admin } = {}) {
  const adminApi = admin ?? {
    createUser: vi.fn(async () => ({ data: { user: { id: 'new-1' } }, error: null })),
    updateUserById: vi.fn(async () => ({ error: null })),
    deleteUser: vi.fn(async () => ({ error: null })),
  };
  const db = fakeDb({ single, result, admin: adminApi });
  const caller = { auth: { getUser: vi.fn(async () => ({ data: { user } })) }, rpc: vi.fn(async () => ({ data: allowed })) };
  const handler = await loadHandler('admin-users', { env: ENV, clients: { serviceClient: () => db, userClient: () => caller } });
  return { handler, db, caller, adminApi };
}
const logs = (db) => db.calls.filter((c) => c.table === 'activity_log' && c.kind === 'insert');
const staffRow = { data: { id: 's1', active: true }, error: null };
const noRow = { data: null, error: null };
const profileBy = (map) => (q) => map(q.filters) ?? noRow;

describe('admin-users: who may call it', () => {
  it('refuses a call without a bearer token', async () => {
    const { handler, caller } = await setup();
    expect((await handler(post({ action: 'unlock' }))).status).toBe(401);
    expect(caller.rpc).not.toHaveBeenCalled();
  });
  it('refuses a signed-in caller without users.manage', async () => {
    const { handler, db } = await setup({ allowed: false });
    expect((await handler(post({ action: 'unlock', user_id: 'u' }, BEARER))).status).toBe(403);
    expect(db.calls).toHaveLength(0);
  });
  it('refuses when has_perm is not exactly true (MFA missing returns null/false)', async () => {
    const { handler } = await setup({ allowed: null });
    expect((await handler(post({ action: 'unlock', user_id: 'u' }, BEARER))).status).toBe(403);
  });
  it('refuses an invalid token (no user)', async () => {
    const { handler } = await setup({ user: null });
    expect((await handler(post({ action: 'unlock', user_id: 'u' }, BEARER))).status).toBe(403);
  });
  it('asks the database for users.manage specifically', async () => {
    const { handler, caller } = await setup();
    await handler(post({ action: 'nope' }, BEARER));
    expect(caller.rpc).toHaveBeenCalledWith('has_perm', { p_key: 'users.manage' });
  });
  it('rejects a GET and an unknown action', async () => {
    const { handler } = await setup();
    expect((await handler(new Request('https://x/fn', { method: 'GET' }))).status).toBe(405);
    const res = await handler(post({ action: 'drop_everything' }, BEARER));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('unknown_action');
  });
});

describe('admin-users: create_login', () => {
  const body = { action: 'create_login', staff_id: 's1', username: 'ali.khan', role: 'junior', pin: '4827' };
  const fresh = { staff: () => staffRow, profiles: () => noRow };

  it('creates the login with a derived password, never the PIN, and logs without the PIN', async () => {
    const { handler, db, adminApi } = await setup({ single: fresh });
    const res = await handler(post(body, BEARER));
    expect(res.status).toBe(200);
    const created = adminApi.createUser.mock.calls[0][0];
    expect(created.email).toBe('ali.khan@staff.dua.invalid');
    expect(created.password).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(await res.json())).not.toContain('4827');
    expect(JSON.stringify(logs(db))).not.toContain('4827');
    expect(logs(db)[0].payload.action).toBe('access.login_created');
  });
  it.each([
    ['a weak PIN (repeat)', { pin: '1111' }, 'weak_pin'],
    ['a weak PIN (run)', { pin: '1234' }, 'weak_pin'],
    ['a weak PIN (year)', { pin: '1990' }, 'weak_pin'],
    ['a 6-digit PIN for a new login', { pin: '482719' }, 'bad_pin'],
    ['a letter PIN', { pin: 'abcd' }, 'bad_pin'],
    ['an admin role', { role: 'admin' }, 'role'],
    ['an owner role', { role: 'owner' }, 'role'],
    ['a bad username', { username: '1x' }, 'username'],
  ])('refuses %s', async (_n, patch, code) => {
    const { handler, adminApi } = await setup({ single: fresh });
    const res = await handler(post({ ...body, ...patch }, BEARER));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(code);
    expect(adminApi.createUser).not.toHaveBeenCalled();
  });
  it('refuses a person who is not in the registry (404), inactive (409), already with a login (409), or a taken username (409)', async () => {
    let r = await setup({ single: { staff: () => noRow } });
    expect((await r.handler(post(body, BEARER))).status).toBe(404);
    r = await setup({ single: { staff: () => ({ data: { id: 's1', active: false }, error: null }) } });
    expect((await r.handler(post(body, BEARER))).status).toBe(409);
    r = await setup({
      single: { staff: () => staffRow, profiles: profileBy((f) => (f.staff_id ? { data: { user_id: 'x' }, error: null } : null)) },
    });
    expect((await r.handler(post(body, BEARER))).status).toBe(409);
    r = await setup({
      single: { staff: () => staffRow, profiles: profileBy((f) => (f.username ? { data: { user_id: 'x' }, error: null } : null)) },
    });
    const taken = await r.handler(post(body, BEARER));
    expect(taken.status).toBe(409);
    expect((await taken.json()).error).toBe('username_taken');
    expect(r.adminApi.createUser).not.toHaveBeenCalled();
  });
  it('leaves nothing half-created when the profile insert fails', async () => {
    const { handler, adminApi } = await setup({ single: fresh, result: { 'profiles:insert': { data: null, error: { message: 'boom' } } } });
    const res = await handler(post(body, BEARER));
    expect(res.status).toBe(500);
    expect(adminApi.deleteUser).toHaveBeenCalledWith('new-1');
  });
  it('reports a server set-up problem when PIN_PEPPER is too short, without creating anything', async () => {
    const db = fakeDb({ single: fresh, admin: { createUser: vi.fn() } });
    const caller = { auth: { getUser: async () => ({ data: { user: { id: 'o' } } }) }, rpc: async () => ({ data: true }) };
    const handler = await loadHandler('admin-users', {
      env: { ...ENV, PIN_PEPPER: 'short' },
      clients: { serviceClient: () => db, userClient: () => caller },
    });
    const res = await handler(post(body, BEARER));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('not_set_up');
    expect(db.auth.admin.createUser).not.toHaveBeenCalled();
  });
});

describe('admin-users: set_pin, unlock, set_disabled', () => {
  const person = { data: { user_id: 'u1', username: 'ali.khan', role_template: 'junior', disabled_at: null }, error: null };
  const admin = { data: { user_id: 'a1', username: 'owner', role_template: 'admin', disabled_at: null }, error: null };

  it.each(['set_pin', 'unlock', 'set_disabled'])('%s refuses an unknown person (404) and an admin account (400)', async (action) => {
    let r = await setup({ single: { profiles: () => noRow } });
    expect((await r.handler(post({ action, user_id: 'x', pin: '4827' }, BEARER))).status).toBe(404);
    r = await setup({ single: { profiles: () => admin } });
    const res = await r.handler(post({ action, user_id: 'a1', pin: '4827' }, BEARER));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('admin_protected');
    expect(r.adminApi.updateUserById).not.toHaveBeenCalled();
  });
  it('set_pin replaces the password, clears the lock, and logs without the PIN', async () => {
    const { handler, db, adminApi } = await setup({ single: { profiles: () => person } });
    const res = await handler(post({ action: 'set_pin', user_id: 'u1', pin: '4827' }, BEARER));
    expect(res.status).toBe(200);
    expect(adminApi.updateUserById.mock.calls[0][1].password).toMatch(/^[0-9a-f]{64}$/);
    expect(db.calls.some((c) => c.table === 'login_attempts' && c.kind === 'delete' && c.filters.username === 'ali.khan')).toBe(true);
    expect(JSON.stringify(logs(db))).not.toContain('4827');
  });
  it('set_pin refuses weak and malformed PINs before touching the account', async () => {
    const { handler, adminApi } = await setup({ single: { profiles: () => person } });
    expect((await handler(post({ action: 'set_pin', user_id: 'u1', pin: '0000' }, BEARER))).status).toBe(400);
    expect((await handler(post({ action: 'set_pin', user_id: 'u1', pin: '12' }, BEARER))).status).toBe(400);
    expect(adminApi.updateUserById).not.toHaveBeenCalled();
  });
  it('unlock clears only the failed attempts of that username and logs it', async () => {
    const { handler, db } = await setup({ single: { profiles: () => person } });
    expect((await handler(post({ action: 'unlock', user_id: 'u1' }, BEARER))).status).toBe(200);
    const del = db.calls.find((c) => c.table === 'login_attempts' && c.kind === 'delete');
    expect(del.filters).toEqual({ username: 'ali.khan', success: false });
    expect(logs(db)[0].payload.action).toBe('access.unlocked');
  });
  it('set_disabled bans the login for a long time, and enabling lifts the ban', async () => {
    let r = await setup({ single: { profiles: () => person } });
    await r.handler(post({ action: 'set_disabled', user_id: 'u1', disabled: true }, BEARER));
    expect(r.adminApi.updateUserById).toHaveBeenCalledWith('u1', { ban_duration: '876000h' });
    expect(r.db.calls.find((c) => c.table === 'profiles' && c.kind === 'update').payload.disabled_at).toBeTruthy();
    r = await setup({ single: { profiles: () => person } });
    await r.handler(post({ action: 'set_disabled', user_id: 'u1', disabled: false }, BEARER));
    expect(r.adminApi.updateUserById).toHaveBeenCalledWith('u1', { ban_duration: 'none' });
    expect(r.db.calls.find((c) => c.table === 'profiles' && c.kind === 'update').payload.disabled_at).toBeNull();
  });
  it('only a literal true disables (the string "false" must not)', async () => {
    const { handler, adminApi } = await setup({ single: { profiles: () => person } });
    await handler(post({ action: 'set_disabled', user_id: 'u1', disabled: 'false' }, BEARER));
    expect(adminApi.updateUserById).toHaveBeenCalledWith('u1', { ban_duration: 'none' });
  });
});
