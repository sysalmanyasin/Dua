// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { incentiveCalc } from '../../js/modules/manager/domain/incentive.js';
import { rupTimes } from '../../js/modules/manager/domain/salary.js';

const api = { incentiveMonth: vi.fn(), incentiveSave: vi.fn(), sheetClose: vi.fn(), rateSet: vi.fn() };
vi.mock('../../js/modules/manager/data/api.js', () => api);

const cases = JSON.parse(readFileSync('tests/fixtures/manager-incentive-cases.json', 'utf8'));

describe('incentive maths (shared cases, also run against the database)', () => {
  it('has the cases', () => expect(cases.length).toBe(9));
  for (const c of cases) {
    it(c.name, () => expect(incentiveCalc(c.inputs, c.rates)).toEqual(c.expect));
  }
  it('never returns minus zero', () => {
    const r = incentiveCalc({ sale: 0, generic_sale: 0 }, { sale_commission: 0.005, generic_pool: 0.045, owner_share: 0.5 });
    for (const v of Object.values(r)) expect(Object.is(v, 0)).toBe(true);
  });
  it('rupTimes floors negatives like the database (-4.04 gives -4, -50.5 gives -50)', () => {
    expect(rupTimes(-101, 0.04)).toBe(-4);
    expect(rupTimes(-101, 0.5)).toBe(-50);
    expect(rupTimes(-100, 0.045)).toBe(-4);
    expect(rupTimes(100, 0.005)).toBe(1);
    expect(rupTimes(2500, 0.045)).toBe(113);
  });
});

// ───────────────────────── the page ─────────────────────────
const tick = () => new Promise((r) => setTimeout(r, 15));
const type = (el, value) => {
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
};
let el;
const OWNER = ['mgmt.incentive', 'mgmt.close_month', 'mgmt.rates'];
const ZERO = {
  sale: 0,
  generic_sale: 0,
  pilferage: 0,
  till_short: 0,
  cash_target: 0,
  excess_fine: 0,
  plus_fine: 0,
  paper_fine: 0,
  panel_fine: 0,
  tax: 0,
};
const D = (o = {}) => ({
  has_row: false,
  revision: null,
  closed: false,
  ...ZERO,
  rate_sale_commission: 0.005,
  rate_generic_pool: 0.045,
  rate_owner_share: 0.5,
  sale_comm: 0,
  gen_inc: 0,
  total_comm: 0,
  total_gen: 0,
  grand_total: 0,
  pre_panel: 0,
  net_inc: 0,
  owner_net: 0,
  ...o,
});
const dlg = () => [...document.querySelectorAll('dialog')].at(-1);
async function openPage(perms = OWNER) {
  const { mount } = await import('../../js/modules/manager/ui/incentive.js');
  await mount(el, { ctx: { permissions: perms } });
  await tick();
}
function fill(inputs) {
  for (const [k, v] of Object.entries(inputs)) type(el.querySelector(`[data-i="${k}"]`), String(v));
}

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
  api.incentiveMonth.mockResolvedValue(D());
  api.incentiveSave.mockResolvedValue({ data: { changed: 1, unchanged: 0 }, error: null });
  api.sheetClose.mockResolvedValue({ data: { sheet_id: 'x' }, error: null });
  api.rateSet.mockResolvedValue({ data: { id: 'r' }, error: null });
});
afterEach(() => {
  vi.useRealTimers();
  document.querySelectorAll('dialog').forEach((d) => d.remove());
});

