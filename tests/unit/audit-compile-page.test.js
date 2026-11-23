// @vitest-environment jsdom
// The review screen: progress, Force Submit, compile, differences, corrections, conflicts and the next round, with the database mocked.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../js/modules/audit/data/api.js', () => ({
  compileOverview: vi.fn(),
  compiledRows: vi.fn(),
  compileRound: vi.fn(async () => ({})),
  forceSubmit: vi.fn(async () => ({})),
  reopenAssignment: vi.fn(async () => ({})),
  proposeCorrection: vi.fn(async () => 'c1'),
  decideCorrection: vi.fn(async () => ({})),
  resolveConflict: vi.fn(async () => ({})),
  nextRound: vi.fn(async () => ({ round_id: 'r1a', round_number: 1, round_suffix: 'A', items: 4 })),
}));
const api = await import('../../js/modules/audit/data/api.js');
const { mount } = await import('../../js/modules/audit/ui/compile.js');
const { setView, getView } = await import('../../js/modules/audit/domain/nav.js');

const owner = { ctx: { permissions: ['audit.manage'] } };
const overview = (over = {}) => ({
  round: {
    id: 'r1',
    engagement_id: 'e1',
    round_number: 1,
    round_suffix: null,
    unit: 'item',
    state: 'compiled',
    version: 7,
    items: 6,
    ...over.round,
  },
  assignments: [
    { id: 'a1', auditor_id: 'u1', name: 'Count One', status: 'submitted', items: 3, counted: 3, revisions: 1, forced: false },
    { id: 'a2', auditor_id: 'u2', name: 'Count Two', status: 'submitted', items: 3, counted: 0, revisions: 1, forced: true },
  ],
  compilation: {
    id: 'c1',
    revision: 2,
    compiled_at: '2026-11-17T08:00:00Z',
    with_missing: false,
    missing_assignment_ids: [],
    item_count: 6,
    variance_count: 2,
    variance_value: -301.5,
    auditor_notes: [{ auditor_id: 'u1', note: 'Two boxes were damaged' }],
  },
  history: [
    { revision: 2, compiled_at: '2026-11-17T08:00:00Z', with_missing: false, variance_count: 2, variance_value: -301.5 },
    { revision: 1, compiled_at: '2026-11-17T07:00:00Z', with_missing: false, variance_count: 3, variance_value: -400 },
  ],
  conflicts: [
    {
      id: 'k1',
      company: 'Acme',
      code: 'A1',
      name: 'Alpha one',
      a_round: '1A',
      a_qty: 7,
      a_name: 'Count Two',
      b_round: '1',
      b_qty: 9,
      b_name: 'Count One',
      resolved_side: null,
    },
  ],
  corrections: [
    {
      id: 'cr1',
      round_item_id: 'i1',
      code: 'A1',
      name: 'Alpha one',
      company: 'Acme',
      system_qty: 10,
      counted_qty: 6,
      status: 'proposed',
      reason: 'recount',
      decision_note: '',
      proposed_by: 'Dep One',
      proposed_at: '2026-11-17T08:30:00Z',
      decided_by: null,
      decided_at: null,
    },
  ],
  ...over.rest,
});
const rows = () => ({
  rows: [
    {
      round_item_id: 'i1',
      position: 1,
      company: 'Acme',
      code: 'A1',
      name: 'Alpha one',
      system_qty: 10,
      retail_price: 100.5,
      counted_qty: 7,
      variance: -3,
      variance_value: -301.5,
      missing: false,
      auto_matched: false,
      auditor_id: 'u1',
      note: '',
      corrected_by: null,
    },
  ],
  total: 1,
});
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
const fill = (sel, value) => {
  const i = root().querySelector(sel);
  i.value = value;
  i.dispatchEvent(new Event('input', { bubbles: true }));
  i.dispatchEvent(new Event('change', { bubbles: true }));
};

beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>';
  vi.clearAllMocks();
  setView({ round: 'r1' });
  api.compileOverview.mockResolvedValue(overview());
  api.compiledRows.mockResolvedValue(rows());
});

