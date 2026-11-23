// @vitest-environment jsdom
// Opens the Audit pages in a DOM with the database layer replaced, to prove the screens draw, the preview shows before
// anything is saved, and each button sends the right call with the version the screen last saw.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../js/modules/audit/data/api.js', () => ({
  roundOverview: vi.fn(),
  listPeopleForAudit: vi.fn(),
  assignAuto: vi.fn(async () => ({})),
  assignMove: vi.fn(),
  revokeAssignment: vi.fn(),
  lockRound: vi.fn(async () => ({})),
  startRound: vi.fn(),
  companyItemIds: vi.fn(),
  listEngagements: vi.fn(async () => []),
  myAssignments: vi.fn(async () => []),
  engagementOverview: vi.fn(),
  createRound: vi.fn(),
  setMember: vi.fn(),
  createEngagement: vi.fn(),
  listCompanies: vi.fn(async () => [
    { company: 'Acme', skus: 2, value: 1025 },
    { company: 'Beta, Inc', skus: 1, value: 440 },
  ]),
}));
const api = await import('../../js/modules/audit/data/api.js');
const { mount: mountRound } = await import('../../js/modules/audit/ui/round.js');
const { mount: mountHub } = await import('../../js/modules/audit/ui/hub.js');
const { mount: mountAudits } = await import('../../js/modules/audit/ui/engagements.js');
const { getView, setView } = await import('../../js/modules/audit/domain/nav.js');

const people = [
  { user_id: 'u1', full_name: 'Count One', can_count: true },
  { user_id: 'u2', full_name: 'Count Two', can_count: true },
  { user_id: 'u3', full_name: 'No Counting', can_count: false },
];
const overview = (over = {}) => ({
  round: { id: 'r1', engagement_id: 'e1', round_number: 1, round_suffix: null, unit: 'company', state: 'draft', version: 4, items: 7 },
  assignments: [],
  companies: [
    { company: 'Acme', items: 4, unassigned: 4 },
    { company: 'Beta', items: 2, unassigned: 2 },
    { company: 'Cura', items: 1, unassigned: 1 },
  ],
  ...over,
});
const ctx = { permissions: ['audit.manage', 'audit.assign', 'audit.view'] };
const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>';
  sessionStorage.clear();
  setView({ engagement: 'e1', round: 'r1' });
  vi.clearAllMocks();
  api.listPeopleForAudit.mockResolvedValue(people);
  api.myAssignments.mockResolvedValue([]);
  api.listEngagements.mockResolvedValue([]);
  api.roundOverview.mockResolvedValue(overview());
});

describe('audit round page', () => {
  it('lists only people who can count, and the lock button waits for every item to be assigned', async () => {
    const el = document.getElementById('root');
    await mountRound(el, { ctx });
    expect(el.textContent).toContain('Count One');
    expect(el.textContent).not.toContain('No Counting');
    expect(el.textContent).toContain('7 items are not given to anyone');
    expect(el.querySelector('[data-act="lock"]').disabled).toBe(true);
    expect(el.querySelector('[data-act="split"]').disabled).toBe(true);
  });

  it('shows the split before saving, then sends the chosen people with the round version', async () => {
    const el = document.getElementById('root');
    await mountRound(el, { ctx });
    for (const id of ['u1', 'u2']) {
      const box = el.querySelector(`[data-pick="${id}"]`);
      box.checked = true;
      box.dispatchEvent(new Event('change', { bubbles: true }));
    }
    expect(api.assignAuto).not.toHaveBeenCalled();
    expect(el.textContent).toMatch(/Count One[\s\S]*5 items · 2 companies/);
    expect(el.textContent).toMatch(/Count Two[\s\S]*2 items · 1 company/);
    el.querySelector('[data-act="split"]').click();
    await tick();
    expect(api.assignAuto).toHaveBeenCalledWith({ roundId: 'r1', auditors: ['u1', 'u2'], split: 'company', version: 4 });
  });

  it('locks only when everything is assigned, with the version it saw', async () => {
    api.roundOverview.mockResolvedValue(
      overview({
        assignments: [{ id: 'a1', auditor_id: 'u1', name: 'Count One', status: 'assigned', items: 7, companies: 3 }],
        companies: [{ company: 'Acme', items: 7, unassigned: 0 }],
      }),
    );
    const el = document.getElementById('root');
    await mountRound(el, { ctx });
    const lock = el.querySelector('[data-act="lock"]');
    expect(lock.disabled).toBe(false);
    lock.click();
    await tick();
    expect(api.lockRound).toHaveBeenCalledWith('r1', 4);
  });

  it('shows a refusal in words and refreshes when someone else changed the round', async () => {
    const el = document.getElementById('root');
    api.assignAuto.mockRejectedValueOnce({ hint: 'version_conflict', message: 'raw database text' });
    await mountRound(el, { ctx });
    const box = el.querySelector('[data-pick="u1"]');
    box.checked = true;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    el.querySelector('[data-act="split"]').click();
    await tick();
    await tick();
    expect(el.textContent).toContain('Someone else changed this');
    expect(el.textContent).not.toContain('raw database text');
    expect(api.roundOverview).toHaveBeenCalledTimes(2);
  });

  it('a person without assign rights sees the assignments but no controls', async () => {
    api.roundOverview.mockResolvedValue(
      overview({ assignments: [{ id: 'a1', auditor_id: 'u1', name: 'Count One', status: 'counting', items: 3, companies: 1 }] }),
    );
    const el = document.getElementById('root');
    await mountRound(el, { ctx: { permissions: ['audit.view'] } });
    expect(el.textContent).toContain('Count One');
    expect(el.querySelector('[data-act]')).toBeNull();
    expect(api.listPeopleForAudit).not.toHaveBeenCalled();
  });

  it('asks for a round when none is chosen', async () => {
    sessionStorage.clear();
    const el = document.getElementById('root');
    await mountRound(el, { ctx });
    expect(el.textContent).toContain('No round chosen');
  });
});

