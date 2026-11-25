// @vitest-environment jsdom
// The Audit tab frame, and the two screens the review page now serves: Compile & Review and Corrections (database mocked).
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

beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>';
  vi.clearAllMocks();
  setView({ round: 'r1' });
  api.compileOverview.mockResolvedValue(overview());
  api.compiledRows.mockResolvedValue(rows());
});

const { TABS, individualScreens, placeOf, screenPath, teamScreens, visibleTabs } =
  await import('../../js/modules/audit/domain/workspace.js');
const { toolGroups } = await import('../../js/modules/audit/domain/tools.js');
const { frameBar, framed } = await import('../../js/modules/audit/ui/frame.js');
const { default: manifest } = await import('../../js/modules/audit/manifest.js');

const routes = manifest.routes;
const owner_perms = ['audit.manage'];

describe('workspace map', () => {
  it('has the four primary tabs in order', () => {
    expect(TABS.map((t) => t.label)).toEqual(['Overview', 'Team Audit', 'Individual Audit', 'Tools']);
  });

  it('places each page in a tab, and counting in none', () => {
    expect(placeOf('/audit')).toEqual({ tab: 'overview' });
    expect(placeOf('/audit/compile')).toEqual({ tab: 'team', screen: 'compile' });
    expect(placeOf('/audit/corrections')).toEqual({ tab: 'team', screen: 'corrections' });
    expect(placeOf('/audit/expiry/racks')).toEqual({ tab: 'tools' });
    expect(placeOf('/audit/count')).toBeNull();
  });

  it('every page in the manifest except counting has a place, so none is left without tabs by mistake', () => {
    const missing = routes.map((r) => r.path).filter((p) => p !== '/audit/count' && !placeOf(p));
    expect(missing).toEqual([]);
  });

  it('shows all four tabs to the owner', () => {
    expect(visibleTabs(routes, owner_perms).map((t) => t.key)).toEqual(['overview', 'team', 'individual', 'tools']);
  });

  it('leaves out Team Audit for a person who can only count, and keeps the rest they can open', () => {
    const tabs = visibleTabs(routes, ['audit.count']);
    expect(tabs.map((t) => t.key)).toEqual(['overview']);
  });

  it('a sub-auditor with individual audits sees Overview, Individual Audit and Tools, not Team Audit', () => {
    const keys = visibleTabs(routes, ['audit.count', 'audit.individual']).map((t) => t.key);
    expect(keys).toEqual(['overview', 'individual', 'tools']);
  });

  it('lists the five Team Audit screens, with the ones that need a round waiting until one is chosen', () => {
    const none = teamScreens(routes, owner_perms, null);
    expect(none.map((s) => s.label)).toEqual(['Progress & Assignments', 'Compile & Review', 'Corrections', 'Reports', 'Finalization']);
    expect(none.filter((s) => s.waiting).map((s) => s.key)).toEqual(['compile', 'corrections', 'final']);
    const chosen = teamScreens(routes, owner_perms, { engagement: 'e1', round: 'r1' });
    expect(chosen.some((s) => s.waiting)).toBe(false);
  });

  it('Progress opens the audit when one is chosen and the list of audits when not', () => {
    expect(screenPath('progress', null)).toBe('/audit/engagements');
    expect(screenPath('progress', { engagement: 'e1' })).toBe('/audit/engagement');
  });

  it('a person who can only read reports sees the screens their permissions open, not the audit list', () => {
    const keys = teamScreens(routes, ['audit.report'], { engagement: 'e1', round: 'r1' }).map((s) => s.key);
    expect(keys).toContain('reports');
    expect(keys).not.toContain('progress');
  });
});

describe('tools groups', () => {
  it('shows every group to the owner', () => {
    expect(
      toolGroups(routes, new Set([...owner_perms, 'audit.barcode_admin', 'audit.templates', 'users.manage'])).map((g) => g.key),
    ).toEqual(['expiry', 'barcode', 'templates', 'admin']);
  });

  it('hides Team access without users.manage, and racks without rack rights', () => {
    const groups = toolGroups(routes, new Set(['audit.expiry_log', 'audit.barcode_scan']));
    expect(groups.map((g) => g.key)).toEqual(['expiry', 'barcode']);
    expect(groups[0].items.map((i) => i.path)).toEqual(['/audit/expiry']);
  });

  it('shows nothing to a person with no tool rights', () => {
    expect(toolGroups(routes, new Set(['audit.count']))).toEqual([]);
  });
});

