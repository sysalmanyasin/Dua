import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import { openLocalDb } from '../../js/modules/ebill/data/localDb.js';
import { checkVerifier, makeVerifier } from '../../js/modules/ebill/data/localPin.js';
import { createKit } from '../../js/modules/ebill/data/offlineKit.js';
import { createSync, startAutoSync } from '../../js/modules/ebill/data/sync.js';
import { checkDiscount, classifyError, localRef } from '../../js/modules/ebill/domain/offline.js';
import { billTotals } from '../../js/modules/ebill/domain/calc.js';

const rec = (id, over = {}) => ({
  invoice_id: id,
  user_id: 'u1',
  status: 'pending',
  created_at: `2026-11-15T10:0${id.slice(-1)}:00Z`,
  attempts: 0,
  payload: { invoice_id: id, offline_proof: 'secret' },
  net_total: 10,
  ...over,
});
const newDb = () => openLocalDb(new IDBFactory(), 'test-' + Math.random());

describe('local database', () => {
  it('keeps an invoice across closing and reopening (a restart)', async () => {
    const factory = new IDBFactory();
    const a = await openLocalDb(factory, 'dua-ebill');
    expect(a.durable).toBe(true);
    await a.putInvoice(rec('i1'));
    await a.kvSet('lastSyncAt', '2026-11-15T09:00:00Z');
    a.close();
    const b = await openLocalDb(factory, 'dua-ebill');
    expect((await b.getInvoice('i1')).payload.offline_proof).toBe('secret');
    expect(await b.kvGet('lastSyncAt')).toBe('2026-11-15T09:00:00Z');
    expect(await b.allInvoices()).toHaveLength(1);
  });
  it('patches in place, deletes, and returns null for what is not there', async () => {
    const d = await newDb();
    await d.putInvoice(rec('i1'));
    expect((await d.patchInvoice('i1', { status: 'synced' })).status).toBe('synced');
    expect((await d.getInvoice('i1')).payload.invoice_id).toBe('i1'); // untouched parts stay
    expect(await d.patchInvoice('nope', { status: 'x' })).toBeNull();
    await d.deleteInvoice('i1');
    expect(await d.getInvoice('i1')).toBeNull();
    expect(await d.kvGet('missing')).toBeNull();
  });
  it('falls back to memory (and says it is not durable) when IndexedDB is missing or broken', async () => {
    const none = await openLocalDb(null);
    expect(none.durable).toBe(false);
    await none.putInvoice(rec('i1'));
    expect(await none.allInvoices()).toHaveLength(1);
    const broken = {
      open: () => {
        const r = {};
        setTimeout(() => r.onerror?.(), 0);
        return r;
      },
    };
    expect((await openLocalDb(broken)).durable).toBe(false);
  });
});

describe('local PIN verifier', () => {
  it('accepts the right PIN, refuses others, and never contains the PIN', async () => {
    const v = await makeVerifier('482913', 1000);
    expect(JSON.stringify(v)).not.toContain('482913');
    expect(await checkVerifier('482913', v)).toBe(true);
    expect(await checkVerifier('482914', v)).toBe(false);
    expect(await checkVerifier('', v)).toBe(false);
    expect(await checkVerifier('482913', null)).toBe(false);
    const w = await makeVerifier('482913', 1000);
    expect(w.hash).not.toBe(v.hash); // salted
  });
});

