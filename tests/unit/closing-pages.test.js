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
  source_closing_id: 's0',
  closing_hs_rows: [],
  closing_strip_lines: [],
  closing_mediq_orders: [],
};
const api = {
  listStrips: vi.fn(async () => [{ id: 's1', label: 'Panadol', price: 120 }]),
  staffChoices: vi.fn(async () => [{ id: 'st1', name: 'J One' }]),
  loadByKey: vi.fn(async () => null),
  loadById: vi.fn(async () => ROW),
  saveDraft: vi.fn(async () => ({ closing_id: 'c1', version: 2 })),
  computePreview: vi.fn(async () => ({ net_sale: 1234, shift_sale: 1000, customers: 7 })),
  myRecent: vi.fn(async () => []),
  startOpening: vi.fn(async () => ({ closing_id: 'o1' })),
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
beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '<div id="page"></div>';
  el = document.getElementById('page');
  sessionStorage.clear();
  localStorage.clear();
  Object.values(api).forEach((f) => f.mockClear());
  api.loadByKey.mockImplementation(async () => null);
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
  it('shows a refused start in plain words', async () => {
    openTarget();
    api.saveDraft.mockImplementationOnce(async () => {
      throw Object.assign(new Error('x'), { hint: 'previous_slot_open' });
    });
    await ledger();
    expect(el.textContent).toContain('The slot before this one has not been submitted yet');
  });
  it('keeps typing locally at once and saves to the server after a pause, with the version it last saw', async () => {
    openTarget();
    await ledger();
    api.saveDraft.mockClear();
    type(el.querySelector('#f-sys_cash'), '150,000');
    expect(JSON.parse(localStorage.getItem('dua.closing.draft.k1')).dirty).toBe(true);
    expect(api.saveDraft).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2600);
    expect(api.saveDraft).toHaveBeenCalledTimes(1);
    const call = api.saveDraft.mock.calls[0][0];
    expect(call.expectedVersion).toBe(1); // the version adopted from the created draft
    expect(call.payload.sys_cash).toBe(150000);
    expect(Object.keys(call.payload.overrides).sort()).toEqual(['curr_cc', 'customers', 'prev_cash', 'shift_sale']);
    expect(localStorage.getItem('dua.closing.draft.k1')).toBeNull(); // saved, so the local copy is dropped
    expect(el.querySelector('#cls-chip').textContent).toContain('Saved');
  });
  it('does not send a typo: it marks the field and says what to do', async () => {
    openTarget();
    await ledger();
    api.saveDraft.mockClear();
    type(el.querySelector('#f-sys_cash'), '12O00');
    await vi.advanceTimersByTimeAsync(2600);
    expect(api.saveDraft).not.toHaveBeenCalled();
    expect(el.querySelector('#f-sys_cash').getAttribute('aria-invalid')).toBe('true');
    expect(el.querySelector('#cls-chip').textContent).toContain('Fix the marked fields');
  });
  it('keeps the draft and says Offline when the connection drops, then saves again from the chip', async () => {
    openTarget();
    await ledger();
    api.saveDraft.mockImplementationOnce(async () => {
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
    type(el.querySelector('#f-sys_cash'), '99');
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
  it('shows later sections as not built yet and has no Submit button', async () => {
    openTarget();
    await ledger();
    el.querySelector('[data-jump="6"]').click();
    expect(el.querySelector('.cls-soon')).not.toBeNull();
    expect(el.textContent).not.toMatch(/submit/i);
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
