// Handler-level tests for the notify-ntfy Edge Function (Audit 0): the two shared-secret gates, delivery to ntfy (fetch is stubbed),
// and that every failure is recorded with the topic and token scrubbed out of the stored text. No network is used.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ENV, loadHandler, post } from '../helpers/edgeHarness.js';

const TOPIC = 'secret-topic-abc123';
const TOKEN = 'tk_supersecrettoken';
const env = {
  ...ENV,
  NTFY_TOPIC: TOPIC,
  NTFY_TOKEN: TOKEN,
  NOTIFY_DRAIN_SECRET: 'drain-secret-value',
  OPS_REPORT_SECRET: 'ops-secret-value',
};
const ROW = { id: 'n1', kind: 'backup.failed', payload: { day: '2026-11-27' } };
const OK_REPORT = { action: 'backup_report', kind: 'daily', status: 'failed', error: 'dump failed' };

afterEach(() => vi.unstubAllGlobals());

async function setup({ rows = [ROW], fetchImpl = async () => new Response('ok', { status: 200 }), e = env, rpcImpl } = {}) {
  const fetchMock = vi.fn(fetchImpl);
  vi.stubGlobal('fetch', fetchMock);
  const rpc = vi.fn(
    rpcImpl ??
      (async (name) => {
        if (name === 'notifications_claim') return { data: rows, error: null };
        if (name === 'notify_owner') return { data: 'id-1', error: null };
        return { data: null, error: null };
      }),
  );
  const handler = await loadHandler('notify-ntfy', { env: e, clients: { serviceClient: () => ({ rpc }) } });
  return { handler, rpc, fetchMock };
}
const call = (handler, body, secret) => handler(post(body, secret === undefined ? {} : { 'x-ops-secret': secret }));
const marks = (rpc) => rpc.mock.calls.filter((c) => c[0] === 'notifications_mark').map((c) => c[1]);

