// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { bookSections, chronological, historyRows, pageIndexForDate, rangeFor, variance } from '../../js/modules/closing/domain/book.js';
import { getOpen } from '../../js/modules/closing/domain/store.js';

const PAGE = {
  closing_id: 'c1',
  business_date: '2026-11-08',
  kind: 'night',
  seq: 10,
  mode: 'shift',
  revision: 1,
  is_opening: false,
  submitted_at: '2026-11-08T20:30:00Z',
  correction_reason: null,
  staff: 'Ayesha',
  inputs: {
    sys_cash: 10000,
    last_bill_no: 520,
    comp_sale: 0,
    ret_manual_1: 150,
    ret_system: 0,
    book_bill_1: 0,
    credit_adj: 25,
    prev_cash: 2000,
    prev_cc: 0,
    prev_credit: 2000,
    prev_deposits: 0,
    prev_mediq: 0,
    ov_shift_sale: null,
    ov_customers: 300,
  },
  results: {
    shift_sale: 8000,
    customers: 60,
    customers_charge: 60,
    hs_total: 100,
    strips_a: 25,
    total_returns: 150,
    mediq_extra: 0,
    net_sale: 7800,
    cc_curr: 500,
    cc_total: 900,
    till_c: 9000,
    vault_d: 1000,
    debt_e: 3225,
    deposits_f: 2000,
    misc_g: 500,
    grand: 15000,
    liquid: 14000,
    prev_cash: 2000,
    net_cash: 7300,
    shift_variance: -500,
    final_net_sale: 1,
    final_net_cash: 2,
    final_variance: 3,
  },
  hs: [{ label: 'HS A', amount: 100 }],
  strips: [{ label: 'Panadol', price: 25, qty: 2 }],
  cash: [
    { area: 'till', denomination: 1000, qty: 9 },
    { area: 'vault', denomination: 500, qty: 0 },
    { area: 'vault', denomination: 5000, qty: 1 },
  ],
  credit: [{ kind: 'named', label: 'Ali', amount: 1200 }],
  deposits: [{ label: 'Bank', amount: 2000 }],
  mediq: [{ bill_no: 'B1', collected: 300, pharmacy_bill: 250 }],
  misc: [{ label: 'Courier', amount: 500 }],
  audit: null,
};
const EVENING = {
  ...PAGE,
  closing_id: 'c2',
  kind: 'evening',
  seq: 30,
  business_date: '2026-11-08',
  deposits: [],
  mediq: [],
  inputs: { ...PAGE.inputs, ret_manual_1: 0 },
  results: { ...PAGE.results, total_returns: 0, deposits_f: 0 },
};
const rows = (p, id) => bookSections(p).find((s) => s.id === id)?.rows ?? null;
const val = (p, id, label) => rows(p, id)?.find((r) => r.label === label)?.value;

describe('book helpers', () => {
  it('works out the date range and limit for each shortcut', () => {
    expect(rangeFor('last10', '2026-11-14')).toEqual({ from: null, to: null, limit: 10 });
    expect(rangeFor('days3', '2026-11-14')).toEqual({ from: '2026-11-12', to: '2026-11-14', limit: 200 });
    expect(rangeFor('days7', '2026-11-14')).toEqual({ from: '2026-11-08', to: '2026-11-14', limit: 200 });
    expect(rangeFor('month', '2026-11-14')).toEqual({ from: '2026-10-15', to: '2026-11-14', limit: 200 });
  });
  it('reads a book oldest first', () => {
    expect(chronological([{ n: 3 }, { n: 2 }, { n: 1 }]).map((x) => x.n)).toEqual([1, 2, 3]);
    expect(chronological(null)).toEqual([]);
  });
  it('jumps to the page on a date, or the closest earlier one', () => {
    const pages = [{ business_date: '2026-10-01' }, { business_date: '2026-10-05' }, { business_date: '2026-10-09' }];
    expect(pageIndexForDate(pages, '2026-10-05')).toBe(1);
    expect(pageIndexForDate(pages, '2026-10-07')).toBe(1);
    expect(pageIndexForDate(pages, '2026-09-01')).toBe(0);
    expect(pageIndexForDate(pages, '2026-12-01')).toBe(2);
    expect(pageIndexForDate([], '2026-10-05')).toBe(-1);
  });
  it('writes the direction of a variance in words', () => {
    expect(variance(-500)).toBe('500.00 (Less)');
    expect(variance(250)).toBe('250.00 (Plus)');
    expect(variance(0)).toBe('0.00');
    expect(variance(null)).toBe('0.00');
  });
});

