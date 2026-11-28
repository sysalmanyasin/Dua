// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  balanceMessage,
  directionWord,
  groupByCategory,
  isTickable,
  runningBalances,
  tallyDifference,
  tickSummary,
  tallyTotal,
  validateLedgerEntry,
} from '../../js/modules/manager/domain/ledger.js';

const api = {
  ledgersList: vi.fn(),
  ledgerView: vi.fn(),
  ledgerAdd: vi.fn(),
  ledgerReverse: vi.fn(),
  sectionCreate: vi.fn(),
  categoryAdd: vi.fn(),
  categoryRetire: vi.fn(),
  tallyAccounts: vi.fn(),
  tallyAccountAdd: vi.fn(),
  tallyAccountRetire: vi.fn(),
  tallyGet: vi.fn(),
  tallyList: vi.fn(),
  tallySave: vi.fn(),
};
vi.mock('../../js/modules/manager/data/api.js', () => api);

const cases = JSON.parse(readFileSync('tests/fixtures/manager-ledger-cases.json', 'utf8'));

describe('running balance (shared cases, also run against the database)', () => {
  it('has the cases', () => expect(cases.length).toBe(7));
  for (const c of cases) it(c.name, () => expect(runningBalances(c.entries)).toEqual(c.balances));
});

describe('ledger words and maths', () => {
  const exp = { positive_label: 'Head Office owes you', negative_label: 'You hold Head Office cash' };
  it('shows direction in words, never a bare sign', () => {
    expect(directionWord(1)).toBe('adds');
    expect(directionWord(-1)).toBe('reduces');
  });
  it('words the balance the way the owner described it', () => {
    expect(balanceMessage(exp, 3424)).toEqual({ text: 'Head Office owes you', amount: 3424, tone: 'positive' });
    expect(balanceMessage(exp, -24500)).toEqual({ text: 'You hold Head Office cash', amount: 24500, tone: 'negative' });
    expect(balanceMessage(exp, 0)).toEqual({ text: 'Settled', amount: 0, tone: 'zero' });
    expect(balanceMessage(exp, 0.1 + 0.2 - 0.3).text).toBe('Settled');
  });
  it('groups by category, reversals netting out', () => {
    const rows = [
      { category_id: 'a', category_name: 'Bill', category_direction: 1, effect: 1, amount: 300 },
      { category_id: 'a', category_name: 'Bill', category_direction: 1, effect: -1, amount: 300 },
      { category_id: 'a', category_name: 'Bill', category_direction: 1, effect: 1, amount: 50.5 },
      { category_id: 'b', category_name: 'Cash from HO', category_direction: -1, effect: -1, amount: 1000 },
    ];
    const g = Object.fromEntries(groupByCategory(rows).map((x) => [x.name, x]));
    expect(g.Bill).toMatchObject({ added: 350.5, reduced: 300, net: 50.5, count: 3 });
    expect(g['Cash from HO']).toMatchObject({ added: 0, reduced: 1000, net: -1000 });
  });
  it('checks an entry before it is sent', () => {
    const ok = { date: '2026-11-12', amount: 5, today: '2026-11-12', categoryId: 'c', shift: 'Morning', needsShift: true };
    expect(validateLedgerEntry(ok)).toBeNull();
    expect(validateLedgerEntry({ ...ok, categoryId: '' })).toMatch(/category/);
    expect(validateLedgerEntry({ ...ok, amount: 0 })).toMatch(/above zero/);
    expect(validateLedgerEntry({ ...ok, amount: -5 })).toMatch(/above zero/);
    expect(validateLedgerEntry({ ...ok, amount: Number.NaN })).toMatch(/above zero/);
    expect(validateLedgerEntry({ ...ok, amount: 2e9 })).toMatch(/large/);
    expect(validateLedgerEntry({ ...ok, date: '2026-11-13' })).toMatch(/future/);
    expect(validateLedgerEntry({ ...ok, shift: '' })).toMatch(/shift/);
    expect(validateLedgerEntry({ ...ok, shift: '', needsShift: false })).toBeNull();
  });
  it('only a live entry can be ticked, and the ticked ones add up exactly by direction', () => {
    const rows = [
      { entry_id: 'a', effect: 1, amount: 0.1 },
      { entry_id: 'b', effect: 1, amount: 0.2 },
      { entry_id: 'c', effect: -1, amount: 500 },
      { entry_id: 'd', effect: 1, amount: 70, reversed_by: 'e' },
      { entry_id: 'e', effect: -1, amount: 70, reverses_id: 'd' },
    ];
    expect(rows.map(isTickable)).toEqual([true, true, true, false, false]);
    expect(tickSummary(rows, new Set(['a', 'b', 'c', 'd', 'e', 'gone']))).toEqual({ count: 3, total: 3, added: 0.3, reduced: 500 });
    expect(tickSummary(rows, new Set(['b']))).toEqual({ count: 1, total: 3, added: 0.2, reduced: 0 });
    expect(tickSummary(rows, new Set())).toEqual({ count: 0, total: 3, added: 0, reduced: 0 });
    expect(tickSummary([], new Set(['a']))).toEqual({ count: 0, total: 0, added: 0, reduced: 0 });
  });
  it('the tally: ledger balance plus accounts, against the app total, in exact paisa', () => {
    expect(tallyTotal(-25146, [20000, 5146.5])).toBe(0.5);
    expect(tallyTotal(0.1, [0.2])).toBe(0.3);
    expect(tallyDifference(0.5, 100)).toEqual({ amount: -99.5, label: 'Short' });
    expect(tallyDifference(120, 100)).toEqual({ amount: 20, label: 'Extra cash' });
    expect(tallyDifference(100, 100)).toEqual({ amount: 0, label: 'Balanced' });
  });
});

