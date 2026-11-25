// @vitest-environment jsdom
// The Audit Overview: exactly five sections, each showing only what the person may act on, each item opening the right screen.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../js/modules/audit/data/api.js', () => ({
  myAssignments: vi.fn(async () => []),
  listEngagements: vi.fn(async () => []),
  attentionSummary: vi.fn(async () => ({ ready: [], conflicts: [], corrections: [] })),
  individualOverview: vi.fn(async () => []),
  engagementOverview: vi.fn(async () => ({ rounds: [] })),
  roundOverview: vi.fn(async () => null),
  compileOverview: vi.fn(async () => null),
  productHistory: vi.fn(async () => []),
}));
const api = await import('../../js/modules/audit/data/api.js');
const { mount } = await import('../../js/modules/audit/ui/hub.js');
const { getView } = await import('../../js/modules/audit/domain/nav.js');
const { activeTeamAudit, individualCard, pendingActions, quickActions } = await import('../../js/modules/audit/domain/overview.js');
const { default: manifest } = await import('../../js/modules/audit/manifest.js');

const OWNER = [
  'audit.manage',
  'audit.view',
  'audit.compile',
  'audit.review',
  'audit.finalize',
  'audit.report',
  'audit.count',
  'audit.individual',
  'audit.templates',
  'audit.expiry_log',
  'audit.barcode_scan',
];
const flush = () => new Promise((r) => setTimeout(r, 0));
const sections = (el) => [...el.querySelectorAll('[data-section]')].map((s) => s.dataset.section);
const text = (el) => el.textContent.replace(/\s+/g, ' ');

const engagements = [
  { id: 'e1', name: 'Annual audit', status: 'open', scope_type: 'team' },
  { id: 'e2', name: 'Individual audits', status: 'open', scope_type: 'individual' },
];
const individualRow = (x = {}) => ({
  person_id: 'p1',
  person_name: 'Count One',
  engagement_id: 'e2',
  round_id: 'r9',
  round_label: '1',
  state: 'compiled',
  started_at: '2026-11-02T05:00:00Z',
  item_count: 3,
  variance_count: 1,
  variance_value: -10,
  ...x,
});
const compiledIndividual = (corrections = []) => ({
  round: { id: 'r9', state: 'compiled' },
  assignments: [{ id: 'a1', name: 'Count One', status: 'submitted' }],
  compilation: { compiled_at: '2026-11-03T00:00:00Z', missing_assignment_ids: [] },
  corrections,
  conflicts: [],
});

let el;
const open = async (permissions) => {
  el = document.createElement('div');
  document.body.replaceChildren(el);
  await mount(el, { ctx: { permissions } });
};

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  location.hash = '';
  api.myAssignments.mockResolvedValue([]);
  api.attentionSummary.mockResolvedValue({ ready: [], conflicts: [], corrections: [] });
  api.listEngagements.mockResolvedValue(engagements);
  api.engagementOverview.mockImplementation(async (id) =>
    id === 'e1'
      ? { rounds: [{ id: 'r1', round_number: 1, round_suffix: null, state: 'counting', assignments: 2, items: 10 }] }
      : { rounds: [{ id: 'r9', round_number: 1, round_suffix: null, state: 'compiled', assignments: 1, items: 3 }] },
  );
  api.roundOverview.mockResolvedValue({ round: { id: 'r1' }, assignments: [{ status: 'submitted' }, { status: 'assigned' }] });
  api.compileOverview.mockResolvedValue(compiledIndividual());
  api.individualOverview.mockResolvedValue([
    individualRow(),
    individualRow({ round_id: 'r10', state: 'counting', item_count: null, variance_count: null }),
  ]);
});