describe('book sections', () => {
  it('lays the page out in order and leaves empty sections out', () => {
    expect(bookSections(PAGE).map((s) => s.id)).toEqual([
      'head',
      'typed',
      'carried',
      'overrides',
      'hs',
      'strips',
      'cash',
      'mediq',
      'credit',
      'deposits',
      'misc',
      'results',
    ]);
    expect(bookSections({ ...PAGE, hs: [], strips: [], mediq: [], credit: [], deposits: [], misc: [], cash: [] }).map((s) => s.id)).toEqual(
      ['head', 'typed', 'carried', 'overrides', 'results'],
    );
  });
  it('shows typed figures but hides zero ones (the bill number and system cash always show)', () => {
    expect(val(PAGE, 'typed', 'System cash')).toBe('10,000.00');
    expect(val(PAGE, 'typed', 'Last bill no.')).toBe('520');
    expect(val(PAGE, 'typed', 'Manual return 1')).toBe('150.00');
    expect(val(PAGE, 'typed', 'Comp sale')).toBeUndefined();
    expect(val(PAGE, 'carried', 'Cash')).toBe('2,000.00');
    expect(val(PAGE, 'carried', 'Card (CC)')).toBeUndefined();
  });
  it('shows only overrides that were set', () => {
    expect(val(PAGE, 'overrides', 'Customers')).toBe('300');
    expect(val(PAGE, 'overrides', 'Shift sale')).toBeUndefined();
  });
  it('shows the stored results and the variance in words', () => {
    expect(val(PAGE, 'results', 'Net sale')).toBe('7,800.00');
    expect(val(PAGE, 'results', 'Net cash')).toBe('7,300.00');
    expect(val(PAGE, 'results', 'Shift variance')).toBe('500.00 (Less)');
  });
  it('shows the final figures only on a Final closing', () => {
    expect(val(PAGE, 'results', 'Final net sale')).toBeUndefined();
    expect(val({ ...PAGE, mode: 'final' }, 'results', 'Final net sale')).toBe('1.00');
    expect(val({ ...PAGE, mode: 'final' }, 'results', 'Final variance')).toBe('3.00 (Plus)');
  });
  it('shows list rows as typed, and skips zero-count cash rows', () => {
    expect(val(PAGE, 'hs', 'HS A')).toBe('100.00');
    expect(val(PAGE, 'strips', 'Panadol')).toBe('2 × 25.00');
    expect(rows(PAGE, 'cash').map((r) => `${r.label} ${r.value}`)).toEqual(['Till 1000 × 9', 'Vault 5000 × 1']);
    expect(val(PAGE, 'mediq', 'Bill B1')).toBe('Collected 300.00 · Pharmacy 250.00');
    expect(val(PAGE, 'credit', 'Ali')).toBe('1,200.00');
    expect(val(PAGE, 'deposits', 'Bank')).toBe('2,000.00');
    expect(val(PAGE, 'misc', 'Courier')).toBe('500.00');
  });
  it('names who entered it and why a corrected one was corrected', () => {
    expect(val(PAGE, 'head', 'Entered for')).toBe('Ayesha');
    expect(val(PAGE, 'head', 'Revision')).toBeUndefined();
    const fixed = { ...PAGE, revision: 2, correction_reason: 'Ali paid more' };
    expect(val(fixed, 'head', 'Revision')).toBe('2');
    expect(val(fixed, 'head', 'Corrected because')).toBe('Ali paid more');
  });
  it('reports the inventory audit when there is one', () => {
    const a = { ...PAGE, audit: { verified_at: '2026-11-08T19:00:00Z', data_as_of: null, codes_checked: 31, not_found: ['X1'] } };
    expect(val(a, 'audit', 'Codes not found')).toBe('1');
  });
});