describe('review screen', () => {
  it('shows progress, the result with its value, counter notes and the differing items', async () => {
    await mount(root(), owner);
    const t = root().textContent;
    expect(t).toContain('Round 1 · review');
    expect(t).toContain('Count Two');
    expect(t).toContain('forced by the owner');
    expect(t).toContain('2 of 6 items differ');
    expect(t).toContain('-Rs 301.50');
    expect(t).toContain('Two boxes were damaged');
    expect(t).toContain('Earlier compiles (1)');
    expect(t).toContain('-3 (-Rs 301.50)');
    expect(api.compiledRows).toHaveBeenCalledWith(expect.objectContaining({ compilationId: 'c1', mode: 'diff', from: 0, to: 49 }));
  });

  it('refuses to compile with people missing until the owner chooses to, then sends the version it saw', async () => {
    api.compileOverview.mockResolvedValue(
      overview({
        round: { state: 'counting' },
        rest: {
          compilation: null,
          assignments: [
            { id: 'a1', auditor_id: 'u1', name: 'Count One', status: 'counting', items: 3, counted: 1, revisions: 0, forced: false },
          ],
        },
      }),
    );
    await mount(root(), owner);
    expect(root().textContent).toContain('Not submitted yet: Count One');
    expect(root().querySelector('button[data-act="compile"]').disabled).toBe(true);
    const box = root().querySelector('input[data-field="allow"]');
    box.checked = true;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    expect(root().querySelector('button[data-act="compile"]').disabled).toBe(false);
    click('button[data-act="compile"]');
    await until(() => api.compileRound.mock.calls.length === 1);
    expect(api.compileRound).toHaveBeenCalledWith({ roundId: 'r1', allowMissing: true, version: 7 });
  });

  it('force submits with a chosen mode and a reason', async () => {
    api.compileOverview.mockResolvedValue(
      overview({
        round: { state: 'counting' },
        rest: {
          assignments: [
            { id: 'a2', auditor_id: 'u2', name: 'Count Two', status: 'counting', items: 3, counted: 1, revisions: 0, forced: false },
          ],
        },
      }),
    );
    await mount(root(), owner);
    click('button[data-form="force"]');
    root().querySelector('input[value="match"]').click();
    fill('input[data-field="mode"][value="match"]', 'match');
    fill('input[data-field="reason"]', 'phone died');
    click('button[data-act="force-yes"]');
    await until(() => api.forceSubmit.mock.calls.length === 1);
    expect(api.forceSubmit).toHaveBeenCalledWith({ assignmentId: 'a2', mode: 'match', reason: 'phone died' });
  });

  it('reopens a submitted count with a reason', async () => {
    await mount(root(), owner);
    click('button[data-form="reopen"]');
    fill('input[data-field="reason"]', 'miscounted a shelf');
    click('button[data-act="reopen-yes"]');
    await until(() => api.reopenAssignment.mock.calls.length === 1);
    expect(api.reopenAssignment).toHaveBeenCalledWith({ assignmentId: 'a1', reason: 'miscounted a shelf' });
  });

  it('searches the items after a short pause', async () => {
    await mount(root(), owner);
    fill('input[data-f="text"]', 'alpha');
    await until(() => api.compiledRows.mock.calls.some((c) => c[0].text === 'alpha'));
    const mode = root().querySelector('select[data-f="mode"]');
    mode.value = 'all';
    mode.dispatchEvent(new Event('change', { bubbles: true }));
    await until(() => api.compiledRows.mock.calls.some((c) => c[0].mode === 'all'));
  });

  it('proposes a correction: a bad number is caught on the screen, a good one is sent', async () => {
    await mount(root(), { ctx: { permissions: ['audit.view', 'audit.suggest'] } });
    click('button[data-form="suggest"]');
    fill('input[data-field="qty"]', 'x');
    fill('input[data-field="reason"]', 'recounted');
    click('button[data-act="suggest-yes"]');
    expect(root().textContent).toContain('Enter the correct count');
    expect(api.proposeCorrection).not.toHaveBeenCalled();
    click('button[data-form="suggest"]');
    fill('input[data-field="qty"]', '6');
    fill('input[data-field="reason"]', 'recounted');
    click('button[data-act="suggest-yes"]');
    await until(() => api.proposeCorrection.mock.calls.length === 1);
    expect(api.proposeCorrection).toHaveBeenCalledWith({ roundId: 'r1', itemId: 'i1', qty: 6, reason: 'recounted' });
  });

  it('approves and rejects corrections, with a note on a rejection', async () => {
    await mount(root(), owner);
    click('button[data-act="approve"]');
    await until(() => api.decideCorrection.mock.calls.length === 1);
    expect(api.decideCorrection).toHaveBeenCalledWith({ id: 'cr1', approve: true });
    await until(() => root().querySelector('button[data-act="approve"]') && !root().querySelector('button[data-act="approve"]').disabled);
    click('button[data-form="reject"]');
    fill('input[data-field="reason"]', 'shelf was recounted twice');
    click('button[data-act="reject-yes"]');
    await until(() => api.decideCorrection.mock.calls.length === 2);
    expect(api.decideCorrection).toHaveBeenLastCalledWith({ id: 'cr1', approve: false, note: 'shelf was recounted twice' });
  });

  it('shows a conflict with both counts and records the owner’s choice', async () => {
    await mount(root(), owner);
    expect(root().textContent).toContain('Round 1A: 7');
    click('button[data-form="resolve"][data-side="b"]');
    fill('input[data-field="reason"]', 'the first count was supervised');
    click('button[data-act="resolve-yes"]');
    await until(() => api.resolveConflict.mock.calls.length === 1);
    expect(api.resolveConflict).toHaveBeenCalledWith({ id: 'k1', side: 'b', reason: 'the first count was supervised' });
  });

  it('makes the next round in each mode and goes to it', async () => {
    await mount(root(), owner);
    const sel = root().querySelector('select[data-f="nextMode"]');
    sel.value = 'spot';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    fill('input[data-f="sample"]', '15');
    click('button[data-act="next-round"]');
    await until(() => api.nextRound.mock.calls.length === 1);
    expect(api.nextRound).toHaveBeenCalledWith(expect.objectContaining({ baseRoundId: 'r1', mode: 'spot', sample: 15 }));
    await until(() => location.hash === '#/audit/round');
    expect(getView().round).toBe('r1a');
  });

  it('a person who can only view sees the numbers and no buttons for decisions', async () => {
    await mount(root(), { ctx: { permissions: ['audit.view'] } });
    expect(root().textContent).toContain('2 of 6 items differ');
    for (const sel of [
      'button[data-form="force"]',
      'button[data-form="reopen"]',
      'button[data-act="compile"]',
      'button[data-act="approve"]',
      'button[data-form="resolve"]',
      'button[data-act="next-round"]',
      'button[data-form="suggest"]',
    ])
      expect(root().querySelector(sel)).toBeNull();
  });

  it('shows the database’s sentence when a decision is refused', async () => {
    api.compileRound.mockRejectedValueOnce(Object.assign(new Error('x'), { hint: 'missing_assignments' }));
    api.compileOverview.mockResolvedValue(
      overview({
        rest: {
          assignments: [
            { id: 'a1', auditor_id: 'u1', name: 'Count One', status: 'submitted', items: 3, counted: 3, revisions: 1, forced: false },
          ],
        },
      }),
    );
    await mount(root(), owner);
    click('button[data-act="compile"]');
    await until(() => root().querySelector('[role="alert"]'));
    expect(root().querySelector('[role="alert"]').textContent.length).toBeGreaterThan(10);
  });
});