describe('Incentive page', () => {
  it('shows the month and the three rates, and the next button stops at the current month', async () => {
    await openPage();
    expect(api.incentiveMonth).toHaveBeenCalledWith('2026-11-01');
    expect(el.textContent).toContain('November 2026');
    for (const t of ['0.5%', '4.5%', '50%']) expect(el.textContent).toContain(t);
    expect(el.querySelector('[data-act="next"]').disabled).toBe(true);
  });

  it('previews the whole statement as you type and matches the hand-worked month (owner 6,863)', async () => {
    await openPage();
    fill({
      sale: '1,000,000',
      generic_sale: 200000,
      pilferage: 500,
      till_short: 200,
      cash_target: 3000,
      excess_fine: 100,
      plus_fine: 50,
      paper_fine: 25,
      panel_fine: 1000,
      tax: 700,
    });
    const out = (k) => el.querySelector(`[data-out="${k}"]`).textContent;
    expect(out('sale_comm')).toContain('5,000');
    expect(out('gen_inc')).toContain('9,000');
    expect(out('grand_total')).toContain('16,200');
    expect(out('net_inc')).toContain('15,125');
    expect(out('owner_net')).toContain('6,863');
  });

  it('every typed figure is rounded to a whole rupee first, and a half of an odd net rounds up', async () => {
    await openPage();
    fill({ sale: 12345.5, generic_sale: 999.5, tax: 0.5, pilferage: 10.4 });
    expect(el.querySelector('[data-out="owner_net"]').textContent).toContain('48');
  });

  it('saves the typed figures as numbers with a key; a retry reuses it; an edit after a failure gets a new one', async () => {
    await openPage();
    fill({ sale: 100000, tax: 50 });
    api.incentiveSave.mockResolvedValueOnce({ data: null, error: { message: 'network down' } });
    el.querySelector('[data-act="save"]').click();
    await tick();
    el.querySelector('[data-act="save"]').click();
    await tick();
    const [a, b] = api.incentiveSave.mock.calls;
    expect(a[0]).toBe('2026-11-01');
    expect(a[1]).toEqual({ ...ZERO, sale: 100000, tax: 50 });
    expect(a[3]).toBe(b[3]);

    api.incentiveSave.mockResolvedValueOnce({ data: null, error: { message: 'nope' } });
    fill({ sale: 100000, tax: 60 });
    el.querySelector('[data-act="save"]').click();
    await tick();
    fill({ sale: 100000, tax: 70 });
    el.querySelector('[data-act="save"]').click();
    await tick();
    const k = api.incentiveSave.mock.calls.slice(2).map((c) => c[3]);
    expect(k[0]).not.toBe(k[1]);
  });

  it('refuses a junk number before sending anything', async () => {
    await openPage();
    fill({ sale: '12abc' });
    el.querySelector('[data-act="save"]').click();
    await tick();
    expect(api.incentiveSave).not.toHaveBeenCalled();
    expect(document.getElementById('toasts').textContent).toContain('Check the numbers');
  });

  it('a closed month asks for a reason before a revision, and sends nothing if cancelled', async () => {
    api.incentiveMonth.mockResolvedValue(D({ has_row: true, closed: true, sale: 1000 }));
    await openPage();
    expect(el.textContent).toContain('This month is closed');
    expect(el.querySelector('[data-act="close"]')).toBeNull();
    fill({ sale: 2000 });
    el.querySelector('[data-act="save"]').click();
    await tick();
    dlg().querySelector('[data-close]').click();
    await tick();
    expect(api.incentiveSave).not.toHaveBeenCalled();
    el.querySelector('[data-act="save"]').click();
    await tick();
    type(dlg().querySelector('#reason'), 'corrected after the audit');
    dlg().querySelector('[data-ok]').click();
    await tick();
    expect(api.incentiveSave.mock.calls[0][2]).toBe('corrected after the audit');
  });

  it('Close month needs the close key, a saved month and no unsaved edits', async () => {
    api.incentiveMonth.mockResolvedValue(D({ has_row: true, sale: 1000 }));
    await openPage(['mgmt.incentive']);
    expect(el.querySelector('[data-act="close"]')).toBeNull();
    document.body.innerHTML = '<div id="page"></div>';
    el = document.getElementById('page');
    await openPage();
    fill({ sale: 1200 });
    el.querySelector('[data-act="close"]').click();
    await tick();
    expect(api.sheetClose).not.toHaveBeenCalled();
    expect(document.getElementById('toasts').textContent).toContain('Save your changes first');
    expect(document.querySelectorAll('dialog')).toHaveLength(0); // no confirmation was even offered
    fill({ sale: 1000 });
    el.querySelector('[data-act="close"]').click();
    await tick();
    dlg().querySelector('[data-ok]').click();
    await tick();
    expect(api.sheetClose).toHaveBeenCalledWith('2026-11-01', 'incentive', expect.any(String));
  });

  it('a rate is changed only with the rates key, a valid percentage and a reason', async () => {
    await openPage(['mgmt.incentive']);
    expect(el.querySelector('[data-act="rate"]')).toBeNull();
    document.body.innerHTML = '<div id="page"></div>';
    el = document.getElementById('page');
    await openPage();
    el.querySelector('[data-act="rate"][data-rate="owner_share"]').click();
    await tick();
    type(dlg().querySelector('#r-pct'), '40');
    dlg().querySelector('[data-ok]').click();
    await tick();
    expect(api.rateSet).not.toHaveBeenCalled();
    type(dlg().querySelector('#r-reason'), 'owner decision');
    dlg().querySelector('[data-ok]').click();
    await tick();
    expect(api.rateSet).toHaveBeenCalledWith('owner_share', 0.4, 'owner decision', expect.any(String));
  });

  it('prints a statement with the business name and the owner’s net', async () => {
    await openPage();
    fill({
      sale: 1000000,
      generic_sale: 200000,
      pilferage: 500,
      till_short: 200,
      cash_target: 3000,
      excess_fine: 100,
      plus_fine: 50,
      paper_fine: 25,
      panel_fine: 1000,
      tax: 700,
    });
    el.querySelector('[data-act="print"]').click();
    await tick();
    const t = dlg().textContent;
    expect(t).toContain('Incentive statement');
    expect(t).toContain("Fazal Din's Pharma Plus");
    expect(t).toContain('6,863');
    expect(t).toContain('not saved yet');
    dlg().querySelector('[data-print]').click();
    expect(window.print).toHaveBeenCalledTimes(1);
    expect(document.body.classList.contains('printing-payslip')).toBe(true);
    window.dispatchEvent(new Event('afterprint'));
    expect(document.body.classList.contains('printing-payslip')).toBe(false);
  });

  it('going to another month with unsaved edits asks first', async () => {
    await openPage();
    fill({ sale: 500 });
    el.querySelector('[data-act="prev"]').click();
    await tick();
    expect(dlg().textContent).toContain('Leave without saving');
    dlg().querySelector('[data-close]').click();
    await tick();
    expect(api.incentiveMonth).toHaveBeenCalledTimes(1);
  });

  it('shows a plain error card when it cannot load', async () => {
    api.incentiveMonth.mockRejectedValueOnce(new Error('offline'));
    await openPage();
    expect(el.textContent).toContain('Could not load the incentive sheet');
  });
});
