// @vitest-environment jsdom
// Owner-only Shift <-> Final change (migration 0218). The database is the real gate (supabase/tests/0218_closing_mode_change_test.sql);
// these tests prove the screens only offer the control to the Owner, send the right request, reuse the existing reopen flow's screens,
// and follow a change made on another device.
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { friendlyError } from '../../js/modules/closing/domain/errors.js';
import { getOpen } from '../../js/modules/closing/domain/store.js';

const h = vi.hoisted(() => ({ calls: [], reply: { data: { ok: true }, error: null } }));
vi.mock('../../js/core/supabase.js', () => ({
  db: () => ({
    rpc: (name, args) => (h.calls.push([name, args]), Promise.resolve(h.reply)),
    from: () => {
      const b = { select: () => b, eq: () => b, maybeSingle: () => b, then: (res, rej) => Promise.resolve(h.reply).then(res, rej) };
      return b;
    },
  }),
}));

describe('closing data layer: changeMode', () => {
  beforeEach(() => {
    h.calls = [];
    h.reply = { data: { closing_id: 'r1', new_mode: 'final' }, error: null };
  });
  it('calls the one database function with the closing, new mode, reason and request key', async () => {
    const real = await vi.importActual('../../js/modules/closing/data/api.js');
    const out = await real.changeMode({ closingId: 'c1', mode: 'final', reason: 'day end', key: 'k-1' });
    expect(h.calls).toEqual([['closing_change_mode', { p_closing: 'c1', p_new_mode: 'final', p_reason: 'day end', p_key: 'k-1' }]]);
    expect(out).toMatchObject({ closing_id: 'r1' });
  });
  it('sends a null key for a draft (nothing is reopened)', async () => {
    const real = await vi.importActual('../../js/modules/closing/data/api.js');
    await real.changeMode({ closingId: 'c1', mode: 'shift', reason: 'oops' });
    expect(h.calls[0][1].p_key).toBeNull();
  });
  it('lets the database refusal through so the screen can explain it', async () => {
    h.reply = { data: null, error: { message: 'only the Owner', hint: 'mode_change_owner_only' } };
    const real = await vi.importActual('../../js/modules/closing/data/api.js');
    await expect(real.changeMode({ closingId: 'c1', mode: 'final', reason: 'abc' })).rejects.toMatchObject({
      hint: 'mode_change_owner_only',
    });
  });
  it('the live-sync read includes the mode, so another device hears the change', () => {
    return vi.importActual('node:fs').then(({ readFileSync }) => {
      const src = readFileSync('js/modules/closing/data/api.js', 'utf8');
      expect(/SYNC_SELECT =\s*'id, status, mode,/.test(src)).toBe(true);
    });
  });
});

describe('closing refusal messages for the mode change', () => {
  it('explains an Owner-only refusal and an unchanged type in plain words', () => {
    const a = friendlyError({ hint: 'mode_change_owner_only', message: 'x' });
    expect(a).toMatchObject({ code: 'mode_change_owner_only', kind: 'refused' });
    expect(a.message).toMatch(/Only the Owner/);
    expect(friendlyError({ hint: 'mode_unchanged' }).message).toMatch(/already has that type/);
  });
});

// ── screens, with the data layer replaced ──
const PAGES = [
  {
    closing_id: 'c1',
    business_date: '2026-11-08',
    kind: 'night',
    seq: 10,
    mode: 'shift',
    revision: 1,
    is_opening: false,
    results: { net_sale: 100 },
    staff: 'A',
  },
  {
    closing_id: 'c2',
    business_date: '2026-11-08',
    kind: 'evening',
    seq: 9999,
    mode: 'final',
    revision: 1,
    is_opening: false,
    results: { net_sale: 200 },
    staff: 'B',
  },
  {
    closing_id: 'o1',
    business_date: '2026-11-07',
    kind: 'evening',
    seq: 9999,
    mode: 'final',
    revision: 1,
    is_opening: true,
    results: { net_sale: 0 },
    staff: 'Owner',
  },
];
const ROW = {
  id: 'c1',
  status: 'draft',
  mode: 'shift',
  is_opening: false,
  draft_version: 1,
  updated_at: '2026-11-10T08:00:00Z',
  closing_slots: { business_date: '2026-11-10', kind: 'night', seq: 10 },
  prev_cc: 0,
  prev_credit: 0,
  prev_deposits: 0,
  prev_cash: 4000,
  sys_cash: 150000,
  last_bill_no: 10,
  comp_sale: 0,
  alfalah: 0,
  keenu: 0,
  source_closing_id: 's0',
  closing_hs_rows: [],
  closing_strip_lines: [],
  closing_mediq_orders: [],
  closing_misc_rows: [],
};
const api = {
  closingBook: vi.fn(async () => PAGES),
  reopen: vi.fn(async () => ({ closing_id: 'r' })),
  changeMode: vi.fn(async () => ({ closing_id: 'r1', new_mode: 'final', old_mode: 'shift', status: 'draft', already: false })),
  listStrips: vi.fn(async () => []),
  staffChoices: vi.fn(async () => []),
  loadByKey: vi.fn(async () => ({ ...ROW })),
  loadById: vi.fn(async () => ({ ...ROW })),
  loadSync: vi.fn(async () => ({ ...ROW })),
  refreshDraftCarry: vi.fn(async () => ({ refreshed: true })),
  saveDraft: vi.fn(async () => ({ closing_id: 'c1', version: 2 })),
  patchDraft: vi.fn(async () => ({ closing_id: 'c1', version: 1 })),
  watchDraft: vi.fn(() => () => {}),
  computePreview: vi.fn(async () => ({ net_sale: 1, shift_sale: 1000, customers: 7 })),
  listCreditAccounts: vi.fn(async () => []),
  readAuditRequired: vi.fn(async () => false),
  readAudit: vi.fn(async () => null),
  prevPage: vi.fn(async () => null),
  periodFor: vi.fn(async () => ({})),
  submit: vi.fn(async () => ({ already: false })),
};
vi.mock('../../js/modules/closing/data/api.js', () => api);

let el;
let heard;
const tick = (ms = 20) => vi.advanceTimersByTimeAsync(ms);
const type = (box, value) => {
  box.value = value;
  box.dispatchEvent(new Event('input', { bubbles: true }));
};
const toasts = () => document.getElementById('toasts')?.textContent ?? '';
const OWNER = { role: 'admin', mfa_ok: true, permissions: ['closing.correct', 'closing.review'] };
HTMLDialogElement.prototype.showModal ??= function () {
  this.setAttribute('open', '');
};
HTMLDialogElement.prototype.close ??= function () {
  this.removeAttribute('open');
  this.dispatchEvent(new Event('close'));
};
beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '<div id="page"></div><div id="toasts"></div>';
  el = document.getElementById('page');
  sessionStorage.clear();
  localStorage.clear();
  Object.values(api).forEach((f) => f.mockClear());
  api.changeMode.mockImplementation(async () => ({
    closing_id: 'r1',
    new_mode: 'final',
    old_mode: 'shift',
    status: 'draft',
    already: false,
  }));
  api.loadById.mockImplementation(async () => ({ ...ROW }));
  api.loadSync.mockImplementation(async () => ({ ...ROW }));
  api.saveDraft.mockImplementation(async () => ({ closing_id: 'c1', version: 2 }));
  heard = null;
  api.watchDraft.mockImplementation((id, onChange, onStatus) => {
    heard = { id, onChange, onStatus };
    return () => {};
  });
  location.hash = '';
});
afterEach(() => vi.useRealTimers());