// ───────────────────────── the pages ─────────────────────────
const tick = () => new Promise((r) => setTimeout(r, 15));
const type = (el, value) => {
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
};
const change = (el, value) => {
  el.value = value;
  el.dispatchEvent(new Event('change', { bubbles: true }));
};
let el;
const dlg = () => [...document.querySelectorAll('dialog')].at(-1);
const EXP = {
  ledger_id: 'L1',
  code: 'expense',
  name: 'Expenses',
  kind: 'expense',
  has_shift: false,
  positive_label: 'Head Office owes you',
  negative_label: 'You hold Head Office cash',
  balance: 3424,
  entry_count: 3,
  categories: [
    { id: 'c-bill', name: 'Bill', direction: 1 },
    { id: 'c-fuel', name: 'Fuel/HO', direction: 1 },
    { id: 'c-ho', name: 'Cash received from Head Office', direction: -1 },
  ],
};
const JZ = {
  ledger_id: 'L2',
  code: 'jazzcash',
  name: 'Jazz Cash',
  kind: 'jazzcash',
  has_shift: true,
  positive_label: 'Jazz Cash money held',
  negative_label: 'Transferred out more than received',
  balance: -25146,
  entry_count: 2,
  categories: [
    { id: 'j-recv', name: 'Received', direction: 1 },
    { id: 'j-xfer', name: 'Transfer', direction: -1 },
  ],
};
const SEC = {
  ledger_id: 'L3',
  code: 'misc_1',
  name: 'Shop sundries',
  kind: 'misc',
  has_shift: false,
  positive_label: 'Balance',
  negative_label: 'Balance (below zero)',
  balance: 500,
  entry_count: 1,
  categories: [
    { id: 's-in', name: 'Stock in', direction: 1 },
    { id: 's-out', name: 'Stock out', direction: -1 },
  ],
};
const E = (o = {}) => ({
  entry_id: 'e1',
  entry_date: '2026-11-07',
  shift: null,
  category_id: 'c-bill',
  category_name: 'Bill',
  category_direction: 1,
  description: 'Tea',
  amount: 50,
  effect: 1,
  source: 'manual',
  reverses_id: null,
  reversed_by: null,
  reason: null,
  balance_after: 50,
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
  localStorage.clear();
  Object.values(api).forEach((f) => f.mockReset());
  api.ledgersList.mockResolvedValue([EXP, JZ, SEC]);
  api.ledgerView.mockResolvedValue([
    E({
      entry_id: 'e1',
      category_id: 'c-ho',
      category_name: 'Cash received from Head Office',
      category_direction: -1,
      description: '',
      amount: 24500,
      effect: -1,
      balance_after: -24500,
    }),
    E({ entry_id: 'e2', amount: 50, balance_after: -24450 }),
    E({
      entry_id: 'e3',
      category_name: 'Guard Incentive',
      description: 'Guard Incentive',
      amount: 50,
      source: 'closing_inbox',
      balance_after: -24400,
    }),
  ]);
  api.ledgerAdd.mockResolvedValue({ data: { id: 'n1' }, error: null });
  api.ledgerReverse.mockResolvedValue({ data: { id: 'r1' }, error: null });
  api.sectionCreate.mockResolvedValue({ data: { id: 'L3' }, error: null });
  api.categoryAdd.mockResolvedValue({ data: { id: 'c9' }, error: null });
  api.categoryRetire.mockResolvedValue({ data: { id: 'c-fuel' }, error: null });
  api.tallyAccounts.mockResolvedValue([
    { account_id: 'a1', name: 'ABL' },
    { account_id: 'a2', name: 'Cash in Hand' },
  ]);
  api.tallyGet.mockResolvedValue({
    has_snapshot: false,
    revision: null,
    ledger_balance: -25146,
    accounts: [],
    app_total: 0,
    total: -25146,
    difference: -25146,
    live_ledger_balance: -25146,
  });
  api.tallyList.mockResolvedValue([{ snap_date: '2026-11-11', revision: 0, total: 100, app_total: 100, difference: 0 }]);
  api.tallySave.mockResolvedValue({ data: { id: 's1', revision: 0, difference: 0 }, error: null });
  api.tallyAccountAdd.mockResolvedValue({ data: { id: 'a3' }, error: null });
  api.tallyAccountRetire.mockResolvedValue({ data: { id: 'a1' }, error: null });
});
afterEach(() => {
  vi.useRealTimers();
  document.querySelectorAll('dialog').forEach((d) => d.remove());
});

