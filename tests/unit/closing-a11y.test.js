// @vitest-environment jsdom
// Accessibility and behaviour regressions found in the closing-module audit.
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const ROW = {
  id: 'c1',
  status: 'draft',
  mode: 'shift',
  is_opening: false,
  draft_version: 1,
  updated_at: '2026-11-10T08:00:00Z',
  closing_slots: { business_date: '2026-11-10', kind: 'night', seq: 10 },
  prev_cc: 1000,
  prev_credit: 2000,
  prev_deposits: 300,
  prev_cash: 4000,
  sys_cash: 150000,
  responsible_staff_id: 'st1',
  source_closing_id: 's0',
  closing_hs_rows: [],
  closing_strip_lines: [],
  closing_mediq_orders: [],
  closing_misc_rows: [{ id: 'm1', charge_id: 'charge-1', label: 'Outstanding', amount: 750, sort: 1 }],
};
const FULL_PREVIEW = {
  net_sale: 100,
  net_cash: 500,
  shift_sale: 1000,
  customers: 7,
  grand: 9000,
  liquid: 8000,
  final_net_sale: 7000,
  final_net_cash: 300,
  shift_variance: 0,
  mediq_extra: 0,
};
const api = {
  listStrips: vi.fn(async () => [{ id: 's1', label: 'Panadol', price: 120 }]),
  staffChoices: vi.fn(async () => [{ id: 'st1', name: 'J One' }]),
  loadByKey: vi.fn(async () => null),
  loadById: vi.fn(async () => ROW),
  refreshDraftCarry: vi.fn(async () => ({ refreshed: true })),
  saveDraft: vi.fn(async () => ({ closing_id: 'c1', version: 2 })),
  computePreview: vi.fn(async () => FULL_PREVIEW),
  myRecent: vi.fn(async () => []),
  savedList: vi.fn(async () => []),
  listCreditAccounts: vi.fn(async () => []),
  readAuditRequired: vi.fn(async () => false),
  readAudit: vi.fn(async () => null),
  prevPage: vi.fn(async () => null),
  ownBook: vi.fn(async () => []),
  periodFor: vi.fn(async () => ({})),
  submit: vi.fn(async () => ({ already: false })),
  closingBook: vi.fn(async () => []),
  reopen: vi.fn(async () => ({})),
  listStripsAll: vi.fn(async () => []),
  listAccountsAll: vi.fn(async () => []),
  listAuditItemsAll: vi.fn(async () => []),
  readClosingSettings: vi.fn(async () => ({ till_float: 1000, per_customer_charge: 5 })),
  saveStrip: vi.fn(async () => ({})),
};
vi.mock('../../js/modules/closing/data/api.js', () => api);

const tick = (ms = 20) => vi.advanceTimersByTimeAsync(ms);
const type = (node, value) => {
  node.value = value;
  node.dispatchEvent(new Event('input', { bubbles: true }));
};
let el;
HTMLDialogElement.prototype.showModal ??= function () {
  this.setAttribute('open', '');
};
HTMLDialogElement.prototype.close ??= function () {
  this.removeAttribute('open');
  this.dispatchEvent(new Event('close'));
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-19T06:00:00Z'));
  document.body.innerHTML = '<div id="page"></div>';
  el = document.getElementById('page');
  sessionStorage.clear();
  localStorage.clear();
  Object.values(api).forEach((f) => f.mockClear());
  api.loadByKey.mockImplementation(async () => ({ ...ROW }));
  api.loadById.mockImplementation(async () => ({ ...ROW }));
  api.saveDraft.mockImplementation(async () => ({ closing_id: 'c1', version: 2 }));
  api.computePreview.mockImplementation(async () => FULL_PREVIEW);
  location.hash = '';
});
afterEach(() => vi.useRealTimers());

const openTarget = () =>
  sessionStorage.setItem('dua.closing.open', JSON.stringify({ key: 'k1', date: '2026-11-10', kind: 'night', mode: 'shift' }));
async function ledger() {
  const { mount } = await import('../../js/modules/closing/ui/ledger.js');
  await mount(el);
  await tick();
}
const jump = (n) => el.querySelector(`[data-jump="${n}"]`).click();
const conflict = () => Object.assign(new Error('x'), { hint: 'draft_conflict', details: 'version=5' });

