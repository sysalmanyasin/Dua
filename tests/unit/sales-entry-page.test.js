// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const METHODS = [
  { code: 'cash_sale', label: 'Cash Sale', section: 'Cash', sign: 'add', sort: 10, show_in_entry: true },
  { code: 'cash_returns', label: 'Cash Returns', section: 'Cash', sign: 'sub', sort: 20, show_in_entry: true },
  { code: 'pso', label: 'PSO', section: 'Credit Clients', sign: 'add', sort: 100, show_in_entry: true },
  { code: 'pso_returns', label: 'PSO Returns', section: 'Credit Clients', sign: 'sub', sort: 110, show_in_entry: false },
];
const api = {
  listMethods: vi.fn(async () => METHODS),
  getDay: vi.fn(async () => ({ day: null, lines: [] })),
  saveDay: vi.fn(async (date, header, lines) => ({ data: { business_date: date, total: 1, diff: 1, revision: 1 }, error: null })),
};
vi.mock('../../js/modules/sales/data/api.js', () => api);

const tick = () => new Promise((r) => setTimeout(r, 15));
const type = (el, value) => {
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
};
let el;
const ctxOf = (permissions) => ({ ctx: { permissions } });

beforeEach(() => {
  document.body.innerHTML = '<div id="page"></div>';
  el = document.getElementById('page');
  sessionStorage.clear();
  Object.values(api).forEach((f) => f.mockClear());
  api.getDay.mockImplementation(async () => ({ day: null, lines: [] }));
});

async function open(perms = ['sales.enter', 'sales.view_history']) {
  const { mount } = await import('../../js/modules/sales/ui/entry.js');
  await mount(el, ctxOf(perms));
  await tick();
}

describe('Add Entry page', () => {
  it('shows the live total and diff as numbers are typed, using the deduct rule for returns', async () => {
    await open();
    type(el.querySelector('[data-code="cash_sale"]'), '250,000');
    type(el.querySelector('[data-code="cash_returns"]'), '-30,197');
    type(el.querySelector('[data-code="pso"]'), '-5000');
    type(el.querySelector('[data-hdr="comp_sale"]'), '200000');
    expect(el.querySelector('#pv-total').textContent).toBe('214,803');
    expect(el.querySelector('#pv-diff').textContent).toBe('+14,803');
  });

  it('hides rarely-used fields until asked', async () => {
    await open();
    expect(el.querySelector('[data-code="pso_returns"]')).toBeNull();
    el.querySelector('[data-act="showall"]').click();
    await tick();
    expect(el.querySelector('[data-code="pso_returns"]')).not.toBeNull();
  });

  it('saves the typed amounts as lines and header, skipping blanks', async () => {
    await open();
    type(el.querySelector('[data-code="cash_sale"]'), '1000');
    type(el.querySelector('[data-hdr="customers"]'), '42');
    el.querySelector('[data-act="save"]').click();
    await tick();
    expect(api.saveDay).toHaveBeenCalledTimes(1);
    const [date, header, lines, reason, key] = api.saveDay.mock.calls[0];
    expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(lines).toEqual([{ method: 'cash_sale', amount: 1000 }]);
    expect(header).toMatchObject({ customers: 42, comp_sale: null });
    expect(reason).toBe('');
    expect(key).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('does not call the server when a number is invalid, and highlights it', async () => {
    await open();
    type(el.querySelector('[data-code="cash_sale"]'), '12abc');
    el.querySelector('[data-act="save"]').click();
    await tick();
    expect(api.saveDay).not.toHaveBeenCalled();
    expect(el.querySelector('[data-code="cash_sale"]').closest('.field').classList.contains('bad')).toBe(true);
  });

  it('refuses an empty new day', async () => {
    await open();
    el.querySelector('[data-act="save"]').click();
    await tick();
    expect(api.saveDay).not.toHaveBeenCalled();
  });

  it('a saved day opens as a correction that needs a reason', async () => {
    api.getDay.mockImplementation(async () => ({
      day: { business_date: '2026-11-04', revision: 1, source: 'import', comp_sale: '100', customers: 5, low_sale_reason: null },
      lines: [{ method_code: 'cash_sale', amount: '500' }],
    }));
    await open(['sales.edit', 'sales.view_history']);
    expect(el.querySelector('[data-code="cash_sale"]').value).toBe('500');
    expect(el.querySelector('#reason')).not.toBeNull();
    type(el.querySelector('[data-code="cash_sale"]'), '600');
    el.querySelector('[data-act="save"]').click();
    await tick();
    expect(api.saveDay).not.toHaveBeenCalled(); // no reason yet
    type(el.querySelector('#reason'), 'typo in cash');
    el.querySelector('[data-act="save"]').click();
    await tick();
    expect(api.saveDay).toHaveBeenCalledTimes(1);
    expect(api.saveDay.mock.calls[0][3]).toBe('typo in cash');
  });

  it('a person who may enter but not correct cannot save over a saved day', async () => {
    api.getDay.mockImplementation(async () => ({ day: { business_date: '2026-11-04', revision: 1, source: 'app' }, lines: [] }));
    await open(['sales.enter', 'sales.view_history']);
    expect(el.querySelector('[data-act="save"]').disabled).toBe(true);
  });

  it('a retry reuses the same key, but changing a number starts a new save', async () => {
    api.saveDay.mockImplementationOnce(async () => ({ data: null, error: { message: 'network' } }));
    await open();
    type(el.querySelector('[data-code="cash_sale"]'), '1000');
    el.querySelector('[data-act="save"]').click();
    await tick();
    el.querySelector('[data-act="save"]').click();
    await tick();
    expect(api.saveDay.mock.calls[0][4]).toBe(api.saveDay.mock.calls[1][4]);
  });

  it('escapes anything it renders', async () => {
    api.listMethods.mockImplementationOnce(async () => [{ ...METHODS[0], label: '<img src=x onerror=alert(1)>' }]);
    await open();
    expect(el.querySelector('img')).toBeNull();
  });
});
