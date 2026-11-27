// Handler-level tests for the public device endpoints (Audit 0, T3): attendance-event, widget-today, and the shared-secret
// gate of notify-push. These endpoints have verify_jwt = false in supabase/config.toml, so their own checks are the only gate.
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { ENV, loadHandler, post } from '../helpers/edgeHarness.js';

const DEVICE = '3f2b8c1e-6a4d-4e0b-9c57-1d2e3f4a5b6c';
const EVENT = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const SECRET = 'ab'.repeat(32);
const sha = (s) => createHash('sha256').update(s).digest('hex');
const rpcClient = (impl) => {
  const rpc = vi.fn(impl);
  return { rpc, client: () => ({ rpc }) };
};

describe('widget-today handler', () => {
  const setup = async (impl = async () => ({ data: { total: 1250 }, error: null })) => {
    const { rpc, client } = rpcClient(impl);
    return { rpc, handler: await loadHandler('widget-today', { env: ENV, clients: { serviceClient: client } }) };
  };
  it('refuses GET and malformed bodies without touching the database', async () => {
    const { handler, rpc } = await setup();
    expect((await handler(new Request('https://x/fn', { method: 'GET' }))).status).toBe(405);
    for (const bad of [
      {},
      { device_id: 'nope', secret: SECRET },
      { device_id: DEVICE, secret: 'short' },
      { device_id: DEVICE, secret: 'g'.repeat(64) },
    ]) {
      expect((await handler(post(bad))).status).toBe(400);
    }
    expect(rpc).not.toHaveBeenCalled();
  });
  it('sends only the SHA-256 of the secret to the database, never the secret', async () => {
    const { handler, rpc } = await setup();
    const res = await handler(post({ device_id: DEVICE.toUpperCase(), secret: SECRET }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ total: 1250 });
    expect(rpc).toHaveBeenCalledWith('app_widget_today', { p_device_id: DEVICE, p_secret_hash: sha(SECRET) });
    expect(JSON.stringify(rpc.mock.calls)).not.toContain(SECRET);
  });
  it('a wrong secret, a switched-off person and a revoked right all look the same: 401', async () => {
    const { handler } = await setup(async () => ({ data: null, error: null }));
    const res = await handler(post({ device_id: DEVICE, secret: SECRET }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'sign in again' });
  });
  it('a database error is a plain 500 that leaks nothing', async () => {
    const { handler } = await setup(async () => ({ data: null, error: { message: 'relation x secret detail' } }));
    const res = await handler(post({ device_id: DEVICE, secret: SECRET }));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toMatch(/relation|secret detail/);
  });
  it('a thrown error is a plain 500', async () => {
    const { handler } = await setup(async () => {
      throw new Error('boom');
    });
    expect((await handler(post({ device_id: DEVICE, secret: SECRET }))).status).toBe(500);
  });
});

