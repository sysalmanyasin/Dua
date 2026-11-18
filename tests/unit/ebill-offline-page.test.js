// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { webcrypto } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openLocalDb } from '../../js/modules/ebill/data/localDb.js';
import { makeVerifier } from '../../js/modules/ebill/data/localPin.js';

const DEV = '20000000-0000-0000-0000-000000000001';
const products = [
  {
    code: 'A100',
    name: 'Augmentin 625',
    generic: 'Amoxicillin',
    company: 'Beecham',
    supplier: 'Sup One',
    qty: 8,
    pack: 6,
    price: 90,
    received: '',
    sold: '',
    created: '2024-06-30',
  },
];
vi.mock('../../js/modules/ebill/data/products.js', () => ({
  readCopy: vi.fn(async () => ({ products, meta: { syncedAt: '2026-11-15T09:00:00Z' } })),
  refreshCopy: vi.fn(async () => ''),
  clock: () => '02:00 pm',
}));
vi.mock('../../js/modules/ebill/data/offline.js', () => ({
  registerServiceWorker: vi.fn(async () => ({ supported: false })),
  shellReady: vi.fn(async () => true),
}));
vi.mock('../../js/modules/ebill/data/device.js', () => ({
  getDeviceId: () => '20000000-0000-0000-0000-000000000001',
  deviceLabel: () => 'Test device',
}));
vi.mock('../../js/modules/ebill/data/api.js', () => ({
  currentUserId: vi.fn(async () => 'u1'),
  holdBill: vi.fn(async () => ({ ok: true, code: 'held' })),
  releaseHeld: vi.fn(async () => ({ ok: true })),
  listHeld: vi.fn(async () => []),
  getHeldState: vi.fn(async () => null),
  myLimits: vi.fn(async () => ({ max_pct: 10, max_amount: 1000, override: false, pin_required: true, has_pin: true })),
  offlineGrant: vi.fn(async () => ({ ok: true, secret: 'S3CRET', pin_set_at: '2026-11-01T00:00:00Z' })),
  registerDevice: vi.fn(async () => ({ ok: true, status: 'active' })),
  saveInvoice: vi.fn(async (p) => ({ ok: true, code: 'saved', invoice_no: 'EB-' + p.invoice_id.slice(0, 4) })),
}));
Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });

const ctx = { user_id: 'u1', full_name: 'Test Staff', permissions: ['ebill.use'] };
let el;
let online;
const setOnline = (v) => {
  online = v;
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online });
};
const type = (e, v) => {
  e.value = v;
  e.dispatchEvent(new Event('input', { bubbles: true }));
};
const key = (e, k) => e.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
const api = () => import('../../js/modules/ebill/data/api.js');
const LIMITS = { max_pct: 10, max_amount: 1000, override: false, pin_required: true, has_pin: true };

async function seedReady({ limits = LIMITS, grant = true } = {}) {
  const s = await openLocalDb();
  await s.kvSet('limits:u1', { ...limits, fetchedAt: 'x' });
  if (grant)
    await s.kvSet(`grant:u1:${DEV}`, { secret: 'S3CRET', verifier: await makeVerifier('482913', 1000), pinSetAt: 'x', savedAt: 'x' });
  s.close();
}
async function boot() {
  document.body.replaceChildren();
  el = document.createElement('div');
  document.body.append(el);
  const { mount } = await import('../../js/modules/ebill/ui/pos.js');
  await mount(el, { ctx });
  await vi.waitFor(() => expect(el.querySelector('#eb-sync').textContent).toContain('Pending'));
}
const addItem = () => {
  const sku = el.querySelector('#eb-sku');
  sku.value = 'A100';
  key(sku, 'Enter'); // 90.00
  type(el.querySelector('#eb-cash'), '100');
};
const pinBox = () => el.querySelector('#eb-dialog [data-f="pin"]');
const press = (a) => el.querySelector(`#eb-dialog [data-act="${a}"]`).click();
const enterPin = async (pin) => {
  await vi.waitFor(() => expect(pinBox()).not.toBeNull());
  pinBox().value = pin;
  press('yes');
};
const localInvoices = async () => {
  const s = await openLocalDb();
  const all = await s.allInvoices();
  s.close();
  return all;
};

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory();
  setOnline(true);
  vi.clearAllMocks();
});

