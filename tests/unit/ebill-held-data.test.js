import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import { openLocalDb } from '../../js/modules/ebill/data/localDb.js';
import { createHeld, heldState } from '../../js/modules/ebill/data/held.js';
import { createSync } from '../../js/modules/ebill/data/sync.js';
import { addProduct, emptyCart } from '../../js/modules/ebill/domain/cart.js';
import { billTotals } from '../../js/modules/ebill/domain/calc.js';

const prod = { code: 'A1', name: 'Tablet', generic: 'Alpha', qty: 10, price: 5, pack: 10 };
const stateOf = (customer = 'Mr Ali') => {
  const cart = addProduct(emptyCart(), prod, { qty: 2 });
  const bill = {
    customer,
    customerDiscountPct: 0,
    receiptOn: false,
    receiptDiscount: { mode: 'amt', value: 0 },
    adjustment: 0,
    taxPct: 0,
    cash: 0,
    mode: 'Cash',
    comments: '',
    more: '',
  };
  return heldState({ cart, bill, totals: billTotals({ lines: cart.lines }) });
};
const newDb = () => openLocalDb(new IDBFactory(), 'h-' + Math.random());
const mk = async (over = {}) => {
  const store = await newDb();
  const state = { online: true, user: 'u1', server: [], states: {} };
  const api = {
    listHeld: vi.fn(async () => state.server),
    getHeldState: vi.fn(async (id) => state.states[id] ?? null),
    releaseHeld: vi.fn(async () => ({ ok: true })),
    holdBill: vi.fn(async () => ({ ok: true, code: 'held' })),
    saveInvoice: vi.fn(),
    registerDevice: vi.fn(async () => ({ ok: true })),
    ...over,
  };
  const held = createHeld({
    store,
    api,
    userId: async () => state.user,
    deviceId: 'dev1',
    online: () => state.online,
    now: () => new Date('2026-11-16T10:00:00Z'),
  });
  const sync = createSync({
    store,
    api,
    userId: async () => state.user,
    deviceId: 'dev1',
    online: () => state.online,
    now: () => new Date('2026-11-16T10:00:00Z'),
  });
  return { store, state, api, held, sync };
};

describe('storage upgrade', () => {
  it('opening a version-1 database keeps its invoices and adds the held store', async () => {
    const factory = new IDBFactory();
    await new Promise((resolve, reject) => {
      const r = factory.open('dua-ebill', 1);
      r.onupgradeneeded = () => {
        r.result.createObjectStore('invoices', { keyPath: 'invoice_id' });
        r.result.createObjectStore('kv');
      };
      r.onsuccess = () => {
        const t = r.result.transaction(['invoices', 'kv'], 'readwrite');
        t.objectStore('invoices').put({ invoice_id: 'old1', status: 'pending', user_id: 'u1' });
        t.objectStore('kv').put('2026-11-01', 'lastSyncAt');
        t.oncomplete = () => (r.result.close(), resolve());
      };
      r.onerror = () => reject(r.error);
    });
    const d = await openLocalDb(factory, 'dua-ebill');
    expect((await d.getInvoice('old1')).status).toBe('pending');
    expect(await d.kvGet('lastSyncAt')).toBe('2026-11-01');
    await d.putHeld({ id: 'h1', user_id: 'u1' });
    expect((await d.allHeld()).map((h) => h.id)).toEqual(['h1']);
  });
  it('holds survive a restart', async () => {
    const f = new IDBFactory();
    const a = await openLocalDb(f, 'x');
    await a.putHeld({ id: 'h1', user_id: 'u1', n: 1 });
    a.close();
    const b = await openLocalDb(f, 'x');
    expect(await b.getHeld('h1')).toMatchObject({ n: 1 });
    expect((await b.patchHeld('h1', { n: 2 })).n).toBe(2);
    await b.deleteHeld('h1');
    expect(await b.allHeld()).toEqual([]);
  });
});

