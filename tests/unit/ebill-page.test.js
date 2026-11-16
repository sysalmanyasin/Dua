// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import manifest from '../../js/modules/ebill/manifest.js';

const products = [
  {
    code: 'P001',
    name: 'Panadol Tablet',
    generic: 'Paracetamol',
    company: 'GSK',
    supplier: 'Sup One',
    qty: 50,
    pack: 10,
    price: 5,
    received: '2026-10-01',
    sold: '2026-11-10',
    created: '2025-01-05',
  },
  {
    code: 'P002',
    name: 'Calpol Syrup',
    generic: 'Paracetamol',
    company: 'GSK',
    supplier: 'Sup Two',
    qty: 0,
    pack: 1,
    price: 120,
    received: '2026-09-15',
    sold: '',
    created: '2025-03-01',
  },
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

vi.mock('../../js/modules/ebill/data/api.js', () => ({
  registerDevice: vi.fn(async () => ({ ok: true, status: 'active' })),
  saveInvoice: vi.fn(async () => ({ ok: true, code: 'saved', invoice_no: 'EB-261115-00001' })),
}));
vi.mock('../../js/modules/ebill/data/device.js', () => ({
  getDeviceId: () => '20000000-0000-0000-0000-000000000001',
  deviceLabel: () => 'Test device',
}));

const ctx = { user_id: 'u1', full_name: 'Test Staff', permissions: ['inventory.search'] };
const tick = () => new Promise((r) => setTimeout(r, 0));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const type = (el, v) => {
  el.value = v;
  el.dispatchEvent(new Event('input', { bubbles: true }));
};
const key = (el, k, init = {}) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));

let el;
beforeEach(async () => {
  document.body.replaceChildren();
  el = document.createElement('div');
  document.body.append(el);
  const { mount } = await import('../../js/modules/ebill/ui/pos.js');
  await mount(el, { ctx });
  await tick();
});

describe('registration', () => {
  it('is a valid, permission-gated manifest', () => {
    expect(manifest.id).toBe('ebill');
    expect(manifest.routes[0].path).toBe('/ebill');
    expect(manifest.routes[0].permission).toBe('ebill.use');
    expect(manifest.routes[1].anyOf).toEqual(['ebill.set_pin', 'ebill.manage']);
  });
});

describe('billing screen', () => {
  it('shows the desktop layout: header, grid, totals and bottom controls', () => {
    for (const s of [
      '#eb-sku',
      '#eb-qty',
      '#eb-customer',
      '#eb-lines',
      '#eb-net',
      '#eb-cash',
      'input[name="eb-mode"]',
      '[data-act="help"]',
    ])
      expect(el.querySelector(s), s).not.toBeNull();
    expect(el.querySelector('#eb-sp-name').value).toBe('Test Staff');
    expect(el.textContent).toContain('not live');
  });
  it('adds a scanned or typed code and totals it', () => {
    type(el.querySelector('#eb-qty'), '3');
    const sku = el.querySelector('#eb-sku');
    sku.value = 'p001';
    key(sku, 'Enter');
    expect(el.querySelectorAll('#eb-lines tbody tr[data-id]')).toHaveLength(1);
    expect(el.querySelector('#eb-net').textContent).toBe('15.00');
    expect(sku.value).toBe('');
  });
  it('warns when stock is short or missing, from the saved copy', () => {
    const sku = el.querySelector('#eb-sku');
    sku.value = 'P002';
    key(sku, 'Enter');
    expect(el.querySelector('.eb-warn').textContent).toMatch(/No stock on this device/);
  });
  it('calculates discounts, adjustment, cash received and change', () => {
    const sku = el.querySelector('#eb-sku');
    sku.value = 'A100';
    key(sku, 'Enter'); // 90
    type(el.querySelector('#eb-cdisc'), '10'); // -9
    type(el.querySelector('#eb-adj'), '-1');
    expect(el.querySelector('#eb-net').textContent).toBe('80.00');
    type(el.querySelector('#eb-cash'), '100');
    expect(el.querySelector('[data-out="change"]').textContent).toBe('20.00');
    type(el.querySelector('#eb-cash'), '50');
    expect(el.querySelector('[data-out="due"]').textContent).toBe('30.00');
  });
  it('edits a quantity in place and removes a line', () => {
    const sku = el.querySelector('#eb-sku');
    sku.value = 'P001';
    key(sku, 'Enter');
    const qty = el.querySelector('[data-edit="qty"]');
    type(qty, '4');
    expect(el.querySelector('#eb-net').textContent).toBe('20.00');
    expect(el.querySelector('[data-edit="qty"]')).toBe(qty); // same element: focus is not lost
    el.querySelector('[data-del]').click();
    expect(el.querySelector('#eb-net').textContent).toBe('0.00');
  });
  it('switching a line to pack re-prices it', () => {
    const sku = el.querySelector('#eb-sku');
    sku.value = 'P001';
    key(sku, 'Enter');
    const unit = el.querySelector('[data-edit="unit"]');
    unit.value = 'pack';
    unit.dispatchEvent(new Event('change', { bubbles: true }));
    expect(el.querySelector('#eb-net').textContent).toBe('50.00'); // 5 x pack of 10
  });
  it('Save is off until there is something to save', () => {
    expect(el.querySelector('#eb-save').disabled).toBe(true);
    const sku = el.querySelector('#eb-sku');
    sku.value = 'P001';
    key(sku, 'Enter');
    expect(el.querySelector('#eb-save').disabled).toBe(false);
  });
});

