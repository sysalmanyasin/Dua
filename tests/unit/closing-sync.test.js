// @vitest-environment jsdom
// Live sync (migration 0217): what another device types shows up without a reload, and never overwrites what is being typed here.
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import {
  SIMPLE_PATHS,
  emptyForm,
  formFromRow,
  isSimplePath,
  listPayload,
  mergeSimple,
  patchFields,
  payloadFromForm,
  sameText,
  simpleDiff,
  simpleTexts,
} from '../../js/modules/closing/domain/form.js';

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
  prev_cash: 0,
  sys_cash: 150000,
  last_bill_no: 2481013,
  last_bill_amt: 0,
  comp_sale: 200000,
  alfalah: 220000,
  keenu: 30000,
  ret_manual_1: 1000,
  book_bill_2: 40,
  ov_customers: 12,
  ov_curr_cc: 0,
  extra_cash: 0,
  responsible_staff_id: 'st1',
  source_closing_id: 's0',
  closing_hs_rows: [],
  closing_strip_lines: [],
  closing_mediq_orders: [],
  closing_misc_rows: [],
};

describe('single boxes vs list sections', () => {
  it('knows which paths are single boxes', () => {
    for (const p of ['sys_cash', 'ret_manual.2', 'book.1', 'overrides.curr_cc', 'credit_adj', 'responsible_staff_id'])
      expect(isSimplePath(p)).toBe(true);
    for (const p of ['till.0', 'vault.7', 'opening.cc', 'hs', 'credit.named']) expect(isSimplePath(p)).toBe(false);
  });
  it('reads every single box of a saved row the way the form does', () => {
    const f = formFromRow(ROW, [], []);
    const t = simpleTexts(ROW);
    for (const path of SIMPLE_PATHS) {
      const v = path.split('.').reduce((o, k) => o[k], f);
      expect(t[path], path).toBe(v);
    }
  });
  it('splits the payload: the whole-draft save carries no single box, and the patch carries only what changed', () => {
    const { payload } = payloadFromForm({ ...formFromRow(ROW, [], []), responsible_staff_id: 'st1' });
    const lists = listPayload(payload);
    for (const k of ['sys_cash', 'last_bill_no', 'ret_manual_2', 'book_bill_1', 'overrides', 'credit_adj', 'responsible_staff_id']) {
      expect(lists, k).not.toHaveProperty(k);
    }
    for (const k of ['hs', 'strips', 'mediq', 'till', 'vault', 'misc', 'deposits', 'credit']) expect(lists, k).toHaveProperty(k);
    expect(patchFields(payload, ['sys_cash', 'ret_manual.0', 'book.1', 'overrides.customers', 'responsible_staff_id'])).toEqual({
      sys_cash: 150000,
      ret_manual_1: 1000,
      book_bill_2: 40,
      overrides: { customers: 12 },
      responsible_staff_id: 'st1',
    });
    // an unset responsible person is not sent (the database only takes a person)
    expect(patchFields({ ...payload, responsible_staff_id: undefined }, ['responsible_staff_id'])).toEqual({});
  });
  it('reads "5.50" and "5.5" as the same number, and two empty boxes as the same', () => {
    expect(sameText('5.50', '5.5')).toBe(true);
    expect(sameText('1,000', '1000')).toBe(true);
    expect(sameText('', '  ')).toBe(true);
    expect(sameText('5', '6')).toBe(false);
    expect(sameText('abc', 'abd')).toBe(false);
  });
  it('lists which boxes differ between two forms', () => {
    const a = formFromRow(ROW, [], []);
    const b = { ...a, alfalah: '1', overrides: { ...a.overrides, customers: '13' } };
    expect(simpleDiff(a, b).sort()).toEqual(['alfalah', 'overrides.customers']);
  });
});