describe('history rows', () => {
  const pages = [EVENING, PAGE];
  it('CC lists only Evening closings', () => {
    const r = historyRows(pages, 'cc');
    expect(r).toHaveLength(1);
    expect(r[0].rows).toEqual([
      { label: 'Card (CC) now', value: '500.00' },
      { label: 'Card (CC) total', value: '900.00' },
    ]);
  });
  it('RBD lists returns, book bills and deposits, and skips a closing with none', () => {
    const r = historyRows(pages, 'rbd');
    expect(r).toHaveLength(1);
    const text = r[0].rows.map((x) => `${x.label}|${x.value}`);
    expect(text).toContain('Manual return 1|150.00');
    expect(text).toContain('Returns total|150.00');
    expect(text).toContain('Bank|2,000.00');
    expect(text).toContain('Deposits total|2,000.00');
    expect(text.some((t) => t.startsWith('Book bill'))).toBe(false);
  });
  it('MEDIQ lists orders and skips a closing with none', () => {
    const r = historyRows(pages, 'mediq');
    expect(r).toHaveLength(1);
    expect(r[0].rows[0]).toEqual({ label: 'Bill B1', value: 'Collected 300.00 · Pharmacy 250.00' });
  });
  it('is empty for no pages or an unknown tab', () => {
    expect(historyRows([], 'cc')).toEqual([]);
    expect(historyRows(pages, 'nope')).toEqual([]);
  });
});

const api = {
  closingBook: vi.fn(),
  reopen: vi.fn(async () => ({ closing_id: 'n1' })),
  listStripsAll: vi.fn(),
  listAccountsAll: vi.fn(),
  listAuditItemsAll: vi.fn(),
  readClosingSettings: vi.fn(),
  readAuditRequired: vi.fn(),
  saveStrip: vi.fn(async () => 'id'),
  saveAccount: vi.fn(async () => 'id'),
  saveAuditItem: vi.fn(async () => 'X'),
  setClosingSetting: vi.fn(async () => null),
  setAuditRequired: vi.fn(async () => null),
  myRecent: vi.fn(async () => []),
};
vi.mock('../../js/modules/closing/data/api.js', () => api);

const OLDER = { ...PAGE, closing_id: 'c0', business_date: '2026-11-07', kind: 'evening', seq: 30 };
const tick = () => vi.advanceTimersByTimeAsync(20);
let el;
beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '<div id="page"></div>';
  el = document.getElementById('page');
  Object.values(api).forEach((f) => f.mockClear?.());
  api.closingBook.mockImplementation(async () => [PAGE, OLDER]);
  api.reopen.mockImplementation(async () => ({ closing_id: 'n1' }));
  api.listStripsAll.mockImplementation(async () => [
    { id: 's1', label: 'Panadol', group_name: 'Pain', price: 25, sort: 1, active: true },
    { id: 's2', label: 'Old strip', group_name: '', price: 5, sort: 2, active: false },
  ]);
  api.listAccountsAll.mockImplementation(async () => [
    { id: 'a1', kind: 'named', tier_no: null, label: 'Hospital', sort: 1, active: true },
    { id: 'a2', kind: 'tier_name', tier_no: 1, label: 'Staff', sort: 1, active: true },
  ]);
  api.listAuditItemsAll.mockImplementation(async () => [{ code: 'PAN-500', name: 'Panadol 500', sort: 1, active: true }]);
  api.readClosingSettings.mockImplementation(async () => ({ till_float: 45000, per_customer_charge: 1 }));
  api.readAuditRequired.mockImplementation(async () => true);
  window.print = vi.fn();
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
  sessionStorage.clear();
  location.hash = '';
});
afterEach(() => vi.useRealTimers());
const toasts = () => document.getElementById('toasts')?.textContent ?? '';
const setVal = (sel, v) => {
  document.querySelector(sel).value = v;
};

