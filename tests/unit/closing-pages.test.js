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
  const rec = (o) => ({
    business_date: '2026-11-08',
    kind: 'evening',
    seq: 9999,
    mode: 'shift',
    status: 'submitted',
    is_opening: false,
    ...o,
  });
  it('hides the opening card once an opening closing exists', async () => {
    api.myRecent.mockImplementationOnce(async () => [rec({ closing_id: 'o', is_opening: true, mode: 'final', kind: 'night', seq: 10 })]);
    await start(['closing.enter_own', 'closing.settings']);
    expect(el.querySelector('#cls-open')).toBeNull();
    expect(el.textContent).not.toContain('Opening closing');
  });
  it('hides the opening card as soon as any closing has been saved', async () => {
    api.savedList.mockImplementationOnce(async () => [rec({ closing_id: 'c1' })]);
    await start(['closing.enter_own', 'closing.settings']);
    expect(el.querySelector('#cls-open')).toBeNull();
  });
  it('shows only the draft to continue for the chosen day, with no start form and no saved closings', async () => {
    api.myRecent.mockImplementationOnce(async () => [
      rec({ key: 'kd', closing_id: 'd1', business_date: '2026-11-09', kind: 'night', seq: 10, status: 'draft' }),
      rec({ closing_id: 's1' }),
    ]);
    await start();
    const day = el.querySelector('#cls-day');
    expect(day.querySelector('[data-act="continue"][data-key="kd"]')).not.toBeNull();
    expect(day.querySelector('#cls-new')).toBeNull();
    expect(day.querySelector('[data-act="view"]')).toBeNull();
  });
  it('offers the next slot to start when the day has no draft, and does not list its saved closings again', async () => {
    api.myRecent.mockImplementationOnce(async () => [
      rec({ closing_id: 'n1', business_date: '2026-11-09', kind: 'night', seq: 10 }),
      rec({ closing_id: 'e1' }),
    ]);
    await start();
    const day = el.querySelector('#cls-day');
    expect(day.querySelector('#cls-new')).not.toBeNull();
    expect(day.querySelector('#cls-kind').value).toBe('morning');
    expect(day.querySelector('[data-act="view"]')).toBeNull();
    expect(day.querySelector('[data-act="pdf"]')).toBeNull();
    // the saved closings are listed once, under Saved records
    expect(el.querySelectorAll('[data-act="view"][data-id="n1"]').length).toBe(1);
  });
  it('shows who is responsible and the variance with each record, in words', async () => {
    api.myRecent.mockImplementationOnce(async () => [
      rec({ closing_id: 'a', business_date: '2026-11-09', kind: 'night', seq: 10, staff: 'Ali Raza', shift_variance: -250 }),
      rec({
        closing_id: 'b',
        business_date: '2026-11-08',
        kind: 'morning',
        seq: 20,
        mode: 'final',
        staff: 'Sana',
        shift_variance: -999,
        final_variance: 40,
      }),
      rec({ closing_id: 'c', business_date: '2026-11-07', staff: 'Omar', shift_variance: 0 }),
      rec({ closing_id: 'd', business_date: '2026-11-06', staff: 'Old Row' }), // a database without migration 0225 sends no variance
      rec({ key: 'kd', closing_id: 'e', business_date: '2026-11-05', status: 'draft', staff: 'Draft Person', shift_variance: null }),
    ]);
    await start();
    const text = (id) => el.querySelector(`[data-act="view"][data-id="${id}"]`).closest('li').textContent.replace(/\s+/g, ' ');
    expect(text('a')).toContain('Responsible: Ali Raza');
    expect(text('a')).toContain('Variance 250.00 (Less)');
    expect(text('b')).toContain('Variance 40.00 (Plus)'); // a Final shows its Final variance
    expect(text('b')).not.toContain('999');
    expect(text('c')).toContain('Variance 0.00');
    expect(text('d')).toContain('Responsible: Old Row');
    expect(text('d')).not.toContain('Variance');
    const draft = el.querySelector('[data-act="continue"][data-key="kd"]').closest('li').textContent;
    expect(draft).toContain('Responsible: Draft Person');
    expect(draft).not.toContain('Variance');
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
    // three staff-credit rows, each with a Group and a Name choice; no free-text group any more
    expect(el.querySelectorAll('select[data-list="credit.tier"][data-k="group"]')).toHaveLength(3);
    expect(el.querySelectorAll('select[data-list="credit.tier"][data-k="person"]')).toHaveLength(3);
    expect(el.querySelectorAll('input[data-list="credit.tier"][data-k="label"]')).toHaveLength(0);
    const groups = [...el.querySelector('select[data-k="group"]').options].map((o) => o.value);
    expect(groups).toEqual(['', 'Morning Shift', 'Evening Shift', 'Night Shift']);
    const names = [...el.querySelector('select[data-k="person"]').options].map((o) => o.value);
    expect(names).toEqual(['', 'J One']); // the active staff from the registry, the same under every group
    el.querySelector('[data-act="add"][data-list="credit.free"]').click();
    expect(el.querySelectorAll('input[data-list="credit.free"][data-k="label"]').length).toBe(1);
    el.querySelector('[data-jump="13"]').click();
    expect(el.querySelector('[data-act="submit"]')).not.toBeNull();
  });
  it('stores a staff-credit row as "Group — Name", and the same person can be picked in two rows', async () => {
    openTarget();
    await ledger();
    el.querySelector('[data-jump="10"]').click();
    const pick = (sel, v) => {
      sel.value = v;
      sel.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const rows = [...el.querySelectorAll('.cls-tier')];
    pick(rows[0].querySelector('[data-k="group"]'), 'Morning Shift');
    pick(rows[0].querySelector('[data-k="person"]'), 'J One');
    pick(rows[1].querySelector('[data-k="group"]'), 'Night Shift');
    pick(rows[1].querySelector('[data-k="person"]'), 'J One');
    type(rows[0].querySelector('.cls-in:not(select)'), '500');
    await vi.advanceTimersByTimeAsync(3000);
    const sent = api.saveDraft.mock.calls.at(-1)?.[0]?.payload ?? api.patchDraft?.mock?.calls?.at(-1)?.[0];
    const tier = sent?.credit?.tier;
    expect(tier?.map((t) => t.label)).toEqual(['Morning Shift — J One', 'Night Shift — J One']);
  });
  it('shows each named account as one slim line until an entry is added', async () => {
    openTarget();
    await ledger();
    el.querySelector('[data-jump="10"]').click();
    const acct = el.querySelector('.cls-acct');
    expect(acct.querySelector('.cls-acct-head').textContent).toContain('Ali Traders');
    expect(acct.querySelector('input')).toBeNull(); // nothing typed: no blank boxes taking up the screen
    acct.querySelector('[data-act="add-named"]').click();
    expect(el.querySelector('.cls-acct input[data-k="desc"]')).not.toBeNull(); // the first tap opens its entry row
    el.querySelector('.cls-acct [data-act="add-named"]').click();
    expect(el.querySelectorAll('.cls-acct input[data-k="desc"]')).toHaveLength(2); // later taps add more
  });
  it('shows "N of 14" under a slim title bar, and asks for the responsible person only on the last section', async () => {
    openTarget();
    await ledger();
    expect(el.querySelector('.cls-step').textContent).toContain('1 of 14');
    expect(el.querySelector('.cls-hero, .hero')).toBeNull(); // the big hero is for the start and success screens
    expect(el.querySelector('h1.cls-tb-title').textContent).toContain('closing');
    expect(el.querySelector('#cls-staff')).toBeNull();
    el.querySelector('[data-jump="5"]').click();
    expect(el.querySelector('.cls-step').textContent).toContain('6 of 14');
    expect(el.querySelector('#cls-staff')).toBeNull();
    el.querySelector('[data-jump="13"]').click();
    expect(el.querySelector('.cls-step').textContent).toContain('14 of 14');
    expect(el.querySelector('#cls-staff')).not.toBeNull();
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
    await vi.advanceTimersByTimeAsync(50); // the review opens once the figures have been read again
    document.querySelector('dialog [data-act="go"]').click();
    await vi.advanceTimersByTimeAsync(300);
    expect(api.submit).toHaveBeenCalledWith('k1');
    expect(el.textContent).toContain('Closing submitted');
    expect(el.querySelector('.cls-done-mark')).not.toBeNull();
    expect(el.textContent).toContain('Next up:');
  });
  it('sends you to the Inventory Audit instead of the review when the audit is required and not verified', async () => {
    api.readAudit.mockImplementationOnce(async () => null);
    openTarget();
    await ledger();
    el.querySelector('[data-jump="13"]').click(); // the responsible-staff box is on the last section, beside Submit
    el.querySelector('#cls-staff').value = 'st1';
    el.querySelector('#cls-staff').dispatchEvent(new Event('change', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(3000);
    el.querySelector('[data-act="submit"]').click();
    expect(document.querySelector('dialog')).toBeNull();
    expect(el.querySelector('[data-jump="5"]').getAttribute('aria-current')).toBe('step');
    expect(api.submit).not.toHaveBeenCalled();
  });
  it('maps a refusal to plain words and stays on the ledger', async () => {
    openTarget();
    await ledger();
    el.querySelector('[data-jump="13"]').click();
    el.querySelector('#cls-staff').value = 'st1';
    el.querySelector('#cls-staff').dispatchEvent(new Event('change', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(3000);
    api.submit.mockImplementationOnce(async () => {
      throw Object.assign(new Error('x'), { hint: 'audit_not_verified' });
    });
    el.querySelector('[data-act="submit"]').click();
    await vi.advanceTimersByTimeAsync(50);
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

    // starting on a field, a row label or the tool buttons works too
    swipe(el.querySelector('#f-sys_cash'), 180, 100, 100, 105);
    expect(current()).toBe('1');
    swipe(el.querySelector('.cls-sec h2'), 100, 100, 180, 105);
    expect(current()).toBe('0');
    swipe(el.querySelector('.cls-tools'), 180, 100, 100, 105);
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

  it('does not restore old typing when the server saved later by a fraction of a millisecond (times are compared as times, not as text)', async () => {
    api.loadByKey.mockImplementationOnce(async () => ({ ...ROW, updated_at: '2026-11-10T08:05:00.123456+00:00' }));
    localStorage.setItem(
      'dua.closing.draft.k1',
      JSON.stringify({ form: {}, version: 1, dirty: true, savedAt: '2026-11-10T08:05:00.123Z' }),
    );
    openTarget();
    await ledger();
    expect(document.getElementById('toasts')?.textContent ?? '').not.toContain('Restored');
    expect(el.querySelector('#cls-chip').textContent).toContain('Saved');
  });

  it('never re-creates a missing opening closing as an ordinary closing', async () => {
    openTarget({ opening: true, mode: 'final' });
    await ledger();
    expect(api.saveDraft).not.toHaveBeenCalled();
    expect(el.textContent).toContain('Go back to Closing and start the opening closing again');
  });

  it('shows the opening figures only on the opening closing', async () => {
    openTarget({ opening: true, mode: 'final' });
    // the opening closing is made on the start page, so by the time the ledger opens it exists
    api.loadByKey.mockImplementationOnce(async () => ({
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

describe('Closing ledger: Submit review, Leave and Save as Draft', () => {
  const FIGURES = {
    net_sale: 100,
    net_cash: 90,
    shift_variance: -10,
    final_net_sale: 0,
    final_net_cash: 0,
    shift_sale: 100,
    customers: 7,
  };
  const plain = (n) => n.textContent.replace(/\s+/g, ' ').trim();
  let previewBefore;
  beforeEach(() => {
    previewBefore = api.computePreview.getMockImplementation();
  });
  afterEach(() => {
    api.computePreview.mockImplementation(previewBefore);
    api.patchDraft.mockReset();
    api.patchDraft.mockImplementation(async () => ({ closing_id: 'c1', version: 1, updated_at: '2026-11-10T08:05:00Z' }));
    vi.restoreAllMocks();
  });
  // on the last section with a responsible person chosen and everything saved
  async function atSubmit() {
    openTarget();
    await ledger();
    el.querySelector('[data-jump="13"]').click();
    el.querySelector('#cls-staff').value = 'st1';
    el.querySelector('#cls-staff').dispatchEvent(new Event('change', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(3000);
  }
  const openReview = async () => {
    el.querySelector('[data-act="submit"]').click();
    await vi.advanceTimersByTimeAsync(50);
  };

  it('shows the Net Cash Available of a Shift as the net cash, so target, cash and Plus/Less add up', async () => {
    api.computePreview.mockImplementation(async () => FIGURES);
    await atSubmit();
    await openReview();
    const rows = [...document.querySelectorAll('dialog .cls-review-row')].map(plain);
    expect(rows[0]).toContain('100.00'); // Target Net Sales
    expect(rows[1]).toContain('90.00'); // Net Cash Available (it showed 190.00)
    expect(rows[1]).not.toContain('190');
    expect(rows[2]).toContain('Less');
    expect(rows[2]).toContain('10.00');
  });

  it('reads the figures again when Submit is tapped, even though the draft already shows Saved', async () => {
    let now = { ...FIGURES, net_cash: 50, shift_variance: -50 };
    api.computePreview.mockImplementation(async () => now);
    await atSubmit();
    expect(el.querySelector('#cls-chip').textContent).toContain('Saved');
    now = { ...FIGURES, net_cash: 95, shift_variance: -5 }; // what the server holds after the last save
    await openReview();
    const rows = [...document.querySelectorAll('dialog .cls-review-row')].map(plain);
    expect(rows[1]).toContain('95.00');
    expect(rows[2]).toContain('5.00');
  });

  it('does not show old figures as current when they cannot be read', async () => {
    await atSubmit();
    api.computePreview.mockImplementation(async () => {
      throw new TypeError('Failed to fetch');
    });
    await openReview();
    expect(document.querySelector('dialog .cls-review')).toBeNull();
    expect(plain(document.querySelector('dialog'))).toContain('still being worked out');
  });

  it('opens one review, not two, when Submit is tapped twice in a row', async () => {
    await atSubmit();
    const submit = el.querySelector('[data-act="submit"]');
    submit.click();
    submit.click();
    await vi.advanceTimersByTimeAsync(50);
    expect(document.querySelectorAll('dialog').length).toBe(1);
  });

  it('forgets the open closing and the conflict backup once it is submitted, so Back does not land on a locked closing', async () => {
    await atSubmit();
    localStorage.setItem('dua.closing.draft.k1.mine', '{"form":{}}');
    await openReview();
    document.querySelector('dialog [data-act="go"]').click();
    await vi.advanceTimersByTimeAsync(300);
    expect(el.textContent).toContain('Closing submitted');
    expect(sessionStorage.getItem('dua.closing.open')).toBeNull();
    expect(localStorage.getItem('dua.closing.draft.k1.mine')).toBeNull();
  });

  it('waits for a save already in flight before leaving, instead of saying it could not be saved', async () => {
    let finish;
    api.patchDraft.mockImplementationOnce(() => new Promise((resolve) => (finish = () => resolve({ closing_id: 'c1', version: 1 }))));
    const ask = vi.spyOn(globalThis, 'confirm').mockImplementation(() => false);
    openTarget();
    await ledger();
    type(el.querySelector('#f-sys_cash'), '5');
    await vi.advanceTimersByTimeAsync(900); // the save has started and is waiting for the server
    el.querySelector('[data-act="leave"]').click();
    await vi.advanceTimersByTimeAsync(300);
    expect(location.hash).not.toBe('#/closing'); // still waiting for that save
    finish();
    await vi.advanceTimersByTimeAsync(300);
    expect(ask).not.toHaveBeenCalled();
    expect(location.hash).toBe('#/closing');
  });

  it('says "Draft saved" when Save as Draft is tapped while an autosave is in flight', async () => {
    let finish;
    api.patchDraft.mockImplementationOnce(() => new Promise((resolve) => (finish = () => resolve({ closing_id: 'c1', version: 1 }))));
    openTarget();
    await ledger();
    type(el.querySelector('#f-sys_cash'), '5');
    await vi.advanceTimersByTimeAsync(900);
    el.querySelector('[data-act="draft"]').click();
    finish();
    await vi.advanceTimersByTimeAsync(400);
    expect(document.getElementById('toasts').textContent).toContain('Draft saved');
  });
});
