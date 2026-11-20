// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../js/modules/ebill/data/api.js', () => ({
  listStaff: vi.fn(async () => [
    {
      user_id: 'u1',
      username: 'junior1',
      full_name: 'J One',
      role: 'junior',
      disabled: false,
      can_bill: true,
      has_pin: false,
      locked: false,
      max_discount_pct: null,
      max_discount_amount: null,
    },
    {
      user_id: 'u2',
      username: 'senior1',
      full_name: 'S One',
      role: 'senior',
      disabled: false,
      can_bill: true,
      has_pin: true,
      locked: true,
      max_discount_pct: 20,
      max_discount_amount: 2500,
    },
  ]),
  listDevices: vi.fn(async () => [
    {
      device_id: '20000000-0000-0000-0000-000000000001',
      label: 'Counter 1',
      status: 'active',
      registered_at: '2026-11-15T05:00:00Z',
      last_seen_at: '2026-11-15T06:00:00Z',
    },
    {
      device_id: '20000000-0000-0000-0000-000000000002',
      label: 'Old tablet',
      status: 'deactivated',
      deactivate_reason: 'lost',
      registered_at: '2026-11-10T05:00:00Z',
      last_seen_at: '2026-11-11T06:00:00Z',
    },
  ]),
  getShopSettings: vi.fn(async () => ({ maxPct: 10, maxAmount: 1000, pinRequired: true })),
  setPin: vi.fn(async () => null),
  removePin: vi.fn(async () => null),
  setLimits: vi.fn(async () => null),
  setShopSetting: vi.fn(async () => null),
  deactivateDevice: vi.fn(async () => null),
  getReceipt: vi.fn(async () => ({ shop_name: 'Old Shop', footer: 'Thanks', copies: 1, width_mm: 80 })),
  setReceipt: vi.fn(async (v) => v),
}));
vi.mock('../../js/modules/ebill/data/device.js', () => ({
  getDeviceId: () => '20000000-0000-0000-0000-000000000001',
  deviceLabel: () => 'Test device',
}));

const tick = () => new Promise((r) => setTimeout(r, 0));
let el;
const api = () => import('../../js/modules/ebill/data/api.js');
const mountAs = async (permissions) => {
  document.body.replaceChildren();
  el = document.createElement('div');
  document.body.append(el);
  const { mount } = await import('../../js/modules/ebill/ui/settings.js');
  await mount(el, { ctx: { permissions } });
  await tick();
};
const fill = (id, v) => {
  el.querySelector(`#ebs-dialog [data-f="${id}"]`).value = v;
};
const press = (a) => el.querySelector(`#ebs-dialog [data-act="${a}"]`).click();

beforeEach(() => vi.clearAllMocks());

