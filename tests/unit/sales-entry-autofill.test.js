// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const M = (code, label, section, sign = 'add', show = true) => ({ code, label, section, sign, sort: 1, show_in_entry: show });
const METHODS = [
  M('cash_sale', 'Cash Sale', 'Cash'),
  M('cash_returns', 'Cash Returns', 'Cash', 'sub'),
  M('bank_alfalah', 'Bank Alfalah', 'Banks'),
  M('c_bank_alfalah_2', 'Bank Alfalah 2', 'Banks'),
  M('askari_bank', 'Askari', 'Credit Clients'),
  M('parco', 'PARCO', 'Credit Clients'),
];
const SOURCES = {
  closing: { sys_cash: '207202.00', alfalah: '46451.00', keenu: '116020.00' },
  candela: {
    payments: { cash_sale: '178128.42', card_sale: '255872.93', credit_sale: '11408.46', total_sale: '445409.81' },
    credit: [
      { name: 'Askari General Insurance Company Ltd.', amount: '7360.32' },
      { name: 'PARCO', amount: '4048.14' },
    ],
  },
  closingError: null,
  candelaError: null,
};
const api = {
  listMethods: vi.fn(async () => METHODS),
  getDay: vi.fn(async () => ({ day: null, lines: [] })),
  recentDays: vi.fn(async () => []),
  saveDay: vi.fn(async (date) => ({ data: { business_date: date, total: 1, diff: 1, revision: 1 }, error: null })),
  autofillSources: vi.fn(async () => SOURCES),
};
vi.mock('../../js/modules/sales/data/api.js', () => api);

const tick = () => new Promise((r) => setTimeout(r, 15));
const type = (el, value) => {
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
};
let el;
const val = (code) => el.querySelector(`[data-code="${code}"]`).value;

async function open(perms = ['sales.enter', 'sales.view_history']) {
  const { mount } = await import('../../js/modules/sales/ui/entry.js');
  await mount(el, { ctx: { permissions: perms } });
  await tick();
}

beforeEach(() => {
  document.body.innerHTML = '<div id="page"></div>';
  el = document.getElementById('page');
  sessionStorage.clear();
  sessionStorage.setItem('sales.entry.date', '2026-11-23');
  Object.values(api).forEach((f) => f.mockClear());
  api.getDay.mockImplementation(async () => ({ day: null, lines: [] }));
  api.autofillSources.mockImplementation(async () => SOURCES);
});

