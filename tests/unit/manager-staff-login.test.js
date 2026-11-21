// @vitest-environment jsdom
// Owner creates a staff login from the Staff Registry (4-digit PIN, no self sign-up).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { suggestUsername, validateLoginForm } from '../../js/modules/manager/domain/staff.js';

const api = {
  listStaff: vi.fn(),
  getStaff: vi.fn(),
  saveStaff: vi.fn(),
  listNotes: vi.fn(),
  addNote: vi.fn(),
  removeNote: vi.fn(),
  creditMonth: vi.fn(),
  listLogins: vi.fn(),
  createLogin: vi.fn(),
};
vi.mock('../../js/modules/manager/data/api.js', () => api);

const tick = () => new Promise((r) => setTimeout(r, 15));
const type = (el, value) => {
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
};
const person = (o = {}) => ({
  staff_id: 's1',
  full_name: 'Test Person A',
  phone: null,
  joined_on: '2024-01-01',
  active: true,
  staff_code: 'EMP-001',
  designation: 'Salesman',
  sort_order: 1,
  ...o,
});
const OWNER = ['mgmt.staff_view', 'mgmt.staff_edit', 'users.manage'];
const dlg = () => document.querySelector('dialog');
let el;

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
  document.body.innerHTML = '<div id="page"></div>';
  el = document.getElementById('page');
  Object.values(api).forEach((f) => f.mockReset());
  api.listStaff.mockResolvedValue([person(), person({ staff_id: 's2', full_name: 'Test Person B', staff_code: 'EMP-002', sort_order: 2 })]);
  api.getStaff.mockImplementation(async (id) => ({
    ...person({ staff_id: id, full_name: id === 's2' ? 'Test Person B' : 'Test Person A' }),
    private_visible: false,
    private: null,
  }));
  api.listLogins.mockResolvedValue([{ user_id: 'u1', staff_id: 's1', username: 'persona', role_template: 'junior', disabled_at: null }]);
  api.createLogin.mockResolvedValue({ ok: true, status: 200, body: { ok: true, username: 'personb', user_id: 'u2' } });
});
afterEach(() => document.querySelectorAll('dialog').forEach((d) => d.remove()));

async function openStaff(perms = OWNER) {
  const { mount } = await import('../../js/modules/manager/ui/staff.js');
  await mount(el, { ctx: { permissions: perms } });
  await tick();
}
const openPerson = async (n) => {
  el.querySelectorAll('[data-act="open"]')[n].click();
  await tick();
};
const fillLogin = (f) => {
  for (const [k, v] of Object.entries(f)) type(dlg().querySelector(`[data-login="${k}"]`), v);
};

describe('login rules (client side)', () => {
  it('suggests the first name in lower case', () => {
    expect(suggestUsername('Muhammad Ali')).toBe('muhammad');
    expect(suggestUsername('  Sara  Khan ')).toBe('sara');
    expect(suggestUsername('Al Rao')).toBe('al.rao');
    expect(suggestUsername('')).toBe('');
    expect(suggestUsername('12 Ali')).toBe('ali');
    expect(suggestUsername('1234')).toBe('');
  });
  it('accepts a good login and explains each mistake', () => {
    expect(validateLoginForm({ username: 'sara', role: 'junior', pin: '4829', pin2: '4829' })).toEqual({});
    expect(validateLoginForm({ username: 'a', role: 'junior', pin: '4829', pin2: '4829' }).username).toBeTruthy();
    expect(validateLoginForm({ username: 'sara', role: 'admin', pin: '4829', pin2: '4829' }).role).toBeTruthy();
    expect(validateLoginForm({ username: 'sara', role: 'junior', pin: '482', pin2: '482' }).pin).toBeTruthy();
    expect(validateLoginForm({ username: 'sara', role: 'junior', pin: '482913', pin2: '482913' }).pin).toBeTruthy();
    expect(validateLoginForm({ username: 'sara', role: 'junior', pin: '4829', pin2: '4830' }).pin2).toBeTruthy();
  });
});