async function openExpenses() {
  const { mount } = await import('../../js/modules/manager/ui/expenses.js');
  await mount(el, { ctx: { permissions: ['mgmt.ledgers'] } });
  await tick();
}

describe('ledger panel (Expenses)', () => {
  it('words the balance, lists newest first with running balances, and marks entries filed from Closing', async () => {
    await openExpenses();
    expect(el.querySelector('[data-balance]').textContent).toContain('Head Office owes you');
    expect(el.querySelector('[data-balance]').textContent).toContain('3,424');
    const cards = [...el.querySelectorAll('.mg-entry')];
    expect(cards).toHaveLength(3);
    expect(cards[0].textContent).toContain('Guard Incentive');
    expect(cards[0].textContent).toContain('Closing');
    expect(cards[2].textContent).toContain('Cash received from Head Office');
    expect(cards[2].textContent).toContain('reduces');
    expect(cards[1].textContent).toContain('adds');
  });

  it('a negative balance reads "You hold Head Office cash" and zero reads Settled', async () => {
    api.ledgersList.mockResolvedValue([{ ...EXP, balance: -24500 }]);
    await openExpenses();
    expect(el.querySelector('[data-balance]').textContent).toContain('You hold Head Office cash');
    document.body.innerHTML = '<div id="page"></div>';
    el = document.getElementById('page');
    api.ledgersList.mockResolvedValue([{ ...EXP, balance: 0 }]);
    await openExpenses();
    expect(el.querySelector('[data-balance]').textContent).toContain('Settled');
  });

  it('offers categories with their direction in words and no shift for Expenses', async () => {
    await openExpenses();
    const opts = [...el.querySelectorAll('[data-form="category"] option')].map((o) => o.textContent);
    expect(opts).toEqual(['Bill (adds)', 'Fuel/HO (adds)', 'Cash received from Head Office (reduces)']);
    expect(el.querySelector('[data-form="shift"]')).toBeNull();
  });

  it('adds an entry once with a key; a retry reuses it; an edit after a failure gets a new one', async () => {
    await openExpenses();
    type(el.querySelector('[data-form="amount"]'), '1,250');
    type(el.querySelector('[data-form="description"]'), 'Test fuel');
    api.ledgerAdd.mockResolvedValueOnce({ data: null, error: { message: 'network down' } });
    el.querySelector('[data-act="add"]').click();
    await tick();
    el.querySelector('[data-act="add"]').click();
    await tick();
    const [a, b] = api.ledgerAdd.mock.calls;
    expect(a.slice(0, 6)).toEqual(['L1', 'c-bill', '2026-11-12', null, 'Test fuel', 1250]);
    expect(a[6]).toBe(b[6]);
    expect(api.ledgerView).toHaveBeenCalledTimes(2); // reloaded after the successful add
    type(el.querySelector('[data-form="amount"]'), '5');
    api.ledgerAdd.mockResolvedValueOnce({ data: null, error: { message: 'nope' } });
    el.querySelector('[data-act="add"]').click();
    await tick();
    type(el.querySelector('[data-form="amount"]'), '6');
    el.querySelector('[data-act="add"]').click();
    await tick();
    const keys = api.ledgerAdd.mock.calls.slice(2).map((c) => c[6]);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it('refuses a blank, zero or future entry before sending anything', async () => {
    await openExpenses();
    el.querySelector('[data-act="add"]').click();
    await tick();
    expect(el.textContent).toContain('above zero');
    type(el.querySelector('[data-form="amount"]'), '0');
    el.querySelector('[data-act="add"]').click();
    await tick();
    type(el.querySelector('[data-form="amount"]'), '5');
    type(el.querySelector('[data-form="date"]'), '2026-11-13');
    el.querySelector('[data-act="add"]').click();
    await tick();
    expect(el.textContent).toContain('future');
    expect(api.ledgerAdd).not.toHaveBeenCalled();
  });

  it('Jazz Cash asks for a shift (Morning by default) and sends it', async () => {
    const { mount } = await import('../../js/modules/manager/ui/jazzcash.js');
    api.ledgerView.mockResolvedValue([]);
    await mount(el, { ctx: { permissions: ['mgmt.ledgers'] } });
    await tick();
    expect(el.querySelector('[data-balance]').textContent).toContain('Transferred out more than received');
    expect(el.querySelector('[data-form="shift"]').value).toBe('Morning');
    type(el.querySelector('[data-form="shift"]'), 'Night'); // a real select fires input as well as change
    type(el.querySelector('[data-form="amount"]'), '53,796');
    el.querySelector('[data-act="add"]').click();
    await tick();
    expect(api.ledgerAdd.mock.calls[0].slice(0, 4)).toEqual(['L2', 'j-recv', '2026-11-12', 'Night']);
  });

  it('reverses only a live entry, and only with a reason', async () => {
    api.ledgerView.mockResolvedValue([
      E({ entry_id: 'a', reversed_by: 'b' }),
      E({ entry_id: 'b', reverses_id: 'a', effect: -1, description: 'Reversal: Tea', reason: 'typed twice' }),
      E({ entry_id: 'c', description: 'Live one' }),
    ]);
    await openExpenses();
    expect([...el.querySelectorAll('[data-act="reverse"]')].map((b) => b.dataset.id)).toEqual(['c']);
    expect(el.textContent).toContain('Reversed');
    expect(el.textContent).toContain('typed twice');
    el.querySelector('[data-act="reverse"]').click();
    await tick();
    dlg().querySelector('[data-ok]').click();
    expect(dlg().querySelector('#reason-err').hidden).toBe(false);
    expect(api.ledgerReverse).not.toHaveBeenCalled();
    type(dlg().querySelector('#reason'), 'typed for the wrong day');
    dlg().querySelector('[data-ok]').click();
    await tick();
    expect(api.ledgerReverse).toHaveBeenCalledWith('c', 'typed for the wrong day', expect.any(String));
  });

  it('filters by date range through the database and groups by category', async () => {
    await openExpenses();
    change(el.querySelector('[data-filter="from"]'), '2026-11-08');
    await tick();
    expect(api.ledgerView).toHaveBeenLastCalledWith('L1', '2026-11-08', null);
    change(el.querySelector('[data-filter="to"]'), '2026-11-10');
    await tick();
    expect(api.ledgerView).toHaveBeenLastCalledWith('L1', '2026-11-08', '2026-11-10');
    const box = el.querySelector('[data-act="group"]');
    box.checked = true;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    expect(el.querySelector('table.table').textContent).toContain('Cash received from Head Office');
  });

  it('adds a category (direction as a number) and stops using one, but never the last', async () => {
    await openExpenses();
    el.querySelector('[data-act="manage"]').click();
    type(el.querySelector('#cat-name'), 'Wastage');
    el.querySelector('#cat-dir').value = '-1';
    el.querySelector('[data-act="addcat"]').click();
    await tick();
    expect(api.categoryAdd).toHaveBeenCalledWith('L1', 'Wastage', -1, expect.any(String));
    el.querySelector('[data-act="manage"]').click();
    await tick();
    el.querySelector('[data-act="manage"]').click();
    el.querySelector('[data-act="retire"][data-id="c-fuel"]').click();
    await tick();
    dlg().querySelector('[data-ok]').click();
    await tick();
    expect(api.categoryRetire).toHaveBeenCalledWith('c-fuel', expect.any(String));
    document.body.innerHTML = '<div id="page"></div>';
    el = document.getElementById('page');
    api.ledgersList.mockResolvedValue([{ ...EXP, categories: [EXP.categories[0]] }]);
    await openExpenses();
    el.querySelector('[data-act="manage"]').click();
    expect(el.querySelector('[data-act="retire"]')).toBeNull();
  });

  it('shows a plain error card when it cannot load', async () => {
    api.ledgersList.mockRejectedValueOnce(new Error('offline'));
    await openExpenses();
    expect(el.textContent).toContain('Could not load this ledger');
  });

  describe('verify ticks', () => {
    const ticks = () => [...el.querySelectorAll('[data-act="tick"]')];
    const tickFor = (id) => el.querySelector(`[data-act="tick"][data-id="${id}"]`);
    const count = () => el.querySelector('[data-verify-count]').textContent;

    it('starts unverified, ticks an entry in place, and sums what is ticked by direction', async () => {
      await openExpenses();
      expect(ticks()).toHaveLength(3);
      expect(count()).toBe('0 of 3 verified');
      const card = tickFor('e2').closest('.mg-entry');
      tickFor('e2').click();
      expect(tickFor('e2').getAttribute('aria-pressed')).toBe('true');
      expect(card.classList.contains('mg-ticked')).toBe(true);
      expect(tickFor('e2').closest('.mg-entry')).toBe(card); // the row was updated, not rebuilt
      tickFor('e1').click();
      expect(count()).toBe('2 of 3 verified');
      expect(el.querySelector('[data-verify-sums]').textContent).toBe('adds 50 · reduces 24,500');
      tickFor('e2').click(); // a second tap undoes it
      expect(tickFor('e2').getAttribute('aria-pressed')).toBe('false');
      expect(count()).toBe('1 of 3 verified');
      expect(api.ledgerAdd).not.toHaveBeenCalled();
      expect(api.ledgerReverse).not.toHaveBeenCalled();
    });

    it('remembers the ticks on this device, for that ledger only', async () => {
      await openExpenses();
      tickFor('e1').click();
      tickFor('e3').click();
      document.body.innerHTML = '<div id="page"></div>';
      el = document.getElementById('page');
      await openExpenses();
      expect(tickFor('e1').getAttribute('aria-pressed')).toBe('true');
      expect(tickFor('e2').getAttribute('aria-pressed')).toBe('false');
      expect(count()).toBe('2 of 3 verified');
      // the same entry ids in another ledger are not ticked
      document.body.innerHTML = '<div id="page"></div>';
      el = document.getElementById('page');
      const { mount } = await import('../../js/modules/manager/ui/jazzcash.js');
      await mount(el, { ctx: { permissions: ['mgmt.ledgers'] } });
      await tick();
      expect(count()).toBe('0 of 3 verified');
    });

    it('has no tick on a reversed entry or its reversal line', async () => {
      api.ledgerView.mockResolvedValue([
        E({ entry_id: 'a', reversed_by: 'b' }),
        E({ entry_id: 'b', reverses_id: 'a', effect: -1, description: 'Reversal: Tea', reason: 'typed twice' }),
        E({ entry_id: 'c', description: 'Live one' }),
      ]);
      await openExpenses();
      expect(ticks().map((b) => b.dataset.id)).toEqual(['c']);
      expect(count()).toBe('0 of 1 verified');
    });

    it('shows unverified entries only, dropping each one as it is ticked', async () => {
      await openExpenses();
      tickFor('e2').click();
      const box = el.querySelector('[data-act="unverified"]');
      box.checked = true;
      box.dispatchEvent(new Event('change', { bubbles: true }));
      expect(el.querySelectorAll('.mg-entry')).toHaveLength(2);
      expect(tickFor('e2')).toBeNull();
      tickFor('e1').click();
      expect(el.querySelectorAll('.mg-entry')).toHaveLength(1);
      expect(count()).toBe('2 of 3 verified');
      tickFor('e3').click();
      expect(el.textContent).toContain('Every entry here is verified.');
      expect(count()).toBe('3 of 3 verified');
    });

    it('clears the ticks only after asking, leaving the ledger alone', async () => {
      await openExpenses();
      tickFor('e1').click();
      tickFor('e2').click();
      el.querySelector('[data-act="clearticks"]').click();
      await tick();
      expect(dlg().textContent).toContain('2 ticks');
      dlg().querySelector('[data-close]').click();
      await tick();
      expect(count()).toBe('2 of 3 verified');
      el.querySelector('[data-act="clearticks"]').click();
      await tick();
      dlg().querySelector('[data-ok]').click();
      await tick();
      expect(count()).toBe('0 of 3 verified');
      expect(el.querySelector('[data-act="clearticks"]')).toBeNull();
      expect(localStorage.getItem('dua.manager.ticks.v1')).toBe('{}');
      expect(api.ledgerReverse).not.toHaveBeenCalled();
    });

    it('still works when the browser will not store anything', async () => {
      const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('full');
      });
      await openExpenses();
      tickFor('e1').click();
      expect(count()).toBe('1 of 3 verified');
      spy.mockRestore();
    });
  });
});

