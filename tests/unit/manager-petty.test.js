// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  groupTotal,
  isBlankLine,
  lineAmount,
  monthTotal,
  newGroup,
  toPayload,
  validateGroups,
} from '../../js/modules/manager/domain/petty.js';

const api = { pettyMonth: vi.fn(), pettySave: vi.fn(), pettyCopy: vi.fn(), sheetClose: vi.fn() };
vi.mock('../../js/modules/manager/data/api.js', () => api);

const g = (title, lines, extra = {}) => ({
  group_key: 'k-' + title,
  title,
  lines: lines.map(([description, amount]) => ({ description, amount: String(amount) })),
  ...extra,
});

describe('petty domain', () => {
  it('rounds each line to a whole rupee on its own, then adds', () => {
    expect(lineAmount('450.5')).toBe(451);
    expect(lineAmount('1,200')).toBe(1200);
    expect(lineAmount('-0.5')).toBe(0);
    expect(lineAmount('-200')).toBe(-200);
    expect(lineAmount('abc')).toBe(0);
    expect(
      groupTotal(
        g('A', [
          ['tea', '450.5'],
          ['soap', '1200'],
        ]),
      ),
    ).toBe(1651);
    expect(
      groupTotal(
        g('B', [
          ['bought', 1000],
          ['refund', -200],
        ]),
      ),
    ).toBe(800);
    expect(monthTotal([g('A', [['x', 100]]), g('B', [['y', 250]])])).toBe(350);
  });
  it('sends only real lines and drops an untouched new voucher, keeping removals', () => {
    const groups = [
      g('Keep', [
        ['tea', 10],
        ['', ''],
      ]),
      newGroup('new-1'),
      { ...newGroup('new-2'), title: 'Typed', lines: [{ description: 'x', amount: '5' }] },
    ];
    const p = toPayload(groups, ['gone-1']);
    expect(p).toEqual([
      { group_key: 'k-Keep', title: 'Keep', lines: [{ description: 'tea', amount: 10 }] },
      { group_key: 'new-2', title: 'Typed', lines: [{ description: 'x', amount: 5 }] },
      { group_key: 'gone-1', removed: true },
    ]);
    expect(isBlankLine({ description: ' ', amount: '' })).toBe(true);
  });
  it('explains what is wrong in plain words', () => {
    expect(validateGroups([g('', [['x', 1]])])).toMatch(/title/);
    expect(validateGroups([g('A', [['', '']])])).toMatch(/at least one line/);
    expect(validateGroups([g('A', [['', '5']])])).toMatch(/description/);
    expect(validateGroups([g('A', [['x', 'abc']])])).toMatch(/check the amount/);
    expect(validateGroups([g('A', [['x', '0.4']])])).toMatch(/cannot be zero/);
    expect(validateGroups([g('A', [['x', '5']])])).toBeNull();
    expect(validateGroups([newGroup('n')])).toBeNull(); // an untouched blank voucher is simply ignored
  });
});

// ───────────────────────── the page ─────────────────────────
const tick = () => new Promise((r) => setTimeout(r, 15));
const type = (el, value) => {
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
};
let el;
const OWNER = ['mgmt.petty_cash', 'mgmt.close_month'];
const row = (title, lines, extra = {}) => ({
  group_key: 'k-' + title,
  title,
  lines: lines.map(([description, amount]) => ({ description, amount })),
  total: lines.reduce((s, [, a]) => s + a, 0),
  revision: 0,
  closed: false,
  ...extra,
});
const dlg = () => [...document.querySelectorAll('dialog')].at(-1);
async function openPage(perms = OWNER) {
  const { mount } = await import('../../js/modules/manager/ui/petty.js');
  await mount(el, { ctx: { permissions: perms } });
  await tick();
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
  api.pettyMonth.mockResolvedValue([
    row('First ten days', [
      ['Tea', 451],
      ['Soap', 1200],
    ]),
    row('Second ten days', [['Fuel', 3000]]),
  ]);
  api.pettySave.mockResolvedValue({ data: { changed: 1, unchanged: 1 }, error: null });
  api.pettyCopy.mockResolvedValue({ data: { groups: 2 }, error: null });
  api.sheetClose.mockResolvedValue({ data: { sheet_id: 'x' }, error: null });
});
afterEach(() => {
  vi.useRealTimers();
  document.querySelectorAll('dialog').forEach((d) => d.remove());
});

