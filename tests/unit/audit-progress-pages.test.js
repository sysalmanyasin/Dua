// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../js/modules/audit/data/api.js', () => ({
  compileOverview: vi.fn(),
  compiledRows: vi.fn(async () => ({ rows: [], total: 0 })),
  roundOverview: vi.fn(),
  assignmentProgress: vi.fn(),
  attentionSummary: vi.fn(),
  myAssignments: vi.fn(async () => []),
  listEngagements: vi.fn(async () => []),
  engagementOverview: vi.fn(),
  listPeopleForAudit: vi.fn(async () => []),
  forceSubmit: vi.fn(async () => ({})),
  reopenAssignment: vi.fn(async () => ({})),
}));
const api = await import('../../js/modules/audit/data/api.js');
const compile = await import('../../js/modules/audit/ui/compile.js');
const round = await import('../../js/modules/audit/ui/round.js');
const hub = await import('../../js/modules/audit/ui/hub.js');
const attention = await import('../../js/modules/audit/ui/attention.js');
const { setView, getView } = await import('../../js/modules/audit/domain/nav.js');

const flush = async () => {
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
};
const progressRes = () => ({
  assignment: { id: 'a1', name: 'Count One', status: 'counting', round_state: 'counting' },
  items: [
    { round_item_id: 'i1', code: 'A1', name: 'Alpha one', company: 'Acme', counted: true, qty: 4, auto_matched: false, note: '' },
    { round_item_id: 'i2', code: 'A2', name: 'Alpha two', company: 'Acme', counted: false, qty: null, auto_matched: false, note: '' },
  ],
});
const compileOv = (state = 'counting') => ({
  round: { id: 'r1', engagement_id: 'e1', round_number: 1, round_suffix: null, unit: 'item', state, version: 3, items: 2 },
  assignments: [{ id: 'a1', auditor_id: 'u1', name: 'Count One', status: 'counting', items: 2, counted: 1, revisions: 0, forced: false }],
  compilation: null,
  history: [],
  conflicts: [],
  corrections: [],
});

describe('person panel on the Review page', () => {
  let el;
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    setView({ engagement: 'e1', round: 'r1' });
    el = document.createElement('div');
    document.body.replaceChildren(el);
    api.compileOverview.mockResolvedValue(compileOv());
    api.assignmentProgress.mockResolvedValue(progressRes());
  });

  it('opens a person’s items with the not-counted ones first, beside Force submit', async () => {
    await compile.mount(el, { ctx: { permissions: ['audit.manage', 'audit.compile', 'audit.assign'] } });
    expect(el.querySelector('[data-form="force"]')).not.toBeNull();
    el.querySelector('button[data-peek="a1"]').click();
    await flush();
    expect(api.assignmentProgress).toHaveBeenCalledWith('a1');
    const panel = el.querySelector('[data-prog]');
    expect(panel.textContent).toContain('1 of 2 counted');
    expect(panel.textContent).toContain('Alpha two');
    expect(panel.textContent).not.toContain('Alpha one');
    expect(panel.textContent).toContain('Not counted');
    expect(el.querySelector('[data-form="force"]')).not.toBeNull();
  });
  it('switches filters and closes again', async () => {
    await compile.mount(el, { ctx: { permissions: ['audit.manage', 'audit.compile', 'audit.assign'] } });
    el.querySelector('button[data-peek="a1"]').click();
    await flush();
    el.querySelector('button[data-pf="counted"]').click();
    expect(el.querySelector('[data-prog]').textContent).toContain('Counted 4');
    expect(el.querySelector('[data-prog]').textContent).not.toContain('Alpha two');
    el.querySelector('button[data-peek="a1"]').click();
    await flush();
    expect(el.querySelector('[data-prog]')).toBeNull();
  });
  it('shows a friendly message when the database refuses', async () => {
    api.assignmentProgress.mockRejectedValue({ hint: 'not_allowed', message: 'not allowed' });
    await compile.mount(el, { ctx: { permissions: ['audit.manage', 'audit.compile', 'audit.assign'] } });
    el.querySelector('button[data-peek="a1"]').click();
    await flush();
    expect(el.querySelector('[data-prog] , .note-error')).not.toBeNull();
    expect(el.querySelector('[role="alert"]')).not.toBeNull();
  });
  it('shows no Items button to a person without a viewing key', async () => {
    await compile.mount(el, { ctx: { permissions: ['audit.review'] } });
    expect(el.querySelector('button[data-peek]')).toBeNull();
  });
});