describe('Closing Book page', () => {
  const open = async () => {
    const { mount } = await import('../../js/modules/closing/ui/book.js');
    await mount(el);
    await tick();
  };
  it('opens at the newest page and flips back and forward', async () => {
    await open();
    expect(el.querySelector('#bk-count').textContent).toBe('Page 2 of 2');
    expect(el.querySelector('.cls-bk-page h2').textContent).toContain('08 Nov 2026');
    expect(el.querySelector('#bk-newer').disabled).toBe(true);
    el.querySelector('#bk-older').click();
    expect(el.querySelector('#bk-count').textContent).toBe('Page 1 of 2');
    expect(el.querySelector('.cls-bk-page h2').textContent).toContain('07 Nov 2026');
    expect(el.querySelector('#bk-older').disabled).toBe(true);
  });
  it('shows the figures on the page', async () => {
    await open();
    const t = el.querySelector('.cls-bk-page').textContent;
    expect(t).toContain('7,800.00');
    expect(t).toContain('500.00 (Less)');
    expect(t).toContain('Panadol');
  });
  it('jumps to a date', async () => {
    await open();
    setVal('#bk-date', '2026-11-07');
    el.querySelector('#bk-go').click();
    expect(el.querySelector('.cls-bk-page h2').textContent).toContain('07 Nov 2026');
  });
  it('asks for a date if none was picked', async () => {
    await open();
    el.querySelector('#bk-go').click();
    expect(toasts()).toContain('Pick a date first.');
  });
  it('asks the database for the chosen range', async () => {
    await open();
    el.querySelector('[data-range="days7"]').click();
    await tick();
    const arg = api.closingBook.mock.calls.at(-1)[0];
    expect(arg.limit).toBe(200);
    expect(arg.from < arg.to).toBe(true);
    expect(el.querySelector('[data-range="days7"]').getAttribute('aria-pressed')).toBe('true');
  });
  it('prints every page in the range, then tidies up', async () => {
    await open();
    let during;
    window.print = vi.fn(() => {
      during = {
        pages: document.querySelectorAll('#cls-book-print .cls-bk-page').length,
        on: document.body.classList.contains('cls-printing-book'),
      };
    });
    el.querySelector('#bk-print').click();
    expect(during).toEqual({ pages: 2, on: true });
    window.dispatchEvent(new Event('afterprint'));
    expect(document.getElementById('cls-book-print')).toBeNull();
    expect(document.body.classList.contains('cls-printing-book')).toBe(false);
  });
  it('says so when there is nothing in the range, and disables printing', async () => {
    api.closingBook.mockImplementationOnce(async () => []);
    await open();
    expect(el.textContent).toContain('No submitted closings in this range.');
    expect(el.querySelector('#bk-print').disabled).toBe(true);
  });
  it('shows a refusal in plain words', async () => {
    api.closingBook.mockImplementationOnce(async () => {
      throw Object.assign(new Error('x'), { hint: 'not_allowed' });
    });
    await open();
    expect(el.textContent).toContain('Could not load the Closing Book');
    expect(el.textContent).toContain('You are not allowed to do that.');
  });
});