describe('Petty Cash page', () => {
  it('shows the vouchers with their totals and the month total; next stops at the current month', async () => {
    await openPage();
    expect(api.pettyMonth).toHaveBeenCalledWith('2026-11-01');
    expect(el.querySelector('[data-gtotal="0"]').textContent).toContain('1,651');
    expect(el.querySelector('[data-gtotal="1"]').textContent).toContain('3,000');
    expect(el.querySelector('[data-mtotal]').textContent).toContain('4,651');
    expect(el.querySelector('[data-act="next"]').disabled).toBe(true);
  });

  it('updates totals as you type, rounds each line, and a refund lowers the total', async () => {
    await openPage();
    type(el.querySelector('[data-a="0:0"]'), '450.5');
    expect(el.querySelector('[data-gtotal="0"]').textContent).toContain('1,651');
    type(el.querySelector('[data-a="0:1"]'), '-200');
    expect(el.querySelector('[data-gtotal="0"]').textContent).toContain('251');
    expect(el.querySelector('[data-mtotal]').textContent).toContain('3,251');
  });

  it('saves with a key; sends removals; drops blank lines and an untouched new voucher; retry keeps the key, an edit changes it', async () => {
    await openPage();
    el.querySelector('[data-act="addline"][data-g="1"]').click();
    el.querySelector('[data-act="addgroup"]').click();
    el.querySelector('[data-act="delgroup"][data-g="0"]').click();
    await tick();
    dlg().querySelector('[data-ok]').click(); // confirm removing an existing voucher
    await tick();
    api.pettySave.mockResolvedValueOnce({ data: null, error: { message: 'network down' } });
    el.querySelector('[data-act="save"]').click();
    await tick();
    el.querySelector('[data-act="save"]').click();
    await tick();
    const [a, b] = api.pettySave.mock.calls;
    expect(a[0]).toBe('2026-11-01');
    expect(a[1]).toEqual([
      { group_key: 'k-Second ten days', title: 'Second ten days', lines: [{ description: 'Fuel', amount: 3000 }] },
      { group_key: 'k-First ten days', removed: true },
    ]);
    expect(a[3]).toBe(b[3]);

    api.pettySave.mockResolvedValueOnce({ data: null, error: { message: 'nope' } });
    el.querySelector('[data-act="save"]').click();
    await tick();
    type(el.querySelector('[data-t="0"]'), 'Second ten days (edited)');
    el.querySelector('[data-act="save"]').click();
    await tick();
    const keys = api.pettySave.mock.calls.slice(2).map((c) => c[3]);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it('removing a voucher that was never saved needs no confirmation and is not sent', async () => {
    await openPage();
    el.querySelector('[data-act="addgroup"]').click();
    el.querySelector('[data-act="delgroup"][data-g="2"]').click();
    await tick();
    expect(document.querySelectorAll('dialog')).toHaveLength(0);
    el.querySelector('[data-act="save"]').click();
    await tick();
    expect(api.pettySave.mock.calls[0][1]).toHaveLength(2);
  });

  it('says what is wrong before sending anything', async () => {
    await openPage();
    type(el.querySelector('[data-a="0:0"]'), 'abc');
    el.querySelector('[data-act="save"]').click();
    await tick();
    expect(api.pettySave).not.toHaveBeenCalled();
    expect(document.getElementById('toasts').textContent).toContain('check the amount for “Tea”');
    type(el.querySelector('[data-a="0:0"]'), '0');
    el.querySelector('[data-act="save"]').click();
    await tick();
    expect(document.getElementById('toasts').textContent).toContain('cannot be zero');
    type(el.querySelector('[data-a="0:0"]'), '5');
    type(el.querySelector('[data-t="0"]'), '');
    el.querySelector('[data-act="save"]').click();
    await tick();
    expect(document.getElementById('toasts').textContent).toContain('Give every voucher a title');
    expect(api.pettySave).not.toHaveBeenCalled();
  });

  it('an empty month offers to copy last month’s vouchers, then reloads', async () => {
    api.pettyMonth.mockResolvedValueOnce([]);
    await openPage();
    expect(el.textContent).toContain('No vouchers this month');
    el.querySelector('[data-act="copy"]').click();
    await tick();
    expect(api.pettyCopy).toHaveBeenCalledWith('2026-10-01', '2026-11-01', expect.any(String));
    expect(api.pettyMonth).toHaveBeenCalledTimes(2);
    expect(document.getElementById('toasts').textContent).toContain('Copied 2 vouchers');
  });

  it('shows the database refusal when copying fails', async () => {
    api.pettyMonth.mockResolvedValueOnce([]);
    api.pettyCopy.mockResolvedValueOnce({ data: null, error: { message: 'there is nothing to copy from that month' } });
    await openPage();
    el.querySelector('[data-act="copy"]').click();
    await tick();
    expect(document.getElementById('toasts').textContent).toContain('nothing to copy');
  });

  it('a closed month asks for a reason before a revision, and sends nothing if cancelled', async () => {
    api.pettyMonth.mockResolvedValue([row('First ten days', [['Tea', 451]], { closed: true })]);
    await openPage();
    expect(el.textContent).toContain('This month is closed');
    expect(el.querySelector('[data-act="close"]')).toBeNull();
    type(el.querySelector('[data-a="0:0"]'), '500');
    el.querySelector('[data-act="save"]').click();
    await tick();
    dlg().querySelector('[data-close]').click();
    await tick();
    expect(api.pettySave).not.toHaveBeenCalled();
    el.querySelector('[data-act="save"]').click();
    await tick();
    type(dlg().querySelector('#reason'), 'price corrected');
    dlg().querySelector('[data-ok]').click();
    await tick();
    expect(api.pettySave.mock.calls[0][2]).toBe('price corrected');
  });

  it('Close month needs the close key and a saved month (no unsaved edits)', async () => {
    await openPage(['mgmt.petty_cash']);
    expect(el.querySelector('[data-act="close"]')).toBeNull();
    document.body.innerHTML = '<div id="page"></div>';
    el = document.getElementById('page');
    await openPage();
    expect(el.querySelector('[data-act="close"]')).not.toBeNull();
    type(el.querySelector('[data-a="0:0"]'), '999');
    el.querySelector('[data-act="addline"][data-g="0"]').click(); // repaint: the close button hides while there are unsaved edits
    expect(el.querySelector('[data-act="close"]')).toBeNull();
    document.body.innerHTML = '<div id="page"></div>';
    el = document.getElementById('page');
    await openPage();
    el.querySelector('[data-act="close"]').click();
    await tick();
    dlg().querySelector('[data-ok]').click();
    await tick();
    expect(api.sheetClose).toHaveBeenCalledWith('2026-11-01', 'petty', expect.any(String));
  });

  it('prints a voucher with the business name, its lines and its total', async () => {
    await openPage();
    el.querySelector('[data-act="print"][data-g="0"]').click();
    await tick();
    const t = dlg().textContent;
    expect(t).toContain("Fazal Din's Pharma Plus");
    expect(t).toContain('First ten days');
    expect(t).toContain('Soap');
    expect(t).toContain('1,651');
    dlg().querySelector('[data-print]').click();
    expect(window.print).toHaveBeenCalledTimes(1);
    expect(document.body.classList.contains('printing-payslip')).toBe(true);
    window.dispatchEvent(new Event('afterprint'));
    expect(document.body.classList.contains('printing-payslip')).toBe(false);
  });

  it('going to another month with unsaved edits asks first', async () => {
    await openPage();
    type(el.querySelector('[data-a="0:0"]'), '7');
    el.querySelector('[data-act="prev"]').click();
    await tick();
    expect(dlg().textContent).toContain('Leave without saving');
    dlg().querySelector('[data-close]').click();
    await tick();
    expect(api.pettyMonth).toHaveBeenCalledTimes(1);
  });

  it('shows a plain error card when it cannot load', async () => {
    api.pettyMonth.mockRejectedValueOnce(new Error('offline'));
    await openPage();
    expect(el.textContent).toContain('Could not load petty cash');
  });
});