describe('person panel on the Round page', () => {
  it('opens the same panel', async () => {
    vi.clearAllMocks();
    setView({ engagement: 'e1', round: 'r1' });
    const el = document.createElement('div');
    document.body.replaceChildren(el);
    api.roundOverview.mockResolvedValue({
      round: { id: 'r1', engagement_id: 'e1', round_number: 1, round_suffix: null, unit: 'item', state: 'counting', version: 3, items: 2 },
      assignments: [{ id: 'a1', auditor_id: 'u1', name: 'Count One', status: 'counting', items: 2, companies: 1 }],
      companies: [{ company: 'Acme', items: 2, unassigned: 0 }],
    });
    api.assignmentProgress.mockResolvedValue(progressRes());
    await round.mount(el, { ctx: { permissions: ['audit.assign', 'audit.view'] } });
    el.querySelector('button[data-peek="a1"]').click();
    await flush();
    expect(el.querySelector('[data-prog]').textContent).toContain('Alpha two');
  });
});

describe('hub badges and the attention page', () => {
  const summary = {
    ready: [{ engagement_id: 'e1', engagement_name: 'Annual', round_id: 'r1', round_label: '1', n: 1 }],
    conflicts: [{ engagement_id: 'e1', engagement_name: 'Annual', round_id: 'r2', round_label: '2', n: 2 }],
    corrections: [],
  };
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    location.hash = '';
  });

  it('shows exact counts only for what the person can act on', async () => {
    api.attentionSummary.mockResolvedValue(summary);
    const el = document.createElement('div');
    document.body.replaceChildren(el);
    await hub.mount(el, { ctx: { permissions: ['audit.compile', 'audit.review', 'audit.view'] } });
    const badges = [...el.querySelectorAll('[data-attn]')];
    expect(badges.map((b) => b.dataset.attn)).toEqual(['ready', 'conflicts']);
    expect(badges[0].textContent).toContain('1');
    expect(badges[1].textContent).toContain('2');
    expect(badges[1].textContent).toContain('open conflicts');
    expect(badges[0].getAttribute('href')).toBe('#/audit/attention');
  });
  it('does not ask for badges when the person has neither key', async () => {
    const el = document.createElement('div');
    document.body.replaceChildren(el);
    await hub.mount(el, { ctx: { permissions: ['audit.view'] } });
    expect(api.attentionSummary).not.toHaveBeenCalled();
    expect(el.querySelector('[data-attn]')).toBeNull();
  });
  it('still opens the hub when the badges cannot load', async () => {
    api.attentionSummary.mockRejectedValue(new Error('boom'));
    const el = document.createElement('div');
    document.body.replaceChildren(el);
    await hub.mount(el, { ctx: { permissions: ['audit.compile', 'audit.view'] } });
    expect(el.textContent).toContain('Audit Overview');
    expect(el.querySelector('[data-attn]')).toBeNull();
  });
  it('lists exactly what each badge counts and opens the round', async () => {
    api.attentionSummary.mockResolvedValue(summary);
    const el = document.createElement('div');
    document.body.replaceChildren(el);
    await attention.mount(el);
    expect(el.querySelector('[data-attn-list="ready"] li').textContent.replace(/\s+/g, ' ')).toContain('Annual · Round 1');
    expect(el.querySelector('[data-attn-list="conflicts"] li').textContent.replace(/\s+/g, ' ')).toContain('2 conflicts');
    expect(el.querySelector('[data-attn-list="corrections"]')).toBeNull();
    el.querySelector('[data-attn-list="conflicts"] button[data-open]').click();
    expect(location.hash).toBe('#/audit/compile');
    expect(getView()).toEqual({ engagement: 'e1', round: 'r2' });
  });
  it('says so when nothing waits, and shows an error when the call fails', async () => {
    api.attentionSummary.mockResolvedValue({ ready: [], conflicts: [], corrections: [] });
    let el = document.createElement('div');
    document.body.replaceChildren(el);
    await attention.mount(el);
    expect(el.querySelector('[data-empty]')).not.toBeNull();
    api.attentionSummary.mockRejectedValue({ hint: 'not_allowed', message: 'not allowed' });
    el = document.createElement('div');
    document.body.replaceChildren(el);
    await attention.mount(el);
    expect(el.textContent).toContain('Could not load');
  });
});
