// @vitest-environment jsdom
// The New audit wizard and the "same team as last round" button, with the database mocked.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { companiesOf, extraMembers, sameTeam, scopeProblem, teamProblem } from '../../js/modules/audit/domain/wizard.js';
import { previousRound } from '../../js/modules/audit/domain/pipeline.js';

vi.mock('../../js/modules/audit/data/api.js', () => ({
  listEngagements: vi.fn(async () => []),
  listCompanies: vi.fn(async () => [
    { name: 'Acme', skus: 3, value: 100 },
    { name: 'Beta', skus: 2, value: 50 },
  ]),
  listPeopleForAudit: vi.fn(),
  createEngagement: vi.fn(),
  setMember: vi.fn(async () => ({})),
  createRound: vi.fn(),
  roundOverview: vi.fn(),
  assignAuto: vi.fn(async () => ({})),
  lockRound: vi.fn(async () => ({})),
  startRound: vi.fn(async () => ({})),
  engagementOverview: vi.fn(),
  assignMove: vi.fn(),
  revokeAssignment: vi.fn(),
  companyItemIds: vi.fn(),
}));
const api = await import('../../js/modules/audit/data/api.js');
const { mount: mountAudits } = await import('../../js/modules/audit/ui/engagements.js');
const { mount: mountRound } = await import('../../js/modules/audit/ui/round.js');
const { getView, setView } = await import('../../js/modules/audit/domain/nav.js');

describe('wizard rules', () => {
  const form = (over = {}) => ({ name: 'Annual', scope: 'full', companies: '', picked: [], ...over });

  it('needs a name, and companies unless the whole stock is counted', () => {
    expect(scopeProblem(form(), true)).toBeNull();
    expect(scopeProblem(form({ name: '  ' }), true)).toBe('Give the audit a name.');
    expect(scopeProblem(form({ scope: 'selected' }), true)).toBe('Choose at least one company.');
    expect(scopeProblem(form({ scope: 'single' }), true)).toBe('Choose the company.');
    expect(scopeProblem(form({ scope: 'selected', picked: ['Acme'] }), true)).toBeNull();
    expect(scopeProblem(form({ scope: 'single', picked: ['A', 'B'] }), true)).toBe('A single-company audit has one company.');
  });

  it('reads typed company names when there is no list, ignoring blanks, and ignores a stale pick for a full audit', () => {
    expect(companiesOf(form({ scope: 'selected', companies: ' Acme, ,Beta ' }), false)).toEqual(['Acme', 'Beta']);
    expect(companiesOf(form({ scope: 'full', picked: ['Acme'] }), true)).toEqual([]);
    expect(scopeProblem(form({ scope: 'selected', companies: ' , ' }), false)).toBe('Choose at least one company.');
  });

  it('needs one counter, and lists only real extra roles', () => {
    expect(teamProblem(new Set())).toBe('Choose at least one person to count.');
    expect(teamProblem(new Set(['u1']))).toBeNull();
    expect(extraMembers({ u1: 'deputy', u2: '', u3: 'counter', u4: 'toString', u5: 'observer' })).toEqual([
      { userId: 'u1', role: 'deputy' },
      { userId: 'u5', role: 'observer' },
    ]);
  });

  it('same team: keeps earlier counters who can still count, once each, and names those who cannot', () => {
    const people = [
      { user_id: 'u1', can_count: true },
      { user_id: 'u2', can_count: false },
    ];
    const earlier = [
      { auditor_id: 'u1', name: 'One', status: 'submitted' },
      { auditor_id: 'u1', name: 'One', status: 'submitted' },
      { auditor_id: 'u2', name: 'Two', status: 'submitted' },
      { auditor_id: 'u3', name: 'Three', status: 'revoked' },
    ];
    expect(sameTeam(earlier, people)).toEqual({ ids: ['u1'], gone: ['Two'] });
  });

  it('the round before this one is the latest earlier round that was given to people', () => {
    const rounds = [
      { id: 'r1', round_number: 1, round_suffix: null, assignments: 2 },
      { id: 'r1a', round_number: 1, round_suffix: 'A', assignments: 0 },
      { id: 'r1b', round_number: 1, round_suffix: 'B', assignments: 1 },
    ];
    expect(previousRound(rounds, 'r1b').id).toBe('r1');
    expect(previousRound(rounds, 'r1')).toBeUndefined();
    expect(previousRound(rounds, 'nope')).toBeUndefined();
  });
});