describe('Candela-style layout details', () => {
  it('shows the totals row under the grid and keeps it in step', () => {
    const sku = el.querySelector('#eb-sku');
    type(el.querySelector('#eb-qty'), '2');
    sku.value = 'P001';
    key(sku, 'Enter'); // 2 x 5 = 10
    sku.value = 'A100';
    key(sku, 'Enter'); // 1 x 90
    expect(el.querySelector('[data-sum="qty"]').textContent).toBe('3');
    expect(el.querySelector('[data-sum="total"]').textContent).toBe('100.00');
    expect(el.querySelector('[data-sum="count"]').textContent).toBe('Records: 2');
    type(el.querySelector('[data-edit="disc"]'), '10'); // 10% off the first line
    expect(el.querySelector('[data-sum="disc"]').textContent).toBe('1.00');
    expect(el.querySelector('[data-udist]').textContent).toBe('0.50'); // per-unit discount
  });
  it('the receipt discount only counts once its box is ticked', () => {
    const sku = el.querySelector('#eb-sku');
    sku.value = 'A100';
    key(sku, 'Enter');
    expect(el.querySelector('#eb-rdisc').disabled).toBe(true);
    const box = el.querySelector('#eb-rdon');
    box.checked = true;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    type(el.querySelector('#eb-rdisc'), '10');
    expect(el.querySelector('#eb-net').textContent).toBe('80.00');
    box.checked = false;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    expect(el.querySelector('#eb-net').textContent).toBe('90.00');
  });
  it('offers the Candela receipt types, switched off until printing exists', () => {
    const sel = el.querySelector('#eb-rtype');
    expect([...sel.options].map((o) => o.textContent)).toEqual(['Primary Receipt', 'Gift Receipt', 'Summary Receipt', 'Secondary Receipt']);
    expect(sel.disabled).toBe(true);
  });
  it('Cancel / New clears the bill after confirmation, and only then', () => {
    const sku = el.querySelector('#eb-sku');
    sku.value = 'A100';
    key(sku, 'Enter');
    type(el.querySelector('#eb-customer'), 'Mr Ali');
    const ask = vi.spyOn(window, 'confirm');
    ask.mockReturnValueOnce(false);
    el.querySelector('[data-act="new"]').click();
    expect(el.querySelectorAll('#eb-lines tbody tr[data-id]')).toHaveLength(1);
    ask.mockReturnValueOnce(true);
    el.querySelector('[data-act="cancel"]').click();
    expect(el.querySelectorAll('#eb-lines tbody tr[data-id]')).toHaveLength(0);
    expect(el.querySelector('#eb-customer').value).toBe('');
    expect(el.querySelector('#eb-net').textContent).toBe('0.00');
    ask.mockRestore();
  });
});