describe('Balance Tally', () => {
  async function openTally() {
    const { mount } = await import('../../js/modules/manager/ui/jazzcash.js');
    api.ledgerView.mockResolvedValue([]);
    await mount(el, { ctx: { permissions: ['mgmt.ledgers'] } });
    await tick();
    el.querySelector('[data-tab="tally"]').click();
    await tick();
  }

  it('counts the ledger balance automatically and updates the total and the difference label as you type', async () => {
    await openTally();
    expect(el.textContent).toContain('Jazz Cash ledger (money held)');
    type(el.querySelector('[data-acc="a1"]'), '20,000');
    type(el.querySelector('[data-acc="a2"]'), '5146.5');
    expect(el.querySelector('[data-total]').textContent).toContain('0.50');
    type(el.querySelector('[data-app]'), '100');
    expect(el.querySelector('[data-label]').textContent).toBe('Short');
    type(el.querySelector('[data-app]'), '0.5');
    expect(el.querySelector('[data-label]').textContent).toBe('Balanced');
    type(el.querySelector('[data-app]'), '0');
    expect(el.querySelector('[data-label]').textContent).toBe('Extra cash');
  });

  it('saves every account with a key, and retries with the same key until something is edited', async () => {
    await openTally();
    type(el.querySelector('[data-acc="a1"]'), '20000');
    type(el.querySelector('[data-app]'), '100');
    api.tallySave.mockResolvedValueOnce({ data: null, error: { message: 'network down' } });
    el.querySelector('[data-act="save"]').click();
    await tick();
    el.querySelector('[data-act="save"]').click();
    await tick();
    const [a, b] = api.tallySave.mock.calls;
    expect(a[0]).toBe('2026-11-12');
    expect(a[1]).toEqual([
      { account_id: 'a1', amount: 20000 },
      { account_id: 'a2', amount: 0 },
    ]);
    expect(a[2]).toBe(100);
    expect(a[4]).toBe(b[4]);
  });

  it('an edit after a failed save gets a NEW key', async () => {
    await openTally();
    type(el.querySelector('[data-app]'), '100');
    api.tallySave.mockResolvedValueOnce({ data: null, error: { message: 'nope' } });
    el.querySelector('[data-act="save"]').click();
    await tick();
    type(el.querySelector('[data-app]'), '200');
    el.querySelector('[data-act="save"]').click();
    await tick();
    const [a, b] = api.tallySave.mock.calls;
    expect(a[4]).not.toBe(b[4]);
  });

  it('a date that already has a count asks for a reason when you change it, and not when you do not', async () => {
    api.tallyGet.mockResolvedValue({
      has_snapshot: true,
      revision: 0,
      ledger_balance: -25146,
      accounts: [{ account_id: 'a1', name: 'ABL', amount: 20000 }],
      app_total: 100,
      total: 0.5,
      difference: -99.5,
      live_ledger_balance: -25146,
    });
    await openTally();
    expect(el.querySelector('[data-acc="a1"]').value).toBe('20000');
    el.querySelector('[data-act="save"]').click();
    await tick();
    expect(document.querySelectorAll('dialog')).toHaveLength(0);
    type(el.querySelector('[data-app]'), '150');
    el.querySelector('[data-act="save"]').click();
    await tick();
    expect(dlg().textContent).toContain('Change this count');
    dlg().querySelector('[data-close]').click();
    await tick();
    expect(api.tallySave).toHaveBeenCalledTimes(1);
    el.querySelector('[data-act="save"]').click();
    await tick();
    type(dlg().querySelector('#reason'), 'the app figure was read wrongly');
    dlg().querySelector('[data-ok]').click();
    await tick();
    expect(api.tallySave.mock.calls[1][3]).toBe('the app figure was read wrongly');
  });

  it('refuses junk numbers, and adds or stops an account through dialogs', async () => {
    await openTally();
    type(el.querySelector('[data-acc="a1"]'), 'abc');
    el.querySelector('[data-act="save"]').click();
    await tick();
    expect(api.tallySave).not.toHaveBeenCalled();
    expect(document.getElementById('toasts').textContent).toContain('ABL');
    el.querySelector('[data-act="addacc"]').click();
    await tick();
    dlg().querySelector('[data-ok]').click();
    expect(dlg().querySelector('#ask-err').hidden).toBe(false);
    type(dlg().querySelector('#ask-text'), 'Test Wallet');
    dlg().querySelector('[data-ok]').click();
    await tick();
    expect(api.tallyAccountAdd).toHaveBeenCalledWith('Test Wallet', expect.any(String));
    el.querySelector('[data-act="retire"][data-id="a1"]').click();
    await tick();
    dlg().querySelector('[data-ok]').click();
    await tick();
    expect(api.tallyAccountRetire).toHaveBeenCalledWith('a1', expect.any(String));
  });

  it('opens an earlier count from the history, asking first if there are unsaved edits', async () => {
    await openTally();
    type(el.querySelector('[data-app]'), '7');
    el.querySelector('[data-act="open"]').click();
    await tick();
    expect(dlg().textContent).toContain('Leave without saving');
    dlg().querySelector('[data-close]').click();
    await tick();
    expect(api.tallyGet).toHaveBeenCalledTimes(1);
    type(el.querySelector('[data-app]'), '');
    el.querySelector('[data-act="open"]').click();
    await tick();
    expect(api.tallyGet).toHaveBeenLastCalledWith('2026-11-11');
  });
});

