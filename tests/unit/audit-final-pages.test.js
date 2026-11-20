// @vitest-environment jsdom
// The Final Snapshot screen and the Reports screen, with the database layer mocked.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../js/modules/audit/data/api.js', () => ({
  compileOverview: vi.fn(),
  finalizeRound: vi.fn(async () => ({})),
  finalOverview: vi.fn(),
  finalLines: vi.fn(),
  finalLinesAll: vi.fn(async () => []),
  listEngagements: vi.fn(async () => [{ id: 'e1', name: 'November audit' }]),
  reportEngagement: vi.fn(),
  auditTrail: vi.fn(),
}));
const api = await import('../../js/modules/audit/data/api.js');
const final = await import('../../js/modules/audit/ui/final.js');
const reports = await import('../../js/modules/audit/ui/reports.js');
const { setView } = await import('../../js/modules/audit/domain/nav.js');

const owner = { ctx: { permissions: ['audit.manage'] } };
const deputy = { ctx: { permissions: ['audit.view'] } };
const compiled = (over = {}) => ({
  round: { id: 'r1', engagement_id: 'e1', round_number: 1, round_suffix: null, state: 'compiled', version: 7, items: 6, ...over.round },
  compilation: { id: 'c1', revision: 2, with_missing: false, item_count: 6, variance_count: 2, variance_value: -567 },
  conflicts: over.conflicts ?? [],
  corrections: over.corrections ?? [],
  assignments: [],
});
const finalOv = () => ({
  round: { id: 'r1', label: '1', state: 'final', version: 8 },
  engagement: { id: 'e1', name: 'November audit' },
  final: {
    id: 'f1',
    finalized_at: '2026-11-18T08:00:00Z',
    finalized_by: 'Test Owner',
    note: 'first count',
    with_missing: false,
    item_count: 6,
    variance_count: 2,
    variance_value: -567,
    missing_count: 1,
    conflict_count: 1,
    conflict_changed: 1,
    compilation_revision: 2,
  },
  companies: [{ company: 'Acme', items: 2, variance_count: 2, shortage_value: -567, excess_value: 0, variance_value: -567 }],
  conflicts: [
    {
      company: 'Acme',
      code: 'A1',
      name: 'Alpha one',
      side: 'b',
      counted_qty: 7,
      final_qty: 6,
      reason: 'shelf recount',
      by: 'Owner',
      at: 'x',
    },
  ],
});
const lines = () => [
  {
    total: 2,
    round_item_id: 'i1',
    position: 1,
    company: 'Acme',
    code: 'A1',
    name: 'Alpha one',
    system_qty: 10,
    retail_price: 100.5,
    counted_qty: 7,
    final_qty: 6,
    variance: -4,
    variance_value: -402,
    missing: false,
    auto_matched: false,
    auditor_name: 'Count One',
    note: '',
    conflict_side: 'b',
  },
];
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const until = async (fn) => {
  for (let i = 0; i < 200; i++) {
    if (fn()) return;
    await tick(15);
  }
  throw new Error('timed out waiting');
};
const root = () => document.getElementById('root');
const click = (sel) => root().querySelector(sel).click();

beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>';
  vi.clearAllMocks();
  setView({ engagement: 'e1', round: 'r1' });
});

describe('Final Snapshot screen: before the final', () => {
  it('asks twice before making a round final, then sends the version it saw', async () => {
    api.compileOverview.mockResolvedValue(compiled());
    await final.mount(root(), owner);
    expect(root().textContent).toContain('Create the Final Snapshot');
    expect(root().textContent).toContain('2 of 6 items differ');
    click('[data-act="finalize"]');
    await until(() => root().querySelector('[data-act="finalize-yes"]'));
    expect(api.finalizeRound).not.toHaveBeenCalled();
    api.compileOverview.mockResolvedValue(compiled({ round: { state: 'final', version: 8 } }));
    api.finalOverview.mockResolvedValue(finalOv());
    api.finalLines.mockResolvedValue(lines());
    click('[data-act="finalize-yes"]');
    await until(() => api.finalizeRound.mock.calls.length === 1);
    expect(api.finalizeRound.mock.calls[0][0]).toMatchObject({ roundId: 'r1', version: 7 });
    await until(() => root().textContent.includes('Made final'));
  });
  it('blocks the button while a conflict or correction is open', async () => {
    api.compileOverview.mockResolvedValue(
      compiled({ conflicts: [{ id: 'k1', resolved_side: null }], corrections: [{ id: 'c', status: 'proposed' }] }),
    );
    await final.mount(root(), owner);
    expect(root().textContent).toContain('1 conflict is not settled');
    expect(root().textContent).toContain('1 correction is waiting');
    expect(root().querySelector('[data-act="finalize"]').disabled).toBe(true);
  });
  it('shows the database refusal in words', async () => {
    api.compileOverview.mockResolvedValue(compiled());
    api.finalizeRound.mockRejectedValueOnce(Object.assign(new Error('x'), { hint: 'compile_stale' }));
    await final.mount(root(), owner);
    click('[data-act="finalize"]');
    await until(() => root().querySelector('[data-act="finalize-yes"]'));
    click('[data-act="finalize-yes"]');
    await until(() => root().textContent.includes('Compile again, then create the final'));
  });
  it('offers no button to someone who cannot finalize', async () => {
    api.compileOverview.mockResolvedValue(compiled());
    await final.mount(root(), deputy);
    expect(root().querySelector('[data-act="finalize"]')).toBeNull();
    expect(root().textContent).toContain('Only the owner can make a round final');
  });
  it('says so when the round is not compiled', async () => {
    api.compileOverview.mockResolvedValue(compiled({ round: { state: 'counting' } }));
    await final.mount(root(), owner);
    expect(root().textContent).toContain('Not final yet');
  });
});