describe('offline billing on the screen', () => {
  it('saves with no connection: PIN checked on the device, invoice written locally before it says saved, bill cleared', async () => {
    await seedReady();
    setOnline(false);
    await boot();
    const { saveInvoice } = await api();
    addItem();
    el.querySelector('#eb-save').click();
    await enterPin('482913');
    await vi.waitFor(() => expect(el.querySelector('#eb-note').textContent).toContain('Saved on this device as'));
    expect(saveInvoice).not.toHaveBeenCalled(); // nothing went to the server
    const [rec] = await localInvoices();
    expect(rec).toMatchObject({ status: 'pending', user_id: 'u1', net_total: 90 });
    expect(rec.payload.offline_proof).toBe('S3CRET');
    expect(JSON.stringify(rec)).not.toContain('482913'); // the PIN is never stored
    expect(rec.payload.lines).toHaveLength(1);
    expect(el.querySelectorAll('#eb-lines tbody tr[data-id]')).toHaveLength(0);
    await vi.waitFor(() => expect(el.querySelector('#eb-sync').textContent).toContain('Pending 1'));
    expect(el.querySelector('#eb-sync').textContent).toContain('LOCAL-');
  });
  it('a wrong PIN is refused on the device and asked again; nothing is queued', async () => {
    await seedReady();
    setOnline(false);
    await boot();
    addItem();
    el.querySelector('#eb-save').click();
    await enterPin('000001');
    await vi.waitFor(() => expect(el.querySelector('#eb-dialog').textContent).toContain('Wrong PIN.'));
    expect(await localInvoices()).toHaveLength(0);
    await enterPin('482913');
    await vi.waitFor(async () => expect(await localInvoices()).toHaveLength(1));
  });
  it('refuses, with the reason, when the device has not been prepared for offline billing', async () => {
    await seedReady({ grant: false });
    setOnline(false);
    await boot();
    addItem();
    el.querySelector('#eb-save').click();
    await enterPin('482913');
    await vi.waitFor(() => expect(el.querySelector('#eb-note').textContent).toMatch(/not set up on this device|Prepare offline/));
    expect(await localInvoices()).toHaveLength(0);
    expect(el.querySelectorAll('#eb-lines tbody tr[data-id]')).toHaveLength(1); // the bill is still open
  });
  it("applies the person's discount limit offline", async () => {
    await seedReady();
    setOnline(false);
    await boot();
    addItem();
    type(el.querySelector('#eb-cdisc'), '20'); // 20% against a 10% limit
    el.querySelector('#eb-save').click();
    await enterPin('482913');
    await vi.waitFor(() => expect(el.querySelector('#eb-note').textContent).toContain('above your limit'));
    expect(await localInvoices()).toHaveLength(0);
  });
  it('keeps pending invoices through a restart (the page is rebuilt from scratch) and still shows them', async () => {
    await seedReady();
    setOnline(false);
    await boot();
    addItem();
    el.querySelector('#eb-save').click();
    await enterPin('482913');
    await vi.waitFor(async () => expect(await localInvoices()).toHaveLength(1));
    await boot(); // a restart: new page, same device storage
    expect(el.querySelector('#eb-sync').textContent).toContain('Pending 1');
    expect(el.querySelector('.eb-sync-list summary').textContent).toContain('(1)');
  });
  it('uploads by itself when the connection returns, and shows Synced with the server number', async () => {
    await seedReady();
    setOnline(false);
    await boot();
    const { saveInvoice } = await api();
    addItem();
    el.querySelector('#eb-save').click();
    await enterPin('482913');
    await vi.waitFor(async () => expect(await localInvoices()).toHaveLength(1));
    expect(saveInvoice).not.toHaveBeenCalled();
    setOnline(true);
    window.dispatchEvent(new Event('online'));
    await vi.waitFor(() => expect(saveInvoice).toHaveBeenCalledTimes(1), { timeout: 3000 });
    const [payload, pin] = saveInvoice.mock.calls[0];
    expect(pin).toBeNull();
    expect(payload.offline_proof).toBe('S3CRET');
    await vi.waitFor(async () => expect((await localInvoices())[0].status).toBe('synced'));
    await vi.waitFor(() => expect(el.querySelector('#eb-sync').textContent).toContain('Pending 0'));
    expect(el.querySelector('#eb-sync').textContent).toContain('Synced');
    expect(el.querySelector('#eb-sync').textContent).toMatch(/Last sync: \d/);
  });
  it('when the connection drops during an online save, it carries on locally with the same PIN (no second prompt)', async () => {
    await seedReady();
    await boot();
    const { saveInvoice } = await api();
    saveInvoice.mockRejectedValueOnce(new Error('TypeError: Failed to fetch'));
    addItem();
    el.querySelector('#eb-save').click();
    await enterPin('482913');
    await vi.waitFor(() => expect(el.querySelector('#eb-note').textContent).toContain('Saved on this device as'));
    expect(el.querySelector('#eb-dialog').textContent).toBe(''); // one prompt only
    const [rec] = await localInvoices();
    expect(rec.payload.invoice_id).toBe(saveInvoice.mock.calls[0][0].invoice_id); // the same id the server was sent, so a lost reply cannot duplicate
  });
  it("a failed invoice is shown with the server's reason and Retry sends it again", async () => {
    await seedReady();
    const s = await openLocalDb();
    await s.putInvoice({
      invoice_id: 'f1',
      user_id: 'u1',
      status: 'failed',
      created_at: '2026-11-15T10:00:00Z',
      attempts: 1,
      local_ref: 'LOCAL-261115-F1F1',
      customer: 'Mr Ali',
      net_total: 50,
      payload: { invoice_id: 'f1' },
      last_error: { code: 'discount_limit', message: 'The discount is above your limit.' },
    });
    s.close();
    await boot();
    expect(el.querySelector('#eb-sync').textContent).toContain('Failed 1');
    expect(el.querySelector('.eb-st-failed').textContent).toBe('Failed');
    expect(el.querySelector('#eb-sync').textContent).toContain('The discount is above your limit.');
    const { saveInvoice } = await api();
    saveInvoice.mockClear();
    el.querySelector('[data-act="retry"]').click();
    await vi.waitFor(() => expect(saveInvoice).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(el.querySelector('#eb-sync').textContent).toContain('Failed 0'));
  });
  it("another person's invoices stay put and are explained", async () => {
    await seedReady();
    const s = await openLocalDb();
    await s.putInvoice({
      invoice_id: 'o1',
      user_id: 'someone-else',
      status: 'pending',
      created_at: '2026-11-15T10:00:00Z',
      payload: { invoice_id: 'o1' },
    });
    s.close();
    await boot();
    const { saveInvoice } = await api();
    expect(saveInvoice).not.toHaveBeenCalled();
    expect(el.querySelector('#eb-sync').textContent).toContain('belong to another login');
  });
  it('says what is missing when the device is not ready, and offers Prepare offline when online', async () => {
    await boot();
    expect(el.querySelector('#eb-sync').textContent).toContain('Not ready for offline billing yet');
    const prep = el.querySelector('[data-act="prep"]');
    expect(prep).not.toBeNull();
    const { offlineGrant } = await api();
    prep.click();
    await enterPin('482913');
    await vi.waitFor(() => expect(offlineGrant).toHaveBeenCalledWith(DEV, '482913'));
    await vi.waitFor(() => expect(el.querySelector('#eb-sync').textContent).toContain('Ready for offline billing'));
  });
  it('a deactivated-device failure switches Save off on this device', async () => {
    await seedReady();
    const s = await openLocalDb();
    await s.putInvoice({
      invoice_id: 'd1',
      user_id: 'u1',
      status: 'failed',
      created_at: '2026-11-15T10:00:00Z',
      payload: { invoice_id: 'd1' },
      net_total: 10,
      last_error: { code: 'device_inactive', message: 'This device has been deactivated.' },
    });
    s.close();
    await boot();
    addItem();
    await vi.waitFor(() => expect(el.querySelector('#eb-save').disabled).toBe(true));
    expect(el.querySelector('#eb-note').textContent).toContain('switched off by the manager');
  });
  it('without durable storage it refuses to save offline rather than pretend', async () => {
    globalThis.indexedDB = undefined;
    setOnline(false);
    await boot();
    addItem();
    el.querySelector('#eb-save').click();
    await enterPin('482913');
    await vi.waitFor(() =>
      expect(el.querySelector('#eb-note').textContent).toMatch(
        /cannot keep an invoice safely|not set up on this device|Limits not downloaded/,
      ),
    );
  });
});
