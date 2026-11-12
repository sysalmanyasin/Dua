// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = {
  listStaff: vi.fn(),
  getStaff: vi.fn(),
  saveStaff: vi.fn(),
  listNotes: vi.fn(),
  addNote: vi.fn(),
  removeNote: vi.fn(),
  creditMonth: vi.fn(),
  creditAdd: vi.fn(),
  creditReverse: vi.fn(),
  creditSetDeduction: vi.fn(),
  creditSetOpening: vi.fn(),
};
vi.mock('../../js/modules/manager/data/api.js', () => api);

const tick = () => new Promise((r) => setTimeout(r, 15));
const type = (el, value) => {
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
};
let el;
const OWNER = [
  'mgmt.staff_view',
  'mgmt.staff_edit',
  'mgmt.staff_private',
  'mgmt.notes',
  'credit.view',
  'mgmt.credit_manage',
  'mgmt.openings',
  'mgmt.salary',
];

const person = (o = {}) => ({
  staff_id: 's1',
  full_name: 'Test Person A',
  staff_code: 'EMP-001',
  designation: 'Salesman',
  sort_order: 1,
  active: true,
  phone: '0300-0000001',
  joined_on: '2024-01-15',
  ...o,
});
const month = (o = {}) => ({
  staff_id: 's1',
  full_name: 'Test Person A',
  staff_code: 'EMP-001',
  sort_order: 1,
  active: true,
  opening_month: '2026-10-01',
  opening_amount: 5000,
  prev_balance: 5000,
  entries: [],
  entries_total: 0,
  salary_deduction: 0,
  generic_deduction: 0,
  net: 5000,
  ...o,
});

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-12T08:00:00Z'));
  document.body.innerHTML = '<div id="page"></div>';
  el = document.getElementById('page');
  Object.values(api).forEach((f) => f.mockReset());
  api.listStaff.mockResolvedValue([
    person(),
    person({ staff_id: 's2', full_name: 'Test Person B', staff_code: 'EMP-002', designation: null, sort_order: 2 }),
    person({ staff_id: 's3', full_name: 'Test Person C', staff_code: 'EMP-003', active: false, sort_order: 3 }),
  ]);
  api.getStaff.mockResolvedValue({
    ...person(),
    private_visible: true,
    private: { father_name: 'Test Father', address: 'Test Street 1', blood_group: 'O+' },
  });
  api.saveStaff.mockResolvedValue({ data: { staff_id: 's9', staff_code: 'EMP-009' }, error: null });
  api.listNotes.mockResolvedValue([{ id: 'n1', body: 'Test note one', created_at: '2026-11-01T09:00:00Z' }]);
  api.addNote.mockResolvedValue({ data: { id: 'n2' }, error: null });
  api.removeNote.mockResolvedValue({ data: null, error: null });
  api.creditMonth.mockResolvedValue([month()]);
  api.creditAdd.mockResolvedValue({ data: { id: 'e1' }, error: null });
  api.creditReverse.mockResolvedValue({ data: { id: 'e2' }, error: null });
  api.creditSetDeduction.mockResolvedValue({ data: { total: 1500 }, error: null });
  api.creditSetOpening.mockResolvedValue({ data: { id: 'o1' }, error: null });
});
afterEach(() => {
  vi.useRealTimers();
  document.querySelectorAll('dialog').forEach((d) => d.remove());
});

const dlg = () => document.querySelector('dialog');

// ───────────────────────── Staff Registry ─────────────────────────
async function openStaff(perms = OWNER) {
  const { mount } = await import('../../js/modules/manager/ui/staff.js');
  await mount(el, { ctx: { permissions: perms } });
  await tick();
}

