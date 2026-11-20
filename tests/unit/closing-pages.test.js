// @vitest-environment jsdom
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
  last_bill_no: 2481013,
  comp_sale: 200000,
  alfalah: 220000,
  keenu: 30000,
  source_closing_id: 's0',
  closing_hs_rows: [],
  closing_strip_lines: [],
  closing_mediq_orders: [],
  closing_misc_rows: [{ id: 'm1', charge_id: 'charge-1', label: 'Outstanding', amount: 750, sort: 1 }],
};
const api = {
  listStrips: vi.fn(async () => [{ id: 's1', label: 'Panadol', price: 120 }]),
  staffChoices: vi.fn(async () => [{ id: 'st1', name: 'J One' }]),
  loadByKey: vi.fn(async () => null),
  loadById: vi.fn(async () => ROW),
  refreshDraftCarry: vi.fn(async () => ({ refreshed: true })),
  saveDraft: vi.fn(async () => ({ closing_id: 'c1', version: 2 })),
  patchDraft: vi.fn(async () => ({ closing_id: 'c1', version: 1, updated_at: '2026-11-10T08:05:00Z' })),
  loadSync: vi.fn(async () => null),
  watchDraft: vi.fn(() => () => {}),
  computePreview: vi.fn(async () => ({ net_sale: 1234, shift_sale: 1000, customers: 7 })),
  myRecent: vi.fn(async () => []),
  savedList: vi.fn(async () => []),
  startOpening: vi.fn(async () => ({ closing_id: 'o1' })),
  listCreditAccounts: vi.fn(async () => [
    { id: 'a1', kind: 'named', label: 'Ali Traders' },
    { id: 't1', kind: 'tier_name', tier_no: 1, label: 'Staff' },
  ]),
  readAuditRequired: vi.fn(async () => true),
  readAudit: vi.fn(async () => ({
    verified_at: '2026-11-10T10:00:00Z',
    data_as_of: '2026-11-10T09:00:00Z',
    codes_checked: 3,
    not_found: [],
    items: [],
  })),
  prevPage: vi.fn(async () => null),
  ownBook: vi.fn(async () => []),
  setAuditRequired: vi.fn(async () => ({})),
  periodFor: vi.fn(async () => ({})),
  submit: vi.fn(async () => ({ already: false })),
};
vi.mock('../../js/modules/closing/data/api.js', () => api);

const tick = () => vi.advanceTimersByTimeAsync(20);
const type = (el, value) => {
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
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
  document.body.innerHTML = '<div id="page"></div>';
  el = document.getElementById('page');
  sessionStorage.clear();
  localStorage.clear();
  Object.values(api).forEach((f) => f.mockClear());
  api.loadByKey.mockImplementation(async () => null);
  api.refreshDraftCarry.mockImplementation(async () => ({ refreshed: true }));
  api.saveDraft.mockImplementation(async () => ({ closing_id: 'c1', version: 2 }));
  location.hash = '';
});
afterEach(() => vi.useRealTimers());

const openTarget = (t = {}) =>
  sessionStorage.setItem('dua.closing.open', JSON.stringify({ key: 'k1', date: '2026-11-10', kind: 'night', mode: 'shift', ...t }));
async function ledger() {
  const { mount } = await import('../../js/modules/closing/ui/ledger.js');
  await mount(el);
  await tick();
}