const people = [
  { user_id: 'u1', full_name: 'Count One', can_count: true },
  { user_id: 'u2', full_name: 'Count Two', can_count: true },
  { user_id: 'u3', full_name: 'Dep Three', can_count: false },
];
const roundOv = (state = 'draft', version = 1) => ({
  round: { id: 'r1', engagement_id: 'e1', round_number: 1, round_suffix: null, unit: 'company', state, version, items: 7 },
  assignments: [],
  companies: [
    { company: 'Acme', items: 4, unassigned: 4 },
    { company: 'Beta', items: 3, unassigned: 3 },
  ],
});
const manage = { ctx: { permissions: ['audit.manage'] } };
const root = () => document.getElementById('root');
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const until = async (fn) => {
  for (let i = 0; i < 100; i++) {
    if (fn()) return;
    await tick(5);
  }
  throw new Error('timed out waiting');
};
const type = (sel, value) => {
  const i = root().querySelector(sel);
  i.value = value;
  i.dispatchEvent(new Event('input', { bubbles: true }));
};
const change = (sel, value) => {
  const i = root().querySelector(sel);
  if (value !== undefined) i.value = value;
  if ('checked' in i && value === undefined) i.checked = true;
  i.dispatchEvent(new Event('change', { bubbles: true }));
};
const click = (sel) => root().querySelector(sel).click();
const step = () => root().querySelector('.aud-wiz-steps [aria-current="step"]').textContent.replace(/\s+/g, ' ').trim();

beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>';
  sessionStorage.clear();
  location.hash = '';
  vi.clearAllMocks();
  api.listPeopleForAudit.mockResolvedValue(people);
  api.createEngagement.mockResolvedValue('e1');
  api.createRound.mockResolvedValue('r1');
  api.roundOverview.mockResolvedValue(roundOv());
});

const gotoPreview = async () => {
  await mountAudits(root(), manage);
  type('input[data-f="name"]', 'Annual audit');
  click('button[data-act="wiz-next"]');
  change('input[data-wcount="u1"]');
  change('input[data-wcount="u2"]');
  change('select[data-wrole="u3"]', 'deputy');
  click('button[data-act="wiz-create"]');
  await until(() => step().includes('Split preview'));
};