describe('mergeSimple', () => {
  const base = () => ({ ...emptyForm(), sys_cash: '100', alfalah: '5' });
  it('lays incoming values over the form and reports what changed', () => {
    const { form, changed } = mergeSimple(base(), { sys_cash: '200', alfalah: '5.0', 'ret_manual.1': '7' });
    expect(form.sys_cash).toBe('200');
    expect(form.ret_manual[1]).toBe('7');
    expect(form.alfalah).toBe('5'); // the same number: left as typed
    expect(changed.sort()).toEqual(['ret_manual.1', 'sys_cash']);
  });
  it('keeps boxes typed here and not yet saved, and the box the person is in', () => {
    const { form, changed } = mergeSimple(
      base(),
      { sys_cash: '200', alfalah: '9' },
      { keep: new Set(['sys_cash']), skip: new Set(['alfalah']) },
    );
    expect(form.sys_cash).toBe('100');
    expect(form.alfalah).toBe('5');
    expect(changed).toEqual([]);
  });
  it('never changes the form it was given', () => {
    const f = base();
    mergeSimple(f, { sys_cash: '200', 'ret_manual.0': '1', 'overrides.customers': '3' });
    expect(f.sys_cash).toBe('100');
    expect(f.ret_manual[0]).toBe('');
    expect(f.overrides.customers).toBe('');
  });
});

// ── the ledger screen ──
const api = {
  listStrips: vi.fn(async () => []),
  staffChoices: vi.fn(async () => [{ id: 'st1', name: 'J One' }]),
  loadByKey: vi.fn(async () => ({ ...ROW })),
  loadById: vi.fn(async () => ({ ...ROW })),
  loadSync: vi.fn(async () => ({ ...ROW })),
  refreshDraftCarry: vi.fn(async () => ({ refreshed: true })),
  saveDraft: vi.fn(async () => ({ closing_id: 'c1', version: 2 })),
  patchDraft: vi.fn(async () => ({ closing_id: 'c1', version: 1, updated_at: '2026-11-10T08:05:00Z' })),
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
let heard; // what the screen passed to watchDraft
const tick = (ms = 20) => vi.advanceTimersByTimeAsync(ms);
const type = (box, value) => {
  box.value = value;
  box.dispatchEvent(new Event('input', { bubbles: true }));
};
HTMLDialogElement.prototype.showModal ??= function () {
  this.setAttribute('open', '');
};
HTMLDialogElement.prototype.close ??= function () {
  this.removeAttribute('open');
  this.dispatchEvent(new Event('close'));
};
async function ledger() {
  sessionStorage.setItem('dua.closing.open', JSON.stringify({ key: 'k1', date: '2026-11-10', kind: 'night', mode: 'shift' }));
  location.hash = '#/closing/ledger';
  const { mount } = await import('../../js/modules/closing/ui/ledger.js');
  await mount(el);
  await tick();
}
const remote = async (changes) => {
  api.loadSync.mockImplementation(async () => ({ ...ROW, ...changes }));
  heard.onChange();
  await tick(400);
};
beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '<div id="page"></div><div id="toasts"></div>';
  el = document.getElementById('page');
  sessionStorage.clear();
  localStorage.clear();
  Object.values(api).forEach((f) => f.mockClear());
  api.patchDraft.mockReset();
  api.patchDraft.mockImplementation(async () => ({ closing_id: 'c1', version: 1, updated_at: '2026-11-10T08:05:00Z' }));
  api.saveDraft.mockReset();
  api.saveDraft.mockImplementation(async () => ({ closing_id: 'c1', version: 2 }));
  api.loadSync.mockImplementation(async () => ({ ...ROW }));
  api.loadById.mockImplementation(async () => ({ ...ROW }));
  heard = null;
  api.watchDraft.mockImplementation((id, onChange, onStatus) => {
    heard = { id, onChange, onStatus };
    return () => {};
  });
});
afterEach(() => {
  location.hash = '';
  vi.useRealTimers();
});