describe('history pages', () => {
  const LOADERS = {
    cc: () => import('../../js/modules/closing/ui/history-cc.js'),
    rbd: () => import('../../js/modules/closing/ui/history-rbd.js'),
    mediq: () => import('../../js/modules/closing/ui/history-mediq.js'),
  };
  it.each([
    ['cc', 'Card (CC) total'],
    ['rbd', 'Bank'],
    ['mediq', 'Bill B1'],
  ])('%s tab shows its rows and marks itself current', async (tab, text) => {
    api.closingBook.mockImplementation(async () => [{ ...PAGE, kind: 'evening' }]);
    const { mount } = await LOADERS[tab]();
    await mount(el);
    await tick();
    expect(el.textContent).toContain(text);
    expect(el.querySelector('[aria-current="page"]').getAttribute('href')).toBe(`#/closing/history/${tab}`);
    expect(el.querySelectorAll('nav a')).toHaveLength(3);
  });
  it('says so when nothing is recorded', async () => {
    api.closingBook.mockImplementation(async () => []);
    const { mount } = await import('../../js/modules/closing/ui/history-cc.js');
    await mount(el);
    await tick();
    expect(el.textContent).toContain('Nothing recorded yet.');
  });
  it('shows a refusal in plain words', async () => {
    api.closingBook.mockImplementationOnce(async () => {
      throw Object.assign(new Error('x'), { hint: 'not_allowed' });
    });
    const { mount } = await import('../../js/modules/closing/ui/history-rbd.js');
    await mount(el);
    await tick();
    expect(el.textContent).toContain('Could not load the history');
  });
});

describe('Review page', () => {
  const open = async (permissions) => {
    const { mount } = await import('../../js/modules/closing/ui/review.js');
    await mount(el, { ctx: { permissions } });
    await tick();
  };
  it('lists closings with their stored figures and the variance in words', async () => {
    await open(['closing.review']);
    const card = el.querySelector('[data-closing="c1"]');
    expect(card.textContent).toContain('Night');
    expect(card.textContent).toContain('7,800.00');
    expect(card.textContent).toContain('500.00 (Less)');
    expect(el.querySelectorAll('section[data-date]')).toHaveLength(2);
  });
  it('offers reopening only to someone who may correct', async () => {
    await open(['closing.review']);
    expect(el.querySelector('[data-act="reopen"]')).toBeNull();
    await open(['closing.review', 'closing.correct']);
    expect(el.querySelectorAll('[data-act="reopen"]')).toHaveLength(2);
  });
  it('needs a reason before it reopens anything', async () => {
    await open(['closing.correct']);
    el.querySelector('[data-id="c1"]').click();
    setVal('#ro-reason', ' a ');
    document.querySelector('#ro-go').click();
    await tick();
    expect(api.reopen).not.toHaveBeenCalled();
    expect(toasts()).toContain('Please write a reason');
  });
  it('reopens, points the ledger at the new draft, and goes there', async () => {
    await open(['closing.correct']);
    el.querySelector('[data-id="c1"]').click();
    setVal('#ro-reason', 'Ali paid 200 more');
    document.querySelector('#ro-go').click();
    await tick();
    expect(api.reopen).toHaveBeenCalledTimes(1);
    const call = api.reopen.mock.calls[0][0];
    expect(call.closingId).toBe('c1');
    expect(call.reason).toBe('Ali paid 200 more');
    expect(typeof call.key).toBe('string');
    expect(getOpen()).toMatchObject({ key: call.key, date: '2026-11-08', kind: 'night', mode: 'shift', opening: false });
    expect(location.hash).toBe('#/closing/ledger');
  });
  it('shows why a reopen was refused and stays put', async () => {
    api.reopen.mockImplementationOnce(async () => {
      throw Object.assign(new Error('x'), { hint: 'revision_open' });
    });
    await open(['closing.correct']);
    el.querySelector('[data-id="c1"]').click();
    setVal('#ro-reason', 'fix');
    document.querySelector('#ro-go').click();
    await tick();
    expect(toasts().length).toBeGreaterThan(10);
    expect(getOpen()).toBeNull();
    expect(location.hash).toBe('');
  });
});