describe('offline rules', () => {
  const lines = [{ rate: 100, qty: 1 }];
  const totals = (disc) => billTotals({ lines: [{ rate: 100, qty: 1, discount: { mode: 'pct', value: disc } }] });
  it('applies the same limits as the server', () => {
    const lim = { max_pct: 10, max_amount: 1000, override: false };
    expect(checkDiscount(totals(10), lines, lim).ok).toBe(true);
    expect(checkDiscount(totals(11), lines, lim)).toMatchObject({ ok: false, code: 'discount_limit' });
    expect(
      checkDiscount(
        billTotals({ lines: [{ rate: 20000, qty: 1, discount: { mode: 'amt', value: 1200 } }] }),
        [{ rate: 20000, qty: 1 }],
        lim,
      ).ok,
    ).toBe(false);
    expect(checkDiscount(totals(50), lines, { ...lim, override: true }).ok).toBe(true);
    expect(checkDiscount(totals(50), lines, null).ok).toBe(true); // nothing known: the server decides
  });
  it('makes a readable local reference', () => {
    expect(localRef('3fa9aaaa-0000', new Date('2026-11-15T10:00:00Z'))).toBe('LOCAL-261115-3FA9');
  });
  it('tells network, auth and server errors apart', () => {
    expect(classifyError(new Error('TypeError: Failed to fetch'))).toBe('network');
    expect(classifyError({ status: 0 })).toBe('network');
    expect(classifyError(new Error('x'), false)).toBe('network');
    expect(classifyError({ status: 401, message: 'x' })).toBe('auth');
    expect(classifyError(new Error('JWT expired'))).toBe('auth');
    expect(classifyError({ code: '42501', message: 'not allowed' })).toBe('server');
  });
});

function harness({ online = true, user = 'u1', save } = {}) {
  const state = { online, user };
  const api = {
    saveInvoice: vi.fn(save ?? (async (p) => ({ ok: true, code: 'saved', invoice_no: 'EB-' + p.invoice_id }))),
    registerDevice: vi.fn(async () => ({ ok: true, status: 'active' })),
  };
  return { state, api };
}
const mkSync = async (h, extra = {}) => {
  const store = await newDb();
  const clock = { t: new Date('2026-11-15T12:00:00Z') };
  const sync = createSync({
    store,
    api: h.api,
    userId: async () => h.state.user,
    deviceId: 'dev1',
    online: () => h.state.online,
    now: () => clock.t,
    ...extra,
  });
  return { store, sync, clock };
};

