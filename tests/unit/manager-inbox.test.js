// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  allowedTargets,
  changeNote,
  filingSummary,
  kindLabel,
  linesFor,
  slotLabel,
  validateFiling,
  waitingCount,
} from '../../js/modules/manager/domain/inbox.js';

const api = {
  inboxLines: vi.fn(),
  inboxCount: vi.fn(),
  inboxFile: vi.fn(),
  inboxDismiss: vi.fn(),
  inboxReopen: vi.fn(),
  creditMonth: vi.fn(),
  ledgersList: vi.fn(),
};
vi.mock('../../js/modules/manager/data/api.js', () => api);

// ── invented data ──
const line = (o = {}) => ({
  line_id: 'l1',
  business_date: '2026-11-10',
  slot_kind: 'day',
  slot_seq: 1,
  kind: 'named',
  label: 'Test Customer X',
  amount: 1500,
  closing_id: 'c1',
  revision: 0,
  submitted_at: '2026-11-10T20:00:00Z',
  changed_after_first: false,
  removed: false,
  account_id: null,
  state: 'unfiled',
  filing_id: null,
  filed_at: null,
  target_kind: null,
  staff_id: null,
  ledger_id: null,
  category_id: null,
  target_label: null,
  filed_amount: null,
  filed_label: null,
  changed_after_filing: false,
  entry_reversed: false,
  reason: null,
  ...o,
});
const people = [
  { staff_id: 'p1', full_name: 'Test Person One', opening_month: '2026-10-01' },
  { staff_id: 'p2', full_name: 'Test Person Two', opening_month: null },
  { staff_id: 'p3', full_name: 'Test Person Three', opening_month: '2026-11-01' },
];
const ledgers = [
  {
    ledger_id: 'ex',
    name: 'Expenses',
    has_shift: false,
    categories: [
      { id: 'c-bill', name: 'Bill', direction: 1 },
      { id: 'c-ho', name: 'Head Office received', direction: -1 },
    ],
  },
  { ledger_id: 'jz', name: 'Jazz Cash', has_shift: true, categories: [{ id: 'c-recv', name: 'Received', direction: 1 }] },
];

// ── domain ──
describe('inbox words', () => {
  it('names the kinds and shifts', () => {
    expect(kindLabel('named')).toBe('Named customer');
    expect(kindLabel('tier')).toBe('Credit tier');
    expect(kindLabel('free')).toBe('Other credit');
    expect(kindLabel('adjustment')).toBe('Adjustment');
    expect(kindLabel('zzz')).toBe('Credit');
    expect(slotLabel('day', 1)).toBe('Day shift');
    expect(slotLabel('night', 2)).toBe('Night shift 2');
  });
});

describe('who may file where (seeing the inbox is not enough)', () => {
  it('needs the target’s own key', () => {
    expect(allowedTargets(['mgmt.inbox_file'])).toEqual({ credit: false, ledger: false });
    expect(allowedTargets(['mgmt.inbox_file', 'mgmt.credit_manage'])).toEqual({ credit: true, ledger: false });
    expect(allowedTargets(new Set(['mgmt.inbox_file', 'mgmt.ledgers']))).toEqual({ credit: false, ledger: true });
  });
});

describe('tabs and the waiting count', () => {
  const all = [
    line(),
    line({ line_id: 'l2', removed: true }),
    line({ line_id: 'l3', state: 'filed' }),
    line({ line_id: 'l4', state: 'dismissed' }),
  ];
  it('sorts lines into their tab', () => {
    expect(linesFor(all, 'unfiled').map((l) => l.line_id)).toEqual(['l1', 'l2']);
    expect(linesFor(all, 'filed')).toHaveLength(1);
    expect(linesFor(all, 'dismissed')).toHaveLength(1);
  });
  it('does not count a line Closing has removed as waiting', () => expect(waitingCount(all)).toBe(1));
  it('copes with no lines', () => {
    expect(waitingCount(null)).toBe(0);
    expect(linesFor(undefined, 'filed')).toEqual([]);
  });
});