describe('saving', () => {
  const api = () => import('../../js/modules/ebill/data/api.js');
  const addOne = () => {
    const sku = el.querySelector('#eb-sku');
    sku.value = 'A100';
    key(sku, 'Enter'); // 90.00
    type(el.querySelector('#eb-cash'), '100');
  };
  const pinBox = () => el.querySelector('#eb-dialog [data-f="pin"]');
  const press = (act) => el.querySelector(`#eb-dialog [data-act="${act}"]`).click();

  it('asks for the PIN, sends the bill with its own id, then clears the bill and shows the invoice number', async () => {
    const { saveInvoice } = await api();
    saveInvoice.mockClear();
    addOne();
    el.querySelector('#eb-save').click();
    await tick();
    expect(pinBox()).not.toBeNull();
    pinBox().value = '482913';
    press('yes');
    await tick();
    await tick();
    expect(saveInvoice).toHaveBeenCalledTimes(1);
    const [inv, pin] = saveInvoice.mock.calls[0];
    expect(pin).toBe('482913');
    expect(inv.invoice_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(inv.device_id).toBe('20000000-0000-0000-0000-000000000001');
    expect(inv.totals.net_total).toBe(90);
    expect(inv.lines).toHaveLength(1);
    expect(el.querySelector('#eb-note').textContent).toContain('EB-261115-00001');
    expect(el.querySelectorAll('#eb-lines tbody tr[data-id]')).toHaveLength(0);
  });
  it('a wrong PIN asks again with the same invoice id and keeps the bill', async () => {
    const { saveInvoice } = await api();
    saveInvoice.mockClear();
    saveInvoice.mockResolvedValueOnce({ ok: false, code: 'bad_pin', message: 'Wrong PIN.' });
    addOne();
    el.querySelector('#eb-save').click();
    await tick();
    pinBox().value = '000001';
    press('yes');
    await tick();
    await tick();
    expect(el.querySelector('#eb-dialog').textContent).toContain('Wrong PIN.');
    pinBox().value = '482913';
    press('yes');
    await tick();
    await tick();
    expect(saveInvoice).toHaveBeenCalledTimes(2);
    expect(saveInvoice.mock.calls[0][0].invoice_id).toBe(saveInvoice.mock.calls[1][0].invoice_id);
  });
  it('cancelling the PIN prompt saves nothing and keeps the bill', async () => {
    const { saveInvoice } = await api();
    saveInvoice.mockClear();
    addOne();
    el.querySelector('#eb-save').click();
    await tick();
    press('no');
    await tick();
    expect(saveInvoice).not.toHaveBeenCalled();
    expect(el.querySelectorAll('#eb-lines tbody tr[data-id]')).toHaveLength(1);
  });
  it('a refusal such as the discount limit shows plainly and keeps the bill', async () => {
    const { saveInvoice } = await api();
    saveInvoice.mockResolvedValueOnce({ ok: false, code: 'discount_limit' });
    addOne();
    el.querySelector('#eb-save').click();
    await tick();
    pinBox().value = '482913';
    press('yes');
    await tick();
    await tick();
    expect(el.querySelector('#eb-note').textContent).toContain('above your limit');
    expect(el.querySelectorAll('#eb-lines tbody tr[data-id]')).toHaveLength(1);
  });
  it('a network failure keeps the bill open and says so', async () => {
    const { saveInvoice } = await api();
    saveInvoice.mockRejectedValueOnce(new Error('network'));
    addOne();
    el.querySelector('#eb-save').click();
    await tick();
    pinBox().value = '482913';
    press('yes');
    await tick();
    await tick();
    expect(el.querySelector('#eb-note').textContent).toContain('Could not reach the server');
    expect(el.querySelectorAll('#eb-lines tbody tr[data-id]')).toHaveLength(1);
  });
  it('a deactivated device cannot save and says why', async () => {
    const { registerDevice, saveInvoice } = await api();
    saveInvoice.mockClear();
    registerDevice.mockResolvedValueOnce({ ok: true, status: 'deactivated' });
    document.body.replaceChildren();
    el = document.createElement('div');
    document.body.append(el);
    const { mount } = await import('../../js/modules/ebill/ui/pos.js');
    await mount(el, { ctx });
    await tick();
    addOne();
    expect(el.querySelector('#eb-save').disabled).toBe(true);
    expect(el.querySelector('#eb-note').textContent).toContain('switched off by the manager');
    expect(saveInvoice).not.toHaveBeenCalled();
  });
  it('warns before saving a Cash bill with too little cash', async () => {
    const { saveInvoice } = await api();
    saveInvoice.mockClear();
    addOne();
    type(el.querySelector('#eb-cash'), '10');
    const ask = vi.spyOn(window, 'confirm').mockReturnValueOnce(false);
    el.querySelector('#eb-save').click();
    await tick();
    expect(ask).toHaveBeenCalled();
    expect(el.querySelector('#eb-dialog [data-f="pin"]')).toBeNull();
    ask.mockRestore();
  });
});

describe('Product Help', () => {
  const open = () => {
    el.querySelector('[data-act="help"]').click();
    return el.querySelector('.eb-modal');
  };

  it('opens from the button and from F2, and closes with Escape', () => {
    expect(open()).not.toBeNull();
    key(document, 'Escape');
    expect(el.querySelector('.eb-modal')).toBeNull();
    key(document, 'F2');
    expect(el.querySelector('.eb-modal')).not.toBeNull();
  });
  it('has a filter control on every column and shows the match count', () => {
    const m = open();
    expect(m.querySelectorAll('#ph-filters th')).toHaveLength(11);
    for (const th of m.querySelectorAll('#ph-filters th')) expect(th.querySelector('select,input'), th.dataset.col).not.toBeNull();
    expect(m.querySelector('#ph-chips').textContent).toContain('3 matches');
    expect(m.textContent).toContain('not live stock');
  });
  it('combines global search and a column filter, shows chips, and Clear all resets', async () => {
    const m = open();
    type(m.querySelector('#ph-global'), 'paracetamol');
    await wait(200);
    expect(m.querySelectorAll('#ph-table tbody tr[data-i]')).toHaveLength(2);
    const op = m.querySelector('[data-f="qty"][data-part="op"]');
    op.value = 'in';
    op.dispatchEvent(new Event('change', { bubbles: true }));
    expect(m.querySelectorAll('#ph-table tbody tr[data-i]')).toHaveLength(1);
    expect(m.querySelector('#ph-chips').textContent).toContain('Stock: in stock');
    m.querySelector('[data-act="clear-all"]').click();
    expect(m.querySelectorAll('#ph-table tbody tr[data-i]')).toHaveLength(3);
    expect(m.querySelector('#ph-global').value).toBe('');
  });
  it('picks with the keyboard, adds to the bill and keeps what was already there', () => {
    const sku = el.querySelector('#eb-sku');
    sku.value = 'A100';
    key(sku, 'Enter');
    type(el.querySelector('#eb-customer'), 'Mr Ali');
    open();
    key(document, 'ArrowDown');
    key(document, 'Enter');
    expect(el.querySelector('.eb-modal')).toBeNull();
    expect(el.querySelectorAll('#eb-lines tbody tr[data-id]')).toHaveLength(2);
    expect(el.querySelector('#eb-customer').value).toBe('Mr Ali');
  });
  it('picks with a double-click', () => {
    const m = open();
    m.querySelector('#ph-table tbody tr[data-i="0"]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(el.querySelectorAll('#eb-lines tbody tr[data-id]')).toHaveLength(1);
  });
  it('remembers the filters when reopened', async () => {
    const m = open();
    type(m.querySelector('#ph-global'), 'syrup');
    await wait(200);
    key(document, 'Escape');
    const again = open();
    expect(again.querySelector('#ph-global').value).toBe('syrup');
    expect(again.querySelectorAll('#ph-table tbody tr[data-i]')).toHaveLength(1);
  });
  it('an unknown code typed in the SKU box opens Product Help already searching for it', async () => {
    const sku = el.querySelector('#eb-sku');
    sku.value = 'augmen';
    key(sku, 'Enter');
    expect(el.querySelector('#ph-global').value).toBe('augmen');
    expect(el.querySelectorAll('#ph-table tbody tr[data-i]')).toHaveLength(1);
  });
  it('Enter right after typing applies the typed filter first instead of choosing a stale row', async () => {
    const m = open();
    const g = m.querySelector('#ph-global');
    type(g, 'syrup');
    key(g, 'Enter');
    expect(el.querySelector('.eb-modal')).not.toBeNull();
    expect(m.querySelectorAll('#ph-table tbody tr[data-i]')).toHaveLength(1);
    expect(el.querySelectorAll('#eb-lines tbody tr[data-id]')).toHaveLength(0);
  });
});