describe('Review page: Change type', () => {
  const open = async (ctx) => {
    const { mount } = await import('../../js/modules/closing/ui/review.js');
    await mount(el, { ctx });
    await tick();
  };
  it('is offered only to the Owner (admin with MFA), never to someone who merely may correct', async () => {
    await open({ role: 'senior', mfa_ok: true, permissions: ['closing.correct', 'closing.review'] });
    expect(el.querySelector('[data-act="mode"]')).toBeNull();
    await open({ role: 'admin', mfa_ok: false, permissions: [] });
    expect(el.querySelector('[data-act="mode"]')).toBeNull();
    await open(OWNER);
    expect(el.querySelectorAll('[data-act="mode"]')).toHaveLength(2); // the opening closing has none
    expect(el.querySelector('[data-act="mode"][data-id="o1"]')).toBeNull();
  });
  it("offers the opposite type, and shows each closing's current type", async () => {
    await open(OWNER);
    expect(el.querySelector('[data-act="mode"][data-id="c1"]').textContent).toContain('Change to Final');
    expect(el.querySelector('[data-act="mode"][data-id="c2"]').textContent).toContain('Change to Shift');
    expect(el.querySelector('[data-closing="c1"]').textContent).toContain('Shift');
    expect(el.querySelector('[data-closing="c2"]').textContent).toContain('Final');
  });
  it('needs a reason before it sends anything', async () => {
    await open(OWNER);
    el.querySelector('[data-act="mode"][data-id="c1"]').click();
    type(document.querySelector('#mc-reason'), ' a ');
    document.querySelector('#mc-go').click();
    await tick();
    expect(api.changeMode).not.toHaveBeenCalled();
    expect(toasts()).toContain('Please write a reason');
  });
  it('sends one request (reopen + type in the database), then opens the new draft in the ledger in the new type', async () => {
    await open(OWNER);
    el.querySelector('[data-act="mode"][data-id="c1"]').click();
    type(document.querySelector('#mc-reason'), 'This was the last shift of the day');
    document.querySelector('#mc-go').click();
    await tick();
    expect(api.changeMode).toHaveBeenCalledTimes(1);
    const call = api.changeMode.mock.calls[0][0];
    expect(call).toMatchObject({ closingId: 'c1', mode: 'final', reason: 'This was the last shift of the day' });
    expect(typeof call.key).toBe('string');
    expect(api.reopen).not.toHaveBeenCalled(); // the reopen happens inside the one database call, not as a second browser step
    expect(getOpen()).toMatchObject({ key: call.key, date: '2026-11-08', kind: 'night', mode: 'final', opening: false });
    expect(location.hash).toBe('#/closing/ledger');
  });
  it('Final -> Shift sends shift', async () => {
    await open(OWNER);
    el.querySelector('[data-act="mode"][data-id="c2"]').click();
    type(document.querySelector('#mc-reason'), 'not a final after all');
    document.querySelector('#mc-go').click();
    await tick();
    expect(api.changeMode.mock.calls[0][0]).toMatchObject({ closingId: 'c2', mode: 'shift' });
    expect(getOpen()).toMatchObject({ mode: 'shift', kind: 'evening' });
  });
  it('shows a refusal in plain words and stays put', async () => {
    api.changeMode.mockImplementationOnce(async () => {
      throw Object.assign(new Error('x'), { hint: 'previous_slot_open' });
    });
    await open(OWNER);
    el.querySelector('[data-act="mode"][data-id="c2"]').click();
    type(document.querySelector('#mc-reason'), 'abc');
    document.querySelector('#mc-go').click();
    await tick();
    expect(toasts()).toContain('slot before');
    expect(getOpen()).toBeNull();
    expect(location.hash).toBe('');
  });
  it('a double tap changes once', async () => {
    api.changeMode.mockImplementationOnce(() => new Promise((r) => setTimeout(() => r({ closing_id: 'r1' }), 50)));
    await open(OWNER);
    el.querySelector('[data-act="mode"][data-id="c1"]').click();
    type(document.querySelector('#mc-reason'), 'twice?');
    const go = document.querySelector('#mc-go');
    go.click();
    go.click();
    await tick(200);
    expect(api.changeMode).toHaveBeenCalledTimes(1);
  });
});

