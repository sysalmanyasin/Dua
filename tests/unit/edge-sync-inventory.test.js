// Handler-level tests for sync-inventory-from-dropbox (Audit 0): who may trigger a sync, what happens when Dropbox or the database
// misbehaves, the unchanged-file shortcut, the payload sent to the database, and the 20% removal guard. Dropbox (fetch) and Supabase are fakes.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ENV, fakeDb, loadHandler, post } from '../helpers/edgeHarness.js';

const SYNC_SECRET = 'sync-secret-value';
const REFRESH = 'sl.refresh-token-value-123';
const env = {
  ...ENV,
  INVENTORY_SYNC_SECRET: SYNC_SECRET,
  DROPBOX_APP_KEY: 'appkey',
  DROPBOX_APP_SECRET: 'appsecret',
  DROPBOX_REFRESH_TOKEN: REFRESH,
};
const FILE = {
  products: [
    { code: 'A1', name: 'Test Syrup', stock: 12, unitPrice: 55.5, supplier: 'Sup A', conversionFactor: 10, isTaxable: true },
    { code: 'A2', name: 'Test Tablet', stock: 3 },
    { code: 'A3', stock: 9 },
  ],
  strLast7Days: [{ strId: 1, strNumber: 'S1', direction: 'in' }],
  strLineItemsLast7Days: [
    { strId: 1, strItemId: 10, productCode: 'A1', strQty: 2 },
    { strId: 99, strItemId: 11, productCode: 'A1', strQty: 2 },
  ],
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function setup({
  file = FILE,
  hash = 'h-new',
  storedHash = 'h-old',
  tokenOk = true,
  downloadOk = true,
  rpcImpl,
  userCaller,
  e = env,
} = {}) {
  const fetchMock = vi.fn(async (url) => {
    if (String(url).includes('oauth2/token'))
      return tokenOk ? Response.json({ access_token: 'tok' }) : new Response('invalid_grant', { status: 400 });
    if (String(url).includes('get_metadata'))
      return hash === null ? new Response('no', { status: 500 }) : Response.json({ content_hash: hash });
    return downloadOk ? Response.json(file) : new Response('nope', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  const rpc = vi.fn(rpcImpl ?? (async () => ({ data: { ok: true, result: 'synced' }, error: null })));
  const db = { ...fakeDb({ single: { inventory_sync_state: () => ({ data: { content_hash: storedHash }, error: null }) } }), rpc };
  const handler = await loadHandler('sync-inventory-from-dropbox', {
    env: e,
    clients: { serviceClient: () => db, userClient: () => userCaller },
  });
  return { handler, rpc, fetchMock };
}
const scheduled = (body = {}) => post(body, { 'x-sync-secret': SYNC_SECRET });
const names = (rpc) => rpc.mock.calls.map((c) => c[0]);
const downloads = (f) => f.mock.calls.filter((c) => String(c[0]).includes('files/download')).length;
const caller = (user, allowed) => ({ auth: { getUser: async () => ({ data: { user } }) }, rpc: async () => ({ data: allowed }) });

describe('who may trigger a sync', () => {
  it('answers the preflight and refuses GET', async () => {
    const { handler } = await setup();
    expect((await handler(new Request('https://x/fn', { method: 'OPTIONS', headers: { origin: ENV.ALLOWED_ORIGIN } }))).status).toBe(204);
    expect((await handler(new Request('https://x/fn', { method: 'GET' }))).status).toBe(405);
  });
  it.each([
    ['no credentials', {}],
    ['a wrong secret', { 'x-sync-secret': 'wrong-secret-value' }],
    ['an empty secret header', { 'x-sync-secret': '' }],
    ['a non-bearer authorization', { authorization: 'Basic abc' }],
  ])('refuses %s with 401 and does nothing', async (_n, headers) => {
    const { handler, rpc, fetchMock } = await setup();
    expect((await handler(post({}, headers))).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('an unset INVENTORY_SYNC_SECRET never matches an empty header', async () => {
    const { handler, fetchMock } = await setup({ e: { ...env, INVENTORY_SYNC_SECRET: '' } });
    expect((await handler(post({}, { 'x-sync-secret': '' }))).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('a signed-in person without inventory.sync, or an invalid token, gets 403', async () => {
    let s = await setup({ userCaller: caller({ id: 'u1' }, false) });
    expect((await s.handler(post({}, { authorization: 'Bearer jwt' }))).status).toBe(403);
    s = await setup({ userCaller: caller({ id: 'u1' }, null) });
    expect((await s.handler(post({}, { authorization: 'Bearer jwt' }))).status).toBe(403);
    s = await setup({ userCaller: caller(null, true) });
    expect((await s.handler(post({}, { authorization: 'Bearer jwt' }))).status).toBe(403);
    expect(s.fetchMock).not.toHaveBeenCalled();
  });
  it('a signed-in person with inventory.sync may sync and is recorded as the trigger', async () => {
    const { handler, rpc } = await setup({ userCaller: caller({ id: 'owner-1' }, true) });
    expect((await handler(post({}, { authorization: 'Bearer jwt' }))).status).toBe(200);
    expect(rpc.mock.calls[0][1].meta.triggered_by).toBe('owner-1');
  });
  it('names a missing Dropbox secret without revealing any value', async () => {
    const { handler, fetchMock } = await setup({ e: { ...env, DROPBOX_APP_SECRET: '' } });
    const res = await handler(scheduled());
    expect(res.status).toBe(500);
    const text = JSON.stringify(await res.json());
    expect(text).toContain('DROPBOX_APP_SECRET');
    expect(text).not.toContain(REFRESH);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('Dropbox and database failures keep the old data and are logged', () => {
  it('a failed token refresh is 502, logged, and the log never holds the refresh token', async () => {
    const { handler, rpc } = await setup({ tokenOk: false });
    const res = await handler(scheduled());
    expect(res.status).toBe(502);
    const log = rpc.mock.calls.find((c) => c[0] === 'inventory_log_sync_failure');
    expect(log[1].p_source).toBe('dropbox');
    expect(log[1].p_error).not.toContain(REFRESH);
    expect(names(rpc)).not.toContain('inventory_apply_sync_body');
  });
  it('a failed download is 502 and logged; nothing is applied', async () => {
    const { handler, rpc } = await setup({ downloadOk: false });
    expect((await handler(scheduled())).status).toBe(502);
    expect(names(rpc)).toEqual(['inventory_log_sync_failure']);
  });
  it.each([
    ['not an object', [1, 2]],
    ['an object with no products', { products: [] }],
    ['products without names', { products: [{ code: 'x', stock: 1 }] }],
  ])('a file that is %s is refused with 422 and nothing is applied', async (_n, file) => {
    const { handler, rpc } = await setup({ file });
    expect((await handler(scheduled())).status).toBe(422);
    expect(names(rpc)).toEqual(['inventory_log_sync_failure']);
  });
  it('a database error is a plain 500 and is logged', async () => {
    const { handler, rpc } = await setup({
      rpcImpl: async (name) =>
        name === 'inventory_apply_sync_body' ? { data: null, error: { message: 'boom' } } : { data: null, error: null },
    });
    const res = await handler(scheduled());
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('Sync failed; previous data kept');
    expect(names(rpc)).toContain('inventory_log_sync_failure');
  });
  it('falls back to the older named-argument function only on PGRST202', async () => {
    let calls = 0;
    const { handler, rpc } = await setup({
      rpcImpl: async (name) => {
        calls++;
        if (name === 'inventory_apply_sync_body') return { data: null, error: { code: 'PGRST202', message: 'not found' } };
        return { data: { ok: true }, error: null };
      },
    });
    expect((await handler(scheduled())).status).toBe(200);
    expect(names(rpc)).toEqual(['inventory_apply_sync_body', 'inventory_apply_sync']);
    expect(calls).toBe(2);
  });
  it('retries once after a statement timeout, then succeeds', async () => {
    vi.useFakeTimers();
    let n = 0;
    const { handler, rpc } = await setup({
      rpcImpl: async () =>
        n++ === 0
          ? { data: null, error: { message: 'canceling statement due to statement timeout' } }
          : { data: { ok: true }, error: null },
    });
    const pending = handler(scheduled());
    await vi.advanceTimersByTimeAsync(5000);
    expect((await pending).status).toBe(200);
    expect(names(rpc).filter((x) => x === 'inventory_apply_sync_body')).toHaveLength(2);
    expect(names(rpc)).not.toContain('inventory_log_sync_failure');
  });
});

describe('what a sync sends and answers', () => {
  it('an unchanged file is checked, not downloaded or applied', async () => {
    const { handler, rpc, fetchMock } = await setup({ hash: 'same', storedHash: 'same' });
    const res = await handler(scheduled());
    expect(await res.json()).toMatchObject({ ok: true, result: 'unchanged', skipped: true });
    expect(names(rpc)).toEqual(['inventory_note_unchanged']);
    expect(downloads(fetchMock)).toBe(0);
  });
  it('recheck skips the shortcut; an unreadable hash downloads anyway', async () => {
    let s = await setup({ hash: 'same', storedHash: 'same' });
    await s.handler(scheduled({ recheck: true }));
    expect(downloads(s.fetchMock)).toBe(1);
    s = await setup({ hash: null });
    await s.handler(scheduled());
    expect(downloads(s.fetchMock)).toBe(1);
  });
  it('maps the file into the database payload: nameless products dropped, defaults applied, orphan line items dropped', async () => {
    const { handler, rpc } = await setup();
    await handler(scheduled());
    const [fn, body] = rpc.mock.calls[0];
    expect(fn).toBe('inventory_apply_sync_body');
    expect(body.meta).toEqual({ source: 'dropbox', triggered_by: null, force: false, content_hash: 'h-new' });
    expect(body.products.map((p) => p.code)).toEqual(['A1', 'A2']);
    expect(body.products[0]).toMatchObject({
      qty: 12,
      price: 55.5,
      supplier: 'Sup A',
      conversion_factor: 10,
      pack_valid: true,
      is_taxable: true,
    });
    expect(body.products[1]).toMatchObject({
      company: 'Unassigned Manufacturer',
      supplier: 'Unassigned Supplier',
      conversion_factor: 1,
      pack_valid: false,
      is_taxable: false,
    });
    expect(body.str_line_items.map((l) => l.str_item_id)).toEqual([10]);
  });
  it('a scheduled call can never confirm a large removal; a signed-in owner can', async () => {
    let s = await setup();
    await s.handler(scheduled({ confirmRemoval: true }));
    expect(s.rpc.mock.calls[0][1].meta.force).toBe(false);
    s = await setup({ userCaller: caller({ id: 'owner-1' }, true) });
    await s.handler(post({ confirmRemoval: true }, { authorization: 'Bearer jwt' }));
    expect(s.rpc.mock.calls[0][1].meta.force).toBe(true);
    s = await setup({ userCaller: caller({ id: 'owner-1' }, true) });
    await s.handler(post({ confirmRemoval: 'true' }, { authorization: 'Bearer jwt' }));
    expect(s.rpc.mock.calls[0][1].meta.force).toBe(false);
  });
  it('answers 409 when another sync is running and 422 when the removal guard refuses', async () => {
    let s = await setup({ rpcImpl: async () => ({ data: { busy: true }, error: null }) });
    expect((await s.handler(scheduled())).status).toBe(409);
    s = await setup({ rpcImpl: async () => ({ data: { refused: true, wouldRemove: 30, active: 100 }, error: null }) });
    const res = await s.handler(scheduled());
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ refused: true, wouldRemove: 30, active: 100 });
  });
  it('a good sync returns the database result with a timestamp', async () => {
    const { handler } = await setup({ rpcImpl: async () => ({ data: { ok: true, changed: 4 }, error: null }) });
    const out = await (await handler(scheduled())).json();
    expect(out).toMatchObject({ ok: true, changed: 4 });
    expect(Date.parse(out.syncedAt)).not.toBeNaN();
  });
});