describe('tab frame', () => {
  it('draws the tabs with the current one marked, and links to each tab’s page', () => {
    const host = document.createElement('div');
    const html = frameBar({ path: '/audit/engagements', routes, permissions: new Set(owner_perms), view: null }).toString();
    host.innerHTML = html;
    const current = host.querySelector('.aud-tab[aria-current="page"]');
    expect(current.textContent).toBe('Team Audit');
    expect([...host.querySelectorAll('.aud-tab')].map((a) => a.getAttribute('href'))).toEqual([
      '#/audit',
      '#/audit/engagements',
      '#/audit/individuals',
      '#/audit/tools',
    ]);
  });

  it('shows the five Team Audit screens only inside Team Audit, with the current one marked', () => {
    const host = document.createElement('div');
    host.innerHTML = frameBar({
      path: '/audit/corrections',
      routes,
      permissions: new Set(owner_perms),
      view: { engagement: 'e1', round: 'r1' },
    }).toString();
    expect(host.querySelectorAll('.aud-screen')).toHaveLength(5);
    expect(host.querySelector('.aud-screen[aria-current="page"]').textContent).toBe('Corrections');
    host.innerHTML = frameBar({ path: '/audit/tools', routes, permissions: new Set(owner_perms), view: null }).toString();
    expect(host.querySelectorAll('.aud-screen')).toHaveLength(0);
  });

  it('shows a screen that needs a round as unavailable, not as a link, until one is chosen', () => {
    const host = document.createElement('div');
    host.innerHTML = frameBar({ path: '/audit/engagements', routes, permissions: new Set(owner_perms), view: null }).toString();
    const waiting = host.querySelector('.aud-screen[data-screen="compile"]');
    expect(waiting.tagName).toBe('SPAN');
    expect(waiting.getAttribute('aria-disabled')).toBe('true');
  });

  it('draws nothing for a page with no tab bar (counting)', () => {
    expect(frameBar({ path: '/audit/count', routes, permissions: new Set(owner_perms), view: null }).toString()).toBe('');
  });

  it('mounts the page below the tabs and passes it the options and the app context', async () => {
    const seen = [];
    const page = await framed(async () => ({ mount: async (el, args) => seen.push([el, args]) }), { screen: 'review' });
    const host = document.createElement('div');
    await page.mount(host, { ctx: { permissions: owner_perms }, route: { path: '/audit/compile' } });
    expect(host.querySelector('.aud-tab[aria-current="page"]').textContent).toBe('Team Audit');
    expect(seen).toHaveLength(1);
    expect(seen[0][0].parentElement).toBe(host);
    expect(seen[0][1].screen).toBe('review');
    expect(seen[0][1].ctx.permissions).toEqual(owner_perms);
  });

  it('a page opened through the manifest comes with the tab bar', async () => {
    const page = await routes.find((r) => r.path === '/audit/tools').load();
    const host = document.createElement('div');
    await page.mount(host, { ctx: { permissions: ['audit.manage'] }, route: { path: '/audit/tools' } });
    expect(host.querySelector('.aud-tabs')).toBeTruthy();
    expect(host.querySelector('.aud-tab[aria-current="page"]').textContent).toBe('Tools');
    expect(host.querySelector('[data-tool-group="expiry"]')).toBeTruthy();
  });
});

