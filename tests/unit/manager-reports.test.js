// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { creditDetail, creditSummary, genericReport, reportsFor, salaryReport } from '../../js/modules/manager/domain/reports.js';

const api = { creditMonth: vi.fn(), salaryMonth: vi.fn(), salaryColumns: vi.fn(), genericMonth: vi.fn() };
vi.mock('../../js/modules/manager/data/api.js', () => api);

// ── invented figures ──
const credit = [
  {
    staff_id: 's1',
    full_name: 'Test Person A',
    staff_code: 'EMP-001',
    prev_balance: 5000,
    entries_total: 0.1,
    salary_deduction: 1000,
    generic_deduction: 0,
    net: 4000.1,
    entries: [{ entry_date: '2026-11-03', description: 'Advance', amount: 0.1, reverses_id: null, reversed_by: null, reason: null }],
  },
  {
    staff_id: 's2',
    full_name: 'Test Person B',
    staff_code: 'EMP-002',
    prev_balance: 0,
    entries_total: 0.2,
    salary_deduction: 0,
    generic_deduction: 0,
    net: 0.2,
    entries: [{ entry_date: '2026-11-04', description: 'Mistake', amount: 0.2, reverses_id: null, reversed_by: 'x', reason: null }],
  },
];
const cols = [
  { column_id: 'c1', name: 'Bonus', sign: 1 },
  { column_id: 'c2', name: 'Fine', sign: -1 },
];
const salary = [
  {
    staff_id: 's1',
    full_name: 'Test Person A',
    staff_code: 'EMP-001',
    designation: 'Salesman',
    ho_salary: 30000,
    advance: 1000,
    generic: 500,
    extras: { c1: 200, c2: 100 },
    net: 29600,
  },
  {
    staff_id: 's2',
    full_name: 'Test Person B',
    staff_code: 'EMP-002',
    designation: null,
    ho_salary: 25000,
    advance: 0,
    generic: 0,
    extras: {},
    net: 25000,
  },
];
const generic = [
  {
    staff_id: 's1',
    full_name: 'Test Person A',
    staff_code: 'EMP-001',
    generic_sale: 10000,
    rate: 0.045,
    incentive: 450,
    extra: 50,
    final: 500,
  },
  {
    staff_id: 's2',
    full_name: 'Test Person B',
    staff_code: 'EMP-002',
    generic_sale: 2000,
    rate: 0.045,
    incentive: 90,
    extra: 0,
    final: 90,
  },
];

describe('which reports a person may open', () => {
  it('follows the keys', () => {
    expect(reportsFor(['credit.view']).map((r) => r.id)).toEqual(['credit-summary', 'credit-detail']);
    expect(reportsFor(new Set(['mgmt.salary_view'])).map((r) => r.id)).toEqual(['salary', 'generic']);
    expect(reportsFor(['mgmt.ledgers'])).toEqual([]);
    expect(reportsFor(['credit.view', 'mgmt.salary']).length).toBe(4);
  });
});

describe('credit reports', () => {
  it('summary adds in whole paisa, so 0.1 + 0.2 is exactly 0.3', () => {
    const s = creditSummary(credit);
    expect(s.rows).toHaveLength(2);
    expect(s.totals.entries).toBe(0.3);
    expect(s.totals.prev).toBe(5000);
    expect(s.totals.net).toBe(4000.3);
  });
  it('leaving someone off removes them from the rows and the totals', () => {
    const s = creditSummary(credit, new Set(['s2']));
    expect(s.rows.map((r) => r.name)).toEqual(['Test Person A']);
    expect(s.totals.net).toBe(4000.1);
  });
  it('detailed keeps every entry, marking reversed and reversal lines', () => {
    const d = creditDetail(credit);
    expect(d.rows[1].entries[0].reversed).toBe(true);
    expect(d.rows[0].entries[0]).toMatchObject({ date: '2026-11-03', note: 'Advance', amount: 0.1, reversal: false, reversed: false });
    expect(creditDetail(credit, new Set(['s1'])).rows).toHaveLength(1);
  });
});