describe('audit hub', () => {
  it('shows the empty state and only the pages the person may open', async () => {
    const el = document.getElementById('root');
    await mountHub(el, { ctx: { permissions: ['audit.count'] } });
    expect(el.textContent).toContain('No counting assignments are currently assigned to you.');
    expect(el.querySelector('a[href="#/audit/team"]')).toBeNull();
    expect(el.querySelector('a[href="#/audit/engagements"]')).toBeNull();
    const el2 = document.createElement('div');
    await mountHub(el2, { ctx: { permissions: ['audit.manage', 'users.manage'] } });
    expect(el2.querySelector('a[href="#/audit/team"]')).not.toBeNull();
    expect(el2.querySelector('a[href="#/audit/engagements"]')).not.toBeNull();
  });

  it('loads only personal assignments for a counter and shows their own progress', async () => {
    api.myAssignments.mockResolvedValueOnce([
      {
        assignment_id: 'a1',
        engagement_name: 'Monthly Stock Audit',
        round_number: 2,
        round_suffix: null,
        round_state: 'counting',
        status: 'counting',
        items: 20,
        counted: 15,
      },
    ]);
    const el = document.getElementById('root');
    await mountHub(el, { ctx: { permissions: ['audit.count'] } });
    expect(api.myAssignments).toHaveBeenCalledOnce();
    expect(api.listEngagements).not.toHaveBeenCalled();
    expect(el.textContent).toContain('Monthly Stock Audit');
    expect(el.textContent).toContain('15 of 20 counted');
    expect(el.textContent).toContain('Continue counting');
    expect(el.querySelector('a[href="#/audit/engagements"]')).toBeNull();
  });

  it('shows role-permitted grouped navigation and a bounded engagement overview to managers', async () => {
    api.listEngagements.mockResolvedValueOnce([
      { id: 'e1', name: 'Annual Audit', scope_type: 'full', status: 'open', created_at: '2026-11-19T08:00:00Z' },
    ]);
    api.engagementOverview.mockResolvedValueOnce({
      rounds: [{ id: 'r1', round_number: 1, round_suffix: null, state: 'counting', items: 100, assignments: 2 }],
    });
    const el = document.getElementById('root');
    await mountHub(el, { ctx: { permissions: ['audit.manage', 'audit.view'] } });
    expect(el.textContent).toContain('Audit Overview');
    expect(el.textContent).toContain('Stock audits');
    expect(el.textContent).toContain('Annual Audit');
    expect(el.textContent).toContain('Active rounds');
    expect(el.querySelector('a[href="#/audit/engagements"]')).not.toBeNull();
    expect(el.querySelector('a[href="#/audit/team"]')).toBeNull();
    expect(el.querySelector('a[href="#/audit/barcode"]')).toBeNull();
    expect(api.engagementOverview).toHaveBeenCalledWith('e1');
  });

  it('hands the chosen assignment to the counting page, so each card opens its own work', async () => {
    api.myAssignments.mockResolvedValueOnce([
      {
        assignment_id: 'a1',
        engagement_name: 'Monthly Stock Audit',
        round_number: 2,
        round_suffix: null,
        round_state: 'counting',
        status: 'counting',
        items: 20,
        counted: 15,
      },
      {
        assignment_id: 'a2',
        engagement_name: 'Autumn Audit',
        round_number: 1,
        round_suffix: null,
        round_state: 'counting',
        status: 'assigned',
        items: 10,
        counted: 0,
      },
    ]);
    const el = document.getElementById('root');
    await mountHub(el, { ctx: { permissions: ['audit.count'] } });
    el.querySelector('a[data-open-assignment="a2"]').click();
    expect(getView()).toMatchObject({ assignment: 'a2' });
    el.querySelector('a[data-open-assignment="a1"]').click();
    expect(getView()).toMatchObject({ assignment: 'a1' });
  });

  describe('pick up where you left off', () => {
    const manager = { ctx: { permissions: ['audit.manage', 'audit.view'] } };
    const e1 = { id: 'e1', name: 'Annual Audit', scope_type: 'full', status: 'open', created_at: '2026-11-19T08:00:00Z' };

    it('offers the last round opened, and opening it sets the audit and round', async () => {
      api.listEngagements.mockResolvedValueOnce([e1]);
      api.engagementOverview.mockResolvedValueOnce({ rounds: [] });
      const el = document.getElementById('root');
      await mountHub(el, manager);
      const link = el.querySelector('a[data-open-last]');
      expect(el.textContent).toContain('Pick up where you left off');
      expect(link.getAttribute('href')).toBe('#/audit/round');
      setView({});
      link.click();
      expect(getView()).toEqual({ engagement: 'e1', round: 'r1' });
    });

    it('goes to the audit when no round was open', async () => {
      setView({ engagement: 'e1' });
      api.listEngagements.mockResolvedValueOnce([e1]);
      api.engagementOverview.mockResolvedValueOnce({ rounds: [] });
      const el = document.getElementById('root');
      await mountHub(el, manager);
      expect(el.querySelector('a[data-open-last]').getAttribute('href')).toBe('#/audit/engagement');
    });

    it('says nothing when that audit is not one the person can see now, or the person only counts', async () => {
      setView({ engagement: 'gone', round: 'r9' });
      api.listEngagements.mockResolvedValueOnce([e1]);
      api.engagementOverview.mockResolvedValueOnce({ rounds: [] });
      const el = document.getElementById('root');
      await mountHub(el, manager);
      expect(el.querySelector('a[data-open-last]')).toBeNull();
      setView({ engagement: 'e1', round: 'r1' });
      const counter = document.createElement('div');
      await mountHub(counter, { ctx: { permissions: ['audit.count'] } });
      expect(counter.querySelector('a[data-open-last]')).toBeNull();
    });
  });

  it('opens the first navigation group by default and keeps the others folded until tapped', async () => {
    const el = document.getElementById('root');
    await mountHub(el, {
      ctx: {
        permissions: [
          'audit.manage',
          'audit.view',
          'audit.individual',
          'audit.templates',
          'audit.report',
          'audit.expiry_log',
          'users.manage',
        ],
      },
    });
    const toggles = [...el.querySelectorAll('[data-aud-toggle]')];
    expect(toggles.length).toBeGreaterThanOrEqual(5);
    const panelOf = (toggle) => el.querySelector(`#${toggle.getAttribute('aria-controls')}`);
    const [first, ...others] = toggles;
    expect(first.getAttribute('aria-expanded')).toBe('true');
    expect(panelOf(first).hidden).toBe(false);
    for (const toggle of others) {
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      expect(panelOf(toggle).hidden).toBe(true);
    }
    first.click();
    expect(first.getAttribute('aria-expanded')).toBe('false');
    expect(panelOf(first).hidden).toBe(true);
    others[0].click();
    expect(others[0].getAttribute('aria-expanded')).toBe('true');
    expect(panelOf(others[0]).hidden).toBe(false);
  });

  it('shows team administration only with users.manage and expiry links only when permitted', async () => {
    const el = document.getElementById('root');
    await mountHub(el, { ctx: { permissions: ['audit.expiry_log', 'users.manage'] } });
    expect(el.querySelector('a[href="#/audit/team"]')).not.toBeNull();
    expect(el.querySelector('a[href="#/audit/expiry"]')).not.toBeNull();
    expect(el.querySelector('a[href="#/audit/expiry/racks"]')).toBeNull();
    expect(el.querySelector('a[href="#/audit/engagements"]')).toBeNull();
  });
});

