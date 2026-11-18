// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { qtyText, whenKarachi } from '../../js/modules/closing/domain/audit.js';
import { friendlyError } from '../../js/modules/closing/domain/errors.js';

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
  source_closing_id: 's0',
  closing_hs_rows: [],
  closing_strip_lines: [],
  closing_mediq_orders: [],
};
const PREVIEW = {
  items: [
    { code: '894301', name: 'Item A', qty: 1250 },
    { code: '894303', name: 'Item C', qty: -2 },
  ],
  not_found: ['894330', '894331'],
  codes_checked: 31,
  data_as_of: '2026-11-10T07:30:00Z',
  fetched_at: '2026-11-10T08:00:00Z',
  digest: 'abc123',
};
const SNAP = {
  verified_at: '2026-11-10T08:05:00Z',
  data_as_of: '2026-11-10T07:30:00Z',
  codes_checked: 31,
  not_found: ['894330'],
  by: 'J One',
  items: [{ item_code: '894301', item_name: 'Item A', qty: 5 }],
};
const api = {
  listStrips: vi.fn(async () => []),
  staffChoices: vi.fn(async () => []),
  loadByKey: vi.fn(),
  loadById: vi.fn(async () => ROW),
  saveDraft: vi.fn(async () => ({ closing_id: 'c1', version: 2 })),
  computePreview: vi.fn(async () => ({})),
  myRecent: vi.fn(async () => []),
  savedList: vi.fn(async () => []),
  listCreditAccounts: vi.fn(async () => []),
  readAuditRequired: vi.fn(async () => true),
  setAuditRequired: vi.fn(async () => ({})),
  periodFor: vi.fn(async () => ({})),
  submit: vi.fn(async () => ({})),
  auditPreview: vi.fn(),
  auditVerify: vi.fn(),
  readAudit: vi.fn(),
};
vi.mock('../../js/modules/closing/data/api.js', () => api);

HTMLDialogElement.prototype.showModal ??= function () {
  this.setAttribute('open', '');
};
HTMLDialogElement.prototype.close ??= function () {
  this.removeAttribute('open');
  this.dispatchEvent(new Event('close'));
};
const tick = () => vi.advanceTimersByTimeAsync(20);
const toasts = () => document.getElementById('toasts')?.textContent ?? '';
let el;
beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '<div id="page"></div>';
  el = document.getElementById('page');
  sessionStorage.clear();
  localStorage.clear();
  Object.values(api).forEach((f) => f.mockReset?.());
  api.listStrips.mockImplementation(async () => []);
  api.staffChoices.mockImplementation(async () => []);
  api.loadByKey.mockImplementation(async () => ROW);
  api.loadById.mockImplementation(async () => ROW);
  api.listCreditAccounts.mockImplementation(async () => []);
  api.readAuditRequired.mockImplementation(async () => true);
  api.myRecent.mockImplementation(async () => []);
  api.computePreview.mockImplementation(async () => ({}));
  api.periodFor.mockImplementation(async () => ({}));
  api.auditPreview.mockImplementation(async () => PREVIEW);
  api.auditVerify.mockImplementation(async () => ({ verified_at: '2026-11-10T08:05:00Z' }));
  api.readAudit.mockImplementation(async () => null);
  location.hash = '';
});
afterEach(() => vi.useRealTimers());

async function card(perms = [], target = {}) {
  sessionStorage.setItem('dua.closing.open', JSON.stringify({ key: 'k1', date: '2026-11-10', kind: 'night', mode: 'shift', ...target }));
  const { mount } = await import('../../js/modules/closing/ui/ledger.js');
  await mount(el, { ctx: { permissions: perms } });
  await tick();
  el.querySelector('[data-jump="5"]').click();
  await tick();
}
const act = async (name) => {
  el.querySelector(`[data-act="${name}"]`).click();
  await tick();
};

