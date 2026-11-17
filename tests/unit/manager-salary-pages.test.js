// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = {
  genericMonth: vi.fn(),
  ratesList: vi.fn(),
  genericSave: vi.fn(),
  rateSet: vi.fn(),
  sheetClose: vi.fn(),
  salaryMonth: vi.fn(),
  salaryColumns: vi.fn(),
  salarySave: vi.fn(),
  salaryColumnAdd: vi.fn(),
  salaryColumnRetire: vi.fn(),
  creditMonth: vi.fn(),
};
vi.mock('../../js/modules/manager/data/api.js', () => api);

const tick = () => new Promise((r) => setTimeout(r, 15));
const type = (el, value) => {
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
};
let el;
const OWNER = ['mgmt.salary', 'mgmt.salary_view', 'mgmt.close_month', 'mgmt.rates', 'credit.view', 'mgmt.credit_manage'];
const G = (o = {}) => ({
  staff_id: 's1',
  full_name: 'Test Person A',
  staff_code: 'EMP-001',
  designation: 'Salesman',
  sort_order: 1,
  active: true,
  has_row: false,
  revision: null,
  generic_sale: 0,
  extra: 0,
  rate: 0.04,
  incentive: 0,
  final: 0,
  closed: false,
  ...o,
});
const S = (o = {}) => ({
  staff_id: 's1',
  full_name: 'Test Person A',
  staff_code: 'EMP-001',
  designation: 'Salesman',
  sort_order: 1,
  active: true,
  has_row: true,
  revision: 0,
  ho_salary: 30000,
  ho_carried: false,
  days: 30,
  extras: {},
  advance: 1500,
  advance_live: 1500,
  generic: 1100,
  generic_live: 1100,
  credit_deduction: 1500,
  net: 29600,
  closed: false,
  entries: [
    { entry_date: '2026-11-05', description: 'Advance', amount: 2000 },
    { entry_date: '2026-11-08', description: 'Repayment', amount: -500 },
  ],
  ...o,
});
const COLS = [
  { column_id: 'c1', name: 'Bonus', sign: 1 },
  { column_id: 'c2', name: 'Fine', sign: -1 },
];
const dlg = () => [...document.querySelectorAll('dialog')].at(-1);

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
  window.print = vi.fn();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-12T08:00:00Z'));
  document.body.innerHTML = '<div id="page"></div>';
  el = document.getElementById('page');
  Object.values(api).forEach((f) => f.mockReset());
  api.ratesList.mockResolvedValue([{ rate_key: 'generic_staff', rate: 0.04, reason: 'start', set_at: '2026-01-01T00:00:00Z' }]);
  api.genericMonth.mockResolvedValue([G(), G({ staff_id: 's2', full_name: 'Test Person B', staff_code: 'EMP-002', sort_order: 2 })]);
  api.genericSave.mockResolvedValue({ data: { changed: 1, unchanged: 0 }, error: null });
  api.rateSet.mockResolvedValue({ data: { id: 'r1' }, error: null });
  api.sheetClose.mockResolvedValue({ data: { sheet_id: 'x' }, error: null });
  api.salaryMonth.mockResolvedValue([
    S(),
    S({
      staff_id: 's2',
      full_name: 'Test Person B',
      staff_code: 'EMP-002',
      sort_order: 2,
      ho_salary: 20000,
      ho_carried: true,
      has_row: false,
      advance: 0,
      advance_live: 0,
      generic: 0,
      generic_live: 0,
      credit_deduction: 0,
      entries: [],
      days: 31,
    }),
  ]);
  api.salaryColumns.mockResolvedValue(COLS);
  api.salarySave.mockResolvedValue({ data: { changed: 1, unchanged: 0 }, error: null });
  api.salaryColumnAdd.mockResolvedValue({ data: { id: 'c9' }, error: null });
  api.salaryColumnRetire.mockResolvedValue({ data: { id: 'c1' }, error: null });
  api.creditMonth.mockResolvedValue([
    { staff_id: 's1', prev_balance: 5000, entries_total: 1500, salary_deduction: 1500, generic_deduction: 0, net: 5000 },
  ]);
});
afterEach(() => {
  vi.useRealTimers();
  document.querySelectorAll('dialog').forEach((d) => d.remove());
});