describe('settings page', () => {
  it('the owner sees staff, PIN status, limits and devices', async () => {
    await mountAs(['ebill.set_pin', 'ebill.manage']);
    const rows = [...el.querySelectorAll('tr[data-user]')];
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('Not set');
    expect(rows[0].textContent).toContain('Shop default');
    expect(rows[1].textContent).toContain('locked');
    expect(rows[1].textContent).toContain('20%');
    expect(el.querySelectorAll('tr[data-device]')).toHaveLength(2);
    expect(el.textContent).toContain('this device');
    expect(el.textContent).not.toMatch(/pin_hash|\$2[aby]\$/);
  });
  it('a manager without the PIN right gets no PIN buttons', async () => {
    await mountAs(['ebill.manage']);
    expect(el.querySelector('[data-act="pin"]')).toBeNull();
    expect(el.querySelector('[data-act="limits"]')).not.toBeNull();
  });
  it('setting a PIN asks for it and sends it to the server once', async () => {
    await mountAs(['ebill.set_pin']);
    const { setPin } = await api();
    el.querySelector('tr[data-user="u1"] [data-act="pin"]').click();
    await tick();
    fill('pin', '482913');
    press('yes');
    await tick();
    await tick();
    expect(setPin).toHaveBeenCalledWith('u1', '482913');
    expect(el.textContent).toContain('PIN set for J One');
  });
  it('cancelling the PIN prompt sends nothing', async () => {
    await mountAs(['ebill.set_pin']);
    const { setPin } = await api();
    el.querySelector('tr[data-user="u1"] [data-act="pin"]').click();
    await tick();
    press('no');
    await tick();
    expect(setPin).not.toHaveBeenCalled();
  });
  it('limits need a reason; empty boxes mean the shop default', async () => {
    await mountAs(['ebill.manage']);
    const { setLimits } = await api();
    el.querySelector('tr[data-user="u1"] [data-act="limits"]').click();
    await tick();
    fill('pct', '15');
    fill('amt', '');
    fill('why', 'trusted cashier');
    press('yes');
    await tick();
    await tick();
    expect(setLimits).toHaveBeenCalledWith('u1', 15, null, 'trusted cashier');
  });
  it('a database refusal is shown in plain words', async () => {
    await mountAs(['ebill.set_pin']);
    const { setPin } = await api();
    setPin.mockRejectedValueOnce(new Error('PIN must be 6 digits, not all the same and not a run like 123456'));
    el.querySelector('tr[data-user="u1"] [data-act="pin"]').click();
    await tick();
    fill('pin', '123456');
    press('yes');
    await tick();
    await tick();
    expect(el.querySelector('#ebs-note').textContent).toContain('PIN must be 6 digits');
  });
  it('switching a device off sends the reason', async () => {
    await mountAs(['ebill.manage']);
    const { deactivateDevice } = await api();
    el.querySelector('tr[data-device="20000000-0000-0000-0000-000000000001"] [data-act="off"]').click();
    await tick();
    fill('why', 'tablet lost');
    press('yes');
    await tick();
    await tick();
    expect(deactivateDevice).toHaveBeenCalledWith('20000000-0000-0000-0000-000000000001', 'tablet lost');
  });
  it('shop defaults only send what changed', async () => {
    await mountAs(['ebill.manage']);
    const { setShopSetting } = await api();
    el.querySelector('[data-act="shop"]').click();
    await tick();
    fill('pct', '12');
    fill('why', 'busy season');
    press('yes');
    await tick();
    await tick();
    expect(setShopSetting).toHaveBeenCalledTimes(1);
    expect(setShopSetting).toHaveBeenCalledWith('ebill.max_discount_pct', 12, 'busy season');
  });
});