describe('audit display helpers', () => {
  it('writes a time in Karachi, or nothing', () => {
    expect(whenKarachi('2026-11-10T11:39:00Z')).toBe('10 Nov 2026, 4:39 pm');
    expect(whenKarachi(null)).toBe('');
    expect(whenKarachi('nonsense')).toBe('');
  });
  it('writes a quantity with separators', () => {
    expect(qtyText(1250)).toBe('1,250');
    expect(qtyText(-2)).toBe('-2');
    expect(qtyText(2.5)).toBe('2.5');
    expect(qtyText(null)).toBe('0');
  });
  it('has plain sentences for every refusal the audit can give', () => {
    for (const hint of ['inventory_not_allowed', 'no_audit_codes', 'audit_not_needed', 'audit_already_verified', 'audit_changed']) {
      const m = friendlyError(Object.assign(new Error('x'), { hint })).message;
      expect(m.length).toBeGreaterThan(20);
      expect(m).not.toMatch(/something went wrong/i);
    }
  });
});

describe('Inventory Audit card (section 6)', () => {
  it('starts with a Sync & audit button and says it is required', async () => {
    await card();
    expect(el.textContent).toContain('6 — Inventory Audit');
    expect(el.querySelector('[data-act="audit-sync"]').textContent).toContain('Sync & audit');
    expect(el.textContent).toContain('It must be verified before this closing can be submitted.');
    expect(el.querySelector('[data-act="audit-verify"]')).toBeNull();
    expect(api.readAudit).toHaveBeenCalledWith('c1');
  });
  it('says the audit is optional when the requirement is switched off', async () => {
    api.readAuditRequired.mockImplementation(async () => false);
    await card();
    expect(el.textContent).toContain('The requirement is switched off, so this is optional.');
  });
  it('shows the non-zero stock, the codes not found and when the data is from, and saves nothing yet', async () => {
    await card();
    await act('audit-sync');
    expect(api.auditPreview).toHaveBeenCalledTimes(1);
    const c = el.querySelector('.cls-audit');
    expect(c.getAttribute('data-state')).toBe('preview');
    expect(c.textContent).toContain('Item A');
    expect(c.textContent).toContain('894301');
    expect(c.textContent).toContain('1,250');
    expect(c.textContent).toContain('-2');
    expect(c.textContent).toContain('Not found in inventory: 894330, 894331');
    expect(c.textContent).toContain('31 codes checked');
    expect(c.textContent).toContain('10 Nov 2026, 12:30 pm');
    expect(c.textContent).toContain('Nothing is saved until you confirm.');
    expect(api.auditVerify).not.toHaveBeenCalled();
    expect(el.querySelector('[data-act="audit-verify"]').textContent).toContain('Verify & confirm');
    expect(el.querySelector('[data-act="audit-sync"]').textContent).toContain('Read again');
  });
  it('says so when every audited code shows zero', async () => {
    api.auditPreview.mockImplementation(async () => ({ ...PREVIEW, items: [], not_found: [] }));
    await card();
    await act('audit-sync');
    expect(el.textContent).toContain('Every audited code shows zero stock.');
  });
  it('freezes exactly what was looked at: verifies with the digest, then shows who and when', async () => {
    await card();
    await act('audit-sync');
    api.readAudit.mockImplementation(async () => SNAP);
    await act('audit-verify');
    expect(api.auditVerify).toHaveBeenCalledWith('k1', 'abc123');
    const c = el.querySelector('.cls-audit');
    expect(c.getAttribute('data-state')).toBe('verified');
    expect(c.textContent).toContain('Verified');
    expect(c.textContent).toContain('by J One');
    expect(c.textContent).toContain('This list is frozen with the closing.');
    expect(c.textContent).toContain('Not found in inventory: 894330');
    expect(el.querySelector('[data-act="audit-sync"]')).toBeNull();
    expect(el.querySelector('[data-act="audit-verify"]')).toBeNull();
    expect(toasts()).toContain('Inventory audit verified.');
  });
  it('still shows what was confirmed if the saved copy cannot be read straight back', async () => {
    await card();
    await act('audit-sync');
    api.readAudit.mockImplementation(async () => {
      throw new Error('offline');
    });
    await act('audit-verify');
    const c = el.querySelector('.cls-audit');
    expect(c.getAttribute('data-state')).toBe('verified');
    expect(c.textContent).toContain('Item A');
    expect(c.textContent).toContain('1,250');
  });
  it('refuses a stale list and asks to read again', async () => {
    api.auditVerify.mockImplementationOnce(async () => {
      throw Object.assign(new Error('x'), { hint: 'audit_changed' });
    });
    await card();
    await act('audit-sync');
    await act('audit-verify');
    const c = el.querySelector('.cls-audit');
    expect(c.getAttribute('data-state')).toBe('error');
    expect(c.textContent).toContain('The stock changed while you were looking.');
    expect(el.querySelector('[data-act="audit-verify"]')).toBeNull();
    api.auditPreview.mockImplementation(async () => ({ ...PREVIEW, digest: 'new456' }));
    await act('audit-sync');
    await act('audit-verify');
    expect(api.auditVerify).toHaveBeenLastCalledWith('k1', 'new456');
  });
  it('explains a refused read in plain words and lets the person try again', async () => {
    api.auditPreview.mockImplementationOnce(async () => {
      throw Object.assign(new Error('x'), { hint: 'inventory_not_allowed' });
    });
    await card();
    await act('audit-sync');
    expect(el.querySelector('.cls-err').textContent).toContain('You are not allowed to read stock');
    await act('audit-sync');
    expect(el.querySelector('.cls-audit').getAttribute('data-state')).toBe('preview');
  });
  it('reads the stock once however fast the button is pressed', async () => {
    let release;
    api.auditPreview.mockImplementation(() => new Promise((r) => (release = () => r(PREVIEW))));
    await card();
    el.querySelector('[data-act="audit-sync"]').click();
    await tick();
    expect(el.querySelector('[data-act="audit-sync"]').disabled).toBe(true);
    expect(el.querySelector('[data-act="audit-sync"]').textContent).toContain('Reading stock');
    el.querySelector('[data-act="audit-sync"]').click();
    await tick();
    expect(api.auditPreview).toHaveBeenCalledTimes(1);
    release();
    await tick();
    expect(el.querySelector('.cls-audit').getAttribute('data-state')).toBe('preview');
  });
  it('shows the frozen audit at once when the draft already has one (a reopened closing keeps its original)', async () => {
    api.readAudit.mockImplementation(async () => SNAP);
    await card();
    expect(el.querySelector('.cls-audit').getAttribute('data-state')).toBe('verified');
    expect(el.querySelector('[data-act="audit-sync"]')).toBeNull();
    expect(api.auditPreview).not.toHaveBeenCalled();
  });
  it('shows "not verified yet" rather than failing when the saved audit cannot be read', async () => {
    api.readAudit.mockImplementation(async () => {
      throw new Error('offline');
    });
    await card();
    expect(el.querySelector('[data-act="audit-sync"]')).not.toBeNull();
  });
  it('has no audit step on the opening closing', async () => {
    api.loadByKey.mockImplementation(async () => ({ ...ROW, is_opening: true, mode: 'final' }));
    await card([], { mode: 'final', opening: true });
    expect(el.textContent).toContain('The opening closing has no inventory audit step.');
    expect(el.querySelector('[data-act="audit-sync"]')).toBeNull();
    expect(api.readAudit).not.toHaveBeenCalled();
  });
  it('offers the owner the requirement switch, and nobody else', async () => {
    await card();
    expect(el.querySelector('[data-act="audit-toggle"]')).toBeNull();
    await card(['settings.manage']);
    expect(el.querySelector('[data-act="audit-toggle"]').textContent).toContain('Switch the requirement off');
  });
});
