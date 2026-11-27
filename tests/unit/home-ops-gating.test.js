// @vitest-environment jsdom
// Home shows the Action Centre and Recent Activity only to people who hold ops.view, and never asks the database otherwise.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../js/modules/home/data/api.js', () => ({
  coverSummary: vi.fn(async () => ({ sales: { last_day: { date: '2026-11-20', total: 1000 } } })),
  inventoryCover: vi.fn(async () => null),
  lifetimeSalesMonths: vi.fn(async () => null),
  notificationsAttention: vi.fn(async () => null),
  opsActionItems: vi.fn(async () => ({ items: [] })),
  opsRecentActivity: vi.fn(async () => ({ events: [] })),
  opsBiSummary: vi.fn(async () => null),
  opsClosingSummary: vi.fn(async () => null),
  watchClosings: vi.fn(() => () => {}),
  myPayslips: vi.fn(async () => ({ payslips: [] })),
  myRecentClosings: vi.fn(async () => []),
  myInboxList: vi.fn(async () => []),
  myInboxUnread: vi.fn(async () => 0),
  myTaskSnapshot: vi.fn(async () => null),
  myTaskList: vi.fn(async () => null),
  taskVerificationQueue: vi.fn(async () => null),
  taskTeamOverview: vi.fn(async () => null),
  taskPendingRequests: vi.fn(async () => null),
}));
const api = await import('../../js/modules/home/data/api.js');
const { mount } = await import('../../js/modules/home/ui/page.js');