describe('validateFiling mirrors the database rules', () => {
  const ok = { target: 'credit', staffId: 'p2' };
  it('accepts a person, a ledger with a category, and a shift where the ledger has one', () => {
    expect(validateFiling(line(), ok, { people, ledgers })).toEqual({});
    expect(validateFiling(line(), { target: 'ledger', ledgerId: 'ex', categoryId: 'c-bill' }, { people, ledgers })).toEqual({});
    expect(
      validateFiling(line(), { target: 'ledger', ledgerId: 'jz', categoryId: 'c-recv', shift: 'Evening' }, { people, ledgers }),
    ).toEqual({});
  });
  it('asks for a person, a ledger, a category, a shift, a target', () => {
    expect(validateFiling(line(), { target: 'credit', staffId: '' }, { people })).toHaveProperty('staff');
    expect(validateFiling(line(), { target: 'ledger', ledgerId: '' }, { ledgers })).toHaveProperty('ledger');
    expect(validateFiling(line(), { target: 'ledger', ledgerId: 'ex', categoryId: 'nope' }, { ledgers })).toHaveProperty('category');
    expect(validateFiling(line(), { target: 'ledger', ledgerId: 'jz', categoryId: 'c-recv', shift: '' }, { ledgers })).toHaveProperty(
      'shift',
    );
    expect(validateFiling(line(), { target: '' }, {})).toHaveProperty('target');
  });
  it('refuses a date before the person’s opening month, but not on or after it', () => {
    expect(validateFiling(line({ business_date: '2026-09-30' }), { target: 'credit', staffId: 'p1' }, { people })).toHaveProperty('staff');
    expect(validateFiling(line({ business_date: '2026-10-01' }), { target: 'credit', staffId: 'p1' }, { people })).toEqual({});
    expect(validateFiling(line({ business_date: '2026-10-31' }), { target: 'credit', staffId: 'p3' }, { people })).toHaveProperty('staff');
  });
  it('lets a negative line go only to staff credit', () => {
    const neg = line({ amount: -300 });
    expect(validateFiling(neg, ok, { people })).toEqual({});
    expect(validateFiling(neg, { target: 'ledger', ledgerId: 'ex', categoryId: 'c-bill' }, { ledgers })).toHaveProperty('line');
  });
  it('never files a line Closing has removed', () =>
    expect(validateFiling(line({ removed: true }), ok, { people })).toHaveProperty('line'));
});

describe('filing summary and change note', () => {
  it('says where it will go, in words', () => {
    expect(filingSummary(line(), { target: 'credit', person: people[0] })).toBe('Staff credit for Test Person One');
    expect(filingSummary(line(), { target: 'ledger', ledger: ledgers[0], category: ledgers[0].categories[1] })).toBe(
      'Expenses · Head Office received (reduces)',
    );
    expect(filingSummary(line(), { target: 'credit' })).toBe('');
  });
  it('tells what changed after filing, and says nothing otherwise', () => {
    expect(changeNote(line())).toBe('');
    expect(changeNote(line({ changed_after_filing: true, amount: 1800, filed_amount: 1500, label: 'A', filed_label: 'A' }))).toBe(
      'Changed in Closing: amount is now 1800 (was 1500).',
    );
    expect(changeNote(line({ changed_after_filing: true, amount: 1500, filed_amount: 1500, label: 'B', filed_label: 'A' }))).toBe(
      'Changed in Closing: the name changed.',
    );
    expect(changeNote(line({ changed_after_filing: true, removed: true }))).toBe('Closing has removed this line since.');
  });
});

// ── page ──
const tick = () => new Promise((r) => setTimeout(r, 15));
const type = (el, value) => {
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
};
const OWNER = ['mgmt.inbox_file', 'credit.view', 'mgmt.credit_manage', 'mgmt.ledgers'];
let el;
const dlg = () => document.querySelector('dialog');
const open = async (perms = OWNER) => {
  const { mount } = await import('../../js/modules/manager/ui/inbox.js');
  await mount(el, { ctx: { permissions: perms } });
  await tick();
};
const pick = (root, sel, value) => {
  const s = root.querySelector(sel);
  s.value = value;
  s.dispatchEvent(new Event('input', { bubbles: true }));
};

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
  api.inboxLines.mockResolvedValue([
    line(),
    line({ line_id: 'l2', kind: 'adjustment', label: 'Credit adjustment', amount: -300, business_date: '2026-11-09' }),
    line({ line_id: 'l3', removed: true, label: 'Gone line', amount: 90 }),
    line({
      line_id: 'l4',
      state: 'filed',
      target_kind: 'credit',
      target_label: 'Staff credit · Test Person One',
      filed_at: '2026-11-11T05:00:00Z',
      filed_amount: 1500,
      filed_label: 'Test Customer X',
    }),
    line({ line_id: 'l5', state: 'dismissed', reason: 'Duplicate of another line', label: 'Dup' }),
  ]);
  api.creditMonth.mockResolvedValue(people);
  api.ledgersList.mockResolvedValue(ledgers);
  api.inboxFile.mockResolvedValue({ data: { filing_id: 'f1' }, error: null });
  api.inboxDismiss.mockResolvedValue({ data: { filing_id: 'f2' }, error: null });
  api.inboxReopen.mockResolvedValue({ data: { filing_id: 'f3' }, error: null });
});
afterEach(() => document.querySelectorAll('dialog').forEach((d) => d.remove()));