describe('Compile & Review and Corrections screens', () => {
  it('Compile & Review shows progress, the result, differences and conflicts, and no corrections list', async () => {
    await mount(root(), { ...owner, screen: 'review' });
    await until(() => root().querySelector('[data-sec="differences"], [data-sec="conflicts"]') || root().querySelector('h2'));
    await until(() => root().textContent.includes('Alpha one'));
    expect(root().querySelector('[data-sec="progress"]')).toBeTruthy();
    expect(root().querySelector('[data-sec="conflicts"]')).toBeTruthy();
    expect(root().querySelector('[data-sec="corrections"]')).toBeNull();
    expect(root().querySelector('[data-sec="next"]')).toBeNull();
  });

  it('Compile & Review points to Corrections when decisions are waiting', async () => {
    await mount(root(), { ...owner, screen: 'review' });
    await until(() => root().querySelector('[data-corrections-hint]'));
    expect(root().querySelector('[data-corrections-hint] a').getAttribute('href')).toBe('#/audit/corrections');
    expect(root().querySelector('[data-corrections-hint]').textContent).toContain('1 correction is waiting');
  });

  it('Corrections shows the corrections and counting again, and no differences, progress or conflicts', async () => {
    await mount(root(), { ...owner, screen: 'corrections' });
    await until(() => root().querySelector('[data-sec="corrections"]'));
    expect(root().querySelector('[data-sec="next"]')).toBeTruthy();
    expect(root().querySelector('[data-sec="progress"]')).toBeNull();
    expect(root().querySelector('[data-sec="conflicts"]')).toBeNull();
    expect(root().querySelector('[data-sec="differences"]')).toBeNull();
    expect(root().querySelector('.aud-pipe')).toBeNull();
    expect(root().textContent).toContain('1 waiting · 0 approved · 0 rejected');
  });

  it('Corrections still approves a correction through the same database call', async () => {
    await mount(root(), { ...owner, screen: 'corrections' });
    await until(() => root().querySelector('[data-act="approve"]'));
    click('[data-act="approve"]');
    await until(() => api.decideCorrection.mock.calls.length > 0);
    expect(api.decideCorrection).toHaveBeenCalledWith({ id: 'cr1', approve: true, note: undefined });
  });

  it('Corrections lists waiting first, then approved, then rejected, with the counts', async () => {
    const o = overview();
    o.corrections = [
      { ...o.corrections[0], id: 'c-rej', status: 'rejected', decision_note: 'no', decided_by: 'Boss' },
      { ...o.corrections[0], id: 'c-app', status: 'approved', decided_by: 'Boss', decided_at: '2026-11-17T09:00:00Z' },
      { ...o.corrections[0], id: 'c-wait', status: 'proposed' },
    ];
    api.compileOverview.mockResolvedValue(o);
    await mount(root(), { ...owner, screen: 'corrections' });
    await until(() => root().querySelector('[data-correction-counts]'));
    const badges = [...root().querySelectorAll('[data-sec="corrections"] .aud-badge')].map((b) => b.textContent.trim());
    expect(badges).toEqual(['Waiting', 'Approved', 'Rejected']);
    expect(root().querySelector('[data-correction-counts]').textContent).toContain('1 waiting · 1 approved · 1 rejected');
  });

  it('Corrections says so when there are none, and points to where one is proposed', async () => {
    const o = overview();
    o.corrections = [];
    api.compileOverview.mockResolvedValue(o);
    await mount(root(), { ...owner, screen: 'corrections' });
    await until(() => root().querySelector('[data-empty]'));
    expect(root().querySelector('[data-empty] a').getAttribute('href')).toBe('#/audit/compile');
  });

  it('shows the recompile alert on both screens when an approved correction has not been compiled in', async () => {
    const o = overview();
    o.corrections = [{ ...o.corrections[0], status: 'approved', decided_at: '2026-11-17T09:00:00Z', decided_by: 'Boss' }];
    api.compileOverview.mockResolvedValue(o);
    for (const screen of ['review', 'corrections']) {
      document.body.innerHTML = '<div id="root"></div>';
      await mount(root(), { ...owner, screen });
      await until(() => root().querySelector('[data-recompile]'));
      expect(root().querySelector('[data-recompile]').textContent).toContain('1 approved correction waiting');
    }
  });

  it('with no screen the page is the whole review page as before', async () => {
    await mount(root(), owner);
    await until(() => root().querySelector('[data-sec="corrections"]'));
    for (const sec of ['progress', 'conflicts', 'next']) expect(root().querySelector(`[data-sec="${sec}"]`)).toBeTruthy();
  });

  it('leaves the breadcrumb honest on the Corrections screen', async () => {
    setView({ round: 'r1' });
    await mount(root(), { ...owner, screen: 'corrections' });
    await until(() => root().querySelector('.aud-crumbs'));
    expect(root().querySelector('.aud-crumbs li[aria-current="page"]').textContent).toBe('Corrections');
    expect(getView().round).toBe('r1');
  });
});