describe('notify-ntfy secret gates', () => {
  it('refuses GET and an unknown action', async () => {
    const { handler } = await setup();
    expect((await handler(new Request('https://x/fn', { method: 'GET' }))).status).toBe(405);
    expect((await call(handler, { action: 'wipe' }, 'drain-secret-value')).status).toBe(400);
  });
  it.each([
    ['drain', 'ops-secret-value'],
    ['enqueue', 'drain-secret-value'],
    ['backup_report', 'drain-secret-value'],
    ['drain', ''],
    ['drain', undefined],
  ])('%s refuses the wrong or missing secret (%s) and touches nothing', async (action, wrong) => {
    const { handler, rpc, fetchMock } = await setup();
    expect((await call(handler, { action }, wrong)).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('fails closed when the secret is not configured, even for an empty header', async () => {
    const { handler, rpc } = await setup({ e: { ...ENV, NTFY_TOPIC: TOPIC } });
    expect((await call(handler, { action: 'drain' }, '')).status).toBe(500);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('notify-ntfy drain', () => {
  it('claims at most 20 rows, posts each to the topic with the token, and marks them sent', async () => {
    const { handler, rpc, fetchMock } = await setup();
    const res = await call(handler, { action: 'drain' }, 'drain-secret-value');
    expect(await res.json()).toEqual({ sent: 1, failed: 0 });
    expect(rpc).toHaveBeenCalledWith('notifications_claim', { p_limit: 20 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://ntfy.sh/');
    expect(init.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(init.body).topic).toBe(TOPIC);
    expect(marks(rpc)).toEqual([{ p_id: 'n1', p_ok: true, p_error: null }]);
  });
  it('with nothing to send it sends nothing', async () => {
    const { handler, fetchMock } = await setup({ rows: [] });
    expect(await (await call(handler, { action: 'drain' }, 'drain-secret-value')).json()).toEqual({ sent: 0, failed: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('a missing topic is a recorded failure with a plain reason, never silent', async () => {
    const { handler, rpc, fetchMock } = await setup({ e: { ...env, NTFY_TOPIC: '' } });
    expect(await (await call(handler, { action: 'drain' }, 'drain-secret-value')).json()).toEqual({ sent: 0, failed: 1 });
    expect(marks(rpc)[0]).toMatchObject({ p_ok: false, p_error: 'NTFY_TOPIC secret is not set' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('refuses a non-https server and records it', async () => {
    const { handler, rpc, fetchMock } = await setup({ e: { ...env, NTFY_SERVER: 'http://insecure.example' } });
    await call(handler, { action: 'drain' }, 'drain-secret-value');
    expect(marks(rpc)[0].p_error).toBe('NTFY_SERVER must be an https address');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('an ntfy refusal is recorded, and neither the topic nor the token reaches the stored text', async () => {
    const leak = `rate limited for ${TOPIC} using ${TOKEN}`;
    const { handler, rpc } = await setup({ fetchImpl: async () => new Response(leak, { status: 500 }) });
    expect(await (await call(handler, { action: 'drain' }, 'drain-secret-value')).json()).toEqual({ sent: 0, failed: 1 });
    const m = marks(rpc)[0];
    expect(m.p_ok).toBe(false);
    expect(m.p_error).toContain('ntfy answered 500');
    expect(m.p_error).not.toContain(TOPIC);
    expect(m.p_error).not.toContain(TOKEN);
  });
  it('a network error is recorded with secrets scrubbed, and the next row is still tried', async () => {
    let n = 0;
    const { handler, rpc, fetchMock } = await setup({
      rows: [ROW, { ...ROW, id: 'n2' }],
      fetchImpl: async () => {
        if (n++ === 0) throw new Error(`connect failed to ${TOPIC}`);
        return new Response('ok', { status: 200 });
      },
    });
    expect(await (await call(handler, { action: 'drain' }, 'drain-secret-value')).json()).toEqual({ sent: 1, failed: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [a, b] = marks(rpc);
    expect(a.p_ok).toBe(false);
    expect(a.p_error).not.toContain(TOPIC);
    expect(b).toMatchObject({ p_id: 'n2', p_ok: true });
  });
  it('a claim failure is a plain 500 that leaks no detail', async () => {
    const { handler } = await setup({ rpcImpl: async () => ({ data: null, error: { message: 'internal detail' } }) });
    const res = await call(handler, { action: 'drain' }, 'drain-secret-value');
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('internal detail');
  });
});

describe('notify-ntfy enqueue and backup_report', () => {
  it('enqueue refuses a kind that is not on the allow-list', async () => {
    const { handler, rpc } = await setup();
    expect((await call(handler, { action: 'enqueue', kind: 'closing.submitted', payload: {} }, 'ops-secret-value')).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
  it('enqueue queues an allowed kind with a cleaned payload, then delivers', async () => {
    const { handler, rpc } = await setup();
    const res = await call(
      handler,
      { action: 'enqueue', kind: 'backup.failed', payload: { day: '2026-11-27', 'Bad Key': 'x', nested: { a: 1 }, n: 3 } },
      'ops-secret-value',
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ queued: true, sent: 1 });
    expect(rpc).toHaveBeenCalledWith('notify_owner', { p_kind: 'backup.failed', p_payload: { day: '2026-11-27', n: 3 } });
  });
  it('backup_report refuses a malformed report, and a success that does not say what it saved', async () => {
    const { handler, rpc } = await setup();
    expect((await call(handler, { action: 'backup_report', kind: 'hourly', status: 'ok' }, 'ops-secret-value')).status).toBe(400);
    expect((await call(handler, { action: 'backup_report', kind: 'daily', status: 'ok' }, 'ops-secret-value')).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
  it('backup_report records a failed report and then drains', async () => {
    const { handler, rpc } = await setup();
    const res = await call(handler, OK_REPORT, 'ops-secret-value');
    expect(await res.json()).toMatchObject({ recorded: true });
    expect(rpc).toHaveBeenCalledWith(
      'backup_report',
      expect.objectContaining({ p_kind: 'daily', p_status: 'failed', p_error: 'dump failed' }),
    );
  });
  it('backup_report: a database error is a plain 500', async () => {
    const { handler } = await setup({ rpcImpl: async () => ({ data: null, error: { message: 'internal detail' } }) });
    const res = await call(handler, OK_REPORT, 'ops-secret-value');
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('internal detail');
  });
});