describe('Credit Inbox page', () => {
  it('opens on Unfiled, with counts on the tabs and the waiting number in the banner', async () => {
    await open();
    expect(el.textContent).toContain('2 to file');
    expect([...el.querySelectorAll('.tab')].map((t) => t.textContent.replace(/\s+/g, ' ').trim())).toEqual([
      'Unfiled (3)',
      'Filed (1)',
      'Dismissed (1)',
    ]);
    expect(el.querySelectorAll('.mg-inbox-line')).toHaveLength(3);
    expect(el.textContent).toContain('Test Customer X');
    expect(el.textContent).toContain('Removed in Closing');
  });

  it('offers File on a live line but not on a line Closing removed (it can still be dismissed)', async () => {
    await open();
    const cards = [...el.querySelectorAll('.mg-inbox-line')];
    const removed = cards.find((c) => c.textContent.includes('Gone line'));
    expect(removed.querySelector('[data-act="file"]').disabled).toBe(true);
    expect(removed.querySelector('[data-act="dismiss"]')).not.toBeNull();
    expect(cards[0].querySelector('[data-act="file"]').disabled).toBe(false);
  });

  it('shows where a filed line went and the reason for a dismissed one', async () => {
    await open();
    el.querySelector('[data-tab="filed"]').click();
    expect(el.textContent).toContain('Filed to Staff credit · Test Person One');
    expect(el.querySelector('[data-act="reopen"]')).not.toBeNull();
    el.querySelector('[data-tab="dismissed"]').click();
    expect(el.textContent).toContain('Dismissed: Duplicate of another line');
  });

  it('flags a line Closing changed after filing, and only that one', async () => {
    api.inboxLines.mockResolvedValue([
      line({
        line_id: 'a',
        state: 'filed',
        target_label: 'x',
        filed_at: '2026-11-11T05:00:00Z',
        changed_after_filing: true,
        amount: 1800,
        filed_amount: 1500,
        filed_label: 'Test Customer X',
      }),
      line({ line_id: 'b', state: 'filed', target_label: 'y', filed_at: '2026-11-11T05:00:00Z' }),
    ]);
    await open();
    el.querySelector('[data-tab="filed"]').click();
    expect(el.querySelectorAll('.mg-changed')).toHaveLength(1);
    expect(el.textContent).toContain('Changed in Closing: amount is now 1800 (was 1500).');
  });

  it('says so when a filed entry was reversed elsewhere', async () => {
    api.inboxLines.mockResolvedValue([line({ entry_reversed: true })]);
    await open();
    expect(el.textContent).toContain('The entry filed earlier was reversed');
  });

  it('a person with only the inbox key can dismiss but is not offered File', async () => {
    await open(['mgmt.inbox_file', 'credit.view']);
    expect(el.querySelector('[data-act="file"]')).toBeNull();
    expect(el.querySelector('[data-act="dismiss"]')).not.toBeNull();
  });

  it('shows a friendly card when the inbox cannot be read', async () => {
    api.inboxLines.mockRejectedValue(new Error('network'));
    await open();
    expect(el.textContent).toContain('Could not load the credit inbox');
  });

  it('says so when nothing waits', async () => {
    api.inboxLines.mockResolvedValue([]);
    await open();
    expect(el.textContent).toContain('Everything is filed');
    expect(el.textContent).toContain('Nothing waiting');
  });

  describe('filing', () => {
    const openFile = async (perms = OWNER) => {
      await open(perms);
      el.querySelector('[data-act="file"]').click();
      await tick();
    };

    it('shows the date, amount and description pre-filled from Closing, all editable', async () => {
      await openFile();
      expect(dlg().querySelector('[data-f="date"]').value).toBe('2026-11-10');
      expect(dlg().querySelector('[data-f="amount"]').value).toBe('1500');
      expect(dlg().querySelector('[data-f="description"]').value).toBe('Test Customer X');
    });

    it('lets the owner change the date and amount, and sends them', async () => {
      await openFile();
      pick(dlg(), '[data-f="staffId"]', 'p2');
      type(dlg().querySelector('[data-f="amount"]'), '1200');
      type(dlg().querySelector('[data-f="date"]'), '2026-11-09');
      dlg().querySelector('[data-ok]').click();
      await tick();
      expect(api.inboxFile).toHaveBeenCalledWith(
        'l1',
        'credit',
        expect.objectContaining({ staffId: 'p2', date: '2026-11-09', amount: 1200 }),
        expect.any(String),
      );
    });

    it('will not send a zero or empty amount', async () => {
      await openFile();
      pick(dlg(), '[data-f="staffId"]', 'p2');
      type(dlg().querySelector('[data-f="amount"]'), '0');
      dlg().querySelector('[data-ok]').click();
      await tick();
      expect(api.inboxFile).not.toHaveBeenCalled();
      expect(dlg().textContent).toContain('Enter an amount');
    });

    it('loads the people for the line’s own month', async () => {
      await openFile();
      expect(api.creditMonth).toHaveBeenCalledWith('2026-11-01');
    });

    it('will not send without a person', async () => {
      await openFile();
      dlg().querySelector('[data-ok]').click();
      await tick();
      expect(api.inboxFile).not.toHaveBeenCalled();
      expect(dlg().textContent).toContain('Pick a person');
    });

    it('files into staff credit with the line, the person and the description, then reloads', async () => {
      await openFile();
      pick(dlg(), '[data-f="staffId"]', 'p2');
      type(dlg().querySelector('[data-f="description"]'), 'Edited note');
      dlg().querySelector('[data-ok]').click();
      await tick();
      expect(api.inboxFile).toHaveBeenCalledWith(
        'l1',
        'credit',
        { staffId: 'p2', ledgerId: null, categoryId: null, shift: null, description: 'Edited note', date: '2026-11-10', amount: 1500 },
        expect.any(String),
      );
      expect(api.inboxLines).toHaveBeenCalledTimes(2);
    });

    it('a failed filing keeps the dialog open and retries with the same key; an edit gets a new key', async () => {
      api.inboxFile
        .mockResolvedValueOnce({ data: null, error: { message: 'this line is already filed' } })
        .mockResolvedValueOnce({ data: null, error: { message: 'still refused' } });
      await openFile();
      pick(dlg(), '[data-f="staffId"]', 'p2');
      dlg().querySelector('[data-ok]').click();
      await tick();
      expect(dlg()).not.toBeNull();
      dlg().querySelector('[data-ok]').click();
      await tick();
      pick(dlg(), '[data-f="staffId"]', 'p1');
      dlg().querySelector('[data-ok]').click();
      await tick();
      const [first, second, third] = api.inboxFile.mock.calls.map((c) => c[3]);
      expect(first).toBe(second);
      expect(third).not.toBe(first);
    });

    it('files into a ledger with its category; Jazz Cash also sends the shift', async () => {
      await openFile();
      dlg().querySelector('[data-target="ledger"]').click();
      expect(dlg().querySelector('[data-f="categoryId"]').textContent).toContain('Choose ledger first');
      pick(dlg(), '[data-f="ledgerId"]', 'ex');
      pick(dlg(), '[data-f="categoryId"]', 'c-ho');
      dlg().querySelector('[data-ok]').click();
      await tick();
      expect(api.inboxFile).toHaveBeenLastCalledWith(
        'l1',
        'ledger',
        {
          staffId: null,
          ledgerId: 'ex',
          categoryId: 'c-ho',
          shift: null,
          description: 'Test Customer X',
          date: '2026-11-10',
          amount: 1500,
        },
        expect.any(String),
      );
      document.querySelectorAll('dialog').forEach((d) => d.remove());
      el.querySelector('[data-act="file"]').click();
      await tick();
      dlg().querySelector('[data-target="ledger"]').click();
      pick(dlg(), '[data-f="ledgerId"]', 'jz');
      pick(dlg(), '[data-f="categoryId"]', 'c-recv');
      pick(dlg(), '[data-f="shift"]', 'Night');
      dlg().querySelector('[data-ok]').click();
      await tick();
      expect(api.inboxFile).toHaveBeenLastCalledWith(
        'l1',
        'ledger',
        expect.objectContaining({ ledgerId: 'jz', categoryId: 'c-recv', shift: 'Night' }),
        expect.any(String),
      );
    });

    it('a negative line cannot be sent to a ledger', async () => {
      await open();
      el.querySelectorAll('[data-act="file"]')[1].click(); // the -300 adjustment
      await tick();
      dlg().querySelector('[data-target="ledger"]').click();
      pick(dlg(), '[data-f="ledgerId"]', 'ex');
      pick(dlg(), '[data-f="categoryId"]', 'c-ho');
      dlg().querySelector('[data-ok]').click();
      await tick();
      expect(api.inboxFile).not.toHaveBeenCalled();
      expect(dlg().textContent).toContain('A negative line can only go to staff credit');
    });

    it('a person who may file only into ledgers sees no staff-credit choice and loads no people', async () => {
      await openFile(['mgmt.inbox_file', 'credit.view', 'mgmt.ledgers']);
      expect(dlg().querySelector('[data-target]')).toBeNull();
      expect(dlg().querySelector('[data-f="ledgerId"]')).not.toBeNull();
      expect(api.creditMonth).not.toHaveBeenCalled();
    });

    it('cancelling sends nothing', async () => {
      await openFile();
      dlg().querySelector('[data-close]').click();
      expect(api.inboxFile).not.toHaveBeenCalled();
    });
  });

  describe('dismissing and reopening', () => {
    it('dismiss needs a reason and sends exactly that', async () => {
      await open();
      el.querySelector('[data-act="dismiss"]').click();
      await tick();
      dlg().querySelector('[data-ok]').click();
      expect(dlg().querySelector('#reason-err').hidden).toBe(false);
      expect(api.inboxDismiss).not.toHaveBeenCalled();
      type(dlg().querySelector('#reason'), 'Counted twice');
      dlg().querySelector('[data-ok]').click();
      await tick();
      expect(api.inboxDismiss).toHaveBeenCalledWith('l1', 'Counted twice', expect.any(String));
    });

    it('cancelling the reason prompt sends nothing', async () => {
      await open();
      el.querySelector('[data-act="dismiss"]').click();
      await tick();
      dlg().querySelector('[data-close]').click();
      await tick();
      expect(api.inboxDismiss).not.toHaveBeenCalled();
    });

    it('reopen explains that a filed entry is reversed, and sends the reason', async () => {
      await open();
      el.querySelector('[data-tab="filed"]').click();
      el.querySelector('[data-act="reopen"]').click();
      await tick();
      expect(dlg().textContent).toContain('reversed');
      type(dlg().querySelector('#reason'), 'Closing corrected it');
      dlg().querySelector('[data-ok]').click();
      await tick();
      expect(api.inboxReopen).toHaveBeenCalledWith('l4', 'Closing corrected it', expect.any(String));
    });

    it('shows the database’s plain message when it refuses', async () => {
      api.inboxDismiss.mockResolvedValue({ data: null, error: { message: 'this line is filed: reopen it first' } });
      await open();
      el.querySelector('[data-act="dismiss"]').click();
      await tick();
      type(dlg().querySelector('#reason'), 'Counted twice');
      dlg().querySelector('[data-ok]').click();
      await tick();
      expect(document.getElementById('toasts').textContent).toContain('reopen it first');
    });
  });
});

describe('status pill', () => {
  it('counts what waits, and says so when nothing does', async () => {
    const { pill } = await import('../../js/modules/manager/status.js');
    api.inboxCount.mockResolvedValue(4);
    expect(await pill()).toEqual({ label: 'Credit inbox', value: '4 to file', href: '#/manager/inbox' });
    api.inboxCount.mockResolvedValue(0);
    expect((await pill()).value).toBe('All filed');
  });
});

describe('module wiring', () => {
  it('the route and the pill are for people holding mgmt.inbox_file only', async () => {
    const manifest = (await import('../../js/modules/manager/manifest.js')).default;
    const route = manifest.routes.find((r) => r.path === '/manager/inbox');
    expect(route.anyOf).toEqual(['mgmt.inbox_file']);
    expect(manifest.status.anyOf).toEqual(['mgmt.inbox_file']);
  });
  it('the inbox page and its api never write a table directly', () => {
    const src = readFileSync('js/modules/manager/ui/inbox.js', 'utf8') + readFileSync('js/modules/manager/status.js', 'utf8');
    expect(src).not.toMatch(/\.(insert|update|delete|upsert)\(/);
    expect(src).not.toMatch(/innerHTML/);
  });
});