describe('Staff Registry page', () => {
  it('lists the active people in the order the database gives, with code and designation', async () => {
    await openStaff();
    const rows = [...el.querySelectorAll('.mg-person')];
    expect(
      rows.map((r) => [r.querySelector('.chip').textContent, r.querySelector('strong').textContent, r.querySelector('small').textContent]),
    ).toEqual([
      ['EMP-001', 'Test Person A', 'Salesman'],
      ['EMP-002', 'Test Person B', 'No designation yet'],
    ]);
    expect(el.textContent).toContain('2 on the payroll list · 1 inactive');
  });

  it('shows inactive people only when asked', async () => {
    await openStaff();
    const box = el.querySelector('[data-act="inactive"]');
    box.checked = true;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    expect(el.querySelectorAll('.mg-person')).toHaveLength(3);
    expect(el.textContent).toContain('Inactive');
  });

  it('shows a plain error card when the list cannot load', async () => {
    api.listStaff.mockRejectedValueOnce(new Error('offline'));
    await openStaff();
    expect(el.textContent).toContain('Could not load the staff registry');
  });

  it('hides "Add person" from someone who may only view', async () => {
    await openStaff(['mgmt.staff_view']);
    expect(el.querySelector('[data-act="add"]')).toBeNull();
    el.querySelector('[data-act="open"]').click();
    await tick();
    expect(dlg().querySelector('[data-do="save"]')).toBeNull();
    expect(dlg().querySelector('[data-f="full_name"]').disabled).toBe(true);
  });

  it('never shows private fields when the database says they are not visible', async () => {
    api.getStaff.mockResolvedValue({ ...person(), private_visible: false, private: null });
    await openStaff(['mgmt.staff_view', 'mgmt.staff_edit']);
    el.querySelector('[data-act="open"]').click();
    await tick();
    expect(dlg().textContent).not.toContain('Private');
    expect(dlg().querySelector('[data-p]')).toBeNull();
  });

  it('shows only the tabs the person may use', async () => {
    await openStaff(['mgmt.staff_view']);
    el.querySelector('[data-act="open"]').click();
    await tick();
    expect(dlg().querySelector('[role="tablist"]')).toBeNull();
    dlg().querySelector('[data-close]').click();
    document.body.innerHTML = '<div id="page"></div>'; // the shell gives every page a fresh container
    el = document.getElementById('page');
    await openStaff(['mgmt.staff_view', 'credit.view', 'mgmt.notes']);
    el.querySelector('[data-act="open"]').click();
    await tick();
    expect([...dlg().querySelectorAll('[data-tab]')].map((t) => t.textContent)).toEqual(['Details', 'Credit', 'Notes']);
  });

  it('adds a person: validates first, then sends one save with an idempotency key', async () => {
    await openStaff();
    el.querySelector('[data-act="add"]').click();
    await tick();
    type(dlg().querySelector('[data-f="full_name"]'), 'X');
    dlg().querySelector('[data-do="save"]').click();
    await tick();
    expect(api.saveStaff).not.toHaveBeenCalled();
    expect(dlg().textContent).toContain('Name must be 2 to 80 characters.');
    type(dlg().querySelector('[data-f="full_name"]'), 'Test Person Z');
    type(dlg().querySelector('[data-f="designation"]'), 'Guard');
    type(dlg().querySelector('[data-p="father_name"]'), 'Test Father Z');
    dlg().querySelector('[data-do="save"]').click();
    await tick();
    expect(api.saveStaff).toHaveBeenCalledTimes(1);
    const p = api.saveStaff.mock.calls[0][0];
    expect(p).toMatchObject({ p_staff_id: null, p_full_name: 'Test Person Z', p_designation: 'Guard', p_staff_code: null, p_active: true });
    expect(p.p_private.father_name).toBe('Test Father Z');
    expect(p.p_key).toMatch(/^[0-9a-f-]{36}$/);
    expect(dlg()).toBeNull();
    expect(api.listStaff).toHaveBeenCalledTimes(2); // reloaded after saving
  });

  it('a failed save keeps the form, shows the database message, and a retry reuses the same key until the form is edited', async () => {
    api.saveStaff.mockResolvedValueOnce({ data: null, error: { message: 'that staff code is already used' } });
    await openStaff();
    el.querySelector('[data-act="add"]').click();
    await tick();
    type(dlg().querySelector('[data-f="full_name"]'), 'Test Person Z');
    dlg().querySelector('[data-do="save"]').click();
    await tick();
    expect(document.getElementById('toasts').textContent).toContain('already used');
    expect(dlg()).not.toBeNull();
    dlg().querySelector('[data-do="save"]').click();
    await tick();
    const [k1, k2] = api.saveStaff.mock.calls.map((c) => c[0].p_key);
    expect(k1).toBe(k2);
    expect(dlg()).toBeNull();

    api.saveStaff.mockResolvedValueOnce({ data: null, error: { message: 'nope' } });
    el.querySelector('[data-act="open"]').click();
    await tick();
    dlg().querySelector('[data-do="save"]').click();
    await tick();
    type(dlg().querySelector('[data-f="designation"]'), 'Changed');
    dlg().querySelector('[data-do="save"]').click();
    await tick();
    const [k3, k4] = api.saveStaff.mock.calls.slice(2).map((c) => c[0].p_key);
    expect(k3).not.toBe(k4);
  });

  it('notes: add, and remove with an optional reason', async () => {
    await openStaff();
    el.querySelector('[data-act="open"]').click();
    await tick();
    dlg().querySelector('[data-tab="notes"]').click();
    await tick();
    expect(dlg().textContent).toContain('Test note one');
    type(dlg().querySelector('#note-body'), 'Test note two');
    dlg().querySelector('[data-do="note-add"]').click();
    await tick();
    expect(api.addNote).toHaveBeenCalledWith('s1', 'Test note two', expect.stringMatching(/^[0-9a-f-]{36}$/));
    dlg().querySelector('[data-do="note-remove"]').click();
    await tick();
    const reasonDlg = [...document.querySelectorAll('dialog')].at(-1);
    reasonDlg.querySelector('[data-ok]').click(); // a reason is optional for notes
    await tick();
    expect(api.removeNote).toHaveBeenCalledWith('n1', '');
  });

  it('the credit tab shows this month’s numbers from the database function', async () => {
    api.creditMonth.mockResolvedValue([month({ net: 6500, entries_total: 1500, salary_deduction: 0 })]);
    await openStaff();
    el.querySelector('[data-act="open"]').click();
    await tick();
    dlg().querySelector('[data-tab="credit"]').click();
    await tick();
    expect(api.creditMonth).toHaveBeenCalledWith('2026-11-01');
    expect(dlg().textContent).toContain('6,500');
  });
});