async function openGeneric(perms = OWNER) {
  const { mount } = await import('../../js/modules/manager/ui/generic.js');
  await mount(el, { ctx: { permissions: perms } });
  await tick();
}
async function openSalary(perms = OWNER) {
  const { mount } = await import('../../js/modules/manager/ui/salary.js');
  await mount(el, { ctx: { permissions: perms } });
  await tick();
}

describe('Generic Sheet page', () => {
  it('shows the month, the rate and a total, and the next button stops at the current month', async () => {
    await openGeneric();
    expect(api.genericMonth).toHaveBeenCalledWith('2026-11-01');
    expect(el.textContent).toContain('November 2026');
    expect(el.textContent).toContain('4%');
    expect(el.querySelector('[data-act="next"]').disabled).toBe(true);
  });

  it('previews incentive and final as you type, rounding to whole rupees', async () => {
    api.ratesList.mockResolvedValue([{ rate_key: 'generic_staff', rate: 0.045 }]);
    api.genericMonth.mockResolvedValue([G({ rate: 0.045 })]);
    await openGeneric();
    type(el.querySelector('[data-g="sale"]'), '2,500');
    expect(el.querySelector('[data-inc="s1"]').textContent).toContain('113'); // 112.5 -> 113
    type(el.querySelector('[data-g="extra"]'), '-30');
    expect(el.querySelector('[data-final="s1"]').textContent).toContain('83');
    expect(el.querySelector('[data-total]').textContent).toContain('83');
  });

  it('saves every row once with a key, and retries with the SAME key until something is edited', async () => {
    await openGeneric();
    type(el.querySelector('[data-g="sale"]'), '100000');
    api.genericSave.mockResolvedValueOnce({ data: null, error: { message: 'network down' } });
    el.querySelector('[data-act="save"]').click();
    await tick();
    expect(document.getElementById('toasts').textContent).toContain('network down');
    el.querySelector('[data-act="save"]').click();
    await tick();
    const [a, b] = api.genericSave.mock.calls;
    expect(a[0]).toBe('2026-11-01');
    expect(a[1]).toEqual([
      { staff_id: 's1', generic_sale: 100000, extra: 0 },
      { staff_id: 's2', generic_sale: 0, extra: 0 },
    ]);
    expect(a[3]).toBe(b[3]);
  });

  it('an edit after a failed save gets a NEW key (a changed sheet is a different save)', async () => {
    await openGeneric();
    type(el.querySelector('[data-g="sale"]'), '100000');
    api.genericSave.mockResolvedValueOnce({ data: null, error: { message: 'network down' } });
    el.querySelector('[data-act="save"]').click();
    await tick();
    type(el.querySelector('[data-g="sale"]'), '120000');
    el.querySelector('[data-act="save"]').click();
    await tick();
    const [a, b] = api.genericSave.mock.calls;
    expect(a[3]).not.toBe(b[3]);
  });

  it('refuses junk numbers before sending anything', async () => {
    await openGeneric();
    type(el.querySelector('[data-g="sale"]'), '12abc');
    el.querySelector('[data-act="save"]').click();
    await tick();
    expect(api.genericSave).not.toHaveBeenCalled();
    expect(document.getElementById('toasts').textContent).toContain('Test Person A');
  });

  it('a read-only person sees disabled inputs and no Save, Close or Change rate', async () => {
    await openGeneric(['mgmt.salary_view']);
    expect(el.querySelector('[data-g="sale"]').disabled).toBe(true);
    for (const a of ['save', 'close', 'rate']) expect(el.querySelector(`[data-act="${a}"]`)).toBeNull();
  });

  it('a closed month asks for a reason before saving a revision, and sends nothing if cancelled', async () => {
    api.genericMonth.mockResolvedValue([G({ has_row: true, closed: true, generic_sale: 1000, incentive: 40, final: 40 })]);
    await openGeneric();
    expect(el.textContent).toContain('This month is closed');
    expect(el.querySelector('[data-act="close"]')).toBeNull();
    type(el.querySelector('[data-g="sale"]'), '2000');
    el.querySelector('[data-act="save"]').click();
    await tick();
    dlg().querySelector('[data-close]').click();
    await tick();
    expect(api.genericSave).not.toHaveBeenCalled();
    el.querySelector('[data-act="save"]').click();
    await tick();
    type(dlg().querySelector('#reason'), 'sale corrected after the audit');
    dlg().querySelector('[data-ok]').click();
    await tick();
    expect(api.genericSave.mock.calls[0][2]).toBe('sale corrected after the audit');
  });

  it('Close month needs the close key, a saved sheet, and no unsaved edits', async () => {
    api.genericMonth.mockResolvedValue([G({ has_row: true, generic_sale: 1000, incentive: 40, final: 40 })]);
    await openGeneric(['mgmt.salary', 'mgmt.salary_view']);
    expect(el.querySelector('[data-act="close"]')).toBeNull();
    document.body.innerHTML = '<div id="page"></div>';
    el = document.getElementById('page');
    await openGeneric();
    type(el.querySelector('[data-g="sale"]'), '1200');
    el.querySelector('[data-act="close"]').click();
    await tick();
    expect(api.sheetClose).not.toHaveBeenCalled();
    expect(document.getElementById('toasts').textContent).toContain('Save your changes first');
    type(el.querySelector('[data-g="sale"]'), '1000');
    el.querySelector('[data-act="close"]').click();
    await tick();
    dlg().querySelector('[data-ok]').click();
    await tick();
    expect(api.sheetClose).toHaveBeenCalledWith('2026-11-01', 'generic', expect.any(String));
  });

  it('changing the rate needs the rates key, a valid percentage and a reason', async () => {
    await openGeneric();
    el.querySelector('[data-act="rate"]').click();
    await tick();
    type(dlg().querySelector('#r-pct'), '150');
    dlg().querySelector('[data-ok]').click();
    await tick();
    expect(api.rateSet).not.toHaveBeenCalled();
    type(dlg().querySelector('#r-pct'), '4.5');
    dlg().querySelector('[data-ok]').click();
    await tick();
    expect(api.rateSet).not.toHaveBeenCalled(); // no reason yet
    type(dlg().querySelector('#r-reason'), 'owner decision');
    dlg().querySelector('[data-ok]').click();
    await tick();
    expect(api.rateSet).toHaveBeenCalledWith('generic_staff', 0.045, 'owner decision', expect.any(String));
  });

  it('going to another month with unsaved edits asks first', async () => {
    await openGeneric();
    type(el.querySelector('[data-g="sale"]'), '500');
    el.querySelector('[data-act="prev"]').click();
    await tick();
    expect(dlg().textContent).toContain('Leave without saving');
    dlg().querySelector('[data-close]').click();
    await tick();
    expect(api.genericMonth).toHaveBeenCalledTimes(1);
  });

  it('shows a plain error card when it cannot load', async () => {
    api.genericMonth.mockRejectedValueOnce(new Error('offline'));
    await openGeneric();
    expect(el.textContent).toContain('Could not load the generic sheet');
  });
});