let el;
const open = async (permissions) => {
  await mount(el, { ctx: { permissions, username: 'u', full_name: 'Test Person' }, modules: [] });
  for (let i = 0; i < 8; i++) await Promise.resolve();
  await vi.advanceTimersByTimeAsync(0);
};

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '<div id="home"></div>';
  el = document.getElementById('home');
  api.opsActionItems.mockClear();
  api.opsRecentActivity.mockClear();
  api.opsClosingSummary.mockClear();
  api.myPayslips.mockClear();
  for (const f of ['myTaskSnapshot', 'myTaskList', 'taskVerificationQueue', 'taskTeamOverview', 'taskPendingRequests']) api[f].mockClear();
});
afterEach(() => {
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('Home: Operations sections are for ops.view only', () => {
  it('does not render or request them for ordinary staff', async () => {
    await open(['sales.view_last_day']);
    expect(el.querySelector('#home-ops-actions')).toBeNull();
    expect(el.querySelector('#home-ops-activity')).toBeNull();
    expect(api.opsActionItems).not.toHaveBeenCalled();
    expect(api.opsRecentActivity).not.toHaveBeenCalled();
  });

  it('renders them in the agreed order for the Owner: snapshot, Action Centre, then Recent Activity', async () => {
    await open(['ops.view', 'sales.view_last_day', 'sales.view_history']);
    expect(api.opsActionItems).toHaveBeenCalledTimes(1);
    expect(el.querySelector('#home-ops-actions .ops-section')).not.toBeNull();
    expect(el.querySelector('#home-ops-activity .ops-section')).not.toBeNull();
    const order = [...el.querySelectorAll('h2')].map((h) => h.textContent.trim());
    expect(order.indexOf('Business snapshot')).toBeGreaterThanOrEqual(0);
    expect(order.indexOf('Action Centre')).toBeGreaterThan(order.indexOf('Business snapshot'));
    expect(order.indexOf('Recent activity')).toBeGreaterThan(order.indexOf('Action Centre'));
    expect(order.indexOf('Favourites')).toBeGreaterThan(order.indexOf('Recent activity'));
  });

  it('shows the Latest closing summary to the Owner only, above the Action Centre, and never asks for it otherwise', async () => {
    api.opsClosingSummary.mockResolvedValueOnce({
      has_closing: true,
      business_date: '2026-11-22',
      day_no: 1,
      kind: 'night',
      seq: 10,
      mode: 'shift',
      is_opening: false,
      period_start: '2026-11-20',
      period_closings: 4,
      book_bills: 27725,
      manual_returns: 69648,
      mediq_collected: 0,
      deposits: 455000,
      carried_cc: 19872,
    });
    await open(['ops.view', 'sales.view_last_day']);
    expect(api.opsClosingSummary).toHaveBeenCalledTimes(1);
    const order = [...el.querySelectorAll('h2')].map((h) => h.textContent.trim());
    expect(order.indexOf('Latest closing summary')).toBeGreaterThanOrEqual(0);
    expect(order.indexOf('Action Centre')).toBeGreaterThan(order.indexOf('Latest closing summary'));
    expect(el.querySelector('#home-closing-summary').textContent).toContain('Rs. 455,000');
    document.body.innerHTML = '<div id="home"></div>';
    el = document.getElementById('home');
    api.opsClosingSummary.mockClear();
    await open(['sales.view_last_day', 'closing.enter_own']);
    expect(el.querySelector('#home-closing-summary')).toBeNull();
    expect(api.opsClosingSummary).not.toHaveBeenCalled();
  });

  it('shows the staff sections, not the owner ones, to a person with payroll.view_own', async () => {
    await open(['payroll.view_own', 'closing.enter_own', 'sales.view_last_day']);
    expect(el.querySelector('#home-ops-actions')).toBeNull();
    expect(el.querySelector('#home-staff-pay')).not.toBeNull();
    expect(api.opsActionItems).not.toHaveBeenCalled();
    expect(api.myPayslips).toHaveBeenCalledTimes(1);
  });

  it('never shows the staff payroll section to the Owner view', async () => {
    await open(['ops.view', 'payroll.view_own']);
    expect(el.querySelector('#home-staff-pay')).toBeNull();
    expect(api.myPayslips).not.toHaveBeenCalled();
  });

  it('puts Business intelligence between the Action Centre and Recent activity for the Owner', async () => {
    api.opsBiSummary.mockResolvedValueOnce({ days: 30, from: '2026-10-23', to: '2026-11-21', sales: {}, transactions: {}, operations: {} });
    await open(['ops.view', 'sales.view_last_day']);
    const order = [...el.querySelectorAll('h2')].map((h) => h.textContent.trim());
    expect(order.indexOf('Business intelligence')).toBeGreaterThan(order.indexOf('Action Centre'));
    expect(order.indexOf('Recent activity')).toBeGreaterThan(order.indexOf('Business intelligence'));
  });
});

describe('Home: Task Master sections follow the task permissions', () => {
  it('gives staff with tasks.view_own the work sections, and never the team overview', async () => {
    await open(['tasks.view_own']);
    expect(el.querySelector('#home-staff-work')).not.toBeNull();
    expect(el.querySelector('#home-team')).toBeNull();
    expect(api.myTaskSnapshot).toHaveBeenCalled();
    expect(api.taskTeamOverview).not.toHaveBeenCalled();
  });
  it('gives the Owner Staff & Team between the Business Intelligence and Recent Activity, and no personal task list', async () => {
    await open(['ops.view', 'tasks.manage', 'tasks.view_own']);
    const order = [...el.querySelectorAll('#home-ops-actions, #home-ops-bi, #home-team, #home-ops-activity')].map((n) => n.id);
    expect(order).toEqual(['home-ops-actions', 'home-ops-bi', 'home-team', 'home-ops-activity']);
    expect(el.querySelector('#home-staff-work')).toBeNull();
    expect(api.taskTeamOverview).toHaveBeenCalled();
    expect(api.myTaskSnapshot).not.toHaveBeenCalled();
  });
  it('asks the database for no task data without a task permission', async () => {
    await open(['sales.view_last_day']);
    expect(el.querySelector('#home-team')).toBeNull();
    expect(el.querySelector('#home-staff-work')).toBeNull();
    expect(api.myTaskSnapshot).not.toHaveBeenCalled();
  });
});