describe('holding', () => {
  it('keeps the bill on the device first, not yet marked as on the server', async () => {
    const { held, store } = await mk();
    const r = await held.hold({ id: 'h1', state: stateOf() });
    expect(r.ok).toBe(true);
    expect(await store.getHeld('h1')).toMatchObject({
      user_id: 'u1',
      customer: 'Mr Ali',
      item_count: 1,
      net_total: 10,
      synced: false,
      release_pending: false,
    });
    expect(await held.count()).toBe(1);
  });
  it('refuses an empty bill, and a seventh bill; updating an existing one is always allowed', async () => {
    const { held } = await mk();
    expect((await held.hold({ id: 'x', state: { lines: [] } })).code).toBe('empty');
    for (let i = 1; i <= 6; i++) expect((await held.hold({ id: 'h' + i, state: stateOf('C' + i) })).ok).toBe(true);
    expect((await held.hold({ id: 'h7', state: stateOf() })).code).toBe('too_many');
    expect((await held.hold({ id: 'h3', state: stateOf('Changed') })).ok).toBe(true);
    expect(await held.count()).toBe(6);
  });
  it('holding the same id again replaces it, keeps when it was first held, and needs uploading again', async () => {
    const { held, store } = await mk();
    await held.hold({ id: 'h1', state: stateOf('First'), label: 'desk' });
    await store.patchHeld('h1', { synced: true, created_at: '2026-11-16T09:00:00Z' });
    await held.hold({ id: 'h1', state: stateOf('Second') });
    expect(await store.getHeld('h1')).toMatchObject({
      customer: 'Second',
      label: 'desk',
      created_at: '2026-11-16T09:00:00Z',
      synced: false,
    });
  });
  it('refuses to hold where nothing can be kept safely', async () => {
    const { held, store } = await mk();
    store.durable = false;
    expect((await held.hold({ id: 'h1', state: stateOf() })).code).toBe('not_durable');
  });
  it("only counts and lists this person's holds", async () => {
    const { held, store, state } = await mk();
    await held.hold({ id: 'h1', state: stateOf() });
    await store.putHeld({
      id: 'o1',
      user_id: 'someone-else',
      synced: true,
      state: stateOf(),
      updated_at: '2026-11-16T09:00:00Z',
      created_at: 'x',
    });
    expect(await held.count()).toBe(1);
    state.user = 'someone-else';
    expect(await held.count()).toBe(1);
  });
});

describe('list, load, release', () => {
  it("merges this device's holds with holds made elsewhere, and says where each is", async () => {
    const { held, state, store } = await mk();
    await held.hold({ id: 'h1', state: stateOf('Local only') });
    await held.hold({ id: 'h2', state: stateOf('Both') });
    await store.patchHeld('h2', { synced: true });
    state.server = [
      { id: 'h2', customer: 'Both', item_count: 1, net_total: '10', updated_at: '2026-11-16T09:00:00Z', created_at: 'x' },
      { id: 's1', customer: 'Elsewhere', item_count: 3, net_total: '300', updated_at: '2026-11-16T08:00:00Z', created_at: 'x' },
    ];
    const { items, serverError } = await held.list();
    expect(serverError).toBe(false);
    expect(items.map((h) => [h.id, h.where])).toEqual([
      ['h1', 'device'],
      ['h2', 'both'],
      ['s1', 'server'],
    ]);
    expect(items[2].net_total).toBe(300);
  });
  it('offline it shows the device only, and if the server fails it says so without losing anything', async () => {
    const { held, state, api } = await mk();
    await held.hold({ id: 'h1', state: stateOf() });
    state.online = false;
    expect((await held.list()).items).toHaveLength(1);
    expect(api.listHeld).not.toHaveBeenCalled();
    state.online = true;
    api.listHeld.mockRejectedValueOnce(new Error('boom'));
    expect(await held.list()).toMatchObject({ serverError: true, items: [{ id: 'h1' }] });
  });
  it('does not show a hold that is waiting to be removed from the server', async () => {
    const { held, state, store } = await mk();
    await held.hold({ id: 'h1', state: stateOf() });
    await store.patchHeld('h1', { synced: true });
    await held.release('h1');
    state.server = [{ id: 'h1', customer: 'x', item_count: 1, net_total: '10', updated_at: 'z', created_at: 'x' }];
    expect((await held.list()).items).toEqual([]);
  });
  it('loads a hold from the device, or fetches one made elsewhere and keeps a copy', async () => {
    const { held, state, store, api } = await mk();
    await held.hold({ id: 'h1', state: stateOf('Local') });
    expect((await held.load('h1')).state.customer).toBe('Local');
    state.states.s1 = stateOf('Remote');
    const r = await held.load('s1');
    expect(r.state.customer).toBe('Remote');
    expect(await store.getHeld('s1')).toMatchObject({ synced: true });
    api.getHeldState.mockClear();
    await held.load('s1');
    expect(api.getHeldState).not.toHaveBeenCalled(); // now local
  });
  it('explains when a server-only hold cannot be opened', async () => {
    const { held, state } = await mk();
    state.online = false;
    expect((await held.load('s1')).message).toMatch(/Connect to the internet/);
    state.online = true;
    expect((await held.load('s1')).message).toMatch(/no longer there/);
  });
  it('releasing a hold the server never had just removes it; one it had waits for the next sync', async () => {
    const { held, store, api } = await mk();
    await held.hold({ id: 'a', state: stateOf() });
    await held.release('a');
    expect(await store.getHeld('a')).toBeNull();
    await held.hold({ id: 'b', state: stateOf() });
    await store.patchHeld('b', { synced: true });
    await held.release('b');
    expect(await store.getHeld('b')).toMatchObject({ release_pending: true });
    expect(api.releaseHeld).not.toHaveBeenCalled();
    expect(await held.count()).toBe(0);
  });
  it('releasing a server-only hold goes straight to the server, and says so when offline', async () => {
    const { held, state, api } = await mk();
    expect((await held.release('s1')).ok).toBe(true);
    expect(api.releaseHeld).toHaveBeenCalledWith('s1');
    state.online = false;
    expect((await held.release('s1')).ok).toBe(false);
  });
});