describe('Closing start page', () => {
  const start = async (perms = ['closing.enter_own']) => {
    const { mount } = await import('../../js/modules/closing/ui/start.js');
    await mount(el, { ctx: { permissions: perms } });
    await tick();
  };
  it("shows other people's saved closings to staff, with Open and PDF", async () => {
    api.savedList.mockImplementationOnce(async () => [
      {
        closing_id: 'c-other',
        business_date: '2026-11-08',
        kind: 'morning',
        seq: 20,
        mode: 'shift',
        status: 'submitted',
        is_opening: false,
      },
    ]);
    await start(['closing.enter_own']);
    expect(el.querySelector('[data-act="view"][data-id="c-other"]')).not.toBeNull();
    expect(el.querySelector('[data-act="pdf"][data-id="c-other"]')).not.toBeNull();
  });
  it('lists drafts to continue and hands the chosen one to the ledger', async () => {
    api.myRecent.mockImplementationOnce(async () => [
      { key: 'kd', business_date: '2026-11-09', kind: 'evening', seq: 9999, mode: 'shift', status: 'draft', is_opening: false },
      { key: 'ks', business_date: '2026-11-08', kind: 'morning', seq: 20, mode: 'shift', status: 'submitted' },
    ]);
    await start();
    el.querySelector('[data-act="continue"]').click();
    expect(JSON.parse(sessionStorage.getItem('dua.closing.open'))).toMatchObject({ key: 'kd', date: '2026-11-09', kind: 'evening' });
    expect(location.hash).toBe('#/closing/ledger');
  });
  it('keeps Credit and Misc ledgers off the ordinary staff closing home', async () => {
    await start(['closing.enter_own']);
    expect(el.textContent).not.toContain('Credit Ledger');
    expect(el.textContent).not.toContain('Misc Ledger');
    await start(['closing.enter_own', 'closing.view_all']);
    expect(el.textContent).toContain('Credit Ledger');
  });
  it('shows the opening card only to someone who may change closing settings', async () => {
    await start();
    expect(el.querySelector('#cls-open')).toBeNull();
    await start(['closing.enter_own', 'closing.settings']);
    expect(el.querySelector('#cls-open')).not.toBeNull();
  });
  it('shows the database refusal in plain words and stays on the page', async () => {
    api.startOpening.mockImplementationOnce(async () => {
      throw Object.assign(new Error('x'), { hint: 'opening_exists' });
    });
    await start(['closing.settings']);
    el.querySelector('#cls-open').click();
    await tick();
    expect(document.body.textContent).toContain('An opening closing already exists.');
    expect(location.hash).toBe('');
  });
});

