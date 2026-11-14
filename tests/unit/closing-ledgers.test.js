// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { daysText, groupByDate, receiptRows, snapshotTitle } from '../../js/modules/closing/domain/ledgers.js';

const NIGHT = {
  closing_id: 'c-night',
  business_date: '2026-11-08',
  kind: 'night',
  seq: 10,
  mode: 'shift',
  revision: 2,
  is_opening: false,
  prev_credit: 2000,
  credit_adj: 25,
  debt_e: 3225,
  lines: [{ line_id: 'l1', kind: 'named', label: 'Ali', amount: 1200 }],
};
const MORNING = {
  ...NIGHT,
  closing_id: 'c-morning',
  kind: 'morning',
  seq: 20,
  revision: 1,
  credit_adj: 0,
  debt_e: 3400,
  prev_credit: 3225,
  lines: [{ line_id: 'l2', kind: 'free', label: '', amount: 175 }],
};
const OPENING = {
  ...NIGHT,
  closing_id: 'c-open',
  business_date: '2026-11-07',
  kind: 'evening',
  seq: 9999,
  mode: 'final',
  revision: 1,
  is_opening: true,
  credit_adj: 0,
  lines: [],
  prev_credit: 2000,
  debt_e: 2000,
};

describe('ledger helpers', () => {
  it('says days in plain words', () => {
    expect(daysText(0)).toBe('Today');
    expect(daysText(1)).toBe('1 day');
    expect(daysText(6)).toBe('6 days');
    expect(daysText(null)).toBe('Today');
    expect(daysText(-3)).toBe('Today');
  });
  it('groups newest-first snapshots by date without reordering them', () => {
    const g = groupByDate([MORNING, NIGHT, OPENING]);
    expect(g.map((x) => x.date)).toEqual(['2026-11-08', '2026-11-07']);
    expect(g[0].items.map((s) => s.kind)).toEqual(['morning', 'night']);
    expect(groupByDate(null)).toEqual([]);
  });
  it('titles opening and corrected closings', () => {
    expect(snapshotTitle(NIGHT)).toBe('Night (corrected)');
    expect(snapshotTitle(OPENING)).toBe('Evening (opening)');
    expect(snapshotTitle(MORNING)).toBe('Morning');
    expect(snapshotTitle({ kind: 'handover', seq: 40, revision: 1 })).toBe('Handover 2');
  });
  it('builds the receipt only from stored figures and typed lines', () => {
    const rows = receiptRows(NIGHT);
    const text = rows.map((r) => r.title ?? r.sub ?? (r.rule ? '--' : `${r.left}|${r.right}`));
    expect(text).toEqual([
      'CREDIT LEDGER',
      '08 Nov 2026 · Night (corrected)',
      'Shift closing',
      '--',
      'Carried in|2,000.00',
      'Ali|1,200.00',
      'Adjustment|25.00',
      '--',
      'TOTAL CREDIT|3,225.00',
      '--',
    ]);
  });
  it('leaves out a zero adjustment and names an unlabelled line', () => {
    const lefts = receiptRows(MORNING)
      .filter((r) => r.left)
      .map((r) => r.left);
    expect(lefts).toEqual(['Carried in', 'Credit', 'TOTAL CREDIT']);
  });
  it('shows the stored total even when it is not the sum of the lines (nothing is recomputed)', () => {
    const odd = { ...NIGHT, debt_e: 99 };
    expect(receiptRows(odd).find((r) => r.left === 'TOTAL CREDIT').right).toBe('99.00');
  });
});

const api = {
  creditLedger: vi.fn(async () => [MORNING, NIGHT, OPENING]),
  miscLedger: vi.fn(async () => ({
    as_of: { closing_id: 'c-morning', business_date: '2026-11-08', kind: 'morning', seq: 20 },
    open: [
      { charge_id: 'm1', label: 'Old charge', amount: 700, first_date: '2026-11-02', age_days: 6 },
      { charge_id: 'm2', label: 'Parcel', amount: 40, first_date: '2026-11-08', age_days: 0 },
    ],
    closed: [{ charge_id: 'm3', label: 'Courier', amount: 500, first_date: '2026-11-07', last_date: '2026-11-08', age_days: 1 }],
  })),
  myRecent: vi.fn(async () => []),
};
vi.mock('../../js/modules/closing/data/api.js', () => api);

const tick = () => vi.advanceTimersByTimeAsync(20);
let el;
beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '<div id="page"></div>';
  el = document.getElementById('page');
  Object.values(api).forEach((f) => f.mockClear());
  api.creditLedger.mockImplementation(async () => [MORNING, NIGHT, OPENING]);
  window.print = vi.fn();
});
afterEach(() => vi.useRealTimers());