describe('where the person is and what is next (F4)', () => {
  it('shows the breadcrumb with links up, and no old back link', async () => {
    await mount(root(), owner);
    const crumb = root().querySelector('nav[aria-label="Breadcrumb"]');
    expect([...crumb.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual([
      '#/audit/engagements',
      '#/audit/engagement',
      '#/audit/round',
    ]);
    expect(crumb.querySelector('[aria-current="page"]').textContent).toBe('Review');
    expect(root().textContent).not.toContain('Back to the round');
  });

  it('shows the pipeline with the compile result and no button for a step that is this page', async () => {
    await mount(root(), owner);
    const strip = root().querySelector('.aud-pipe');
    expect(strip.querySelector('[aria-current="step"]').textContent).toContain('Compiled');
    expect(strip.textContent).toContain('2 differ');
    expect(strip.querySelector('[data-pipe-next]').textContent).toContain('Review and finish');
    expect(strip.querySelector('button[data-pipe]')).toBeNull();
  });

  it('the jump bar has a link for each part with the number that needs a look', async () => {
    await mount(root(), owner);
    const bar = root().querySelector('.aud-stepbar');
    const text = (key) => bar.querySelector(`[data-jump="${key}"]`).textContent.replace(/\s+/g, ' ').trim();
    expect(text('progress')).toBe('Progress 2/2');
    expect(text('differences')).toBe('Differences 2');
    expect(text('corrections')).toBe('Corrections 1');
    expect(text('conflicts')).toBe('Conflicts 1');
    expect(bar.querySelector('[data-jump="next"]')).not.toBeNull();
    const target = root().querySelector('[data-sec="corrections"]');
    target.scrollIntoView = vi.fn();
    bar.querySelector('[data-jump="corrections"]').click();
    expect(target.scrollIntoView).toHaveBeenCalled();
    expect(document.activeElement).toBe(target);
  });

  it('leaves out the jump links for parts that are not on the page', async () => {
    api.compileOverview.mockResolvedValue(overview({ rest: { corrections: [], conflicts: [] } }));
    await mount(root(), { ctx: { permissions: ['audit.review'] } });
    const keys = [...root().querySelectorAll('[data-jump]')].map((b) => b.dataset.jump);
    expect(keys).toEqual(['progress', 'differences']);
  });

  it('shows no banner when nothing is waiting', async () => {
    await mount(root(), owner);
    expect(root().querySelector('[data-recompile]')).toBeNull();
  });

  it('says how many approved corrections are waiting and recompiles with the version it saw', async () => {
    api.compileOverview.mockResolvedValue(
      overview({
        rest: {
          corrections: [
            {
              id: 'x1',
              round_item_id: 'i1',
              code: 'A1',
              name: 'A',
              company: 'Acme',
              system_qty: 1,
              counted_qty: 2,
              status: 'approved',
              reason: 'r',
              proposed_by: 'D',
              proposed_at: '2026-11-17T08:30:00Z',
              decided_by: 'O',
              decided_at: '2026-11-17T09:00:00Z',
            },
            {
              id: 'x2',
              round_item_id: 'i2',
              code: 'A2',
              name: 'B',
              company: 'Acme',
              system_qty: 1,
              counted_qty: 2,
              status: 'approved',
              reason: 'r',
              proposed_by: 'D',
              proposed_at: '2026-11-17T08:30:00Z',
              decided_by: 'O',
              decided_at: '2026-11-17T09:10:00Z',
            },
          ],
        },
      }),
    );
    await mount(root(), owner);
    expect(root().querySelector('[data-recompile]').textContent).toContain('2 approved corrections waiting');
    click('button[data-act="recompile"]');
    await until(() => api.compileRound.mock.calls.length > 0);
    expect(api.compileRound).toHaveBeenCalledWith({ roundId: 'r1', allowMissing: false, version: 7 });
  });

  it('a reopened count that has not been submitted again holds the button back', async () => {
    const ov = overview();
    ov.assignments[0].status = 'counting';
    api.compileOverview.mockResolvedValue(ov);
    await mount(root(), owner);
    const banner = root().querySelector('[data-recompile]');
    expect(banner.textContent).toContain('Count One reopened and not submitted again');
    expect(banner.querySelector('button')).toBeNull();
  });

  it('shows the banner only to someone who can compile', async () => {
    const ov = overview();
    ov.assignments[0].status = 'counting';
    api.compileOverview.mockResolvedValue(ov);
    await mount(root(), { ctx: { permissions: ['audit.review'] } });
    expect(root().querySelector('[data-recompile]')).toBeNull();
  });

  it('while counting, the next step is a button that goes to this page and an earlier step is done', async () => {
    api.compileOverview.mockResolvedValue(overview({ round: { state: 'counting' }, rest: { compilation: null } }));
    await mount(root(), owner);
    expect(root().querySelector('.aud-pipe [aria-current="step"]').textContent).toContain('Counting');
    expect(root().querySelector('[data-pipe-next]').textContent).toContain('Review the counting');
  });
});