describe('Salary page', () => {
  it('shows HO salary, days, the custom columns, the read-only advance and generic, and the net', async () => {
    await openSalary();
    const first = el.querySelector('[data-net="s1"]').textContent;
    expect(first).toContain('29,600');
    expect(el.textContent).toContain('Bonus (+)');
    expect(el.textContent).toContain('Fine (−)');
    expect(el.querySelector('[data-s="ho"][data-id="s2"]').value).toBe('20000');
    expect(el.textContent).toContain('(carried)');
    expect(el.textContent).not.toContain('NaN');
  });

  it('the advance is read-only and shows its breakdown on request', async () => {
    await openSalary();
    expect(el.querySelector('input[data-s="advance"]')).toBeNull();
    el.querySelector('[data-act="detail"][data-id="s1"]').click();
    expect(el.textContent).toContain('Repayment');
  });

  it('recalculates the net as you type, whole rupees, custom columns by sign', async () => {
    await openSalary();
    type(el.querySelector('[data-s="ho"][data-id="s1"]'), '31,000.5');
    type(el.querySelector('[data-x="c1"][data-id="s1"]'), '500');
    type(el.querySelector('[data-x="c2"][data-id="s1"]'), '250');
    expect(el.querySelector('[data-net="s1"]').textContent).toContain('30,851'); // 31001 - 1500 + 1100 + 500 - 250
  });

  it('saves with days, HO salary and the columns keyed by id, and retries with the same key', async () => {
    await openSalary();
    type(el.querySelector('[data-x="c1"][data-id="s1"]'), '500');
    api.salarySave.mockResolvedValueOnce({ data: null, error: { message: 'network down' } });
    el.querySelector('[data-act="save"]').click();
    await tick();
    el.querySelector('[data-act="save"]').click();
    await tick();
    const [a, b] = api.salarySave.mock.calls;
    expect(a[0]).toBe('2026-11-01');
    expect(a[1][0]).toEqual({ staff_id: 's1', ho_salary: 30000, days: 30, extras: { c1: 500, c2: 0 } });
    expect(a[1][1].ho_salary).toBe(20000);
    expect(a[3]).toBe(b[3]);
  });

  it('an edit after a failed save gets a NEW key', async () => {
    await openSalary();
    type(el.querySelector('[data-s="ho"][data-id="s1"]'), '31000');
    api.salarySave.mockResolvedValueOnce({ data: null, error: { message: 'network down' } });
    el.querySelector('[data-act="save"]').click();
    await tick();
    type(el.querySelector('[data-s="ho"][data-id="s1"]'), '32000');
    el.querySelector('[data-act="save"]').click();
    await tick();
    const [a, b] = api.salarySave.mock.calls;
    expect(a[3]).not.toBe(b[3]);
  });

  it('going to another month with unsaved edits asks first', async () => {
    await openSalary();
    type(el.querySelector('[data-s="ho"][data-id="s1"]'), '31000');
    el.querySelector('[data-act="prev"]').click();
    await tick();
    expect(dlg().textContent).toContain('Leave without saving');
    dlg().querySelector('[data-close]').click();
    await tick();
    expect(api.salaryMonth).toHaveBeenCalledTimes(1);
  });

  it('refuses days outside 0 to 31 and junk amounts', async () => {
    await openSalary();
    type(el.querySelector('[data-s="days"][data-id="s1"]'), '32');
    el.querySelector('[data-act="save"]').click();
    await tick();
    expect(api.salarySave).not.toHaveBeenCalled();
    expect(document.getElementById('toasts').textContent).toContain('0 to 31');
    type(el.querySelector('[data-s="days"][data-id="s1"]'), '30');
    type(el.querySelector('[data-s="ho"][data-id="s1"]'), 'abc');
    el.querySelector('[data-act="save"]').click();
    await tick();
    expect(api.salarySave).not.toHaveBeenCalled();
  });

  it('flags a closed month whose credit changed, and a credit deduction that differs from the advance', async () => {
    api.salaryMonth.mockResolvedValue([S({ closed: true, advance: 1500, advance_live: 2200, credit_deduction: 1000 })]);
    await openSalary();
    expect(el.textContent).toContain('Staff Credit changed since closing');
    expect(el.textContent).toContain('Staff Credit deducts');
    expect(el.textContent).toContain('This month is closed');
  });

  it('a read-only person sees no inputs enabled and no Save, Close, Add column or Stop', async () => {
    await openSalary(['mgmt.salary_view']);
    expect(el.querySelector('[data-s="ho"]').disabled).toBe(true);
    for (const a of ['save', 'close', 'addcol', 'retire']) expect(el.querySelector(`[data-act="${a}"]`)).toBeNull();
  });

  it('adds a column with a name and a direction', async () => {
    await openSalary();
    el.querySelector('[data-act="addcol"]').click();
    await tick();
    dlg().querySelector('[data-ok]').click();
    await tick();
    expect(api.salaryColumnAdd).not.toHaveBeenCalled();
    type(dlg().querySelector('#c-name'), 'Allowance');
    dlg().querySelector('#c-sign').value = '-1';
    dlg().querySelector('[data-ok]').click();
    await tick();
    expect(api.salaryColumnAdd).toHaveBeenCalledWith('Allowance', -1, '2026-11-01', expect.any(String));
  });

  it('stops a column from next month after confirmation, and shows the database refusal', async () => {
    api.salaryColumnRetire.mockResolvedValueOnce({
      data: null,
      error: { message: 'amounts still exist in this column from that month on' },
    });
    await openSalary();
    el.querySelector('[data-act="retire"][data-col="c1"]').click();
    await tick();
    dlg().querySelector('[data-ok]').click();
    await tick();
    expect(api.salaryColumnRetire).toHaveBeenCalledWith('c1', '2026-12-01', expect.any(String));
    expect(document.getElementById('toasts').textContent).toContain('amounts still exist');
  });

  it('a closed month asks for a reason when saving, and Close month shows the database refusal', async () => {
    api.salaryMonth.mockResolvedValue([S({ closed: true })]);
    await openSalary();
    el.querySelector('[data-act="save"]').click();
    await tick();
    expect(dlg().textContent).toContain('Revise a closed month');
    dlg().querySelector('[data-close]').click();
    await tick();
    expect(api.salarySave).not.toHaveBeenCalled();

    document.body.innerHTML = '<div id="page"></div>';
    el = document.getElementById('page');
    api.salaryMonth.mockResolvedValue([S()]);
    api.sheetClose.mockResolvedValueOnce({ data: null, error: { message: 'close the Generic sheet for that month first' } });
    await openSalary();
    el.querySelector('[data-act="close"]').click();
    await tick();
    dlg().querySelector('[data-ok]').click();
    await tick();
    expect(api.sheetClose).toHaveBeenCalledWith('2026-11-01', 'salary', expect.any(String));
    expect(document.getElementById('toasts').textContent).toContain('Generic sheet');
  });

  it('opens a payslip with the business name, the net, the credit box, and prints it', async () => {
    api.genericMonth.mockResolvedValue([G({ has_row: true, generic_sale: 22000, extra: 0, incentive: 1100, final: 1100, rate: 0.05 })]);
    await openSalary();
    el.querySelector('[data-act="payslip"][data-id="s1"]').click();
    await tick();
    const t = dlg().textContent;
    expect(t).toContain('Payslip');
    expect(t).toContain('Test Person A');
    expect(t).toContain('29,600');
    expect(t).toContain('Staff credit');
    expect(t).toContain('5%');
    expect(t).toContain("Fazal Din's Pharma Plus");
    expect(t).not.toMatch(/whatsapp/i);
    dlg().querySelector('[data-print]').click();
    expect(window.print).toHaveBeenCalledTimes(1);
    expect(document.body.classList.contains('printing-payslip')).toBe(true);
    window.dispatchEvent(new Event('afterprint'));
    expect(document.body.classList.contains('printing-payslip')).toBe(false);
  });

  it('the payslip leaves out the credit box for someone who may not see credit', async () => {
    await openSalary(['mgmt.salary']);
    el.querySelector('[data-act="payslip"][data-id="s1"]').click();
    await tick();
    expect(dlg().textContent).not.toContain('Staff credit');
    expect(api.creditMonth).not.toHaveBeenCalled();
  });
});
