// Handler-level tests for the attendance-health Edge Function (Audit 0, T3). Public endpoint (verify_jwt = false): its own checks are the
// only gate. The phone reports tracking problems, never a location.
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { ENV, loadHandler, post } from '../helpers/edgeHarness.js';

const DEVICE = '3f2b8c1e-6a4d-4e0b-9c57-1d2e3f4a5b6c';
const SECRET = 'cd'.repeat(32);
const sha = (s) => createHash('sha256').update(s).digest('hex');
const body = { device_id: DEVICE, secret: SECRET, state: 'location_off', pending: 3 };

async function setup(impl = async () => ({ data: { ok: true }, error: null })) {
  const rpc = vi.fn(impl);
  const handler = await loadHandler('attendance-health', { env: ENV, clients: { serviceClient: () => ({ rpc }) } });
  return { rpc, handler };
}

describe('attendance-health handler', () => {
  it('refuses GET', async () => {
    const { handler } = await setup();
    expect((await handler(new Request('https://x/fn', { method: 'GET' }))).status).toBe(405);
  });

  it.each([
    ['an unknown state', { state: 'gps_exploded' }],
    ['a state sent as a number', { state: 7 }],
    ['a negative pending count', { pending: -1 }],
    ['more than 1000 pending', { pending: 1001 }],
    ['a fractional pending count', { pending: 1.5 }],
    ['a pending count sent as a string', { pending: '3' }],
    ['a missing pending count', { pending: undefined }],
    ['a bad device id', { device_id: 'abc' }],
    ['a short secret', { secret: 'abcd' }],
    ['a non-hex secret', { secret: 'z'.repeat(64) }],
  ])('refuses %s with 400 and never calls the database', async (_n, patch) => {
    const { handler, rpc } = await setup();
    expect((await handler(post({ ...body, ...patch }))).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each(['no_precise_location', 'location_off', 'no_background_location', 'background_restricted', 'not_registered'])(
    'accepts the state %s',
    async (state) => {
      const { handler, rpc } = await setup();
      expect((await handler(post({ ...body, state }))).status).toBe(200);
      expect(rpc.mock.calls[0][1].p_state).toBe(state);
    },
  );

  it('a null or absent state means everything works', async () => {
    let r = await setup();
    expect((await r.handler(post({ ...body, state: null }))).status).toBe(200);
    expect(r.rpc.mock.calls[0][1].p_state).toBeNull();
    r = await setup();
    const noState = { ...body };
    delete noState.state;
    expect((await r.handler(post(noState))).status).toBe(200);
    expect(r.rpc.mock.calls[0][1].p_state).toBeNull();
  });

  it('sends only the hashed secret and the report, and ignores any location the phone adds', async () => {
    const { handler, rpc } = await setup();
    const res = await handler(post({ ...body, device_id: DEVICE.toUpperCase(), latitude: 33.5, longitude: 73.1 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0]).toEqual([
      'app_attendance_health',
      { p_device_id: DEVICE, p_secret_hash: sha(SECRET), p_state: 'location_off', p_pending: 3 },
    ]);
    expect(JSON.stringify(rpc.mock.calls)).not.toMatch(new RegExp(`${SECRET}|33\\.5|73\\.1`));
  });

  it('maps database answers: no row 401, invalid 22023 400, other error 500 without detail', async () => {
    let r = await setup(async () => ({ data: null, error: null }));
    expect((await r.handler(post(body))).status).toBe(401);
    r = await setup(async () => ({ data: null, error: { code: '22023', message: 'bad' } }));
    expect((await r.handler(post(body))).status).toBe(400);
    r = await setup(async () => ({ data: null, error: { code: 'XX000', message: 'internal detail' } }));
    const res = await r.handler(post(body));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('internal detail');
    r = await setup(async () => {
      throw new Error('boom');
    });
    expect((await r.handler(post(body))).status).toBe(500);
  });
});