describe('Settings page', () => {
  const open = async () => {
    const { mount } = await import('../../js/modules/closing/ui/settings.js');
    await mount(el);
    await tick();
  };
  it('lists strips (switched-off ones marked), accounts, tiers, audit codes and the numbers', async () => {
    await open();
    expect(el.querySelector('#set-strips').textContent).toContain('Panadol');
    expect(el.querySelector('#set-strips').textContent).toContain('Old strip');
    expect(el.querySelector('#set-strips').textContent).toContain('(off)');
    expect(el.querySelector('#set-accounts').textContent).toContain('Hospital');
    expect(el.querySelector('#set-accounts').textContent).toContain('Tier 1: Staff');
    expect(el.querySelector('#set-items').textContent).toContain('PAN-500');
    expect(el.querySelector('#set-numbers').textContent).toContain('45,000.00');
    expect(el.querySelector('#set-numbers').textContent).toContain('Yes');
  });
  it('says when a setting is not visible to this person', async () => {
    api.readClosingSettings.mockImplementationOnce(async () => null);
    api.readAuditRequired.mockImplementationOnce(async () => null);
    await open();
    expect(el.querySelector('#set-numbers').textContent.match(/Not visible to you/g)).toHaveLength(3);
  });
  it('saves an edited strip with a numeric price, then reloads', async () => {
    await open();
    el.querySelector('[data-strip="s1"]').click();
    setVal('#f-price', '30');
    setVal('#f-label', 'Panadol 500');
    document.querySelector('#f-save').click();
    await tick();
    expect(api.saveStrip).toHaveBeenCalledWith({ id: 's1', label: 'Panadol 500', group_name: 'Pain', price: 30, sort: 1, active: true });
    expect(toasts()).toContain('Saved.');
    expect(api.listStripsAll).toHaveBeenCalledTimes(2);
  });
  it('adds a strip with no id, and can switch one off', async () => {
    await open();
    el.querySelector('#add-strip').click();
    setVal('#f-label', 'New');
    setVal('#f-price', '12.5');
    document.querySelector('#f-active').checked = false;
    document.querySelector('#f-save').click();
    await tick();
    expect(api.saveStrip).toHaveBeenCalledWith({ id: undefined, label: 'New', group_name: '', price: 12.5, sort: 0, active: false });
  });
  it('keeps the form open and explains when the database refuses', async () => {
    api.saveStrip.mockImplementationOnce(async () => {
      throw Object.assign(new Error('x'), { hint: 'invalid_amount' });
    });
    await open();
    el.querySelector('#add-strip').click();
    setVal('#f-label', 'X');
    setVal('#f-price', '-1');
    document.querySelector('#f-save').click();
    await tick();
    expect(document.querySelector('dialog[open]')).not.toBeNull();
    expect(api.listStripsAll).toHaveBeenCalledTimes(1);
    expect(toasts().length).toBeGreaterThan(5);
  });
  it('saves a staff tier name with its tier number', async () => {
    await open();
    el.querySelector('#add-acct').click();
    setVal('#f-kind', 'tier_name');
    setVal('#f-tier', '2');
    setVal('#f-label', 'Family');
    document.querySelector('#f-save').click();
    await tick();
    expect(api.saveAccount).toHaveBeenCalledWith({ id: undefined, kind: 'tier_name', tier_no: 2, label: 'Family', sort: 0, active: true });
  });
  it('saves a named account with no tier', async () => {
    await open();
    el.querySelector('[data-acct="a1"]').click();
    setVal('#f-label', 'Hospital A');
    document.querySelector('#f-save').click();
    await tick();
    expect(api.saveAccount).toHaveBeenCalledWith({ id: 'a1', kind: 'named', tier_no: null, label: 'Hospital A', sort: 1, active: true });
  });
  it('adds an audit code, and cannot change the code of an existing one', async () => {
    await open();
    el.querySelector('[data-item="PAN-500"]').click();
    expect(document.querySelector('#f-code').readOnly).toBe(true);
    document.querySelector('dialog [data-close]').click();
    el.querySelector('#add-item').click();
    setVal('#f-code', ' NEW-1 ');
    setVal('#f-name', 'New item');
    document.querySelector('#f-save').click();
    await tick();
    expect(api.saveAuditItem).toHaveBeenCalledWith({ code: 'NEW-1', name: 'New item', sort: 0, active: true });
  });
  it('changes the till float with a reason', async () => {
    await open();
    el.querySelector('[data-num="till_float"]').click();
    setVal('#f-value', '50000');
    setVal('#f-reason', 'new float');
    document.querySelector('#f-save').click();
    await tick();
    expect(api.setClosingSetting).toHaveBeenCalledWith('till_float', 50000, 'new float');
  });
  it('will not send an empty number', async () => {
    await open();
    el.querySelector('[data-num="per_customer_charge"]').click();
    setVal('#f-value', '');
    setVal('#f-reason', 'x');
    document.querySelector('#f-save').click();
    await tick();
    expect(api.setClosingSetting).not.toHaveBeenCalled();
    expect(toasts()).toContain('Enter a number');
  });
  it('switches the inventory audit off only with a reason', async () => {
    await open();
    el.querySelector('#set-audit').click();
    setVal('#f-reason', 'a');
    document.querySelector('#f-save').click();
    await tick();
    expect(api.setAuditRequired).not.toHaveBeenCalled();
    setVal('#f-reason', 'Audit card not built yet');
    document.querySelector('#f-save').click();
    await tick();
    expect(api.setAuditRequired).toHaveBeenCalledWith(false, 'Audit card not built yet');
  });
  it('shows a refusal in plain words', async () => {
    api.listStripsAll.mockImplementationOnce(async () => {
      throw Object.assign(new Error('x'), { hint: 'not_allowed' });
    });
    await open();
    expect(el.textContent).toContain('Could not load the settings');
  });
});

