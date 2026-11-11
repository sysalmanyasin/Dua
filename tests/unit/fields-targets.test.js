// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { friendlyFieldError, moveCode, sectionsOf } from '../../js/modules/sales/domain/fields.js';

const METHODS = [
  { code: 'cash_sale', label: 'Cash Sale', section: 'Cash', sign: 'add', sort: 10, show_in_entry: true, active: true },
  { code: 'hbl', label: 'HBL', section: 'Banks', sign: 'add', sort: 30, show_in_entry: false, active: true },
  { code: 'c_mediq', label: 'MEDIQ', section: 'Credit Clients', sign: 'add', sort: 400, show_in_entry: true, active: true },
  { code: 'old', label: 'Old client', section: 'Credit Clients', sign: 'add', sort: 410, show_in_entry: true, active: false },
];
const api = {
  listAllMethods: vi.fn(async () => METHODS),
  saveField: vi.fn(async () => ({ error: null })),
  reorderFields: vi.fn(async () => ({ error: null })),
  listMonthlyFull: vi.fn(async () => [
    { month: '2026-11-01', total: '1600' },
    { month: '2026-10-01', total: '1500' },
  ]),
  listTargets: vi.fn(async () => [{ month: '2026-11-01', target: '2000' }]),
  setTarget: vi.fn(async () => ({ error: null })),
};
vi.mock('../../js/modules/sales/data/api.js', () => api);

describe('field helpers', () => {
  it('moves a field up or down, and stops at the ends', () => {
    expect(moveCode(['a', 'b', 'c'], 'b', 'up')).toEqual(['b', 'a', 'c']);
    expect(moveCode(['a', 'b', 'c'], 'b', 'down')).toEqual(['a', 'c', 'b']);
    expect(moveCode(['a', 'b', 'c'], 'a', 'up')).toEqual(['a', 'b', 'c']);
    expect(moveCode(['a', 'b', 'c'], 'c', 'down')).toEqual(['a', 'b', 'c']);
    expect(moveCode(['a'], 'zzz', 'up')).toEqual(['a']);
  });
  it('groups by section in the fixed order', () => {
    expect(sectionsOf(METHODS).map((g) => g.section)).toEqual(['Cash', 'Banks', 'Credit Clients']);
  });
  it('explains database errors', () => {
    expect(friendlyFieldError('this field already has saved figures, so its type and section cannot change')).toMatch(/add a new field/);
    expect(friendlyFieldError('name must be 1 to 60 characters')).toMatch(/name/);
    expect(friendlyFieldError('boom')).toMatch(/try again/);
  });
});

const tick = () => new Promise((r) => setTimeout(r, 15));
let el;
const q = (s) => el.querySelector(s);
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
  document.body.innerHTML = '<div id="p"></div>';
  el = document.getElementById('p');
  Object.values(api).forEach((f) => f.mockClear());
  api.saveField.mockImplementation(async () => ({ error: null }));
});

describe('Manage Fields page', () => {
  async function open() {
    const { mount } = await import('../../js/modules/sales/ui/fields.js');
    await mount(el);
    await tick();
  }
  it('lists every field including switched-off ones, and says which are your own', async () => {
    await open();
    expect(el.textContent).toContain('MEDIQ');
    expect(el.textContent).toContain('Old client');
    expect(el.textContent).toContain('switched off');
    expect(el.textContent).toContain('your own field');
  });
  it('hiding a field from the entry page saves just that change', async () => {
    await open();
    const box = q('input[data-show="cash_sale"]');
    box.checked = false;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    await tick();
    expect(api.saveField).toHaveBeenCalledWith('cash_sale', 'Cash Sale', 'Cash', 'add', false, true);
  });
  it('switch off and on, and reorder', async () => {
    await open();
    q('[data-act="off"][data-code="hbl"]').click();
    await tick();
    expect(api.saveField).toHaveBeenCalledWith('hbl', 'HBL', 'Banks', 'add', false, false);
    q('[data-act="on"][data-code="old"]').click();
    await tick();
    expect(api.saveField).toHaveBeenCalledWith('old', 'Old client', 'Credit Clients', 'add', true, true);
    q('[data-act="down"][data-code="cash_sale"]').click();
    await tick();
    expect(api.reorderFields).toHaveBeenCalledWith(['hbl', 'cash_sale', 'c_mediq', 'old']);
  });
  it('adding a field sends no code so the database makes one, and an empty name is refused', async () => {
    await open();
    q('[data-act="add"]').click();
    const dlg = document.querySelector('dialog');
    dlg.querySelector('[data-save]').click();
    await tick();
    expect(api.saveField).not.toHaveBeenCalled();
    dlg.querySelector('#f-name').value = 'Bank Alfalah 2';
    dlg.querySelector('#f-section').value = 'Banks';
    dlg.querySelector('#f-sign').value = 'add';
    dlg.querySelector('[data-save]').click();
    await tick();
    expect(api.saveField).toHaveBeenCalledWith(null, 'Bank Alfalah 2', 'Banks', 'add', true, true);
  });
  it('shows the database reason when a change is refused', async () => {
    api.saveField.mockImplementation(async () => ({
      error: { message: 'this field already has saved figures, so its type and section cannot change' },
    }));
    await open();
    q('[data-act="edit"][data-code="cash_sale"]').click();
    document.querySelector('dialog [data-save]').click();
    await tick();
    expect(document.getElementById('toasts').textContent).toContain('already has saved figures');
  });
});

describe('Targets page', () => {
  async function open() {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-10T08:00:00Z'));
    const { mount } = await import('../../js/modules/sales/ui/targets.js');
    await mount(el);
    await tick();
    vi.useRealTimers();
  }
  it('lists three months ahead and the past two years, with progress where a target exists', async () => {
    await open();
    const rows = el.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(27);
    expect(rows[0].textContent).toContain('February 2027');
    expect(q('input[data-month="2026-11"]').value).toBe('2000');
    expect(q('input[data-month="2026-11"]').closest('tr').textContent).toContain('80%');
  });
  it('saves a target when you leave the box, and an empty box removes it', async () => {
    await open();
    const i = q('input[data-month="2026-12"]');
    i.value = '1,800,000';
    i.dispatchEvent(new Event('change', { bubbles: true }));
    await tick();
    expect(api.setTarget).toHaveBeenCalledWith('2026-12-01', 1800000);
    const j = q('input[data-month="2026-11"]');
    j.value = '';
    j.dispatchEvent(new Event('change', { bubbles: true }));
    await tick();
    expect(api.setTarget).toHaveBeenCalledWith('2026-11-01', null);
  });
  it('refuses nonsense without calling the server', async () => {
    await open();
    const i = q('input[data-month="2026-12"]');
    i.value = 'abc';
    i.dispatchEvent(new Event('change', { bubbles: true }));
    await tick();
    expect(api.setTarget).not.toHaveBeenCalled();
    i.value = '0';
    i.dispatchEvent(new Event('change', { bubbles: true }));
    await tick();
    expect(api.setTarget).not.toHaveBeenCalled();
  });
});
