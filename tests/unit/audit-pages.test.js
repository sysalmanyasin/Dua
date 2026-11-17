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
  engagementOverview: vi.fn(),
  createRound: vi.fn(),
  setMember: vi.fn(),
  createEngagement: vi.fn(),
}));
const api = await import('../../js/modules/audit/data/api.js');
const { mount: mountRound } = await import('../../js/modules/audit/ui/round.js');
const { mount: mountHub } = await import('../../js/modules/audit/ui/hub.js');
const { setView } = await import('../../js/modules/audit/domain/nav.js');

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
    expect(el.textContent).toContain('No audits yet');
    expect(el.querySelector('a[href="#/audit/team"]')).toBeNull();
    expect(el.querySelector('a[href="#/audit/engagements"]')).toBeNull();
    const el2 = document.createElement('div');
    await mountHub(el2, { ctx: { permissions: ['audit.manage', 'users.manage'] } });
    expect(el2.querySelector('a[href="#/audit/team"]')).not.toBeNull();
    expect(el2.querySelector('a[href="#/audit/engagements"]')).not.toBeNull();
  });
});