describe('Final Snapshot screen: after the final', () => {
  beforeEach(() => {
    api.compileOverview.mockResolvedValue(compiled({ round: { state: 'final', version: 8 } }));
    api.finalOverview.mockResolvedValue(finalOv());
    api.finalLines.mockResolvedValue(lines());
  });
  it('shows totals, companies, conflict choices and lines', async () => {
    await final.mount(root(), owner);
    const t = root().textContent;
    expect(t).toContain('Final · Round 1');
    expect(t).toContain('Acme');
    expect(t).toContain('kept the earlier round');
    expect(t).toContain('Alpha one');
    expect(t).toContain('first count');
  });
  it('shows no way to change anything', async () => {
    await final.mount(root(), owner);
    expect(root().querySelector('[data-act="finalize"]')).toBeNull();
    expect(root().querySelector('[data-act="finalize-yes"]')).toBeNull();
  });
  it('hides print and CSV from someone without the report key', async () => {
    await final.mount(root(), deputy);
    expect(root().querySelector('[data-act="print"]')).toBeNull();
    expect(root().querySelector('[data-act="csv"]')).toBeNull();
  });
  it('asks for every line when downloading the CSV', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    api.finalLinesAll.mockResolvedValue(lines());
    await final.mount(root(), owner);
    click('[data-act="csv"]');
    await until(() => api.finalLinesAll.mock.calls.length === 1);
    expect(api.finalLinesAll).toHaveBeenCalledWith('r1', false);
    await until(() => URL.createObjectURL.mock.calls.length === 1);
  });
  it('prints only the lines that differ', async () => {
    window.print = vi.fn();
    api.finalLinesAll.mockResolvedValue(lines());
    await final.mount(root(), owner);
    click('[data-act="print"]');
    await until(() => window.print.mock.calls.length === 1);
    expect(api.finalLinesAll).toHaveBeenCalledWith('r1', true);
    expect(document.getElementById('aud-print-root').textContent).toContain('Alpha one');
    window.dispatchEvent(new Event('afterprint'));
    expect(document.getElementById('aud-print-root')).toBeNull();
    expect(document.body.classList.contains('aud-printing')).toBe(false);
  });
  it('asks the database for the next page', async () => {
    api.finalLines.mockResolvedValue(Array.from({ length: 50 }, (_, i) => ({ ...lines()[0], total: 120, round_item_id: `i${i}` })));
    await final.mount(root(), owner);
    click('[data-act="next"]');
    await until(() => api.finalLines.mock.calls.length === 2);
    expect(api.finalLines.mock.calls[1][0]).toMatchObject({ offset: 50, limit: 50 });
  });
});

describe('Reports screen', () => {
  const rep = () => ({
    engagement: { id: 'e1', name: 'November audit', created_at: '2026-11-17T08:00:00Z' },
    rounds: [
      {
        id: 'r1',
        label: '1',
        state: 'final',
        items: 6,
        people: 2,
        forced: 0,
        variance_count: 2,
        variance_value: -567,
        final_variance_count: 2,
        final_variance_value: -567,
      },
      { id: 'r2', label: '2', state: 'counting', items: 2, people: 1, forced: 0, variance_count: null, variance_value: null },
    ],
    people: [{ name: 'Count One', round: '1', status: 'submitted', items: 3 }],
  });
  const trail = (n = 2) => ({
    rows: Array.from({ length: n }, (_, i) => ({
      id: 100 - i,
      at: '2026-11-18T08:00:00Z',
      action: 'audit.finalized',
      actor: 'Test Owner',
      reason: null,
    })),
  });
  it('lists the rounds, people and trail for the chosen audit', async () => {
    api.reportEngagement.mockResolvedValue(rep());
    api.auditTrail.mockResolvedValue(trail());
    await reports.mount(root(), owner);
    const t = root().textContent;
    expect(t).toContain('November audit');
    expect(t).toContain('Count One');
    expect(t).toContain('Final snapshot created');
    expect(api.reportEngagement).toHaveBeenCalledWith('e1');
  });
  it('does not ask for the trail without report or review', async () => {
    api.reportEngagement.mockResolvedValue(rep());
    await reports.mount(root(), deputy);
    expect(api.auditTrail).not.toHaveBeenCalled();
    expect(root().textContent).not.toContain('Audit trail');
  });
  it('pages the trail backwards by the smallest id it has', async () => {
    api.reportEngagement.mockResolvedValue(rep());
    api.auditTrail.mockResolvedValue(trail(50));
    await reports.mount(root(), owner);
    api.auditTrail.mockResolvedValue(trail(1));
    click('[data-act="more"]');
    await until(() => api.auditTrail.mock.calls.length === 2);
    expect(api.auditTrail.mock.calls[1][0]).toMatchObject({ engagementId: 'e1', before: 51 });
  });
  it('opens a final round on the final screen', async () => {
    api.reportEngagement.mockResolvedValue(rep());
    api.auditTrail.mockResolvedValue(trail());
    await reports.mount(root(), owner);
    click('[data-act="open"][data-id="r1"]');
    expect(location.hash).toBe('#/audit/final');
  });
  it('explains a refusal in words', async () => {
    api.reportEngagement.mockRejectedValue(Object.assign(new Error('x'), { hint: 'not_allowed' }));
    await reports.mount(root(), owner);
    expect(root().textContent).toContain('not allowed');
  });
});
