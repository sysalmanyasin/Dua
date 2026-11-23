// @vitest-environment jsdom
// The Download buttons on the Reports page and in the Barcode Center, with the file building replaced.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../js/modules/audit/ui/exports.js', () => ({
  exportable: (rounds) => rounds.filter((r) => r.state === 'compiled' || r.state === 'final'),
  exportRound: vi.fn(async () => {}),
  exportAllRounds: vi.fn(async () => 0),
  exportBarcodes: vi.fn(async () => {}),
}));
vi.mock('../../js/modules/audit/data/api.js', () => ({
  listEngagements: vi.fn(async () => [{ id: 'e1', name: 'Annual audit' }]),
  reportEngagement: vi.fn(),
  auditTrail: vi.fn(async () => ({ rows: [] })),
  listBarcodes: vi.fn(async () => []),
}));
const api = await import('../../js/modules/audit/data/api.js');
const ex = await import('../../js/modules/audit/ui/exports.js');
const { mount } = await import('../../js/modules/audit/ui/reports.js');
const { mountAdminTab, resetAdminTab } = await import('../../js/modules/audit/ui/barcodeAdmin.js');
const { setView } = await import('../../js/modules/audit/domain/nav.js');

const rounds = [
  { id: 'r1', label: '1', state: 'final', items: 6, people: 2 },
  { id: 'r2', label: '1A', state: 'compiled', items: 2, people: 1 },
  { id: 'r3', label: '2', state: 'counting', items: 4, people: 1 },
];
const report = (over = {}) => ({
  engagement: { id: 'e1', name: 'Annual audit', created_at: '2026-11-01T00:00:00Z' },
  rounds,
  people: [],
  ...over,
});
const owner = { ctx: { permissions: ['audit.manage'] } };
const root = () => document.getElementById('root');
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const until = async (fn) => {
  for (let i = 0; i < 100; i++) {
    if (fn()) return;
    await tick(5);
  }
  throw new Error('timed out waiting');
};

beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>';
  sessionStorage.clear();
  setView({ engagement: 'e1' });
  vi.clearAllMocks();
  api.reportEngagement.mockResolvedValue(report());
});

describe('Download on the Reports page', () => {
  it('offers only rounds that have results, the newest-listed first', async () => {
    await mount(root(), owner);
    const options = [...root().querySelectorAll('select[data-field="export-round"] option')].map((o) => o.textContent);
    expect(options).toEqual(['Round 1', 'Round 1A']);
  });

  it('has no Download card while no round has results', async () => {
    api.reportEngagement.mockResolvedValue(report({ rounds: [rounds[2]] }));
    await mount(root(), owner);
    expect(root().querySelector('[aria-label="Download"]')).toBeNull();
  });

  it('a round button builds that round’s file with the audit’s name', async () => {
    await mount(root(), owner);
    root().querySelector('select[data-field="export-round"]').value = 'r2';
    root()
      .querySelector('select[data-field="export-round"]')
      .dispatchEvent(new Event('change', { bubbles: true }));
    root().querySelector('button[data-export="notes"]').click();
    await until(() => ex.exportRound.mock.calls.length > 0);
    expect(ex.exportRound).toHaveBeenCalledWith('Annual audit', rounds[1], 'notes');
    await until(() => root().querySelector('[data-export-note]').textContent === 'Done.');
  });

  it('the all-rounds buttons pass every round, and say how many were left out', async () => {
    ex.exportAllRounds.mockResolvedValueOnce(1);
    await mount(root(), owner);
    root().querySelector('button[data-export-all="xlsx"]').click();
    await until(() => ex.exportAllRounds.mock.calls.length > 0);
    expect(ex.exportAllRounds.mock.calls[0].slice(0, 3)).toEqual(['Annual audit', rounds, 'xlsx']);
    await until(() => root().querySelector('[data-export-note]').textContent.includes('1 round was left out'));
  });

  it('a refusal is shown in words and the buttons come back', async () => {
    ex.exportRound.mockRejectedValueOnce(new Error('This round has not been compiled yet.'));
    await mount(root(), owner);
    root().querySelector('button[data-export="variance"]').click();
    await until(() => root().querySelector('[role="alert"]'));
    expect(root().querySelector('[role="alert"]').textContent).toContain('not been compiled');
    expect(root().querySelector('button[data-export="variance"]').disabled).toBe(false);
  });

  it('keeps the buttons off while a file is being made', async () => {
    let done;
    ex.exportRound.mockReturnValueOnce(new Promise((r) => (done = r)));
    await mount(root(), owner);
    root().querySelector('button[data-export="xlsx"]').click();
    await until(() => root().querySelector('button[data-export="xlsx"]').disabled);
    done();
    await until(() => !root().querySelector('button[data-export="xlsx"]').disabled);
  });
});

describe('Download in the Barcode Center', () => {
  const mountMaster = async (isAdmin) => {
    resetAdminTab?.();
    const el = root();
    await mountAdminTab('master', { el, isAdmin, prefill: () => null, clearPrefill() {}, startScan() {} });
  };

  it('is for administrators only', async () => {
    await mountMaster(false);
    expect(root().querySelector('[data-bc-export]')).toBeNull();
    await mountMaster(true);
    expect([...root().querySelectorAll('[data-bc-export]')].map((b) => b.dataset.bcExport)).toEqual([
      'xlsx',
      'master',
      'verification',
      'conflicts',
      'history',
    ]);
  });

  it('a button builds that file and says when it is done', async () => {
    await mountMaster(true);
    root().querySelector('[data-bc-export="verification"]').click();
    await until(() => root().querySelector('[data-bc-note]').textContent === 'Done.');
    expect(ex.exportBarcodes.mock.calls[0][0]).toBe('verification');
  });

  it('shows a refusal where the buttons are', async () => {
    ex.exportBarcodes.mockRejectedValueOnce(new Error('Not allowed.'));
    await mountMaster(true);
    root().querySelector('[data-bc-export="master"]').click();
    await until(() => root().querySelector('[data-bc-note]').textContent === 'Not allowed.');
    expect(root().querySelector('[data-bc-export="master"]').disabled).toBe(false);
  });
});