describe('receipt settings form', () => {
  const form = () => el.querySelector('#ebs-receipt');
  const set = (k, v) => {
    const f = form().querySelector(`[data-k="${k}"]`);
    if (f.type === 'checkbox') {
      f.checked = v;
      f.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      f.value = String(v);
      f.dispatchEvent(new Event('input', { bubbles: true }));
    }
  };
  const save = async () => {
    form().querySelector('[data-act="save"]').click();
    await new Promise((r) => setTimeout(r, 30));
  };

  it('only managers see it; staff-PIN-only people do not', async () => {
    await mountAs(['ebill.set_pin']);
    expect(form().querySelector('[data-act="save"]')).toBeNull();
    await mountAs(['ebill.manage']);
    expect(form().querySelector('[data-act="save"]')).not.toBeNull();
    expect(form().querySelector('[data-k="shop_name"]').value).toBe('Old Shop');
  });
  it('the preview follows what is typed, in the shop’s slip layout', async () => {
    await mountAs(['ebill.manage']);
    set('shop_name', "FAZAL DIN'S PHARMA PLUS");
    set('tax_no', '0870213-3');
    set('pos_no', '132070');
    set('address', 'Bahria Town Commercial 1\nDrug Sales Licence No. 05-352');
    const p = form().querySelector('#rc-preview').textContent;
    for (const t of [
      "FAZAL DIN'S PHARMA PLUS",
      'Purchase Slip',
      'STN/NTN# 0870213-3',
      'POS NO: 132070',
      'Drug Sales Licence No. 05-352',
      'Product',
      'U/Price',
      'Net Payable',
      'Total No. of Items : 1',
    ])
      expect(p).toContain(t);
    expect(p).not.toMatch(/FBR|QR/);
    set('width_mm', 58);
    expect(form().querySelector('#rc-preview .eb-rc').classList.contains('eb-rc-58')).toBe(true);
  });
  it('saves everything in one call, with the reason', async () => {
    await mountAs(['ebill.manage']);
    const { setReceipt } = await api();
    set('shop_name', 'New Shop');
    set('copies', 2);
    set('auto_print', true);
    set('show_generic', true);
    form().querySelector('[data-f="reason"]').value = 'new signboard';
    form()
      .querySelector('[data-f="reason"]')
      .dispatchEvent(new Event('input', { bubbles: true }));
    await save();
    expect(setReceipt).toHaveBeenCalledTimes(1);
    const [v, why] = setReceipt.mock.calls[0];
    expect(why).toBe('new signboard');
    expect(v).toMatchObject({
      shop_name: 'New Shop',
      copies: 2,
      auto_print: true,
      show_generic: true,
      width_mm: 80,
      slip_title: 'Purchase Slip',
    });
    expect(el.textContent).toContain('Receipt settings saved.');
  });
  it('asks for a reason and a sensible copy count before sending anything', async () => {
    await mountAs(['ebill.manage']);
    const { setReceipt } = await api();
    form().querySelector('[data-f="reason"]').value = ' ';
    form()
      .querySelector('[data-f="reason"]')
      .dispatchEvent(new Event('input', { bubbles: true }));
    await save();
    expect(el.textContent).toContain('give a reason');
    form().querySelector('[data-f="reason"]').value = 'ok then';
    form()
      .querySelector('[data-f="reason"]')
      .dispatchEvent(new Event('input', { bubbles: true }));
    set('copies', 9);
    await save();
    expect(el.textContent).toContain('from 1 to 5');
    expect(setReceipt).not.toHaveBeenCalled();
  });
  it('explains in plain words when the database lacks the slip fields', async () => {
    await mountAs(['ebill.manage']);
    const { setReceipt } = await api();
    setReceipt.mockRejectedValueOnce(new Error('unknown receipt setting tax_no'));
    await save();
    expect(el.textContent).toContain('migration 0642');
  });
  it('a logo must be a small picture; a good one shows and can be removed', async () => {
    await mountAs(['ebill.manage']);
    const pick = async (file) => {
      const inp = form().querySelector('[data-act="logo"]');
      Object.defineProperty(inp, 'files', { value: [file], configurable: true });
      inp.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 30));
    };
    await pick(new File(['x'], 'a.svg', { type: 'image/svg+xml' }));
    expect(el.textContent).toContain('PNG, JPEG, WebP or GIF');
    await pick(new File([new Uint8Array(101 * 1024)], 'big.png', { type: 'image/png' }));
    expect(el.textContent).toContain('too big');
    await pick(new File([new Uint8Array([137, 80, 78, 71])], 'logo.png', { type: 'image/png' }));
    expect(form().querySelector('.ebs-rc-logo img').getAttribute('src')).toMatch(/^data:image\/png;base64,/);
    expect(form().querySelector('#rc-preview img.eb-rc-logo')).not.toBeNull();
    form().querySelector('[data-act="rm-logo"]').click();
    expect(form().querySelector('.ebs-rc-logo img')).toBeNull();
  });
  it('prints a test slip', async () => {
    await mountAs(['ebill.manage']);
    const printed = [];
    window.print = vi.fn(() => {
      printed.push(document.getElementById('eb-print-root')?.textContent ?? '');
      window.dispatchEvent(new Event('afterprint'));
    });
    form().querySelector('[data-act="test"]').click();
    await tick();
    expect(printed[0]).toContain('Purchase Slip');
  });
});