// ───────────────────────── Staff Credit ─────────────────────────
async function openCredit(perms = OWNER) {
  const { mount } = await import('../../js/modules/manager/ui/credit.js');
  await mount(el, { ctx: { permissions: perms } });
  await tick();
}
const expand = async () => {
  el.querySelector('[data-act="toggle"]').click();
  await tick();
};

describe('Staff Credit page', () => {
  it('shows the month, the sums and the total, and cannot go past the current month', async () => {
    api.creditMonth.mockResolvedValue([month(), month({ staff_id: 's2', full_name: 'Test Person B', net: 250.5 })]);
    await openCredit();
    expect(api.creditMonth).toHaveBeenCalledWith('2026-11-01');
    expect(el.textContent).toContain('November 2026');
    expect(el.textContent).toContain('Previous 5,000');
    expect(el.querySelector('.total-card').textContent).toContain('5,250.50');
    expect(el.querySelector('[data-act="next"]').disabled).toBe(true);
    el.querySelector('[data-act="prev"]').click();
    await tick();
    expect(api.creditMonth).toHaveBeenLastCalledWith('2026-10-01');
    expect(el.querySelector('[data-act="next"]').disabled).toBe(false);
  });

  it('says so when nobody has credit', async () => {
    api.creditMonth.mockResolvedValue([]);
    await openCredit();
    expect(el.textContent).toContain('Nobody has credit this month.');
  });

  it('marks reversed lines and offers Reverse only on a live entry', async () => {
    api.creditMonth.mockResolvedValue([
      month({
        entries: [
          {
            id: 'a',
            entry_date: '2026-11-03',
            description: 'Mistake',
            amount: 2000,
            source: 'manual',
            reverses_id: null,
            reversed_by: 'b',
            reason: null,
          },
          {
            id: 'b',
            entry_date: '2026-11-03',
            description: 'Reversal: Mistake',
            amount: -2000,
            source: 'manual',
            reverses_id: 'a',
            reversed_by: null,
            reason: 'wrong person',
          },
          {
            id: 'c',
            entry_date: '2026-11-05',
            description: 'Advance',
            amount: 1000,
            source: 'manual',
            reverses_id: null,
            reversed_by: null,
            reason: null,
          },
        ],
      }),
    ]);
    await openCredit();
    await expand();
    expect(el.textContent).toContain('Reversed');
    expect(el.textContent).toContain('wrong person');
    expect([...el.querySelectorAll('[data-act="reverse"]')].map((b) => b.dataset.id)).toEqual(['c']);
  });

  it('a read-only viewer sees no forms and no buttons that change anything', async () => {
    await openCredit(['credit.view']);
    await expand();
    expect(el.querySelector('[data-act="add"]')).toBeNull();
    expect(el.querySelector('[data-act="ded"]')).toBeNull();
    expect(el.querySelector('[data-act="reverse"]')).toBeNull();
    expect(el.querySelector('[data-act="opening"]')).toBeNull();
  });

  it('only the opening-balance key shows the opening control', async () => {
    await openCredit(['credit.view', 'mgmt.credit_manage']);
    await expand();
    expect(el.querySelector('[data-act="add"]')).not.toBeNull();
    expect(el.querySelector('[data-act="opening"]')).toBeNull();
  });

  it('adds an entry: refuses zero and a future date, sends 2,000 once, and a failed attempt retries with the same key', async () => {
    await openCredit();
    await expand();
    el.querySelector('[data-act="add"]').click();
    await tick();
    expect(api.creditAdd).not.toHaveBeenCalled();
    expect(el.textContent).toContain('Enter an amount');
    type(el.querySelector('[data-form="amount"]'), '0');
    el.querySelector('[data-act="add"]').click();
    await tick();
    expect(api.creditAdd).not.toHaveBeenCalled();
    type(el.querySelector('[data-form="amount"]'), '2,000');
    type(el.querySelector('[data-form="date"]'), '2026-11-13');
    el.querySelector('[data-act="add"]').click();
    await tick();
    expect(api.creditAdd).not.toHaveBeenCalled();
    expect(el.textContent).toContain('cannot be in the future');
    type(el.querySelector('[data-form="date"]'), '2026-11-12');
    type(el.querySelector('[data-form="description"]'), 'advance');
    api.creditAdd.mockResolvedValueOnce({ data: null, error: { message: 'date is before this person’s opening balance month' } });
    el.querySelector('[data-act="add"]').click();
    await tick();
    expect(document.getElementById('toasts').textContent).toContain('opening balance month');
    el.querySelector('[data-act="add"]').click();
    await tick();
    expect(api.creditAdd).toHaveBeenCalledTimes(2);
    const [a, b] = api.creditAdd.mock.calls;
    expect(a.slice(0, 4)).toEqual(['s1', '2026-11-12', 'advance', 2000]);
    expect(a[4]).toBe(b[4]);
    expect(api.creditMonth).toHaveBeenCalledTimes(2); // reloaded after the successful add
  });

  it('a repayment is a minus amount', async () => {
    await openCredit();
    await expand();
    type(el.querySelector('[data-form="amount"]'), '-500');
    el.querySelector('[data-act="add"]').click();
    await tick();
    expect(api.creditAdd.mock.calls[0][3]).toBe(-500);
  });

  it('reverse asks for a reason first and sends nothing without one', async () => {
    api.creditMonth.mockResolvedValue([
      month({
        entries: [
          {
            id: 'c',
            entry_date: '2026-11-05',
            description: 'Advance',
            amount: 1000,
            source: 'manual',
            reverses_id: null,
            reversed_by: null,
            reason: null,
          },
        ],
      }),
    ]);
    await openCredit();
    await expand();
    el.querySelector('[data-act="reverse"]').click();
    await tick();
    dlg().querySelector('[data-ok]').click();
    expect(dlg().querySelector('#reason-err').hidden).toBe(false);
    expect(api.creditReverse).not.toHaveBeenCalled();
    type(dlg().querySelector('#reason'), 'typed for the wrong person');
    dlg().querySelector('[data-ok]').click();
    await tick();
    expect(api.creditReverse).toHaveBeenCalledWith('c', 'typed for the wrong person', expect.any(String));
  });

  it('cancelling the reason prompt sends nothing', async () => {
    api.creditMonth.mockResolvedValue([
      month({
        entries: [
          {
            id: 'c',
            entry_date: '2026-11-05',
            description: 'Advance',
            amount: 1000,
            source: 'manual',
            reverses_id: null,
            reversed_by: null,
            reason: null,
          },
        ],
      }),
    ]);
    await openCredit();
    await expand();
    el.querySelector('[data-act="reverse"]').click();
    await tick();
    dlg().querySelector('[data-close]').click();
    await tick();
    expect(api.creditReverse).not.toHaveBeenCalled();
  });

  it('a first deduction needs no reason; changing an existing one does', async () => {
    await openCredit();
    await expand();
    type(el.querySelector('[data-ded="salary_deduction"]'), '1,500');
    el.querySelector('[data-act="ded"][data-kind="salary_deduction"]').click();
    await tick();
    expect(api.creditSetDeduction).toHaveBeenCalledWith('s1', '2026-11-01', 'salary_deduction', 1500, '', expect.any(String));

    api.creditMonth.mockResolvedValue([month({ salary_deduction: 1500, net: 3500 })]);
    await openCredit();
    await expand();
    type(el.querySelector('[data-ded="salary_deduction"]'), '2000');
    el.querySelector('[data-act="ded"][data-kind="salary_deduction"]').click();
    await tick();
    expect(dlg().textContent).toContain('It was 1,500');
    type(dlg().querySelector('#reason'), 'corrected after check');
    dlg().querySelector('[data-ok]').click();
    await tick();
    expect(api.creditSetDeduction).toHaveBeenLastCalledWith(
      's1',
      '2026-11-01',
      'salary_deduction',
      2000,
      'corrected after check',
      expect.any(String),
    );
  });

  it('setting a deduction to the same number does nothing', async () => {
    api.creditMonth.mockResolvedValue([month({ salary_deduction: 1500 })]);
    await openCredit();
    await expand();
    el.querySelector('[data-act="ded"][data-kind="salary_deduction"]').click();
    await tick();
    expect(api.creditSetDeduction).not.toHaveBeenCalled();
  });

  it('opening balance: needs amount and reason, then saves once for the chosen month', async () => {
    await openCredit();
    await expand();
    el.querySelector('[data-act="opening"]').click();
    await tick();
    const d = dlg();
    d.querySelector('[data-ok]').click();
    await tick();
    expect(api.creditSetOpening).not.toHaveBeenCalled();
    d.querySelector('#o-month').value = '2026-10';
    type(d.querySelector('#o-amount'), '6,000');
    type(d.querySelector('#o-reason'), 'balance from the old app');
    d.querySelector('[data-ok]').click();
    await tick();
    expect(api.creditSetOpening).toHaveBeenCalledWith('s1', '2026-10-01', 6000, 'balance from the old app', expect.any(String));
  });

  it('shows a plain error card when the month cannot load', async () => {
    api.creditMonth.mockRejectedValueOnce(new Error('offline'));
    await openCredit();
    expect(el.textContent).toContain('Could not load staff credit');
  });
});
