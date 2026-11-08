// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const METHODS = [
  ['cash_sale', 'Cash Sale', 'Cash', 'add'],
  ['cash_returns', 'Cash Returns', 'Cash', 'sub'],
  ['bank_alfalah', 'Bank Alfalah', 'Banks', 'add'],
  ['meezan_bank', 'Meezan Bank', 'Banks', 'add'],
  ['bank_al_habib', 'Bank Al Habib', 'Banks', 'add'],
  ['askari_bank', 'Askari', 'Credit Clients', 'add'],
  ['pso', 'PSO', 'Credit Clients', 'add'],
  ['c_bank_alfalah_2', 'Bank Alfalah 2', 'Banks', 'add'],
  ['c_state_life', 'State Life Insurance', 'Credit Clients', 'add'],
].map(([code, label, section, sign]) => ({ code, label, section, sign, sort: 1, show_in_entry: true }));
const LINES = [
  ['cash_sale', 352788],
  ['bank_alfalah', 108539],
  ['cash_returns', -30197],
  ['c_bank_alfalah_2', 158403],
  ['askari_bank', 14212],
  ['c_state_life', 11013],
].map(([method_code, amount]) => ({ method_code, amount }));
const DAY = { business_date: '2026-11-04', total: 614758, comp_sale: 589781, fdpp_pos: 477, fdpp_consumer: 162, customers: 639 };

vi.mock('../../js/shared/mailDialog.js', () => ({ openMailDialog: (...a) => globalThis.__mail(...a) }));
const api = {
  listMethods: vi.fn(async () => METHODS),
  latestDay: vi.fn(async () => ({ business_date: '2026-11-04' })),
  getDay: vi.fn(async (d) => (d === '2026-11-04' ? { day: DAY, lines: LINES } : { day: null, lines: [] })),
  getTarget: vi.fn(async () => 16500000),
  monthTotal: vi.fn(async () => 3171201),
  getPref: vi.fn(async () => null),
  setPref: vi.fn(async () => ({ error: null })),
  setTarget: vi.fn(async () => ({ error: null })),
};
vi.mock('../../js/modules/sales/data/api.js', () => api);

const tick = () => new Promise((r) => setTimeout(r, 15));
let el;
const q = (s) => el.querySelector(s);
// Each report row as "label value", so assertions read like the printed report.
const txt = () =>
  [...el.querySelectorAll('#sr-card .sr > div')]
    .map((d) => (d.children.length ? [...d.children].map((c) => c.textContent.trim()).join(' ') : d.textContent.trim()))
    .join(' | ');
const type = (n, v) => {
  n.value = v;
  n.dispatchEvent(new Event('input', { bubbles: true }));
};

async function open(perms = ['sales.view_history']) {
  const { mount } = await import('../../js/modules/sales/ui/saleReport.js');
  await mount(el, { ctx: { permissions: perms } });
  await tick();
}
beforeEach(() => {
  // jsdom has no <dialog> support; this is all the page needs from it.
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
  document.body.innerHTML = '<div id="page"></div>';
  el = document.getElementById('page');
  Object.values(api).forEach((f) => f.mockClear());
  api.getPref.mockImplementation(async () => null);
});

describe('Sale Report page', () => {
  it('Send via Gmail opens the mail dialog with the day report in HTML and text', async () => {
    globalThis.__mail = vi.fn();
    await open();
    q('[data-act="gmail"]').click();
    await tick();
    const a = globalThis.__mail.mock.calls[0][0];
    expect(a.subject).toBe('Bahria Town Sale Report — 04/Nov/2026');
    expect(a.html).toContain('₨614,758');
    expect(a.text).toContain('Grand Total: ₨614,758');
  });

  it('opens the latest day and shows the same figures as the original report', async () => {
    await open();
    expect(q('#sr-date').value).toBe('2026-11-04');
    const t = txt();
    expect(t).toContain('BAHRIA TOWN SALE REPORT');
    expect(t).toContain('04/Nov/2026');
    expect(t).toContain('Net Cash Sale: 589,533');
    expect(t).toContain('Net Credit Sale: 25,225');
    expect(t).toContain('Grand Total: ₨614,758');
    expect(t).toContain('Difference (Total − COMP) 24,977');
    expect(t).toContain('Bank Alfalah 2 158,403');
    expect(t).toContain('Cash Returns (Returns Only) -30,197');
    expect(t).toContain('Customers 639');
  });

  it('shows the monthly target card with percent and remaining', async () => {
    await open();
    const card = el.textContent.replace(/\s+/g, ' ');
    expect(card).toContain('Target: ₨16,500,000');
    expect(card).toContain('19% achieved');
    expect(card).toContain('Remaining: ₨13,328,799');
    expect(q('.kpfill').style.width).toBe('19%');
  });

  it('typing Till Short and Patty Cash updates the report without losing focus', async () => {
    await open();
    const till = q('#sr-till');
    till.focus();
    type(till, '1,500');
    type(q('#sr-patty'), '250');
    expect(txt()).toContain('Till Short 1,500');
    expect(txt()).toContain('Patty Cash 250');
    expect(q('#sr-till')).toBe(till); // same element, still typing
  });

  it('says so when a date has no record', async () => {
    await open();
    q('#sr-date').value = '2026-11-03';
    q('#sr-date').dispatchEvent(new Event('change', { bubbles: true }));
    await tick();
    expect(q('#sr-card').textContent).toContain('Record not found');
    expect(q('[data-act="print"]').disabled).toBe(true);
  });

  it('Customize Rows hides a row from the report, keeps the totals, and saves the choice for the person', async () => {
    await open();
    q('[data-act="rows"]').click();
    const dlg = document.querySelector('dialog');
    const box = dlg.querySelector('input[data-row="cashSale"]');
    box.checked = false;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    await tick();
    expect(txt()).not.toContain('Cash Sale (Sales Only)');
    expect(txt()).toContain('Net Cash Sale: 589,533');
    expect(api.setPref).toHaveBeenCalledWith('sale_report.hidden', ['cashSale']);
    expect(dlg.querySelector('input[data-row="c_state_life"]')).not.toBeNull(); // your own fields are listed too
  });

  it('remembers hidden rows saved earlier', async () => {
    api.getPref.mockImplementation(async () => ['customers', 'fdpp']);
    await open();
    expect(txt()).not.toContain('Customers');
    expect(txt()).not.toContain('FDPP POS Sale');
  });

  it('copy writes formatted and plain text', async () => {
    const write = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { write, writeText: vi.fn() }, configurable: true });
    globalThis.ClipboardItem = class {
      constructor(items) {
        this.items = items;
      }
    };
    await open();
    q('[data-act="copy"]').click();
    await tick();
    expect(Object.keys(write.mock.calls[0][0][0].items).sort()).toEqual(['text/html', 'text/plain']);
    expect(q('[data-act="gmail"]').disabled).toBe(false);
  });

  it('only people who manage targets can set one', async () => {
    await open();
    expect(q('[data-act="target"]')).toBeNull();
    el.replaceChildren();
    await open(['sales.view_history', 'targets.manage']);
    q('[data-act="target"]').click();
    const dlg = document.querySelector('dialog');
    dlg.querySelector('#tg-input').value = '17000000';
    dlg.querySelector('[data-tg-save]').click();
    await tick();
    expect(api.setTarget).toHaveBeenCalledWith('2026-11-04', 17000000);
  });
});
