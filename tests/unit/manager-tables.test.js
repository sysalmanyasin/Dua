// @vitest-environment jsdom
// Salary and Generic Sheet are numbered tables with gridlines and a totals row (like the old app).
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = {
  salaryMonth: vi.fn(),
  salaryColumns: vi.fn(),
  salarySave: vi.fn(),
  genericMonth: vi.fn(),
  ratesList: vi.fn(),
  genericSave: vi.fn(),
  creditMonth: vi.fn(),
  sheetClose: vi.fn(),
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
  staff_code: 'EMP-001',
  designation: 'Manager',
  sort_order: 1,
  active: true,
  has_row: true,
  closed: false,
  ho_salary: 30000,
  ho_carried: false,
  days: 31,
  extras: {},
  advance: 1500,
  generic: 1100,
  entries: [],
  credit_deduction: 1500,
  advance_live: 1500,
  generic_live: 1100,
  ...o,
});
const generic = (o = {}) => ({
  staff_id: 's1',
  full_name: 'Test Person A',
  staff_code: 'EMP-001',
  designation: 'Manager',
  active: true,
  has_row: true,
  closed: false,
  generic_sale: 0,
  extra: 0,
  rate: 0.04,
  ...o,
});
let el;
const heads = () => [...el.querySelectorAll('.mg-grid thead th')].map((h) => h.textContent.trim());
const cells = (row) => [...row.querySelectorAll('td')].map((c) => c.textContent.trim());

beforeEach(() => {
  document.body.innerHTML = '<div id="page"></div><div id="toasts"></div>';
  el = document.getElementById('page');
  Object.values(api).forEach((f) => f.mockReset());
  api.salaryMonth.mockResolvedValue([
    person(),
    person({
      staff_id: 's2',
      full_name: 'Test Person B',
      staff_code: 'EMP-002',
      designation: null,
      ho_salary: 20000,
      advance: 0,
      generic: 0,
    }),
  ]);
  api.salaryColumns.mockResolvedValue([]);
  api.genericMonth.mockResolvedValue([
    generic(),
    generic({ staff_id: 's2', full_name: 'Test Person B', staff_code: 'EMP-002', designation: null }),
  ]);
  api.ratesList.mockResolvedValue([{ rate_key: 'generic_staff', rate: 0.04 }]);
});

describe('Salary table', () => {
  const open = async (perms = ['mgmt.salary']) => {
    const { mount } = await import('../../js/modules/manager/ui/salary.js');
    await mount(el, { ctx: { permissions: perms } });
    await tick();
  };

  it('has the old app’s columns, numbered rows and a totals row', async () => {
    await open();
    expect(heads()).toEqual(['#', 'Name', 'Designation', 'Days', 'HO salary', 'Advance (−)', 'Generic (+)', 'Net salary', 'Slip']);
    const rows = [...el.querySelectorAll('.mg-grid tbody tr[data-row]')];
    expect(rows.map((r) => cells(r)[0])).toEqual(['1', '2']);
    expect(cells(rows[0])[1]).toContain('EMP-001');
    expect(cells(rows[0])[1]).toContain('Test Person A');
    expect(cells(rows[0])[2]).toBe('Manager');
    const foot = cells(el.querySelector('.mg-grid tfoot tr'));
    expect(foot[1]).toBe('TOTALS');
    expect(foot).toContain('50,000'); // HO salary total
    expect(foot).toContain('1,500'); // advance total
    expect(foot).toContain('1,100'); // generic total
    expect(foot.at(-2)).toBe('49,600'); // net total: 50000 - 1500 + 1100
  });

  it('adds a column per extra, and the totals follow what is typed', async () => {
    api.salaryColumns.mockResolvedValue([{ column_id: 'c1', name: 'Bonus', sign: 1 }]);
    api.salaryMonth.mockResolvedValue([
      person({ extras: { c1: 0 } }),
      person({ staff_id: 's2', full_name: 'Test Person B', extras: { c1: 0 } }),
    ]);
    await open();
    expect(heads()).toContain('Bonus (+)');
    type(el.querySelector('[data-x="c1"][data-id="s1"]'), '500');
    type(el.querySelector('[data-x="c1"][data-id="s2"]'), '250');
    expect(el.querySelector('[data-tot="x:c1"]').textContent).toBe('750');
    type(el.querySelector('[data-s="ho"][data-id="s1"]'), '31,000');
    expect(el.querySelector('[data-tot="ho"]').textContent).toBe('61,000'); // 31,000 typed + 30,000
  });

  it('is wrapped so a phone scrolls the table sideways instead of squeezing it', async () => {
    await open();
    expect(el.querySelector('.mg-grid-wrap > table.mg-grid')).not.toBeNull();
    expect(el.querySelector('.mg-grid td.name')).not.toBeNull(); // the sticky name column
  });

  it('shows the credit entries and warnings in a note row under the person', async () => {
    api.salaryMonth.mockResolvedValue([
      person({ entries: [{ entry_date: '2026-11-03', description: 'advance', amount: 1500 }], credit_deduction: 900 }),
    ]);
    await open();
    expect(el.querySelector('.mg-note')).not.toBeNull(); // the warning (credit deducts 900, advance is 1,500)
    expect(el.textContent).toContain('Staff Credit deducts 900');
    el.querySelector('[data-act="detail"]').click();
    expect(el.querySelector('.mg-note').textContent).toContain('advance');
  });

  it('says so when nobody is listed', async () => {
    api.salaryMonth.mockResolvedValue([]);
    await open();
    expect(el.querySelector('.mg-grid')).toBeNull();
    expect(el.textContent).toContain('Nobody to show.');
  });
});

describe('Generic Sheet table', () => {
  const open = async () => {
    const { mount } = await import('../../js/modules/manager/ui/generic.js');
    await mount(el, { ctx: { permissions: ['mgmt.salary'] } });
    await tick();
  };

  it('has numbered rows, the old app’s columns and a totals row', async () => {
    await open();
    expect(heads()).toEqual(['#', 'Name', 'Designation', 'Generic sale', 'Incentive (4%)', 'Extra', 'Final']);
    const rows = [...el.querySelectorAll('.mg-grid tbody tr')];
    expect(rows.map((r) => cells(r)[0])).toEqual(['1', '2']);
    expect(cells(el.querySelector('.mg-grid tfoot tr'))[1]).toBe('TOTALS');
  });

  it('keeps every total and the incentive in step with what is typed', async () => {
    await open();
    type(el.querySelector('[data-g="sale"][data-id="s1"]'), '2,500');
    type(el.querySelector('[data-g="sale"][data-id="s2"]'), '1,000');
    type(el.querySelector('[data-g="extra"][data-id="s1"]'), '-30');
    expect(el.querySelector('[data-tot="sale"]').textContent).toBe('3,500');
    expect(el.querySelector('[data-tot="inc"]').textContent).toBe('140'); // 100 + 40
    expect(el.querySelector('[data-tot="extra"]').textContent).toBe('−30');
    expect(el.querySelector('[data-total]').textContent).toBe('110'); // (100 - 30) + 40
  });
});