describe('Closing ledger', () => {
  it('says so when nothing is open', async () => {
    await ledger();
    expect(el.textContent).toContain('No closing is open');
  });
  it('creates a new draft at once with an empty payload and no expected version', async () => {
    openTarget();
    await ledger();
    expect(api.saveDraft).toHaveBeenCalledTimes(1);
    expect(api.saveDraft.mock.calls[0][0]).toMatchObject({ key: 'k1', kind: 'night', payload: {}, expectedVersion: null });
    expect(el.querySelector('#f-sys_cash')).not.toBeNull();
    expect(el.textContent).toContain('Saved');
  });
  it('refreshes carry-forward from the latest submitted closing before hydrating an existing draft', async () => {
    openTarget();
    api.loadByKey.mockImplementationOnce(async () => ({ ...ROW, prev_cc: 100, prev_credit: 200, source_closing_id: 'old-source' }));
    api.loadById.mockImplementationOnce(async () => ({
      ...ROW,
      prev_cc: 9000,
      prev_credit: 8000,
      prev_deposits: 7000,
      prev_cash: 6000,
      source_closing_id: 'new-source',
      closing_misc_rows: [...ROW.closing_misc_rows, { id: 'm2', charge_id: 'charge-2', label: 'New outstanding', amount: 1250, sort: 2 }],
    }));
    api.prevPage.mockImplementationOnce(async () => ({
      business_date: '2026-11-10',
      mode: 'shift',
      inputs: { sys_cash: 100000, last_bill_no: 2481000 },
      results: {},
      hs: [],
      strips: [],
      cash: [],
      credit: [],
      deposits: [],
      mediq: [],
      misc: [],
    }));
    await ledger();
    expect(api.refreshDraftCarry).toHaveBeenCalledWith('c1');
    expect(api.loadById).toHaveBeenCalledWith('c1');
    el.querySelector('[data-jump="2"]').click();
    const carried = [...el.querySelectorAll('.is-carried')].map((i) => i.value);
    expect(carried).toEqual(['9,000', '8,000', '7,000', '6,000']);
    el.querySelector('[data-jump="6"]').click();
    const labels = [...el.querySelectorAll('[data-list="misc"][data-k="label"]')].map((i) => i.value);
    expect(labels).toContain('New outstanding');
  });
  it('does not silently open a draft when carry-forward refresh fails', async () => {
    openTarget();
    api.loadByKey.mockImplementationOnce(async () => ({ ...ROW }));
    api.refreshDraftCarry.mockImplementationOnce(async () => {
      throw new Error('carry refresh failed');
    });
    await ledger();
    expect(el.textContent).toContain('Could not load this draft');
    expect(el.textContent).toContain('Something went wrong');
    expect(el.querySelector('#f-sys_cash')).toBeNull();
  });
  it('restores carried miscellaneous charges when a draft is reopened', async () => {
    openTarget();
    api.loadByKey.mockImplementationOnce(async () => ({ ...ROW }));
    await ledger();
    el.querySelector('[data-jump="6"]').click();
    expect(el.querySelector('[data-list="misc"][data-k="label"]').value).toBe('Outstanding');
    expect(el.querySelector('[data-list="misc"][data-k="amount"]').value).toBe('750');
  });
  it('reopens a draft with its Till Cash, Draw Cash, deposits and credit still filled in', async () => {
    openTarget();
    api.loadByKey.mockImplementationOnce(async () => ({ ...ROW }));
    api.loadById.mockImplementationOnce(async () => ({
      ...ROW,
      closing_cash_counts: [
        { area: 'till', denomination: 5000, qty: 12 },
        { area: 'till', denomination: 100, qty: 7 },
        { area: 'vault', denomination: 1000, qty: 30 },
      ],
      closing_deposits: [{ id: 'd1', label: 'HBL', amount: 50000, sort: 1 }],
      closing_credit_lines: [{ id: 'l1', line_id: 'x1', kind: 'free', label: 'Aux', amount: 900, sort: 1 }],
    }));
    await ledger();
    el.querySelector('[data-jump="8"]').click();
    expect(el.querySelector('[data-f="till.0"]').value).toBe('12');
    expect(el.querySelector('[data-f="till.3"]').value).toBe('7');
    expect(el.querySelector('[data-total="till"]').textContent).toContain('60,700');
    el.querySelector('[data-jump="9"]').click();
    expect(el.querySelector('[data-f="vault.1"]').value).toBe('30');
    el.querySelector('[data-jump="11"]').click();
    expect(el.querySelector('[data-list="deposits"][data-k="amount"]').value).toBe('50000');
  });
  it('does not wipe the saved cash counts when the next autosave runs after a reopen', async () => {
    openTarget();
    api.loadByKey.mockImplementationOnce(async () => ({ ...ROW }));
    api.loadById.mockImplementationOnce(async () => ({
      ...ROW,
      closing_cash_counts: [{ area: 'till', denomination: 5000, qty: 12 }],
    }));
    await ledger();
    api.saveDraft.mockClear();
    // a single box is saved on its own: the cash counts are not part of that save at all
    type(el.querySelector('#f-sys_cash'), '151000');
    await vi.advanceTimersByTimeAsync(1000);
    expect(api.patchDraft).toHaveBeenCalledTimes(1);
    expect(api.saveDraft).not.toHaveBeenCalled();
    // and a list save that follows still carries the saved counts
    el.querySelector('[data-jump="3"]').click();
    el.querySelector('[data-act="add"][data-list="hs"]').click();
    type(el.querySelector('[data-list="hs"][data-k="amount"]'), '50');
    await vi.advanceTimersByTimeAsync(3000);
    const sent = api.saveDraft.mock.calls.at(-1)[0].payload;
    expect(sent.till[0]).toBe(12);
    expect(sent).not.toHaveProperty('sys_cash'); // the single boxes travel on their own
  });
  it('shows the calculated deltas in the override boxes and the previous closing card', async () => {
    openTarget();
    api.loadByKey.mockImplementationOnce(async () => ({ ...ROW }));
    api.prevPage.mockImplementationOnce(async () => ({
      business_date: '2026-11-10',
      day_no: 1,
      kind: 'night',
      seq: 10,
      mode: 'shift',
      inputs: { sys_cash: 100000, last_bill_no: 2481000 },
      results: {},
      hs: [],
      strips: [],
      cash: [],
      credit: [],
      deposits: [],
      mediq: [],
      misc: [],
    }));
    await ledger();
    el.querySelector('[data-jump="2"]').click();
    expect(el.querySelector('[data-f="overrides.shift_sale"]').getAttribute('placeholder')).toBe('50,000.00');
    expect(el.querySelector('[data-f="overrides.customers"]').getAttribute('placeholder')).toBe('13');
    expect(el.querySelector('.cls-prev').textContent).toContain('Previous shift');
  });
  it('does not show a whole-POS figure as the shift sale when the previous closing could not be read', async () => {
    openTarget();
    api.loadByKey.mockImplementationOnce(async () => ({ ...ROW }));
    api.prevPage.mockImplementationOnce(async () => {
      throw Object.assign(new Error('x'), { code: '42501', hint: 'not_allowed' });
    });
    api.computePreview.mockImplementationOnce(async () => ({ net_sale: 1, shift_sale: 50000, customers: 13 }));
    await ledger();
    el.querySelector('[data-jump="2"]').click();
    // the server's own figure (it still reads the previous closing) is shown, never the raw POS total 150,000
    expect(el.querySelector('[data-total="shiftInfo"]').textContent).toContain('50,000');
    expect(el.querySelector('[data-total="shiftInfo"]').textContent).not.toContain('150,000');
    expect(el.querySelector('.cls-prev').textContent).toContain('could not be loaded');
  });
  it('shows live shift-sale, customer and card-sale deltas from the previous closing', async () => {
    openTarget();
    api.loadByKey.mockImplementationOnce(async () => ({ ...ROW }));
    api.prevPage.mockImplementationOnce(async () => ({
      business_date: '2026-11-10',
      day_no: 1,
      kind: 'night',
      seq: 10,
      mode: 'shift',
      inputs: { sys_cash: 100000, last_bill_no: 2481000 },
      results: { shift_sale: 100000, customers: 10, net_sale: 100000 },
      hs: [],
      strips: [],
      cash: [],
      credit: [],
      deposits: [],
      mediq: [],
      misc: [],
    }));
    await ledger();
    el.querySelector('[data-jump="2"]').click();
    expect(el.querySelector('[data-total="shiftInfo"]').textContent).toContain('50,000');
    expect(el.querySelector('[data-total="shiftInfo"]').textContent).toContain('13');
    el.querySelector('[data-jump="7"]').click();
    expect(el.querySelector('[data-total="currCC"]').textContent).toContain('50,000');
  });
  it('shows the previous closing preview immediately below the current section', async () => {
    openTarget();
    api.loadByKey.mockImplementationOnce(async () => ({ ...ROW }));
    api.prevPage.mockImplementationOnce(async () => ({
      business_date: '2026-11-09',
      day_no: 2,
      kind: 'evening',
      seq: 9999,
      mode: 'shift',
      inputs: { sys_cash: 100000, last_bill_no: 2481000 },
      results: { shift_sale: 5000, customers: 13, net_sale: 6000 },
      hs: [],
      strips: [],
      cash: [],
      credit: [],
      deposits: [],
      mediq: [],
      misc: [],
    }));
    await ledger();
    expect(el.querySelector('.cls-prev')).not.toBeNull();
    expect(el.querySelector('.cls-prev').textContent).toContain('Previous shift');
  });
  it('shows a refused start in plain words', async () => {
    openTarget();
    api.saveDraft.mockImplementationOnce(async () => {
      throw Object.assign(new Error('x'), { hint: 'previous_slot_open' });
    });
    await ledger();
    expect(el.textContent).toContain('The slot before this one has not been submitted yet');
  });
  it('keeps typing locally at once and saves the single box on its own after a short pause, with no version check', async () => {
    openTarget();
    await ledger();
    api.saveDraft.mockClear();
    api.patchDraft.mockClear();
    type(el.querySelector('#f-sys_cash'), '150,000');
    expect(JSON.parse(localStorage.getItem('dua.closing.draft.k1')).dirty).toBe(true);
    expect(api.patchDraft).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(api.patchDraft).toHaveBeenCalledTimes(1);
    expect(api.patchDraft.mock.calls[0][0]).toEqual({ key: 'k1', fields: { sys_cash: 150000 } });
    expect(api.saveDraft).not.toHaveBeenCalled();
    expect(localStorage.getItem('dua.closing.draft.k1')).toBeNull(); // saved, so the local copy is dropped
    expect(el.querySelector('#cls-chip').textContent).toContain('Saved');
  });
  it('saves a changed override on its own: only that override is sent', async () => {
    openTarget();
    await ledger();
    api.patchDraft.mockClear();
    el.querySelector('[data-jump="2"]').click();
    type(el.querySelector('[data-f="overrides.customers"]'), '12');
    await vi.advanceTimersByTimeAsync(1000);
    expect(api.patchDraft.mock.calls[0][0].fields).toEqual({ overrides: { customers: 12 } });
  });
  it('saves list sections whole after the usual pause, with the version it last saw, and leaves the single boxes out', async () => {
    openTarget();
    await ledger();
    api.saveDraft.mockClear();
    api.patchDraft.mockClear();
    el.querySelector('[data-jump="3"]').click();
    el.querySelector('[data-act="add"][data-list="hs"]').click();
    type(el.querySelector('[data-list="hs"][data-k="amount"]'), '1000');
    await vi.advanceTimersByTimeAsync(1000);
    expect(api.saveDraft).not.toHaveBeenCalled(); // lists keep the longer pause
    await vi.advanceTimersByTimeAsync(2000);
    expect(api.saveDraft).toHaveBeenCalledTimes(1);
    const call = api.saveDraft.mock.calls[0][0];
    expect(call.expectedVersion).toBe(1); // the version adopted from the created draft
    expect(call.payload.hs).toEqual([{ label: '', amount: 1000, deleted: false }]);
    for (const k of ['sys_cash', 'alfalah', 'overrides', 'responsible_staff_id']) expect(call.payload).not.toHaveProperty(k);
    expect(api.patchDraft).not.toHaveBeenCalled();
    expect(el.querySelector('#cls-chip').textContent).toContain('Saved');
  });
  it('does not send a typo: it marks the field and says what to do', async () => {
    openTarget();
    await ledger();
    api.saveDraft.mockClear();
    api.patchDraft.mockClear();
    type(el.querySelector('#f-sys_cash'), '12O00');
    await vi.advanceTimersByTimeAsync(2600);
    expect(api.saveDraft).not.toHaveBeenCalled();
    expect(api.patchDraft).not.toHaveBeenCalled();
    expect(el.querySelector('#f-sys_cash').getAttribute('aria-invalid')).toBe('true');
    expect(el.querySelector('#cls-chip').textContent).toContain('Fix the marked fields');
  });
  it('keeps the draft and says Offline when the connection drops, then saves again from the chip', async () => {
    openTarget();
    await ledger();
    api.patchDraft.mockImplementationOnce(async () => {
      throw new TypeError('Failed to fetch');
    });
    type(el.querySelector('#f-sys_cash'), '5');
    await vi.advanceTimersByTimeAsync(2600);
    expect(el.querySelector('#cls-chip').textContent).toContain('Offline, draft kept');
    expect(localStorage.getItem('dua.closing.draft.k1')).not.toBeNull();
    el.querySelector('#cls-chip').click();
    await tick();
    expect(el.querySelector('#cls-chip').textContent).toContain('Saved');
  });
  it('on a conflict keeps a copy of the typing and offers to reload the latest draft', async () => {
    openTarget();
    await ledger();
    api.saveDraft.mockImplementationOnce(async () => {
      throw Object.assign(new Error('x'), { hint: 'draft_conflict', details: 'version=7' });
    });
    el.querySelector('[data-jump="3"]').click();
    el.querySelector('[data-act="add"][data-list="hs"]').click();
    type(el.querySelector('[data-list="hs"][data-k="amount"]'), '99');
    await vi.advanceTimersByTimeAsync(2600);
    expect(document.querySelector('dialog')?.textContent).toContain('changed on another device');
    expect(localStorage.getItem('dua.closing.draft.k1.mine')).not.toBeNull();
  });
  it('moves between sections and shows the quick totals', async () => {
    openTarget();
    await ledger();
    el.querySelector('[data-jump="3"]').click();
    el.querySelector('[data-act="add"][data-list="hs"]').click();
    const rows = el.querySelectorAll('[data-list="hs"][data-k="amount"]');
    type(rows[0], '1000.10');
    expect(el.querySelector('[data-total="hs"]').textContent).toBe('1,000.10');
    el.querySelector('[data-jump="4"]').click();
    type(el.querySelector('[data-list="strips"][data-k="qty"]'), '3');
    expect(el.querySelector('[data-total="strips"]').textContent).toBe('360.00');
  });
  it('marks the section you are on in the jump bar', async () => {
    openTarget();
    await ledger();
    expect(el.querySelector('[data-jump="0"]').getAttribute('aria-current')).toBe('step');
    el.querySelector('[data-jump="2"]').click();
    expect(el.querySelector('[data-jump="2"]').getAttribute('aria-current')).toBe('step');
    expect(el.querySelector('[data-jump="0"]').getAttribute('aria-current')).toBe('false');
  });
  it('shows the late sections and keeps Submit for the last one', async () => {
    openTarget();
    await ledger();
    expect(el.querySelector('[data-act="submit"]')).toBeNull();
    el.querySelector('[data-jump="8"]').click();
    expect(el.querySelectorAll('[data-f^="till."]')).toHaveLength(8);
    type(el.querySelector('[data-f="till.0"]'), '2');
    expect(el.querySelector('[data-total="till"]').textContent).toBe('10,000.00');
    el.querySelector('[data-jump="10"]').click();
    expect(el.textContent).toContain('Ali Traders');
    expect(el.querySelectorAll('select[data-list="credit.tier"]')).toHaveLength(1); // only slot 1 has configured names
    expect(el.querySelectorAll('input[data-list="credit.tier"][data-k="label"]')).toHaveLength(2);
    el.querySelector('[data-act="add"][data-list="credit.free"]').click();
    expect(el.querySelectorAll('input[data-list="credit.free"][data-k="label"]').length).toBe(1);
    el.querySelector('[data-jump="13"]').click();
    expect(el.querySelector('[data-act="submit"]')).not.toBeNull();
  });
  it('refuses to submit without a responsible person, then submits and shows the success screen', async () => {
    openTarget();
    await ledger();
    el.querySelector('[data-jump="13"]').click();
    el.querySelector('[data-act="submit"]').click();
    expect(api.submit).not.toHaveBeenCalled();
    el.querySelector('#cls-staff').value = 'st1';
    el.querySelector('#cls-staff').dispatchEvent(new Event('change', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(3000);
    el.querySelector('[data-act="submit"]').click();
    document.querySelector('dialog [data-act="go"]').click();
    await vi.advanceTimersByTimeAsync(300);
    expect(api.submit).toHaveBeenCalledWith('k1');
    expect(el.textContent).toContain('Closing submitted');
  });
  it('sends you to the Inventory Audit instead of the review when the audit is required and not verified', async () => {
    api.readAudit.mockImplementationOnce(async () => null);
    openTarget();
    await ledger();
    el.querySelector('#cls-staff').value = 'st1';
    el.querySelector('#cls-staff').dispatchEvent(new Event('change', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(3000);
    el.querySelector('[data-jump="13"]').click();
    el.querySelector('[data-act="submit"]').click();
    expect(document.querySelector('dialog')).toBeNull();
    expect(el.querySelector('[data-jump="5"]').getAttribute('aria-current')).toBe('step');
    expect(api.submit).not.toHaveBeenCalled();
  });
  it('maps a refusal to plain words and stays on the ledger', async () => {
    openTarget();
    await ledger();
    el.querySelector('#cls-staff').value = 'st1';
    el.querySelector('#cls-staff').dispatchEvent(new Event('change', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(3000);
    api.submit.mockImplementationOnce(async () => {
      throw Object.assign(new Error('x'), { hint: 'audit_not_verified' });
    });
    el.querySelector('[data-jump="13"]').click();
    el.querySelector('[data-act="submit"]').click();
    document.querySelector('dialog [data-act="go"]').click();
    await vi.advanceTimersByTimeAsync(300);
    expect(el.textContent).not.toContain('Closing submitted');
    expect(document.getElementById('toasts').textContent.length).toBeGreaterThan(5);
  });

  it('swipes between sections from anywhere on the cards, with an ordinary swipe', async () => {
    openTarget();
    await ledger();
    const touch = (target, type, x, y) => {
      const event = new Event(type, { bubbles: true });
      Object.defineProperty(event, type === 'touchstart' ? 'touches' : 'changedTouches', {
        value: [{ clientX: x, clientY: y }],
      });
      target.dispatchEvent(event);
    };
    const swipe = (target, x1, y1, x2, y2) => {
      touch(target, 'touchstart', x1, y1);
      touch(target, 'touchend', x2, y2);
    };
    const current = () => el.querySelector('[aria-current="step"][data-jump]').dataset.jump;

    swipe(el.querySelector('.cls-sec'), 180, 100, 100, 105);
    expect(current()).toBe('1');
    swipe(el.querySelector('.cls-sec'), 100, 100, 180, 105);
    expect(current()).toBe('0');

    // an ordinary, slightly slanted swipe still counts (45 px across, 30 px down)
    swipe(el.querySelector('.cls-sec'), 150, 100, 105, 130);
    expect(current()).toBe('1');
    swipe(el.querySelector('.cls-sec'), 100, 100, 145, 130);
    expect(current()).toBe('0');

    // starting on a field, a row label or the staff card works too
    swipe(el.querySelector('#f-sys_cash'), 180, 100, 100, 105);
    expect(current()).toBe('1');
    swipe(el.querySelector('.cls-sec h2'), 100, 100, 180, 105);
    expect(current()).toBe('0');
    swipe(el.querySelector('#cls-staff'), 180, 100, 100, 105);
    expect(current()).toBe('1');
    swipe(el.querySelector('.cls-prev'), 100, 100, 180, 105);
    expect(current()).toBe('0');

    // a vertical scroll, a tiny move, and a swipe on the jump chips do nothing
    swipe(el.querySelector('.cls-sec'), 180, 100, 100, 170);
    swipe(el.querySelector('.cls-sec'), 180, 100, 160, 100);
    swipe(el.querySelector('.cls-jump'), 180, 100, 100, 105);
    expect(current()).toBe('0');
  });

  it('opens on the cards, not the top of the page, and returns there on each section change', async () => {
    const original = Element.prototype.scrollIntoView;
    const spy = vi.fn();
    Element.prototype.scrollIntoView = spy;
    const raf = window.requestAnimationFrame;
    window.requestAnimationFrame = (fn) => fn();
    try {
      openTarget();
      await ledger();
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.instances[0].classList.contains('cls-anchor')).toBe(true);
      el.querySelector('[data-act="next"]').click();
      expect(spy).toHaveBeenCalledTimes(2);
      // tapping a jump chip keeps the position, as before
      el.querySelector('[data-jump="3"]').click();
      expect(spy).toHaveBeenCalledTimes(2);
    } finally {
      Element.prototype.scrollIntoView = original;
      window.requestAnimationFrame = raf;
    }
  });

  it('shows the opening figures only on the opening closing', async () => {
    openTarget({ opening: true, mode: 'final' });
    api.loadById.mockImplementationOnce(async () => ({
      ...ROW,
      is_opening: true,
      mode: 'final',
      prev_cc: 0,
      prev_credit: 0,
      prev_deposits: 0,
      prev_cash: 0,
    }));
    await ledger();
    expect(el.querySelector('#f-opening\\.cash')).not.toBeNull();
    api.saveDraft.mockClear();
    type(el.querySelector('#f-opening\\.cash'), '4200');
    await vi.advanceTimersByTimeAsync(2600);
    expect(api.saveDraft.mock.calls[0][0].payload.opening).toEqual({ cc: 0, credit: 0, deposits: 0, cash: 4200 });
  });
});
