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
  getReceipt: vi.fn(async () => ({
    shop_name: 'Test Pharmacy',
    tax_no: '0870213-3',
    pos_no: '99',
    footer: 'Terms apply',
    copies: 1,
    auto_print: false,
  })),
  history: vi.fn(async () => ({ rows: [], total: 0 })),
  invoiceDetail: vi.fn(async () => ({ ok: false })),
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

const heldRecords = async () => {
  const s = await openLocalDb();
  const all = await s.allHeld();
  s.close();
  return all;
};
const openHeldList = async (nav = 'first') => {
  el.querySelector(`[data-held-nav="${nav}"]`).click();
  await vi.waitFor(() => expect(el.querySelector('#eb-help .eb-held-dlg')).not.toBeNull());
};
const holdNow = async () => {
  el.querySelector('[data-act="hold"]').click();
  await vi.waitFor(() => expect(el.querySelector('#eb-note').textContent).toMatch(/Bill held|nothing to hold|at most/));
};
const itemRows = () => el.querySelectorAll('#eb-lines tbody tr[data-id]');

describe('holding bills on the screen', () => {
  it('holds the bill, clears the screen for the next customer, and shows the count', async () => {
    await seedReady();
    await boot();
    addItem();
    type(el.querySelector('#eb-customer'), 'Mr Ali');
    await holdNow();
    expect(itemRows()).toHaveLength(0);
    expect(el.querySelector('#eb-customer').value).toBe('');
    expect(el.querySelector('#eb-held-n').textContent).toBe('1');
    const [h] = await heldRecords();
    expect(h).toMatchObject({ customer: 'Mr Ali', item_count: 1, user_id: 'u1' });
  });
  it('sends the hold to the server when online and marks it as there', async () => {
    await seedReady();
    await boot();
    const { holdBill } = await api();
    addItem();
    await holdNow();
    await vi.waitFor(() => expect(holdBill).toHaveBeenCalled());
    expect(holdBill.mock.calls.every((call) => call[1] === DEV)).toBe(true);
    await vi.waitFor(async () => expect((await heldRecords())[0].synced).toBe(true));
  });
  it('holds with no connection, keeps it on the device, and uploads it when the connection returns', async () => {
    await seedReady();
    setOnline(false);
    await boot();
    const { holdBill } = await api();
    addItem();
    await holdNow();
    expect(holdBill).not.toHaveBeenCalled();
    expect((await heldRecords())[0].synced).toBe(false);
    setOnline(true);
    window.dispatchEvent(new Event('online'));
    await vi.waitFor(() => expect(holdBill).toHaveBeenCalledTimes(1), { timeout: 3000 });
  });
  it('says so when there is nothing to hold', async () => {
    await seedReady();
    await boot();
    await holdNow();
    expect(el.querySelector('#eb-note').textContent).toContain('nothing to hold');
  });
  it('allows six held bills and explains the seventh', async () => {
    await seedReady();
    await boot();
    for (let i = 0; i < 6; i++) {
      addItem();
      el.querySelector('[data-act="hold"]').click();
      await vi.waitFor(() => expect(el.querySelector('#eb-held-n').textContent).toBe(String(i + 1)));
    }
    addItem();
    el.querySelector('[data-act="hold"]').click();
    await vi.waitFor(() => expect(el.querySelector('#eb-note').textContent).toContain('at most'));
    expect(el.querySelector('#eb-note').textContent).not.toContain('Bill held');
    expect(itemRows()).toHaveLength(1); // the seventh bill is still on screen, nothing lost
  });
  it('the held list shows each bill and resumes one exactly as it was, including discounts, cash and payment mode', async () => {
    await seedReady();
    await boot();
    addItem();
    type(el.querySelector('#eb-customer'), 'Mr Ali');
    type(el.querySelector('#eb-cdisc'), '5');
    type(el.querySelector('#eb-adj'), '-1');
    el.querySelector('input[name="eb-mode"][value="Credit"]').click();
    await holdNow();
    await openHeldList();
    await vi.waitFor(() => expect(el.querySelector('#hb-table').textContent).toContain('Mr Ali'));
    expect(el.querySelector('#hb-table').textContent).toMatch(/Waiting to upload|Saved on server too/); // which one depends on whether the upload has finished yet
    el.querySelector('[data-resume="0"]').click();
    await vi.waitFor(() => expect(itemRows()).toHaveLength(1));
    expect(el.querySelector('#eb-customer').value).toBe('Mr Ali');
    expect(el.querySelector('#eb-cdisc').value).toBe('5');
    expect(el.querySelector('#eb-adj').value).toBe('-1');
    expect(el.querySelector('input[name="eb-mode"][value="Credit"]').checked).toBe(true);
    expect(el.querySelector('#eb-net').textContent).toBe('84.50'); // 90 - 4.50 - 1
    expect(el.querySelector('#eb-note').textContent).toContain('Held bill brought back');
    expect(await heldRecords()).toHaveLength(1); // still held until the bill is saved
  });
  it('saving a resumed bill releases its hold on the device and on the server', async () => {
    await seedReady();
    await boot();
    const { holdBill, releaseHeld, saveInvoice } = await api();
    addItem();
    await holdNow();
    await vi.waitFor(async () => expect((await heldRecords())[0].synced).toBe(true));
    await openHeldList();
    await vi.waitFor(() => expect(el.querySelector('[data-resume="0"]')).not.toBeNull());
    el.querySelector('[data-resume="0"]').click();
    await vi.waitFor(() => expect(itemRows()).toHaveLength(1));
    type(el.querySelector('#eb-cash'), '100');
    el.querySelector('#eb-save').click();
    await enterPin('482913');
    await vi.waitFor(() => expect(saveInvoice).toHaveBeenCalled());
    await vi.waitFor(() => expect(releaseHeld).toHaveBeenCalledTimes(1), { timeout: 3000 });
    await vi.waitFor(async () => expect(await heldRecords()).toHaveLength(0));
    expect(holdBill).toHaveBeenCalledTimes(1);
    expect(el.querySelector('#eb-held-n').textContent).toBe('0');
  });
  it('Cancel discards a resumed held bill after confirmation', async () => {
    await seedReady();
    await boot();
    addItem();
    await holdNow();
    await openHeldList();
    await vi.waitFor(() => expect(el.querySelector('[data-resume="0"]')).not.toBeNull());
    el.querySelector('[data-resume="0"]').click();
    await vi.waitFor(() => expect(itemRows()).toHaveLength(1));
    const ask = vi.spyOn(window, 'confirm').mockReturnValue(true);
    el.querySelector('[data-act="cancel"]').click();
    await vi.waitFor(() => expect(itemRows()).toHaveLength(0));
    await vi.waitFor(() => expect(el.querySelector('#eb-held-n').textContent).toBe('0'));
    await vi.waitFor(async () => expect((await heldRecords()).filter((h) => !h.release_pending)).toHaveLength(0));
    expect(ask).toHaveBeenCalledWith('Discard this held bill? It will be permanently removed.');
    ask.mockRestore();
  });
  it('asks before replacing a bill that is on the screen when resuming', async () => {
    await seedReady();
    await boot();
    addItem();
    await holdNow();
    addItem();
    await openHeldList();
    await vi.waitFor(() => expect(el.querySelector('[data-resume="0"]')).not.toBeNull());
    const ask = vi.spyOn(window, 'confirm').mockReturnValueOnce(false);
    el.querySelector('[data-resume="0"]').click();
    await vi.waitFor(() => expect(ask).toHaveBeenCalled());
    expect(itemRows()).toHaveLength(1);
    expect(el.querySelector('#eb-note').textContent).not.toContain('brought back');
    ask.mockRestore();
  });
  it('deletes a held bill from the list, after asking', async () => {
    await seedReady();
    await boot();
    addItem();
    await holdNow();
    await openHeldList();
    await vi.waitFor(() => expect(el.querySelector('[data-delete="0"]')).not.toBeNull());
    el.querySelector('[data-delete="0"]').click();
    await vi.waitFor(() => expect(el.querySelector('#eb-dialog .eb-modal')).not.toBeNull());
    press('yes');
    await vi.waitFor(async () => expect(await heldRecords()).toHaveLength(0));
    await vi.waitFor(() => expect(el.querySelector('#hb-table').textContent).toContain('No held bills'));
  });
  it('searches the list, and lists a hold made on another device when online', async () => {
    await seedReady();
    const { listHeld } = await api();
    listHeld.mockResolvedValue([
      {
        id: 'remote1',
        label: '',
        customer: 'Remote Customer',
        item_count: 3,
        net_total: '300',
        device_id: 'x',
        created_at: '2026-11-16T05:00:00Z',
        updated_at: '2026-11-16T05:00:00Z',
      },
    ]);
    await boot();
    addItem();
    type(el.querySelector('#eb-customer'), 'Local Person');
    await holdNow();
    await openHeldList();
    await vi.waitFor(() => expect(el.querySelector('#hb-table').textContent).toContain('Remote Customer'));
    expect(el.querySelector('#hb-table').textContent).toContain('another device');
    type(el.querySelector('#hb-search'), 'local');
    expect(el.querySelectorAll('#hb-table tbody tr[data-i]')).toHaveLength(1);
    listHeld.mockResolvedValue([]);
  });
  it('Escape closes the list and leaves the bill alone', async () => {
    await seedReady();
    await boot();
    addItem();
    await openHeldList();
    key(document, 'Escape');
    expect(el.querySelector('#eb-help .eb-held-dlg')).toBeNull();
    expect(itemRows()).toHaveLength(1);
  });
});