describe('ledger: figures', () => {
  it('fills BOTH Net Final Sale lines in the Final section (the second one stayed "–")', async () => {
    openTarget();
    await ledger();
    jump(13);
    const both = [...el.querySelectorAll('[data-total="finalNetSale"]')];
    expect(both).toHaveLength(2);
    both.forEach((n) => expect(n.textContent).toBe('7,000.00'));
  });
  it('shows the figures of what was just saved in the review, not of the save before the last typing', async () => {
    openTarget();
    await ledger();
    type(el.querySelector('#f-sys_cash'), '160000');
    jump(13);
    el.querySelector('[data-act="submit"]').click();
    await tick(500);
    expect(api.saveDraft.mock.calls.at(-1)[0].payload.sys_cash).toBe(160000);
    expect(document.querySelector('dialog h2')?.textContent).toBe('Review closing');
  });
  it('does not let two saves of the same draft stack conflict dialogs, and can keep what was typed', async () => {
    openTarget();
    await ledger();
    api.saveDraft.mockImplementation(async () => {
      throw conflict();
    });
    type(el.querySelector('#f-sys_cash'), '111');
    await tick(3000);
    type(el.querySelector('#f-sys_cash'), '112');
    await tick(3000);
    expect(document.querySelectorAll('dialog[open]')).toHaveLength(1);
    expect(el.querySelector('#cls-chip').textContent).toContain('Changed elsewhere');
    api.saveDraft.mockImplementation(async () => ({ closing_id: 'c1', version: 6 }));
    document.querySelector('dialog [data-act="keep"]').click();
    await tick(200);
    expect(api.saveDraft.mock.calls.at(-1)[0].payload.sys_cash).toBe(112);
    expect(el.querySelector('#f-sys_cash').value).toBe('112');
  });
});

describe('ledger: keyboard and screen reader', () => {
  it('the save chip is a button, working only when there is something to retry', async () => {
    openTarget();
    await ledger();
    const chip = el.querySelector('#cls-chip');
    expect(chip.tagName).toBe('BUTTON');
    expect(chip.disabled).toBe(true); // "Saved"
    api.saveDraft.mockImplementationOnce(async () => {
      throw new Error('boom');
    });
    type(el.querySelector('#f-sys_cash'), '5');
    expect(el.querySelector('#cls-chip').disabled).toBe(false); // "Not saved yet"
    await tick(3000);
    expect(el.querySelector('#cls-chip').textContent).toContain('Failed');
    api.saveDraft.mockClear();
    el.querySelector('#cls-chip').click();
    await tick();
    expect(api.saveDraft).toHaveBeenCalledTimes(1);
  });
  it('moves focus to the new row when a row is added (it used to land on the first row)', async () => {
    openTarget();
    await ledger();
    jump(6);
    el.querySelector('[data-act="add"][data-list="misc"]').click();
    const active = document.activeElement;
    expect(active.dataset.list).toBe('misc');
    expect(active.dataset.id).not.toBe('m1');
    expect(active.dataset.k).toBe('label');
  });
  it('keeps focus on the same button after striking a row out, and gives each row its own name', async () => {
    openTarget();
    await ledger();
    jump(6);
    el.querySelector('[data-act="add"][data-list="misc"]').click();
    const names = [...el.querySelectorAll('[data-list="misc"][data-k="amount"]')].map((i) => i.getAttribute('aria-label'));
    expect(names).toEqual(['Amount, row 1', 'Amount, row 2']);
    const btn = el.querySelector('[data-act="strike"][data-id="m1"]');
    expect(btn.getAttribute('aria-label')).toBe('Strike out row 1');
    btn.focus();
    btn.click();
    expect(document.activeElement.dataset.act).toBe('strike');
    expect(document.activeElement.dataset.id).toBe('m1');
    expect(document.activeElement.getAttribute('aria-label')).toBe('Restore row 1');
  });
  it('moves focus to the new section heading when the section changes', async () => {
    openTarget();
    await ledger();
    el.querySelector('[data-act="next"]').click();
    expect(document.activeElement.tagName).toBe('H2');
    expect(document.activeElement.textContent).toContain('MEDIQ');
  });
  it('labels the carried (read-only) figures', async () => {
    openTarget();
    await ledger();
    jump(2);
    const box = el.querySelector('#carried-card-balance');
    expect(box.readOnly).toBe(true);
    expect(el.querySelector('label[for="carried-card-balance"]').textContent).toBe('Card balance');
  });
  it('names the fields to fix in words, not only with a red border', async () => {
    openTarget();
    await ledger();
    type(el.querySelector('#f-sys_cash'), 'abc');
    await tick(3000);
    const msg = el.querySelector('#cls-errors');
    expect(msg.textContent).toContain('System Cash Sales Total');
    expect(el.querySelector('#f-sys_cash').getAttribute('aria-invalid')).toBe('true');
    type(el.querySelector('#f-sys_cash'), '5');
    await tick(3000);
    expect(el.querySelector('#cls-errors').textContent).toBe('');
  });
  it('sign buttons say what they change and whether it is on', async () => {
    openTarget();
    await ledger();
    jump(10);
    const b = el.querySelector('[data-act="sign"]');
    expect(b.getAttribute('aria-label')).toContain('Credit Adjustment');
    expect(b.getAttribute('aria-pressed')).toBe('false');
    expect(b.hasAttribute('data-f')).toBe(false);
  });
});