describe('start page links and routes', () => {
  const start = async (permissions) => {
    const { mount } = await import('../../js/modules/closing/ui/start.js');
    await mount(el, { ctx: { permissions } });
    await tick();
  };
  const has = (h) => el.querySelector(`a[href="${h}"]`) !== null;
  it('shows the books to someone who may see every closing, but not review or settings', async () => {
    await start(['closing.view_all']);
    ['#/closing/book', '#/closing/history/cc', '#/closing/history/rbd', '#/closing/history/mediq'].forEach((h) =>
      expect(has(h)).toBe(true),
    );
    expect(has('#/closing/review')).toBe(false);
    expect(has('#/closing/settings')).toBe(false);
  });
  it('shows review to a reviewer and settings only to the settings holder', async () => {
    await start(['closing.review']);
    expect(has('#/closing/review')).toBe(true);
    expect(has('#/closing/settings')).toBe(false);
    await start(['closing.settings']);
    expect(has('#/closing/settings')).toBe(true);
    expect(has('#/closing/book')).toBe(false);
  });
  it('shows none of these to a cashier', async () => {
    await start(['closing.enter_own']);
    ['#/closing/book', '#/closing/review', '#/closing/settings'].forEach((h) => expect(has(h)).toBe(false));
  });
  it('registers each route with the right permissions', async () => {
    const m = (await import('../../js/modules/closing/manifest.js')).default;
    const any = (p) => m.routes.find((r) => r.path === p).anyOf;
    ['/closing/book', '/closing/history/cc', '/closing/history/rbd', '/closing/history/mediq'].forEach((p) => {
      expect(any(p)).toEqual(['closing.view_all', 'closing.review', 'closing.correct']);
    });
    expect(any('/closing/review')).toEqual(['closing.review', 'closing.correct']);
    expect(any('/closing/settings')).toEqual(['closing.settings']);
  });
});