describe('new audit company list', () => {
  it('lets the owner tick companies from the stock list, including names that contain a comma', async () => {
    api.createEngagement.mockResolvedValueOnce('eng-new');
    const el = document.getElementById('root');
    await mountAudits(el, { ctx: { permissions: ['audit.manage'] } });
    expect(el.querySelector('input[data-company]')).toBeNull(); // full stock needs no list
    const scope = el.querySelector('select[data-f="scope"]');
    scope.value = 'selected';
    scope.dispatchEvent(new Event('change', { bubbles: true }));
    expect(el.querySelectorAll('input[data-company]').length).toBe(2);
    expect(el.textContent).toContain('2 SKUs · Rs 1,025');
    const beta = [...el.querySelectorAll('input[data-company]')].find((i) => i.dataset.company === 'Beta, Inc');
    beta.checked = true;
    beta.dispatchEvent(new Event('change', { bubbles: true }));
    el.querySelector('button[data-act="create"]').click();
    await tick();
    expect(api.createEngagement.mock.calls[0][0]).toMatchObject({ scopeType: 'selected', companies: ['Beta, Inc'] });
  });

  it('keeps one company at a time for a single-company audit, and falls back to typing if the list cannot load', async () => {
    const el = document.getElementById('root');
    await mountAudits(el, { ctx: { permissions: ['audit.manage'] } });
    const scope = el.querySelector('select[data-f="scope"]');
    scope.value = 'single';
    scope.dispatchEvent(new Event('change', { bubbles: true }));
    expect(el.querySelectorAll('input[type="radio"][data-company]').length).toBe(2);
    api.listCompanies.mockRejectedValueOnce(new Error('offline'));
    const el2 = document.createElement('div');
    document.body.append(el2);
    await mountAudits(el2, { ctx: { permissions: ['audit.manage'] } });
    const s2 = el2.querySelector('select[data-f="scope"]');
    s2.value = 'selected';
    s2.dispatchEvent(new Event('change', { bubbles: true }));
    expect(el2.querySelector('input[data-f="companies"]')).not.toBeNull();
  });
});