describe('ledger: live sync', () => {
  it('listens to this draft, and the box another device changed shows the new figure without a reload', async () => {
    await ledger();
    expect(heard.id).toBe('c1');
    expect(el.querySelector('[data-f="alfalah"]').value).toBe('220000');
    await remote({ alfalah: 225000 });
    expect(el.querySelector('[data-f="alfalah"]').value).toBe('225000');
    expect(api.saveDraft).not.toHaveBeenCalled();
    expect(api.patchDraft).not.toHaveBeenCalled(); // taking a change in is not a save
    expect(el.querySelector('#cls-chip').textContent).toContain('Saved');
  });
  it('does not overwrite a box typed here and not yet saved', async () => {
    await ledger();
    type(el.querySelector('[data-f="alfalah"]'), '1');
    api.patchDraft.mockImplementationOnce(() => new Promise(() => {})); // the save is still on its way
    await remote({ alfalah: 225000, keenu: 31000 });
    expect(el.querySelector('[data-f="alfalah"]').value).toBe('1'); // mine
    expect(el.querySelector('[data-f="keenu"]').value).toBe('31000'); // theirs, a different box
  });
  it('leaves the box the person is in alone, and catches up when they leave it', async () => {
    await ledger();
    const box = el.querySelector('[data-f="alfalah"]');
    box.focus();
    await remote({ alfalah: 225000 });
    expect(box.value).toBe('220000');
    box.blur();
    await tick(400);
    expect(box.value).toBe('225000');
  });
  it('a change heard while this device is saving is read again afterwards, not mixed into the save', async () => {
    await ledger();
    let finish;
    api.patchDraft.mockImplementationOnce(() => new Promise((r) => (finish = r)));
    type(el.querySelector('[data-f="keenu"]'), '5');
    await tick(900); // the save starts and waits
    await remote({ alfalah: 225000 });
    expect(el.querySelector('[data-f="alfalah"]').value).toBe('220000'); // not yet
    finish({ closing_id: 'c1', version: 1, updated_at: 'x' });
    await tick(600);
    expect(el.querySelector('[data-f="alfalah"]').value).toBe('225000');
  });
  it('takes in list sections changed elsewhere when nothing in them was typed here', async () => {
    await ledger();
    api.loadById.mockImplementation(async () => ({
      ...ROW,
      draft_version: 3,
      closing_hs_rows: [{ id: 'h1', label: 'From the other device', amount: 250, sort: 1 }],
    }));
    await remote({ draft_version: 3 });
    el.querySelector('[data-jump="3"]').click();
    expect(el.querySelector('[data-list="hs"][data-k="amount"]').value).toBe('250');
    // and the next list save is against the version just read
    type(el.querySelector('[data-list="hs"][data-k="amount"]'), '260');
    await tick(3000);
    expect(api.saveDraft.mock.calls.at(-1)[0].expectedVersion).toBe(3);
  });
  it('leaves list sections typed here alone: the save then asks which to keep (CLS-13)', async () => {
    await ledger();
    el.querySelector('[data-jump="3"]').click();
    el.querySelector('[data-act="add"][data-list="hs"]').click();
    type(el.querySelector('[data-list="hs"][data-k="amount"]'), '70');
    api.loadById.mockClear();
    await remote({ draft_version: 3 });
    expect(api.loadById).not.toHaveBeenCalled();
    expect(el.querySelector('[data-list="hs"][data-k="amount"]').value).toBe('70');
    api.saveDraft.mockImplementationOnce(async () => {
      throw Object.assign(new Error('x'), { hint: 'draft_conflict', details: 'version=3' });
    });
    await tick(3000);
    expect(document.querySelector('dialog')?.textContent).toContain('changed on another device');
  });
  it('leaves the screen when the draft was submitted on another device', async () => {
    await ledger();
    await remote({ status: 'submitted' });
    expect(location.hash).toBe('#/closing');
    expect(document.getElementById('toasts').textContent).toContain('submitted on another device');
  });
  it('checks every few seconds while the live connection is down, and rarely while it is up', async () => {
    await ledger();
    api.loadSync.mockClear();
    heard.onStatus('CHANNEL_ERROR');
    await tick(3100);
    await tick(3000);
    expect(api.loadSync.mock.calls.length).toBeGreaterThanOrEqual(2);
    api.loadSync.mockClear();
    heard.onStatus('SUBSCRIBED');
    await tick(400); // the connection coming up reads once
    api.loadSync.mockClear();
    await tick(9000);
    expect(api.loadSync.mock.calls.length).toBeLessThanOrEqual(1); // three ticks, of which at most one is a safety-net check
  });
  it('stops listening when the person has left the ledger', async () => {
    const stop = vi.fn();
    api.watchDraft.mockImplementation((id, onChange, onStatus) => {
      heard = { id, onChange, onStatus };
      return stop;
    });
    await ledger();
    location.hash = '#/closing';
    api.loadSync.mockClear();
    heard.onChange();
    await tick(400);
    expect(stop).toHaveBeenCalled();
    expect(api.loadSync).not.toHaveBeenCalled();
  });
});