describe('Staff Registry: logins', () => {
  it('shows "No login" only to the owner, and counts who has none', async () => {
    await openStaff();
    const rows = [...el.querySelectorAll('.mg-person')];
    expect(rows[0].textContent).not.toContain('No login');
    expect(rows[1].textContent).toContain('No login');
    expect(el.textContent).toContain('1 without a login');
  });

  it('shows nothing about logins to someone without users.manage, and never asks for them', async () => {
    await openStaff(['mgmt.staff_view', 'mgmt.staff_edit']);
    expect(api.listLogins).not.toHaveBeenCalled();
    expect(el.textContent).not.toContain('No login');
    await openPerson(1);
    expect(dlg().textContent).not.toContain('Login');
    expect(dlg().querySelector('[data-login]')).toBeNull();
  });

  it('a person who has a login shows it, with no create form', async () => {
    await openStaff();
    await openPerson(0);
    expect(dlg().textContent).toContain('persona');
    expect(dlg().querySelector('[data-do="create-login"]')).toBeNull();
  });

  it('offers the form for a person without a login, with a suggested username', async () => {
    await openStaff();
    await openPerson(1);
    expect(dlg().querySelector('[data-login="username"]').value).toBe('test');
    expect(dlg().querySelector('[data-login="pin"]').maxLength).toBe(4);
    expect(dlg().querySelector('[data-login="role"]').value).toBe('junior');
  });

  it('checks the form first and sends nothing when it is wrong', async () => {
    await openStaff();
    await openPerson(1);
    fillLogin({ username: 'sara', pin: '12', pin2: '12' });
    dlg().querySelector('[data-do="create-login"]').click();
    await tick();
    expect(api.createLogin).not.toHaveBeenCalled();
    expect(dlg().textContent).toContain('exactly 4 digits');
  });

  it('creates the login for that registry person and clears the PIN', async () => {
    await openStaff();
    await openPerson(1);
    fillLogin({ username: 'Sara', pin: '4829', pin2: '4829' });
    api.listLogins.mockResolvedValue([
      { user_id: 'u1', staff_id: 's1', username: 'persona', role_template: 'junior', disabled_at: null },
      { user_id: 'u2', staff_id: 's2', username: 'sara', role_template: 'junior', disabled_at: null },
    ]);
    dlg().querySelector('[data-do="create-login"]').click();
    await tick();
    expect(api.createLogin).toHaveBeenCalledWith({ staffId: 's2', username: 'sara', role: 'junior', pin: '4829' });
    expect(dlg().querySelector('[data-do="create-login"]')).toBeNull();
    expect(dlg().textContent).toContain('sara');
    expect(dlg().innerHTML).not.toContain('4829');
    expect(el.textContent).not.toContain('without a login'); // the registry behind the card updated
  });

  it('shows the server message (for example a weak PIN) and keeps the form', async () => {
    api.createLogin.mockResolvedValueOnce({
      ok: false,
      status: 400,
      body: { error: 'weak_pin', message: 'Choose a 4-digit PIN that is not a year.' },
    });
    await openStaff();
    await openPerson(1);
    fillLogin({ username: 'sara', pin: '1990', pin2: '1990' });
    dlg().querySelector('[data-do="create-login"]').click();
    await tick();
    expect(document.body.textContent).toContain('Choose a 4-digit PIN that is not a year.');
    expect(dlg().querySelector('[data-do="create-login"]')).not.toBeNull();
    expect(dlg().querySelector('[data-login="pin"]').value).toBe('');
  });

  it('offers no login for someone off the payroll list', async () => {
    api.listStaff.mockResolvedValue([person({ staff_id: 's2', active: false })]);
    api.getStaff.mockResolvedValue({ ...person({ staff_id: 's2', active: false }), private_visible: false, private: null });
    await openStaff();
    el.querySelector('[data-act="inactive"]').checked = true;
    el.querySelector('[data-act="inactive"]').dispatchEvent(new Event('change', { bubbles: true }));
    await openPerson(0);
    expect(dlg().querySelector('[data-do="create-login"]')).toBeNull();
    expect(dlg().textContent).toContain('no login can be created');
  });

  it('the registry still works when the login list cannot load', async () => {
    api.listLogins.mockRejectedValueOnce(new Error('offline'));
    await openStaff();
    expect(el.querySelectorAll('.mg-person')).toHaveLength(2);
    expect(el.textContent).not.toContain('No login');
  });
});