describe('the New audit wizard', () => {
  it('is shown only to someone who can manage audits', async () => {
    await mountAudits(root(), { ctx: { permissions: ['audit.view'] } });
    expect(root().querySelector('.aud-wiz-steps')).toBeNull();
  });

  it('starts on Scope and method; Next waits for a name', async () => {
    await mountAudits(root(), manage);
    expect(step()).toContain('Scope and method');
    expect(root().querySelector('button[data-act="wiz-next"]').disabled).toBe(true);
    expect(root().querySelector('[data-why]').textContent).toBe('Give the audit a name.');
    type('input[data-f="name"]', 'Annual audit');
    expect(root().querySelector('button[data-act="wiz-next"]').disabled).toBe(false);
  });

  it('Team needs a counter before it makes anything, and a person who cannot count has no tick', async () => {
    await mountAudits(root(), manage);
    type('input[data-f="name"]', 'Annual audit');
    click('button[data-act="wiz-next"]');
    expect(step()).toContain('Team');
    expect(root().querySelector('input[data-wcount="u3"]')).toBeNull();
    expect(root().querySelector('button[data-act="wiz-create"]').disabled).toBe(true);
    change('input[data-wcount="u1"]');
    expect(root().querySelector('button[data-act="wiz-create"]').disabled).toBe(false);
    expect(api.createEngagement).not.toHaveBeenCalled();
  });

  it('makes the audit, the team and a draft round, then shows the split before giving anything out', async () => {
    await gotoPreview();
    expect(api.createEngagement).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Annual audit', scopeType: 'full', companies: [], method: 'manual' }),
    );
    expect(api.setMember).toHaveBeenCalledTimes(1);
    expect(api.setMember).toHaveBeenCalledWith('e1', 'u3', 'deputy');
    expect(api.createRound).toHaveBeenCalledWith(expect.objectContaining({ engagementId: 'e1', unit: 'company' }));
    expect(root().textContent).toMatch(/Count One[\s\S]*4 items · 1 company/);
    expect(root().textContent).toMatch(/Count Two[\s\S]*3 items · 1 company/);
    expect(api.assignAuto).not.toHaveBeenCalled();
  });

  it('Lock and start gives out the work, locks and starts with the version each time, then opens the round', async () => {
    api.roundOverview
      .mockResolvedValueOnce(roundOv('draft', 1)) // after creating
      .mockResolvedValueOnce(roundOv('draft', 1)) // on pressing Lock and start
      .mockResolvedValueOnce(roundOv('draft', 2)) // after the split
      .mockResolvedValueOnce(roundOv('locked', 3));
    await gotoPreview();
    click('button[data-act="wiz-next"]');
    expect(step()).toContain('Lock and start');
    expect(api.lockRound).not.toHaveBeenCalled();
    click('button[data-act="wiz-start"]');
    await until(() => api.startRound.mock.calls.length > 0);
    expect(api.assignAuto).toHaveBeenCalledWith({ roundId: 'r1', auditors: ['u1', 'u2'], split: 'company', version: 1 });
    expect(api.lockRound).toHaveBeenCalledWith('r1', 2);
    expect(api.startRound).toHaveBeenCalledWith('r1', 3);
    await until(() => location.hash === '#/audit/round');
    expect(getView()).toEqual({ engagement: 'e1', round: 'r1' });
  });

  it('a step that fails stops there, says which, and the retry carries on without making anything twice', async () => {
    api.roundOverview.mockResolvedValue(roundOv('draft', 1));
    api.lockRound.mockRejectedValueOnce({ hint: 'not_allowed', message: 'raw' });
    await gotoPreview();
    click('button[data-act="wiz-next"]');
    click('button[data-act="wiz-start"]');
    await until(() => root().querySelector('[data-stopped]'));
    expect(root().querySelector('[data-stopped]').textContent).toContain('locking the round');
    expect(root().querySelector('[role="alert"]').textContent).not.toContain('raw');
    expect(api.assignAuto).toHaveBeenCalledTimes(1);
    api.roundOverview.mockResolvedValue(roundOv('draft', 2));
    click('button[data-act="wiz-start"]');
    await until(() => api.lockRound.mock.calls.length === 2);
    expect(api.assignAuto).toHaveBeenCalledTimes(1); // the split was not given out again
    expect(api.createEngagement).toHaveBeenCalledTimes(1);
    expect(api.createRound).toHaveBeenCalledTimes(1);
  });

  it('a failure while making the round keeps the audit and retries with the same keys', async () => {
    api.createRound.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await mountAudits(root(), manage);
    type('input[data-f="name"]', 'Annual audit');
    click('button[data-act="wiz-next"]');
    change('input[data-wcount="u1"]');
    click('button[data-act="wiz-create"]');
    await until(() => root().querySelector('[data-stopped]'));
    expect(root().querySelector('[data-stopped]').textContent).toContain('making the first round');
    click('button[data-act="wiz-create"]');
    await until(() => step().includes('Split preview'));
    expect(api.createEngagement).toHaveBeenCalledTimes(1);
    expect(api.createRound).toHaveBeenCalledTimes(2);
    expect(api.createRound.mock.calls[1][0].key).toBe(api.createRound.mock.calls[0][0].key);
  });

  it('after the round is made the owner can open the round page from a stopped wizard', async () => {
    api.assignAuto.mockRejectedValueOnce(new Error('x'));
    await gotoPreview();
    click('button[data-act="wiz-next"]');
    click('button[data-act="wiz-start"]');
    await until(() => root().querySelector('[data-stopped]'));
    click('button[data-act="wiz-open"]');
    expect(location.hash).toBe('#/audit/round');
    expect(getView()).toEqual({ engagement: 'e1', round: 'r1' });
  });

  it('a different balance is given out afresh, and Back from Lock and start returns to the preview', async () => {
    await gotoPreview();
    change('select[data-f="split"]', 'volume');
    click('button[data-act="wiz-next"]');
    click('button[data-act="wiz-back"]');
    expect(step()).toContain('Split preview');
  });

  it('a round with no items cannot go on to Lock and start', async () => {
    api.roundOverview.mockResolvedValue({ ...roundOv(), companies: [] });
    await gotoPreview();
    expect(root().textContent).toContain('no items');
    expect(root().querySelector('button[data-act="wiz-next"]').disabled).toBe(true);
  });

  it('“Create the audit only” still makes just the audit and opens it', async () => {
    await mountAudits(root(), manage);
    type('input[data-f="name"]', 'Quick');
    click('button[data-act="create"]');
    await until(() => location.hash === '#/audit/engagement');
    expect(api.createRound).not.toHaveBeenCalled();
    expect(getView()).toEqual({ engagement: 'e1' });
  });

  it('with no list of people, the team step says so and points to the audit only path', async () => {
    api.listPeopleForAudit.mockRejectedValueOnce(new Error('offline'));
    await mountAudits(root(), manage);
    type('input[data-f="name"]', 'Annual audit');
    click('button[data-act="wiz-next"]');
    expect(root().textContent).toContain('could not be loaded');
    expect(root().querySelector('button[data-act="wiz-create"]').disabled).toBe(true);
  });
});