describe('sync', () => {
  it('uploads pending invoices in order, marks them synced only after the server confirms, and records the time', async () => {
    const h = harness();
    const { store, sync } = await mkSync(h);
    await sync.queue(rec('i2'));
    await sync.queue(rec('i1'));
    const r = await sync.syncNow();
    expect(r).toMatchObject({ uploaded: 2, failed: 0, left: 0 });
    expect(h.api.saveInvoice.mock.calls.map((c) => c[0].invoice_id)).toEqual(['i1', 'i2']); // oldest first
    expect(h.api.saveInvoice.mock.calls[0][1]).toBeNull(); // the proof travels inside the payload, never a PIN
    expect((await store.getInvoice('i1')).status).toBe('synced');
    expect((await store.getInvoice('i1')).invoice_no).toBe('EB-i1');
    expect(await store.kvGet('lastSyncAt')).toBe('2026-11-15T12:00:00.000Z');
  });
  it('does nothing offline, and keeps every invoice', async () => {
    const h = harness({ online: false });
    const { store, sync } = await mkSync(h);
    await sync.queue(rec('i1'));
    expect(await sync.syncNow()).toMatchObject({ offline: true });
    expect(h.api.saveInvoice).not.toHaveBeenCalled();
    expect((await store.getInvoice('i1')).status).toBe('pending');
    expect(await store.kvGet('lastSyncAt')).toBeNull();
  });
  it('an interrupted upload leaves the invoice pending, stops the run, and the next run finishes it', async () => {
    let calls = 0;
    const h = harness({
      save: async (p) => {
        if (++calls === 2) throw new Error('TypeError: Failed to fetch');
        return { ok: true, code: 'saved', invoice_no: 'EB-' + p.invoice_id };
      },
    });
    const { store, sync } = await mkSync(h);
    for (const id of ['i1', 'i2', 'i3']) await sync.queue(rec(id));
    const r = await sync.syncNow();
    expect(r).toMatchObject({ network: true, uploaded: 1, pending: 2 });
    expect((await store.getInvoice('i1')).status).toBe('synced');
    expect((await store.getInvoice('i2')).status).toBe('pending');
    expect((await store.getInvoice('i2')).last_error.code).toBe('network');
    expect((await store.getInvoice('i3')).status).toBe('pending'); // never reached
    expect(await store.kvGet('lastSyncAt')).toBeNull(); // not a successful sync
    const r2 = await sync.syncNow();
    expect(r2).toMatchObject({ uploaded: 2, pending: 0 });
    expect(h.api.saveInvoice.mock.calls.filter((c) => c[0].invoice_id === 'i2')).toHaveLength(2); // same id both times
  });
  it('a server refusal marks that invoice failed with the reason, keeps it, and carries on with the rest', async () => {
    const h = harness({
      save: async (p) =>
        p.invoice_id === 'i1'
          ? { ok: false, code: 'discount_limit', message: 'The discount is above your limit.' }
          : { ok: true, invoice_no: 'EB-x' },
    });
    const { store, sync } = await mkSync(h);
    await sync.queue(rec('i1'));
    await sync.queue(rec('i2'));
    expect(await sync.syncNow()).toMatchObject({ uploaded: 1, failed: 1, left: 1 });
    const f = await store.getInvoice('i1');
    expect(f.status).toBe('failed');
    expect(f.last_error).toEqual({ code: 'discount_limit', message: 'The discount is above your limit.' });
    expect(f.payload.offline_proof).toBe('secret'); // kept whole for review
  });
  it('a deactivated device fails the invoice but never discards it', async () => {
    const h = harness({ save: async () => ({ ok: false, code: 'device_inactive', message: 'This device has been deactivated.' }) });
    const { store, sync } = await mkSync(h);
    await sync.queue(rec('i1'));
    await sync.syncNow();
    expect(await store.getInvoice('i1')).toMatchObject({ status: 'failed', last_error: { code: 'device_inactive' } });
    expect(await sync.snapshot()).toMatchObject({ failed: 1, pending: 0 });
  });
  it('registers the device once and retries when the server does not know it yet', async () => {
    let first = true;
    const h = harness({
      save: async () => (first ? ((first = false), { ok: false, code: 'device_unknown' }) : { ok: true, invoice_no: 'EB-1' }),
    });
    const { store, sync } = await mkSync(h);
    await sync.queue(rec('i1'));
    await sync.syncNow();
    expect(h.api.registerDevice).toHaveBeenCalledWith('dev1', 'Device');
    expect((await store.getInvoice('i1')).status).toBe('synced');
  });
  it('treats duplicate as success: a retry after a lost reply never makes a second invoice', async () => {
    const h = harness({ save: async () => ({ ok: true, code: 'duplicate', invoice_no: 'EB-7' }) });
    const { store, sync } = await mkSync(h);
    await sync.queue(rec('i1'));
    await sync.syncNow();
    expect(await store.getInvoice('i1')).toMatchObject({ status: 'synced', invoice_no: 'EB-7' });
  });
  it('Retry sends failed invoices again; nothing else is touched', async () => {
    let ok = false;
    const h = harness({ save: async () => (ok ? { ok: true, invoice_no: 'EB-9' } : { ok: false, code: 'total_mismatch', message: 'no' }) });
    const { store, sync } = await mkSync(h);
    await sync.queue(rec('i1'));
    await sync.syncNow();
    expect((await store.getInvoice('i1')).status).toBe('failed');
    await sync.syncNow(); // an ordinary run does not retry a failed one on its own
    expect(h.api.saveInvoice).toHaveBeenCalledTimes(1);
    ok = true;
    await sync.retryFailed();
    expect((await store.getInvoice('i1')).status).toBe('synced');
  });
  it("only uploads the signed-in person's invoices and reports the others", async () => {
    const h = harness();
    const { store, sync } = await mkSync(h);
    await sync.queue(rec('i1'));
    await sync.queue(rec('i2', { user_id: 'u2' }));
    await sync.syncNow();
    expect(h.api.saveInvoice).toHaveBeenCalledTimes(1);
    expect((await store.getInvoice('i2')).status).toBe('pending');
    expect(await sync.snapshot()).toMatchObject({ pending: 0, synced: 1, others: 1 });
  });
  it('a lost login leaves everything pending and asks to sign in', async () => {
    const h = harness({
      save: async () => {
        throw { status: 401, message: 'JWT expired' };
      },
    });
    const { store, sync } = await mkSync(h);
    await sync.queue(rec('i1'));
    expect(await sync.syncNow()).toMatchObject({ needsLogin: true, pending: 1 });
    expect((await store.getInvoice('i1')).status).toBe('pending');
    h.state.user = null;
    expect(await sync.syncNow()).toMatchObject({ needsLogin: true });
  });
  it('runs one sync at a time, however often it is asked', async () => {
    let gate;
    const h = harness({
      save: () =>
        new Promise((res) => {
          gate = () => res({ ok: true, invoice_no: 'EB-1' });
        }),
    });
    const { sync } = await mkSync(h);
    await sync.queue(rec('i1'));
    const a = sync.syncNow();
    const b = sync.syncNow();
    expect(a).toBe(b);
    await new Promise((r) => setTimeout(r, 20));
    gate();
    await a;
    expect(h.api.saveInvoice).toHaveBeenCalledTimes(1);
  });
  it('downloads fresh data after a good sync, and a failure there does not undo the sync', async () => {
    const after = vi.fn(async () => {
      throw new Error('boom');
    });
    const h = harness();
    const { store, sync } = await mkSync(h, { afterSync: after });
    await sync.queue(rec('i1'));
    await sync.syncNow();
    expect(after).toHaveBeenCalledTimes(1);
    expect((await store.getInvoice('i1')).status).toBe('synced');
  });
  it('removes synced invoices after 30 days, and nothing that is not synced', async () => {
    const h = harness();
    const { store, sync, clock } = await mkSync(h);
    await store.putInvoice(rec('i1', { status: 'synced', synced_at: '2026-10-01T00:00:00Z' }));
    await store.putInvoice(rec('i2', { status: 'synced', synced_at: '2026-11-10T00:00:00Z' }));
    await store.putInvoice(rec('i3', { status: 'failed', created_at: '2026-09-01T00:00:00Z' }));
    await sync.syncNow();
    expect(await store.getInvoice('i1')).toBeNull();
    expect(await store.getInvoice('i2')).not.toBeNull();
    expect(await store.getInvoice('i3')).not.toBeNull();
    expect(clock.t).toBeTruthy();
  });
  it('notifies listeners when something changes', async () => {
    const h = harness();
    const { sync } = await mkSync(h);
    const seen = vi.fn();
    const off = sync.subscribe(seen);
    await sync.queue(rec('i1'));
    expect(seen).toHaveBeenCalled();
    off();
  });
});