describe('Misc Sections', () => {
  async function openMisc() {
    const { mount } = await import('../../js/modules/manager/ui/misc.js');
    await mount(el, { ctx: { permissions: ['mgmt.ledgers'] } });
    await tick();
  }
  it('lists only the owner’s own sections with their balance', async () => {
    await openMisc();
    expect(el.textContent).toContain('Shop sundries');
    expect(el.textContent).toContain('Stock in, Stock out');
    expect(el.textContent).not.toContain('Jazz Cash');
    expect(el.textContent).toContain('500');
  });
  it('says so when there are none', async () => {
    api.ledgersList.mockResolvedValue([EXP, JZ]);
    await openMisc();
    expect(el.textContent).toContain('No sections yet');
  });
  it('creates a section with its categories (adds / reduces), refusing an empty one, then opens it', async () => {
    await openMisc();
    el.querySelector('[data-act="new"]').click();
    await tick();
    dlg().querySelector('[data-ok]').click();
    expect(dlg().querySelector('#sec-err').textContent).toContain('name');
    type(dlg().querySelector('#sec-name'), 'Test drawer');
    dlg().querySelector('[data-ok]').click();
    expect(dlg().querySelector('#sec-err').textContent).toContain('at least one category');
    type(dlg().querySelector('[data-n="0"]'), 'Put in');
    type(dlg().querySelector('[data-n="1"]'), 'Take out');
    dlg().querySelector('[data-ok]').click();
    await tick();
    expect(api.sectionCreate).toHaveBeenCalledWith(
      'Test drawer',
      [
        { name: 'Put in', direction: 1 },
        { name: 'Take out', direction: -1 },
      ],
      expect.any(String),
    );
    expect(el.textContent).toContain('All sections');
  });
  it('shows the database refusal inside the dialog', async () => {
    api.sectionCreate.mockResolvedValueOnce({ data: null, error: { message: 'a ledger with that name already exists' } });
    await openMisc();
    el.querySelector('[data-act="new"]').click();
    await tick();
    type(dlg().querySelector('#sec-name'), 'Shop sundries');
    type(dlg().querySelector('[data-n="0"]'), 'A');
    dlg().querySelector('[data-ok]').click();
    await tick();
    expect(dlg().querySelector('#sec-err').textContent).toContain('already exists');
  });
});