describe('Add Entry auto-pull', () => {
  it('a new day fills itself from the evening closing and Candela', async () => {
    await open();
    expect(api.autofillSources).toHaveBeenCalledWith('2026-11-23');
    expect(val('cash_sale')).toBe('207202');
    expect(val('bank_alfalah')).toBe('46451');
    expect(val('c_bank_alfalah_2')).toBe('116020');
    expect(val('cash_returns')).toBe('29074');
    expect(val('askari_bank')).toBe('7360.32');
    expect(val('parco')).toBe('4048.14');
    expect(el.querySelector('[data-hdr="comp_sale"]').value).toBe('445410');
    expect(el.querySelector('#pull-card').textContent).toContain('Cash Returns');
  });

  it('shows the total the filled numbers make, and saves exactly those numbers', async () => {
    await open();
    expect(el.querySelector('#pv-total').textContent).toBe('352,007');
    el.querySelector('[data-act="save"]').click();
    await tick();
    const [date, header, lines] = api.saveDay.mock.calls[0];
    expect(date).toBe('2026-11-23');
    expect(header.comp_sale).toBe(445410);
    expect(lines).toContainEqual({ method: 'cash_returns', amount: 29074 });
    expect(lines).toContainEqual({ method: 'c_bank_alfalah_2', amount: 116020 });
    expect(lines).toContainEqual({ method: 'parco', amount: 4048.14 });
  });

  it('does not save by itself', async () => {
    await open();
    expect(api.saveDay).not.toHaveBeenCalled();
  });

  it('a saved day is not pulled automatically, only when asked, and then it overwrites what it fills', async () => {
    api.getDay.mockImplementation(async () => ({
      day: { business_date: '2026-11-23', revision: 1, source: 'app', comp_sale: '1' },
      lines: [{ method_code: 'cash_sale', amount: '500' }],
    }));
    await open(['sales.edit', 'sales.view_history']);
    expect(api.autofillSources).not.toHaveBeenCalled();
    expect(val('cash_sale')).toBe('500');
    el.querySelector('[data-act="pull"]').click();
    await tick();
    expect(api.autofillSources).toHaveBeenCalledTimes(1);
    expect(val('cash_sale')).toBe('207202');
  });

  it('“Pull again” replaces a figure the person changed', async () => {
    await open();
    type(el.querySelector('[data-code="cash_sale"]'), '1');
    el.querySelector('[data-act="pull"]').click();
    await tick();
    expect(val('cash_sale')).toBe('207202');
  });

  it('with no saved closing it still fills Candela’s part and says what is missing', async () => {
    api.autofillSources.mockImplementation(async () => ({ ...SOURCES, closing: null }));
    await open();
    expect(val('cash_sale')).toBe('');
    expect(val('parco')).toBe('4048.14');
    expect(el.querySelector('#pull-card').textContent).toContain('No saved evening closing');
  });

  it('a customer with no field is shown with its amount', async () => {
    api.autofillSources.mockImplementation(async () => ({
      ...SOURCES,
      candela: { ...SOURCES.candela, credit: [{ name: 'Wapda Hospital Lahore', amount: '900' }] },
    }));
    await open();
    expect(el.querySelector('#pull-card').textContent).toContain('No field for Wapda Hospital Lahore');
  });

  it('a person who may read neither source sees no auto-pull card at all', async () => {
    api.autofillSources.mockImplementation(async () => ({
      closing: null,
      candela: null,
      closingError: { code: '42501' },
      candelaError: { code: '42501' },
    }));
    await open();
    expect(el.querySelector('#pull-card')).toBeNull();
    expect(val('cash_sale')).toBe('');
  });

  it('a person who may read only the closing gets it, with a note about Candela', async () => {
    api.autofillSources.mockImplementation(async () => ({ ...SOURCES, candela: null, candelaError: { code: '42501' } }));
    await open();
    expect(val('cash_sale')).toBe('207202');
    expect(val('cash_returns')).toBe('');
    expect(el.querySelector('#pull-card').textContent).toContain('You do not have access to Candela figures.');
  });

  it('a network failure leaves the form empty and usable', async () => {
    api.autofillSources.mockImplementation(async () => {
      throw new Error('offline');
    });
    await open();
    expect(el.querySelector('#pull-card').textContent).toContain('Could not read');
    type(el.querySelector('[data-code="cash_sale"]'), '10');
    expect(el.querySelector('#pv-total').textContent).toBe('10');
  });

  it('an answer for a day the person has already left is ignored', async () => {
    let release;
    api.autofillSources.mockImplementationOnce(() => new Promise((res) => (release = res)));
    api.autofillSources.mockImplementationOnce(async () => ({ ...SOURCES, closing: null })); // 22 Nov has no closing
    await open();
    el.querySelector('[data-act="prev"]').click(); // moves to 22 Nov while 23 Nov is still loading
    await tick();
    release({ ...SOURCES, closing: { sys_cash: '999', alfalah: '0', keenu: '0' } }); // the late answer for 23 Nov
    await tick();
    expect(el.querySelector('#date').value).toBe('2026-11-22');
    expect(val('cash_sale')).toBe(''); // the late 23 Nov figure (999) must not land on 22 Nov
    expect(api.autofillSources.mock.calls.map((c) => c[0])).toEqual(['2026-11-23', '2026-11-22']);
  });
});