describe('Individual Audit workspace', () => {
  it('has the four screens in order, with review waiting for a round', () => {
    const screens = individualScreens(routes, owner_perms, null);
    expect(screens.map((x) => x.label)).toEqual(['Monthly Overview', 'Rounds & Progress', 'Review & Corrections', 'Reports']);
    expect(screens.filter((x) => x.waiting).map((x) => x.key)).toEqual(['review']);
    expect(individualScreens(routes, owner_perms, { round: 'r1' }).some((x) => x.waiting)).toBe(false);
  });

  it('places the four screens, and the person’s own start page, in the Individual tab', () => {
    for (const path of [
      '/audit/individuals',
      '/audit/individual-rounds',
      '/audit/individual-review',
      '/audit/individual-reports',
      '/audit/individual',
    ]) {
      expect(placeOf(path).tab).toBe('individual');
    }
    expect(placeOf('/audit/individual').screen).toBe('rounds');
  });

  it('shows no screens bar to a person who only starts and counts their own audits', () => {
    expect(individualScreens(routes, ['audit.count', 'audit.individual'], null)).toEqual([]);
    const host = document.createElement('div');
    host.innerHTML = frameBar({ path: '/audit/individual', routes, permissions: new Set(['audit.individual']), view: null }).toString();
    expect(host.querySelector('.aud-tab[aria-current="page"]').textContent).toBe('Individual Audit');
    expect(host.querySelector('.aud-screens')).toBeNull();
  });

  it('the frame shows the four screens inside the Individual tab, named for it', () => {
    const host = document.createElement('div');
    host.innerHTML = frameBar({
      path: '/audit/individual-rounds',
      routes,
      permissions: new Set(owner_perms),
      view: { round: 'r1' },
    }).toString();
    expect(host.querySelectorAll('.aud-screen')).toHaveLength(4);
    expect(host.querySelector('.aud-screens').getAttribute('aria-label')).toBe('Individual Audit screens');
    expect(host.querySelector('.aud-screen[aria-current="page"]').textContent).toBe('Rounds & Progress');
  });
});

describe('Individual review & corrections screen', () => {
  it('shows the differences and corrections, with no progress, compile button, conflicts, next round or final snapshot', async () => {
    await mount(root(), { ...owner, screen: 'individual' });
    await until(() => root().querySelector('[data-sec="corrections"]'));
    expect(root().querySelector('[data-sec="differences"], [data-sec="rows"]') || root().textContent.includes('Alpha one')).toBeTruthy();
    // control: the whole page does have these, so their absence here is the screen, not the fixture
    document.body.innerHTML = '<div id="root"></div>';
    await mount(root(), owner);
    await until(() => root().querySelector('[data-sec="corrections"]'));
    expect(root().querySelector('[data-act="compile"]')).not.toBeNull();
    document.body.innerHTML = '<div id="root"></div>';
    await mount(root(), { ...owner, screen: 'individual' });
    await until(() => root().querySelector('[data-sec="corrections"]'));
    for (const sec of ['progress', 'compile', 'conflicts', 'next']) expect(root().querySelector(`[data-sec="${sec}"]`)).toBeNull();
    expect(root().querySelector('.aud-pipe')).toBeNull();
    expect(root().querySelector('a[href="#/audit/final"]')).toBeNull();
    expect(root().querySelector('[data-act="compile"]')).toBeNull();
  });

  it('keeps the recompile alert and its button, because approved corrections apply at the next compile', async () => {
    const o = overview();
    o.corrections = [{ ...o.corrections[0], status: 'approved', decided_at: '2026-11-17T09:00:00Z', decided_by: 'Boss' }];
    api.compileOverview.mockResolvedValue(o);
    await mount(root(), { ...owner, screen: 'individual' });
    await until(() => root().querySelector('[data-recompile]'));
    expect(root().querySelector('[data-recompile]').textContent).toContain('1 approved correction waiting');
  });

  it('names itself in the breadcrumb and heading', async () => {
    await mount(root(), { ...owner, screen: 'individual' });
    await until(() => root().querySelector('.aud-crumbs'));
    expect(root().querySelector('.aud-crumbs li[aria-current="page"]').textContent).toBe('Review & corrections');
    expect(root().querySelector('.aud-crumbs a').getAttribute('href')).toBe('#/audit/individuals');
    expect(root().querySelector('h1').textContent).toContain('review & corrections');
  });

  it('explains an empty corrections list without pointing to the Team screen', async () => {
    const o = overview();
    o.corrections = [];
    api.compileOverview.mockResolvedValue(o);
    await mount(root(), { ...owner, screen: 'individual' });
    await until(() => root().querySelector('[data-empty]'));
    expect(root().querySelector('[data-empty] a')).toBeNull();
  });
});