describe('held bills in sync', () => {
  it('uploads new holds and marks them on the server only after the server agrees', async () => {
    const { held, sync, store, api } = await mk();
    await held.hold({ id: 'h1', state: stateOf(), label: 'desk' });
    await sync.syncNow();
    expect(api.holdBill).toHaveBeenCalledWith('h1', 'dev1', expect.objectContaining({ customer: 'Mr Ali' }), 'desk');
    expect((await store.getHeld('h1')).synced).toBe(true);
    api.holdBill.mockClear();
    await sync.syncNow();
    expect(api.holdBill).not.toHaveBeenCalled(); // nothing changed
  });
  it('a hold edited while its upload was in flight is not marked as uploaded', async () => {
    const { held, sync, store, api, state } = await mk();
    await held.hold({ id: 'h1', state: stateOf('First') });
    api.holdBill.mockImplementationOnce(async () => {
      state.now = 1;
      await store.patchHeld('h1', { updated_at: '2026-11-16T10:05:00Z', customer: 'Second', synced: false }); // the person changed it meanwhile
      return { ok: true };
    });
    await sync.syncNow();
    expect((await store.getHeld('h1')).synced).toBe(false);
    await sync.syncNow();
    expect((await store.getHeld('h1')).synced).toBe(true);
  });
  it('removes released holds from the server, then from the device', async () => {
    const { held, sync, store, api } = await mk();
    await held.hold({ id: 'h1', state: stateOf() });
    await store.patchHeld('h1', { synced: true });
    await held.release('h1');
    await sync.syncNow();
    expect(api.releaseHeld).toHaveBeenCalledWith('h1');
    expect(await store.getHeld('h1')).toBeNull();
  });
  it('a lost connection leaves holds exactly as they were', async () => {
    const { held, sync, store, api } = await mk();
    await held.hold({ id: 'h1', state: stateOf() });
    api.holdBill.mockRejectedValueOnce(new Error('TypeError: Failed to fetch'));
    await sync.syncNow();
    expect(await store.getHeld('h1')).toMatchObject({ synced: false, last_error: null });
    await sync.syncNow();
    expect((await store.getHeld('h1')).synced).toBe(true);
  });
  it('registers the device when the server does not know it, then retries', async () => {
    const { held, sync, store, api } = await mk();
    await held.hold({ id: 'h1', state: stateOf() });
    api.holdBill.mockResolvedValueOnce({ ok: false, code: 'device_unknown' });
    await sync.syncNow();
    expect(api.registerDevice).toHaveBeenCalledTimes(1);
    expect((await store.getHeld('h1')).synced).toBe(true);
  });
  it('a refusal is recorded on the hold and the hold is kept', async () => {
    const { held, sync, store, api } = await mk();
    await held.hold({ id: 'h1', state: stateOf() });
    api.holdBill.mockResolvedValueOnce({ ok: false, code: 'too_many', message: 'Too many held bills.' });
    await sync.syncNow();
    expect(await store.getHeld('h1')).toMatchObject({ synced: false, last_error: { code: 'too_many', message: 'Too many held bills.' } });
  });
  it("leaves another person's holds alone", async () => {
    const { sync, store, api } = await mk();
    await store.putHeld({
      id: 'o1',
      user_id: 'someone-else',
      synced: false,
      release_pending: false,
      state: stateOf(),
      updated_at: 'x',
      created_at: 'x',
      device_id: 'dev1',
    });
    await sync.syncNow();
    expect(api.holdBill).not.toHaveBeenCalled();
  });
});