describe('start page', () => {
  const start = async () => {
    api.myRecent.mockImplementation(async () => [
      { closing_id: 'x1', key: 'k9', business_date: '2026-11-18', kind: 'night', seq: 10, status: 'submitted', mode: 'shift', revision: 0 },
      { closing_id: 'x2', key: 'kd', business_date: '2026-11-19', kind: 'morning', seq: 20, status: 'draft', mode: 'shift' },
    ]);
    const { mount } = await import('../../js/modules/closing/ui/start.js');
    await mount(el, { ctx: { permissions: ['closing.enter_own'] } });
    await tick();
  };
  it('describes each day (saved closings, drafts, today) and has a page heading', async () => {
    await start();
    expect(el.querySelector('h1').textContent).toBe('Closing');
    expect(el.querySelector('[data-day="2026-11-18"]').getAttribute('aria-label')).toContain('saved: Night');
    const today = el.querySelector('[data-day="2026-11-19"]');
    expect(today.getAttribute('aria-label')).toContain('draft in progress');
    expect(today.getAttribute('aria-current')).toBe('date');
  });
  it('cannot page into months that have no selectable day', async () => {
    await start();
    expect(el.querySelector('[data-act="next-month"]').disabled).toBe(true);
    el.querySelector('[data-act="prev-month"]').click();
    expect(el.querySelector('[data-act="next-month"]').disabled).toBe(false);
  });
  it('keeps keyboard focus on the day that was chosen', async () => {
    await start();
    const day = el.querySelector('[data-day="2026-11-17"]');
    day.focus();
    day.click();
    expect(document.activeElement.dataset.day).toBe('2026-11-17');
    expect(document.activeElement.getAttribute('aria-pressed')).toBe('true');
  });
  it('tells which closing a Continue / Open / PDF button belongs to', async () => {
    await start();
    expect(el.querySelector('[data-act="continue"]').getAttribute('aria-label')).toContain('Morning closing');
    expect(el.querySelector('[data-act="view"]').getAttribute('aria-label')).toContain('Night closing');
    expect(el.querySelector('[data-act="pdf"]').getAttribute('aria-label')).toContain('PDF of');
  });
});

describe('settings and review: one tap, one action', () => {
  const settings = async () => {
    const { mount } = await import('../../js/modules/closing/ui/settings.js');
    await mount(el);
    await tick();
  };
  it('a double tap on Save adds the strip once', async () => {
    await settings();
    el.querySelector('#add-strip').click();
    type(document.querySelector('#f-label'), 'Disprin');
    type(document.querySelector('#f-price'), '12');
    api.saveStrip.mockImplementationOnce(() => new Promise((r) => setTimeout(r, 50)));
    const save = document.querySelector('#f-save');
    save.click();
    save.click();
    await tick(200);
    expect(api.saveStrip).toHaveBeenCalledTimes(1);
  });
  it('does not save a strip with no price as free', async () => {
    await settings();
    el.querySelector('#add-strip').click();
    type(document.querySelector('#f-label'), 'Disprin');
    document.querySelector('#f-save').click();
    await tick();
    expect(api.saveStrip).not.toHaveBeenCalled();
    expect(document.getElementById('toasts').textContent).toContain('price');
  });
  it('a double tap on Reopen reopens once', async () => {
    api.closingBook.mockImplementation(async () => [
      { closing_id: 'r1', business_date: '2026-11-10', kind: 'night', seq: 10, mode: 'shift', revision: 0, results: {}, staff: 'A' },
    ]);
    const { mount } = await import('../../js/modules/closing/ui/review.js');
    await mount(el, { ctx: { permissions: ['closing.correct'] } });
    el.querySelector('[data-act="reopen"]').click();
    type(document.querySelector('#ro-reason'), 'typo in cash');
    api.reopen.mockImplementationOnce(() => new Promise((r) => setTimeout(r, 50)));
    const go = document.querySelector('#ro-go');
    go.click();
    go.click();
    await tick(200);
    expect(api.reopen).toHaveBeenCalledTimes(1);
  });
});