describe('attendance-event handler', () => {
  const body = {
    device_id: DEVICE,
    secret: SECRET,
    event_id: EVENT,
    kind: 'in',
    at: 1_800_000_000_000,
    latitude: 33.5,
    longitude: 73.1,
    accuracy: 12,
  };
  const setup = async (impl = async () => ({ data: { recorded: true }, error: null })) => {
    const { rpc, client } = rpcClient(impl);
    return { rpc, handler: await loadHandler('attendance-event', { env: ENV, clients: { serviceClient: client } }) };
  };
  it.each([
    ['an unknown kind', { kind: 'sideways' }],
    ['a time before 2020', { at: 1000 }],
    ['a latitude beyond 90', { latitude: 91 }],
    ['a longitude beyond 180', { longitude: -181 }],
    ['a negative accuracy', { accuracy: -1 }],
    ['a string coordinate', { latitude: '33.5' }],
    ['a non-hex secret', { secret: 'z'.repeat(64) }],
    ['a bad event id', { event_id: '123' }],
  ])('refuses %s with 400 and never calls the database', async (_n, patch) => {
    const { handler, rpc } = await setup();
    expect((await handler(post({ ...body, ...patch }))).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
  it('refuses GET', async () => {
    const { handler } = await setup();
    expect((await handler(new Request('https://x/fn', { method: 'GET' }))).status).toBe(405);
  });
  it('passes the hashed secret and the phone report to the database, and returns its answer', async () => {
    const { handler, rpc } = await setup();
    const res = await handler(post({ ...body, mock: true }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ recorded: true });
    const [fn, args] = rpc.mock.calls[0];
    expect(fn).toBe('app_attendance_event');
    expect(args).toMatchObject({
      p_device_id: DEVICE,
      p_secret_hash: sha(SECRET),
      p_event_id: EVENT,
      p_kind: 'in',
      p_lat: 33.5,
      p_lng: 73.1,
      p_accuracy: 12,
      p_mock: true,
    });
    expect(args.p_at).toBe(new Date(1_800_000_000_000).toISOString());
    expect(JSON.stringify(rpc.mock.calls)).not.toContain(SECRET);
  });
  it('mock defaults to false unless the phone says exactly true', async () => {
    const { handler, rpc } = await setup();
    await handler(post({ ...body, mock: 'true' }));
    expect(rpc.mock.calls[0][1].p_mock).toBe(false);
  });
  it('maps the database answers: no row -> 401, invalid event (22023) -> 400, any other error -> 500', async () => {
    let r = await setup(async () => ({ data: null, error: null }));
    expect((await r.handler(post(body))).status).toBe(401);
    r = await setup(async () => ({ data: null, error: { code: '22023', message: 'invalid event' } }));
    expect((await r.handler(post(body))).status).toBe(400);
    r = await setup(async () => ({ data: null, error: { code: 'XX000', message: 'internal detail' } }));
    const res = await r.handler(post(body));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('internal detail');
  });
});

describe('notify-push shared-secret gate', () => {
  const env = { ...ENV, NOTIFY_DRAIN_SECRET: 'drain-secret-value', OPS_REPORT_SECRET: 'ops-secret-value' };
  const setup = async (e = env) => {
    const { rpc, client } = rpcClient(async () => ({ data: [], error: null }));
    return { rpc, handler: await loadHandler('notify-push', { env: e, clients: { serviceClient: client } }) };
  };
  const call = (handler, body, secret) => handler(post(body, secret === undefined ? {} : { 'x-ops-secret': secret }));

  it('refuses GET and an unknown action', async () => {
    const { handler } = await setup();
    expect((await handler(new Request('https://x/fn', { method: 'GET' }))).status).toBe(405);
    expect((await call(handler, { action: 'wipe' }, 'drain-secret-value')).status).toBe(400);
  });
  it.each([
    ['drain', 'ops-secret-value'],
    ['enqueue', 'drain-secret-value'],
    ['backup_report', 'drain-secret-value'],
  ])("%s refuses the other action's secret", async (action, wrong) => {
    const { handler, rpc } = await setup();
    expect((await call(handler, { action }, wrong)).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });
  it('refuses a missing or empty secret', async () => {
    const { handler, rpc } = await setup();
    expect((await call(handler, { action: 'drain' })).status).toBe(401);
    expect((await call(handler, { action: 'drain' }, '')).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });
  it('fails closed when the secret is not configured, even for an empty header', async () => {
    const { handler, rpc } = await setup({ ...ENV });
    expect((await call(handler, { action: 'drain' }, '')).status).toBe(500);
    expect(rpc).not.toHaveBeenCalled();
  });
  it('drain with the right secret claims work from the database', async () => {
    const { handler, rpc } = await setup();
    const res = await call(handler, { action: 'drain' }, 'drain-secret-value');
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('notifications_claim', { p_limit: 20 });
  });
  it('enqueue refuses a kind that is not on the allow-list', async () => {
    const { handler, rpc } = await setup();
    const res = await call(handler, { action: 'enqueue', kind: 'closing.submitted', payload: {} }, 'ops-secret-value');
    expect(res.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
  it('backup_report refuses a malformed report', async () => {
    const { handler } = await setup();
    expect((await call(handler, { action: 'backup_report', kind: 'daily' }, 'ops-secret-value')).status).toBe(400);
  });
});