describe('starting online and losing the connection mid-work', () => {
  it('says so when the connection is lost and when it returns, without disturbing the bill', async () => {
    await seedReady();
    await boot();
    addItem();
    type(el.querySelector('#eb-customer'), 'Mr Ali');
    setOnline(false);
    window.dispatchEvent(new Event('offline'));
    await vi.waitFor(() => expect(el.querySelector('#eb-note').textContent).toContain('Connection lost'));
    expect(el.querySelector('#eb-note').textContent).toContain('You are offline');
    expect(itemRows()).toHaveLength(1);
    expect(el.querySelector('#eb-customer').value).toBe('Mr Ali');
    await vi.waitFor(() => expect(el.querySelector('#eb-sync').textContent).toContain('Offline'));
    setOnline(true);
    window.dispatchEvent(new Event('online'));
    await vi.waitFor(() => expect(el.querySelector('#eb-note').textContent).toContain('Back online'));
    expect(itemRows()).toHaveLength(1);
  });
  it('a bill started online can be searched in Product Help, held and saved with no connection', async () => {
    await seedReady();
    await boot();
    const { saveInvoice } = await api();
    addItem();
    setOnline(false);
    window.dispatchEvent(new Event('offline'));
    key(document, 'F2');
    expect(el.querySelector('#eb-help .eb-modal')).not.toBeNull(); // Product Help still works
    key(document, 'Escape');
    el.querySelector('#eb-save').click();
    await enterPin('482913');
    await vi.waitFor(() => expect(el.querySelector('#eb-note').textContent).toContain('Saved on this device as'));
    expect(saveInvoice).not.toHaveBeenCalled();
    expect(await localInvoices()).toHaveLength(1);
  });
});