describe('salary and generic reports', () => {
  it('lays out the extra columns in order and totals each one', () => {
    const r = salaryReport(salary, cols);
    expect(r.columns.map((c) => c.name)).toEqual(['Bonus', 'Fine']);
    expect(r.rows[0].extras).toEqual([200, 100]);
    expect(r.rows[1].extras).toEqual([0, 0]);
    expect(r.totals).toMatchObject({ ho: 55000, advance: 1000, generic: 500, extras: [200, 100], net: 54600 });
  });
  it('uses the database net as it is, never its own sum', () => {
    const odd = [{ ...salary[0], net: 123 }];
    expect(salaryReport(odd, cols).rows[0].net).toBe(123);
  });
  it('generic totals sale, incentive, extra and final', () => {
    const g = genericReport(generic);
    expect(g.totals).toEqual({ sale: 12000, incentive: 540, extra: 50, final: 590 });
    expect(genericReport(generic, new Set(['s1'])).totals.final).toBe(90);
  });
});

// ── page ──
const tick = () => new Promise((r) => setTimeout(r, 15));
let el;
const dlg = () => document.querySelector('dialog');
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
  api.creditMonth.mockResolvedValue(credit);
  api.salaryMonth.mockResolvedValue(salary);
  api.salaryColumns.mockResolvedValue(cols);
  api.genericMonth.mockResolvedValue(generic);
});
afterEach(() => {
  vi.useRealTimers();
  document.querySelectorAll('dialog').forEach((d) => d.remove());
});

const open = async (perms) => {
  const { mount } = await import('../../js/modules/manager/ui/reports.js');
  await mount(el, { ctx: { permissions: perms } });
};

describe('Reports page', () => {
  it('lists only the reports the person may open', async () => {
    await open(['credit.view']);
    expect([...el.querySelectorAll('h2')].map((h) => h.textContent)).toEqual(['Credit summary', 'Credit detailed']);
  });
  it('says so when nothing is open to the person', async () => {
    await open(['mgmt.ledgers']);
    expect(el.textContent).toContain('No reports are open to you');
  });
  it('opens a report for the month on screen, with totals', async () => {
    await open(['mgmt.salary']);
    el.querySelector('[data-id="salary"]').click();
    await tick();
    expect(api.salaryMonth).toHaveBeenCalledWith('2026-11-01');
    expect(dlg().textContent).toContain('Salary detail · November 2026');
    expect(dlg().textContent).toContain('54,600');
  });
  it('the month buttons move the month and stop at the current one', async () => {
    await open(['credit.view']);
    expect(el.querySelector('[data-act="next"]').disabled).toBe(true);
    el.querySelector('[data-act="prev"]').click();
    expect(el.textContent).toContain('October 2026');
    el.querySelector('[data-id="credit-summary"]').click();
    await tick();
    expect(api.creditMonth).toHaveBeenCalledWith('2026-10-01');
  });
  it('ticking someone off removes them from the page and the totals', async () => {
    await open(['credit.view']);
    el.querySelector('[data-id="credit-summary"]').click();
    await tick();
    const box = dlg().querySelector('[data-hide="s2"]');
    box.checked = true;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    expect(dlg().querySelector('.rpt-table').textContent).not.toContain('Test Person B');
    expect(dlg().textContent).toContain('1 left off');
  });
  it('print marks the page for printing and calls the browser', async () => {
    window.print = vi.fn();
    await open(['credit.view']);
    el.querySelector('[data-id="credit-detail"]').click();
    await tick();
    dlg().querySelector('[data-print]').click();
    expect(document.body.classList.contains('printing-payslip')).toBe(true);
    expect(window.print).toHaveBeenCalled();
    window.dispatchEvent(new Event('afterprint'));
    expect(document.body.classList.contains('printing-payslip')).toBe(false);
  });
  it('a failed load shows a message and opens nothing', async () => {
    api.genericMonth.mockRejectedValue(new Error('x'));
    await open(['mgmt.salary']);
    el.querySelector('[data-id="generic"]').click();
    await tick();
    expect(dlg()).toBeNull();
    expect(document.getElementById('toasts').textContent).toContain('Could not load that report');
  });
});