describe('same team as last round (O5)', () => {
  const rounds = [
    { id: 'r0', round_number: 1, round_suffix: null, state: 'compiled', assignments: 2 },
    { id: 'r1', round_number: 1, round_suffix: 'A', state: 'draft', assignments: 0 },
  ];
  beforeEach(() => {
    setView({ engagement: 'e1', round: 'r1' });
    api.engagementOverview.mockResolvedValue({ engagement: { id: 'e1' }, members: [], rounds });
    api.roundOverview.mockImplementation(async (id) =>
      id === 'r0'
        ? {
            ...roundOv('compiled'),
            round: { ...roundOv().round, id: 'r0', state: 'compiled' },
            assignments: [
              { id: 'a1', auditor_id: 'u1', name: 'Count One', status: 'submitted' },
              { id: 'a2', auditor_id: 'u2', name: 'Count Two', status: 'submitted' },
            ],
          }
        : roundOv('draft', 4),
    );
  });
  const perms = { ctx: { permissions: ['audit.manage', 'audit.assign', 'audit.view'] } };

  it('fills the split with the earlier counters and still shows the preview before anything is given out', async () => {
    await mountRound(root(), perms);
    expect(root().querySelector('[data-same-team]').textContent).toContain('Count One, Count Two');
    click('button[data-act="same-team"]');
    expect(root().querySelector('input[data-pick="u1"]').checked).toBe(true);
    expect(root().querySelector('input[data-pick="u2"]').checked).toBe(true);
    expect(root().textContent).toMatch(/Preview, before anything is saved/);
    expect(api.assignAuto).not.toHaveBeenCalled();
    expect(root().querySelector('button[data-act="same-team"]').disabled).toBe(true);
  });

  it('names an earlier counter who can no longer count, and leaves them out', async () => {
    api.listPeopleForAudit.mockResolvedValue([people[0], { ...people[1], can_count: false }]);
    await mountRound(root(), perms);
    expect(root().querySelector('[data-same-team]').textContent).toContain('Count Two can no longer count.');
    click('button[data-act="same-team"]');
    expect(root().querySelector('input[data-pick="u1"]').checked).toBe(true);
  });

  it('is not offered for the first round, a round already split, or without the assign key', async () => {
    api.engagementOverview.mockResolvedValue({ engagement: { id: 'e1' }, members: [], rounds: [rounds[1]] });
    await mountRound(root(), perms);
    expect(root().querySelector('[data-same-team]')).toBeNull();
    api.engagementOverview.mockResolvedValue({ engagement: { id: 'e1' }, members: [], rounds });
    await mountRound(root(), { ctx: { permissions: ['audit.view'] } });
    expect(root().querySelector('[data-same-team]')).toBeNull();
  });

  it('the round page still works when the earlier round cannot be read', async () => {
    api.engagementOverview.mockRejectedValue(new Error('offline'));
    await mountRound(root(), perms);
    expect(root().querySelector('[data-same-team]')).toBeNull();
    expect(root().querySelector('[data-act="split"]')).not.toBeNull();
  });
});