describe('auto sync', () => {
  it('syncs when the connection returns and while something is waiting, and stops when told', async () => {
    vi.useFakeTimers();
    const sync = { syncNow: vi.fn(async () => ({})), snapshot: vi.fn(async () => ({ pending: 1 })) };
    const win = new EventTarget();
    const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
    const stop = startAutoSync(sync, { intervalMs: 1000, win, doc });
    expect(sync.syncNow).toHaveBeenCalledTimes(1); // on start
    win.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(1100);
    expect(sync.syncNow.mock.calls.length).toBeGreaterThanOrEqual(3); // online + the interval tick
    const n = sync.syncNow.mock.calls.length;
    stop();
    win.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(5000);
    expect(sync.syncNow).toHaveBeenCalledTimes(n);
    vi.useRealTimers();
  });
  it('switches itself off once its page has gone', async () => {
    vi.useFakeTimers();
    const sync = { syncNow: vi.fn(async () => ({})), snapshot: vi.fn(async () => ({ pending: 1 })) };
    const win = new EventTarget();
    let here = true;
    startAutoSync(sync, { intervalMs: 1000, win, doc: new EventTarget(), alive: () => here });
    expect(sync.syncNow).toHaveBeenCalledTimes(1);
    here = false;
    win.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(5000);
    expect(sync.syncNow).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});

describe('offline kit', () => {
  const setup = async (over = {}) => {
    const store = await newDb();
    const api = {
      offlineGrant: vi.fn(async () => ({ ok: true, secret: 'S3CRET', pin_set_at: '2026-11-01T00:00:00Z' })),
      myLimits: vi.fn(async () => ({ max_pct: 10, max_amount: 1000, override: false, pin_required: true, has_pin: true })),
      ...over,
    };
    let t = 1_000_000;
    const kit = createKit({ store, api, deviceId: 'dev1', userId: () => 'u1', now: () => t });
    return { store, api, kit, advance: (ms) => (t += ms) };
  };
  it('is not ready until the person has proved their PIN online once, and says why', async () => {
    const { kit } = await setup();
    expect((await kit.readiness()).ready).toBe(false);
    await kit.refreshLimits();
    expect((await kit.readiness()).why).toMatch(/Prepare offline|Save one bill/);
    await kit.earnGrant('482913');
    expect((await kit.readiness()).ready).toBe(true);
  });
  it('never stores the PIN, only the grant and a verifier', async () => {
    const { kit, store } = await setup();
    await kit.earnGrant('482913');
    expect(JSON.stringify(await store.kvGet('grant:u1:dev1'))).not.toContain('482913');
  });
  it('checks the PIN locally and hands back the proof', async () => {
    const { kit } = await setup();
    await kit.refreshLimits();
    await kit.earnGrant('482913');
    expect(await kit.verifyPinLocally('482913')).toMatchObject({ ok: true, proof: 'S3CRET' });
    expect(await kit.verifyPinLocally('000001')).toMatchObject({ ok: false, code: 'bad_pin' });
  });
  it('locks for 15 minutes after 5 wrong PINs, even for the right one, then lets it through', async () => {
    const { kit, advance } = await setup();
    await kit.refreshLimits();
    await kit.earnGrant('482913');
    for (let i = 0; i < 5; i++) expect((await kit.verifyPinLocally('000001')).code).toBe('bad_pin');
    expect((await kit.verifyPinLocally('482913')).code).toBe('locked');
    advance(16 * 60_000);
    expect((await kit.verifyPinLocally('482913')).ok).toBe(true);
  });
  it('needs no PIN when the shop turned the PIN rule off', async () => {
    const { kit } = await setup({ myLimits: async () => ({ max_pct: 10, max_amount: 1000, pin_required: false, has_pin: false }) });
    await kit.refreshLimits();
    expect(await kit.verifyPinLocally('')).toMatchObject({ ok: true, proof: null });
  });
  it('refuses when the owner has not set a PIN for this person', async () => {
    const { kit } = await setup({ myLimits: async () => ({ max_pct: 10, max_amount: 1000, pin_required: true, has_pin: false }) });
    await kit.refreshLimits();
    expect((await kit.verifyPinLocally('482913')).message).toMatch(/Ask the owner/);
  });
  it('after an online save it earns the grant if missing, and renews it when the PIN has changed', async () => {
    const { kit, api } = await setup();
    await kit.afterOnlineSave('482913');
    expect(api.offlineGrant).toHaveBeenCalledTimes(1);
    expect(api.myLimits).toHaveBeenCalled();
    await kit.afterOnlineSave('482913'); // unchanged PIN: no new grant
    expect(api.offlineGrant).toHaveBeenCalledTimes(1);
    await kit.afterOnlineSave('739150'); // a different PIN was accepted by the server: renew
    expect(api.offlineGrant).toHaveBeenCalledTimes(2);
  });
  it('a failure while preparing never breaks the save that triggered it', async () => {
    const { kit } = await setup({
      offlineGrant: async () => {
        throw new Error('offline');
      },
    });
    await expect(kit.afterOnlineSave('482913')).resolves.toBeUndefined();
  });
  it('does not keep a grant the server refused', async () => {
    const { kit } = await setup({ offlineGrant: async () => ({ ok: false, code: 'bad_pin' }) });
    expect((await kit.earnGrant('000001')).ok).toBe(false);
    expect(await kit.hasGrant()).toBe(false);
  });
});