describe('audit overview', () => {
  it('has exactly the five agreed sections, in order, and none of the old ones', async () => {
    await open(OWNER);
    expect(sections(el)).toEqual(['quick', 'pending', 'individual', 'team']);
    expect(el.querySelector('[data-search-host] [aria-label], [data-search-host] form, [data-search-host] input')).not.toBeNull();
    expect(text(el)).not.toMatch(/recent activity/i);
  });

  it('quick actions are compact chips to pages the person may open', async () => {
    await open(OWNER);
    const chips = [...el.querySelectorAll('[data-chip]')].map((c) => c.dataset.chip);
    expect(chips).toEqual(expect.arrayContaining(['count', 'individual', 'team', 'reports', 'expiry', 'barcode', 'templates']));
    expect(el.querySelector('[data-chip="team"]').getAttribute('href')).toBe('#/audit/engagements');
  });

  it('lists each pending item on its own row and opens the right screen with the right round', async () => {
    api.attentionSummary.mockResolvedValue({
      ready: [{ engagement_id: 'e1', engagement_name: 'Annual audit', round_id: 'r1', round_label: '1', n: 1 }],
      conflicts: [{ engagement_id: 'e1', engagement_name: 'Annual audit', round_id: 'r1', round_label: '1', n: 2 }],
      corrections: [{ engagement_id: 'e2', engagement_name: 'Individual audits', round_id: 'r9', round_label: '1', n: 1 }],
    });
    await open(OWNER);
    const kinds = [...el.querySelectorAll('[data-pending]')].map((li) => li.dataset.pending);
    expect(kinds).toEqual(['ready', 'conflicts', 'corrections']);
    const hrefs = [...el.querySelectorAll('[data-pending] a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['#/audit/compile', '#/audit/compile', '#/audit/individual-review']);
    el.querySelector('[data-pending="corrections"] a').click();
    expect(getView()).toEqual({ engagement: 'e2', round: 'r9' });
  });

  it('alerts when corrections were approved but the round has not been recompiled', async () => {
    api.compileOverview.mockResolvedValue(compiledIndividual([{ status: 'approved', decided_at: '2026-11-04T00:00:00Z' }]));
    await open(OWNER);
    const row = el.querySelector('[data-pending="recompile"]');
    expect(row).not.toBeNull();
    expect(text(row)).toContain('1 approved correction waiting');
    expect(row.querySelector('a').getAttribute('href')).toBe('#/audit/individual-review');
  });

  it('says nothing is waiting when nothing is', async () => {
    api.compileOverview.mockResolvedValue(compiledIndividual([{ status: 'approved', decided_at: '2026-11-01T00:00:00Z' }]));
    await open(OWNER);
    expect(el.querySelector('[data-section="pending"] [data-empty]')).not.toBeNull();
  });

  it('shows the Individual audit month with its progress and a way in', async () => {
    await open(OWNER);
    expect(el.querySelector('[data-individual-summary]').textContent.replace(/\s+/g, ' ')).toContain(
      '1 person · 2 rounds · 1 done · 1 still counting',
    );
    expect(el.querySelector('[data-individual-waiting]').textContent).toContain('Count One');
    expect(el.querySelector('[data-individual-action]').getAttribute('href')).toBe('#/audit/individuals');
  });

  it('shows the active team audit with how many have submitted and the next step', async () => {
    await open(OWNER);
    expect(text(el.querySelector('[data-team-summary]'))).toContain('Round 1 · Counting');
    expect(text(el.querySelector('[data-team-progress]'))).toContain('1 of 2 submitted');
    const go = el.querySelector('[data-section="team"] [data-open-item]');
    expect(go.textContent.trim()).toBe('Continue');
    expect(go.getAttribute('href')).toBe('#/audit/compile');
    go.click();
    expect(getView()).toEqual({ engagement: 'e1', round: 'r1' });
  });

  it('a person who only counts sees quick actions and their own work, and no search, pending or month', async () => {
    api.myAssignments.mockResolvedValue([
      {
        assignment_id: 'a1',
        engagement_name: 'Annual audit',
        round_number: 1,
        round_suffix: '',
        round_state: 'counting',
        status: 'assigned',
        items: 20,
        counted: 15,
        method: 'auto',
      },
    ]);
    await open(['audit.count']);
    expect(sections(el)).toEqual(['quick', 'team']);
    expect(text(el)).toContain('15 of 20 counted');
    expect(el.querySelector('[data-open-assignment]').textContent).toContain('Continue counting');
    expect(el.querySelector('[data-search-host]')).toBeNull();
    for (const call of ['listEngagements', 'attentionSummary', 'individualOverview']) expect(api[call]).not.toHaveBeenCalled();
  });

  it('a sub-auditor with an open individual round is offered to continue it', async () => {
    api.myAssignments.mockResolvedValue([
      { assignment_id: 'a2', method: 'individual-self-pick', status: 'assigned', round_state: 'counting' },
    ]);
    await open(['audit.individual']);
    expect(sections(el)).toEqual(['quick', 'individual']);
    const a = el.querySelector('[data-individual-action]');
    expect(a.textContent).toBe('Continue counting');
    expect(a.getAttribute('href')).toBe('#/audit/individual');
  });

  it('a sub-auditor with no open round is offered to start one', async () => {
    await open(['audit.individual']);
    expect(el.querySelector('[data-individual-action]').textContent).toBe('Start an individual audit');
  });

  it('keeps the other sections when one cannot load, and says which', async () => {
    api.attentionSummary.mockRejectedValue(new Error('boom'));
    await open(OWNER);
    expect(el.querySelector('[data-section="pending"] .note-error')).not.toBeNull();
    expect(sections(el)).toEqual(['quick', 'pending', 'individual', 'team']);
    expect(el.querySelector('[data-team-summary]')).not.toBeNull();
  });

  it('says there is no active team audit when none is open', async () => {
    api.listEngagements.mockResolvedValue([engagements[1]]);
    await open(OWNER);
    expect(text(el.querySelector('[data-section="team"]'))).toContain('There is no active team audit');
  });

  it('refreshes on request', async () => {
    await open(OWNER);
    const calls = api.listEngagements.mock.calls.length;
    el.querySelector('[data-refresh]').click();
    await flush();
    await flush();
    expect(api.listEngagements.mock.calls.length).toBe(calls + 1);
  });
});

describe('overview rules', () => {
  const routes = manifest.routes;
  it('quick actions leave out what the person cannot open', () => {
    expect(quickActions(routes, ['audit.count']).map((c) => c.key)).toEqual(['count']);
    expect(quickActions(routes, []).length).toBe(0);
  });

  it('an Individual round is never offered for finalization, and a clean compiled team round is', () => {
    const clean = {
      round: { id: 'r1', state: 'compiled' },
      assignments: [],
      compilation: { compiled_at: '2026-11-03T00:00:00Z' },
      corrections: [],
      conflicts: [],
    };
    const items = pendingActions({
      attention: null,
      permissions: ['audit.finalize', 'audit.compile'],
      rounds: [
        { engagementId: 'e1', engagementName: 'A', scopeType: 'team', label: '1', overview: clean },
        { engagementId: 'e2', engagementName: 'B', scopeType: 'individual', label: '1', overview: clean },
      ],
    });
    expect(items.map((i) => [i.engagementId, i.kind])).toEqual([['e1', 'finalize']]);
  });

  it('a round with something still to decide is not offered for finalization', () => {
    const o = {
      round: { id: 'r1', state: 'compiled' },
      assignments: [],
      compilation: { compiled_at: '2026-11-03T00:00:00Z' },
      corrections: [{ status: 'proposed' }],
      conflicts: [],
    };
    const items = pendingActions({
      attention: null,
      permissions: ['audit.finalize'],
      rounds: [{ engagementId: 'e1', engagementName: 'A', scopeType: 'team', label: '1', overview: o }],
    });
    expect(items).toEqual([]);
  });

  it('orders items: ready, recompile, conflicts, corrections, finalize', () => {
    const approved = {
      round: { id: 'r2', state: 'compiled' },
      assignments: [],
      compilation: { compiled_at: '2026-11-03T00:00:00Z' },
      corrections: [{ status: 'approved', decided_at: '2026-11-04T00:00:00Z' }],
      conflicts: [],
    };
    const items = pendingActions({
      attention: {
        ready: [{ engagement_id: 'e1', engagement_name: 'A', round_id: 'r1', round_label: '1', n: 1 }],
        conflicts: [{ engagement_id: 'e1', engagement_name: 'A', round_id: 'r1', round_label: '1', n: 1 }],
        corrections: [{ engagement_id: 'e1', engagement_name: 'A', round_id: 'r1', round_label: '1', n: 1 }],
      },
      permissions: ['audit.compile'],
      rounds: [{ engagementId: 'e1', engagementName: 'A', scopeType: 'team', label: '2', overview: approved }],
    });
    expect(items.map((i) => i.kind)).toEqual(['ready', 'recompile', 'conflicts', 'corrections']);
  });

  it('the Individual card needs no manager rights to offer a start, and prefers continuing an open round', () => {
    expect(individualCard([], { month: '2026-11', canStart: true }).action).toMatchObject({
      label: 'Start an individual audit',
      path: '/audit/individual',
    });
    expect(individualCard([], { month: '2026-11', myOpen: { roundId: 'r' }, canStart: true, canView: true }).action.label).toBe(
      'Continue counting',
    );
    expect(individualCard([], { month: '2026-11' }).action).toBeNull();
  });

  it('the active team audit skips Individual audits and archived ones', () => {
    const list = [
      { id: 'i', status: 'open', scope_type: 'individual', name: 'I' },
      { id: 'x', status: 'archived', scope_type: 'team', name: 'X' },
    ];
    expect(activeTeamAudit({ engagements: list })).toBeNull();
  });
});
