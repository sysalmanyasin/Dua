// @vitest-environment jsdom
// Home: Task Master sections. Staff see My Work Snapshot and My Tasks; the Owner sees Staff & Team; nobody is asked for what they cannot hold.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { card, flush, T } from './tasks-fixtures.js';

vi.mock('../../js/modules/home/data/api.js', () => ({
  myTaskSnapshot: vi.fn(),
  myTaskList: vi.fn(),
  taskVerificationQueue: vi.fn(),
  taskTeamOverview: vi.fn(),
  taskPendingRequests: vi.fn(),
}));
const api = await import('../../js/modules/home/data/api.js');
const { startTaskSections } = await import('../../js/modules/home/ui/tasks.js');

let work;
let team;
const snap = { assigned: 3, pending: 2, overdue: 1, completed: 4, awaiting_verification: 0, returned: 0, upcoming: 1, completed_days: 30 };

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '<div id="w"></div><div id="t"></div>';
  work = document.getElementById('w');
  team = document.getElementById('t');
  for (const f of Object.values(api)) f.mockReset();
  api.myTaskSnapshot.mockResolvedValue(snap);
  api.myTaskList.mockResolvedValue([
    card(1, { rank: 4 }),
    card(2, { rank: 1, overdue: true, due_on: '2020-01-01' }),
    card(3, { rank: 2, priority: 'urgent' }),
  ]);
  api.taskVerificationQueue.mockResolvedValue([]);
  api.taskTeamOverview.mockResolvedValue({
    days: 30,
    staff: [{ staff_id: T(900), name: 'Ayesha Khan', assigned_open: 2, overdue: 1, verification_pending: 0, rate_due: 4, rate_on_time: 3 }],
  });
  api.taskPendingRequests.mockResolvedValue([]);
});
afterEach(() => {
  document.body.innerHTML = '';
  vi.useRealTimers();
});
const start = async (perms) => {
  const r = startTaskSections({ workHost: work, teamHost: team, perms });
  await flush(vi);
  return r;
};

describe('staff sections', () => {
  it('shows the snapshot and My Tasks in the agreed order (overdue, urgent, other)', async () => {
    await start(['tasks.view_own']);
    expect(work.textContent).toContain('My work snapshot');
    expect(work.querySelector('.tk-counts').textContent).toContain('Overdue');
    const titles = [...work.querySelectorAll('.tk-title')].map((n) => n.textContent.trim());
    expect(titles).toEqual(['Task 2', 'Urgent Task 3', 'Task 1']);
    expect(api.taskTeamOverview).not.toHaveBeenCalled();
    expect(api.taskVerificationQueue).not.toHaveBeenCalled();
  });
  it('shows at most five and points to the rest', async () => {
    api.myTaskList.mockResolvedValue(Array.from({ length: 8 }, (_, i) => card(i + 1)));
    await start(['tasks.view_own']);
    expect(work.querySelectorAll('.tk-card')).toHaveLength(5);
    expect(work.textContent).toContain('3 more');
  });
  it('names the verify queue for a named verifier only', async () => {
    api.taskVerificationQueue.mockResolvedValue([card(7, { status: 'submitted' })]);
    await start(['tasks.view_own', 'tasks.verify']);
    expect(work.textContent).toContain('1 task is waiting for you to check');
    expect(work.querySelector('a[href="#/tasks/verify"]')).not.toBeNull();
  });
  it('shows nothing when tasks are not set up for the login', async () => {
    api.myTaskSnapshot.mockResolvedValue(null);
    api.myTaskList.mockResolvedValue(null);
    await start(['tasks.view_own']);
    expect(work.textContent.trim()).toBe('');
  });
  it('says so, and keeps the last good list, when a refresh fails', async () => {
    await start(['tasks.view_own']);
    api.myTaskList.mockRejectedValue(new Error('offline'));
    work.querySelector('[data-task-refresh]').click();
    await flush(vi);
    expect(work.querySelectorAll('.tk-card')).toHaveLength(3);
    expect(work.textContent).toContain('may be out of date');
  });
  it('says plainly that nothing loaded when every request fails', async () => {
    api.myTaskSnapshot.mockRejectedValue(new Error('offline'));
    api.myTaskList.mockRejectedValue(new Error('offline'));
    await start(['tasks.view_own']);
    expect(work.textContent).toContain('could not be loaded');
  });
});

describe('Owner section', () => {
  it('shows Staff & Team with each person and the period, and no attendance figures', async () => {
    await start(['tasks.manage']);
    const t = team.textContent.replace(/\s+/g, ' ');
    expect(t).toContain('Staff & team');
    expect(t).toContain('Ayesha Khan');
    expect(t).toContain('75% (3 of 4 on time)');
    expect(t).toContain('last 30 days');
    expect(t).toContain('Attendance is not shown yet');
    expect(api.myTaskSnapshot).not.toHaveBeenCalled();
  });
  it('links to waiting change requests', async () => {
    api.taskPendingRequests.mockResolvedValue([{ id: T(5), task_id: T(1) }]);
    await start(['tasks.manage']);
    expect(team.textContent).toContain('1 change request is waiting');
  });
  it('shows nothing when the database says the team overview is not for this person', async () => {
    api.taskTeamOverview.mockResolvedValue(null);
    await start(['tasks.manage']);
    expect(team.textContent.trim()).toBe('');
  });
});

describe('gating', () => {
  it('asks for nothing without a task permission', () => {
    expect(startTaskSections({ workHost: work, teamHost: team, perms: ['sales.view_last_day'] })).toBeNull();
    expect(api.myTaskSnapshot).not.toHaveBeenCalled();
    expect(api.taskTeamOverview).not.toHaveBeenCalled();
  });
});