describe('Credit Ledger page', () => {
  const open = async () => {
    const { mount } = await import('../../js/modules/closing/ui/credit.js');
    await mount(el);
    await tick();
  };
  it('lists a snapshot per closing, grouped by date, with the stored figures', async () => {
    await open();
    expect(el.querySelectorAll('section[data-date]')).toHaveLength(2);
    const night = el.querySelector('[data-closing="c-night"]');
    expect(night.textContent).toContain('Night (corrected)');
    expect(night.textContent).toContain('Carried in');
    expect(night.textContent).toContain('2,000.00');
    expect(night.textContent).toContain('Ali');
    expect(night.textContent).toContain('1,200.00');
    expect(night.textContent).toContain('Adjustment');
    expect(night.textContent).toContain('3,225.00');
    expect(el.querySelector('[data-closing="c-open"]').textContent).toContain('Evening (opening)');
    expect(el.querySelector('[data-closing="c-morning"]').textContent).not.toContain('Adjustment');
  });
  it('asks the database for the chosen date range', async () => {
    await open();
    el.querySelector('#cl-from').value = '2026-11-01';
    el.querySelector('#cl-to').value = '2026-11-08';
    el.querySelector('#cl-show').click();
    await tick();
    expect(api.creditLedger).toHaveBeenLastCalledWith({ from: '2026-11-01', to: '2026-11-08' });
  });
  it('refuses a range that ends before it starts, without asking the database', async () => {
    await open();
    api.creditLedger.mockClear();
    el.querySelector('#cl-from').value = '2026-11-09';
    el.querySelector('#cl-to').value = '2026-11-01';
    el.querySelector('#cl-show').click();
    await tick();
    expect(api.creditLedger).not.toHaveBeenCalled();
    expect(document.getElementById('toasts').textContent).toContain('start date is after the end date');
  });
  it('prints the chosen snapshot as a receipt and tidies up afterwards', async () => {
    await open();
    let during;
    window.print = vi.fn(() => {
      during = { root: document.getElementById('cls-print-root')?.textContent, printing: document.body.classList.contains('cls-printing') };
    });
    el.querySelector('[data-id="c-night"]').click();
    expect(window.print).toHaveBeenCalledTimes(1);
    expect(during.printing).toBe(true);
    expect(during.root).toContain('CREDIT LEDGER');
    expect(during.root).toContain('TOTAL CREDIT');
    expect(during.root).toContain('3,225.00');
    window.dispatchEvent(new Event('afterprint'));
    expect(document.getElementById('cls-print-root')).toBeNull();
    expect(document.body.classList.contains('cls-printing')).toBe(false);
  });
  it('says so when there is nothing in the range', async () => {
    api.creditLedger.mockImplementationOnce(async () => []);
    await open();
    expect(el.textContent).toContain('No submitted closings in this range.');
  });
  it('shows a refusal in plain words', async () => {
    api.creditLedger.mockImplementationOnce(async () => {
      throw Object.assign(new Error('x'), { hint: 'not_allowed' });
    });
    await open();
    expect(el.textContent).toContain('Could not load the Credit Ledger');
    expect(el.textContent).toContain('You are not allowed to do that.');
  });
});

describe('Misc Ledger page', () => {
  const open = async () => {
    const { mount } = await import('../../js/modules/closing/ui/misc.js');
    await mount(el);
    await tick();
  };
  it('shows open charges oldest first with their age, and closed ones apart', async () => {
    await open();
    const rows = [...el.querySelectorAll('#misc-open li')];
    expect(rows.map((r) => r.dataset.charge)).toEqual(['m1', 'm2']);
    expect(rows[0].textContent).toContain('Old charge');
    expect(rows[0].textContent).toContain('Since 02 Nov 2026');
    expect(rows[0].textContent).toContain('6 days');
    expect(rows[0].textContent).toContain('700.00');
    expect(rows[1].textContent).toContain('Today');
    const closed = el.querySelector('#misc-closed li');
    expect(closed.textContent).toContain('Courier');
    expect(closed.textContent).toContain('07 Nov 2026 to 08 Nov 2026');
    expect(closed.textContent).toContain('1 day');
  });
  it('says which closing the ledger stands at', async () => {
    await open();
    expect(el.textContent).toContain('Morning · 08 Nov 2026');
  });
  it('handles a shop with no submitted closing and no charges', async () => {
    api.miscLedger.mockImplementationOnce(async () => ({ as_of: null, open: [], closed: [] }));
    await open();
    expect(el.textContent).toContain('No closing has been submitted yet.');
    expect(el.textContent).toContain('No open charges.');
    expect(el.textContent).toContain('No closed charges yet.');
  });
  it('shows a refusal in plain words', async () => {
    api.miscLedger.mockImplementationOnce(async () => {
      throw Object.assign(new Error('x'), { hint: 'not_allowed' });
    });
    await open();
    expect(el.textContent).toContain('Could not load the Misc Ledger');
  });
});

describe('ledger links on the Closing start page', () => {
  const start = async (perms) => {
    const { mount } = await import('../../js/modules/closing/ui/start.js');
    await mount(el, { ctx: { permissions: perms } });
    await tick();
  };
  it('shows them to someone who may see every closing', async () => {
    await start(['closing.enter_own', 'closing.view_all']);
    expect(el.querySelector('a[href="#/closing/credit"]')).not.toBeNull();
    expect(el.querySelector('a[href="#/closing/misc"]')).not.toBeNull();
  });
  it('hides them from a cashier', async () => {
    await start(['closing.enter_own']);
    expect(el.querySelector('a[href="#/closing/credit"]')).toBeNull();
    expect(el.querySelector('a[href="#/closing/misc"]')).toBeNull();
  });
});

describe('manifest', () => {
  it('registers both ledger routes for people who may see every closing, and not for cashiers', async () => {
    const m = (await import('../../js/modules/closing/manifest.js')).default;
    for (const path of ['/closing/credit', '/closing/misc']) {
      const r = m.routes.find((x) => x.path === path);
      expect(r.anyOf).toEqual(['closing.view_all', 'closing.review', 'closing.correct']);
      expect(r.anyOf).not.toContain('closing.enter_own');
    }
  });
});