describe('where the person is and what is next, on the round page (F4)', () => {
  it('shows the breadcrumb, with links up and no old back link', async () => {
    const el = document.getElementById('root');
    await mountRound(el, { ctx });
    const crumb = el.querySelector('nav[aria-label="Breadcrumb"]');
    expect([...crumb.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual(['#/audit/engagements', '#/audit/engagement']);
    expect(crumb.querySelector('[aria-current="page"]').textContent).toBe('Round 1');
    expect(el.textContent).not.toContain('← This audit');
  });

  it('while set up, the strip says so and the next step is below on this page', async () => {
    const el = document.getElementById('root');
    await mountRound(el, { ctx });
    expect(el.querySelector('.aud-pipe [aria-current="step"]').textContent).toContain('Set up');
    expect(el.querySelector('[data-pipe-next]').textContent).toContain('Give out the work');
    expect(el.querySelector('button[data-pipe]')).toBeNull();
  });

  it('once counting, the next step is a button to the review, and it keeps the audit and round', async () => {
    api.roundOverview.mockResolvedValue(
      overview({
        round: {
          id: 'r1',
          engagement_id: 'e9',
          round_number: 1,
          round_suffix: null,
          unit: 'company',
          state: 'counting',
          version: 5,
          items: 7,
        },
        assignments: [
          { id: 'a1', auditor_id: 'u1', name: 'Count One', status: 'submitted', items: 4, companies: 1 },
          { id: 'a2', auditor_id: 'u2', name: 'Count Two', status: 'counting', items: 3, companies: 1 },
        ],
        companies: [{ company: 'Acme', items: 7, unassigned: 0 }],
      }),
    );
    const el = document.getElementById('root');
    await mountRound(el, { ctx });
    expect(el.querySelector('.aud-pipe').textContent).toContain('1 of 2 submitted');
    el.querySelector('button[data-pipe="compile"]').click();
    expect(location.hash).toBe('#/audit/compile');
    expect(getView()).toMatchObject({ engagement: 'e9', round: 'r1' });
  });

  it('offers no next-step button to someone who cannot do it', async () => {
    const el = document.getElementById('root');
    await mountRound(el, { ctx: { permissions: ['audit.view'] } });
    expect(el.querySelector('.aud-pipe [data-pipe-next]')).toBeNull();
    expect(el.querySelector('.aud-pipe button')).toBeNull();
  });
});