describe('Ledger: Change type', () => {
  async function ledger(ctx, target = {}) {
    sessionStorage.setItem('dua.closing.open', JSON.stringify({ key: 'k1', date: '2026-11-10', kind: 'night', mode: 'shift', ...target }));
    location.hash = '#/closing/ledger';
    const { mount } = await import('../../js/modules/closing/ui/ledger.js');
    await mount(el, { ctx });
    await tick();
  }
  const sub = () => el.querySelector('.cls-tb-sub').textContent;
  it('shows the control only to the Owner', async () => {
    await ledger({ role: 'junior', mfa_ok: true, permissions: ['closing.enter_own'] });
    expect(el.querySelector('[data-act="mode"]')).toBeNull();
    await ledger({
      role: 'senior',
      mfa_ok: true,
      permissions: ['closing.enter_own', 'closing.correct', 'closing.review', 'closing.settings'],
    });
    expect(el.querySelector('[data-act="mode"]')).toBeNull();
    await ledger({ role: 'admin', mfa_ok: false, permissions: [] });
    expect(el.querySelector('[data-act="mode"]')).toBeNull();
    await ledger(OWNER);
    expect(el.querySelector('[data-act="mode"]').textContent).toContain('Shift');
  });
  it('never shows it on the opening closing (always Final)', async () => {
    api.loadByKey.mockImplementationOnce(async () => ({ ...ROW, is_opening: true, mode: 'final' }));
    await ledger(OWNER);
    expect(el.querySelector('[data-act="mode"]')).toBeNull();
  });
  it('changes the draft in place: one request for this closing, then the screen shows the new type and carried figures', async () => {
    await ledger(OWNER);
    expect(sub()).toContain('Shift');
    api.loadById.mockImplementation(async () => ({ ...ROW, mode: 'final', draft_version: 2, prev_cash: 0 }));
    el.querySelector('[data-act="mode"]').click();
    type(document.querySelector('#mc-reason'), 'Day ends with this closing');
    document.querySelector('#mc-go').click();
    await tick();
    expect(api.changeMode).toHaveBeenCalledTimes(1);
    expect(api.changeMode.mock.calls[0][0]).toMatchObject({ closingId: 'c1', mode: 'final', reason: 'Day ends with this closing' });
    expect(sub()).toContain('Final');
    expect(el.querySelector('[data-act="mode"]').textContent).toContain('Final');
    expect(toasts()).toContain('Changed to Final');
    // the next save carries the new type, so the database does not see a mode change from the ordinary save
    type(el.querySelector('[data-f="alfalah"]'), '5');
    await tick(3000);
    const sent = [...api.saveDraft.mock.calls, ...api.patchDraft.mock.calls];
    expect(sent.length).toBeGreaterThan(0);
    for (const [arg] of api.saveDraft.mock.calls) expect(arg.mode).toBe('final');
  });
  it('needs a reason', async () => {
    await ledger(OWNER);
    el.querySelector('[data-act="mode"]').click();
    type(document.querySelector('#mc-reason'), '');
    document.querySelector('#mc-go').click();
    await tick();
    expect(api.changeMode).not.toHaveBeenCalled();
  });
  it('explains a refusal and keeps the old type on screen', async () => {
    api.changeMode.mockImplementationOnce(async () => {
      throw Object.assign(new Error('x'), { hint: 'mode_change_owner_only' });
    });
    await ledger(OWNER);
    el.querySelector('[data-act="mode"]').click();
    type(document.querySelector('#mc-reason'), 'try it');
    document.querySelector('#mc-go').click();
    await tick();
    expect(toasts()).toContain('Only the Owner');
    expect(sub()).toContain('Shift');
  });
  it('another device: when the Owner changes the type, this screen follows it and says so', async () => {
    await ledger({ role: 'junior', mfa_ok: true, permissions: ['closing.enter_own'] });
    expect(sub()).toContain('Shift');
    api.loadSync.mockImplementation(async () => ({ ...ROW, mode: 'final', draft_version: 2 }));
    api.loadById.mockImplementation(async () => ({ ...ROW, mode: 'final', draft_version: 2, prev_cash: 0 }));
    heard.onChange();
    await tick(400);
    expect(toasts()).toContain('The Owner changed this closing to Final');
    expect(sub()).toContain('Final');
  });
});
