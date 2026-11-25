// @vitest-environment jsdom
// Task Master pages with the data layer mocked: what each role sees and what each button sends.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { card, detail, flush, T } from './tasks-fixtures.js';

vi.mock('../../js/modules/tasks/data/api.js', () => {
  const fns = [
    'listMine',
    'snapshotMine',
    'listAll',
    'verificationQueue',
    'getTask',
    'pendingRequests',
    'teamOverview',
    'scheduleList',
    'accept',
    'start',
    'submit',
    'addComment',
    'requestChange',
    'beginVerification',
    'verify',
    'createTask',
    'assignTask',
    'setDeadline',
    'cancelTask',
    'decideChange',
    'createSchedule',
    'setScheduleActive',
    'generateNow',
  ];
  return Object.fromEntries(fns.map((f) => [f, vi.fn()]));
});
const api = await import('../../js/modules/tasks/data/api.js');
const pages = {
  mine: await import('../../js/modules/tasks/ui/mine.js'),
  verify: await import('../../js/modules/tasks/ui/verify.js'),
  manage: await import('../../js/modules/tasks/ui/manage.js'),
  requests: await import('../../js/modules/tasks/ui/requests.js'),
  schedules: await import('../../js/modules/tasks/ui/schedules.js'),
  team: await import('../../js/modules/tasks/ui/team.js'),
};

let el;
const open = async (name) => {
  await pages[name].mount(el);
  await flush(vi);
};
const click = async (sel, root = el) => {
  root.querySelector(sel).click();
  await flush(vi);
};
const fill = (sel, value) => {
  const n = el.querySelector(sel);
  n.value = value;
};
const submit = async (sel) => {
  el.querySelector(sel).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await flush(vi);
};
const staff = [
  {
    staff_id: T(900),
    name: 'Ayesha Khan',
    assigned_open: 2,
    overdue: 1,
    verification_pending: 0,
    returned: 0,
    completed: 3,
    rate_due: 4,
    rate_on_time: 3,
  },
  {
    staff_id: T(901),
    name: 'Bilal Raza',
    assigned_open: 0,
    overdue: 0,
    verification_pending: 1,
    returned: 0,
    completed: 0,
    rate_due: 0,
    rate_on_time: 0,
  },
];

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '<div id="root"></div>';
  el = document.getElementById('root');
  for (const f of Object.values(api)) f.mockReset();
  api.teamOverview.mockResolvedValue({ days: 30, from: '2026-10-25', to: '2026-11-23', staff });
  for (const f of [
    'accept',
    'start',
    'submit',
    'addComment',
    'requestChange',
    'beginVerification',
    'verify',
    'createTask',
    'assignTask',
    'setDeadline',
    'cancelTask',
    'decideChange',
    'createSchedule',
    'setScheduleActive',
  ])
    api[f].mockResolvedValue(null);
});
afterEach(() => {
  el.remove();
  vi.useRealTimers();
});

describe('My Tasks', () => {
  const list = [
    card(1, { status: 'in_progress', overdue: true, rank: 1, due_on: '2020-01-01' }),
    card(2, { priority: 'urgent', rank: 2 }),
    card(3, { status: 'returned', rank: 5 }),
    card(4, { status: 'submitted', rank: 6 }),
  ];
  beforeEach(() => {
    api.listMine.mockResolvedValue(list);
    api.snapshotMine.mockResolvedValue({
      assigned: 4,
      pending: 2,
      overdue: 1,
      completed: 5,
      awaiting_verification: 1,
      returned: 1,
      upcoming: 0,
      completed_days: 30,
    });
    api.getTask.mockResolvedValue(null);
  });

  it('shows the groups in the agreed order with counts', async () => {
    await open('mine');
    const heads = [...el.querySelectorAll('.tk-h')].map((h) => h.textContent.replace(/\s+/g, ' ').trim());
    expect(heads).toEqual(['Overdue 1', 'Urgent 1', 'Returned for correction 1', 'Awaiting verification 1']);
    expect(el.textContent).toContain('Overdue by');
    expect(el.querySelector('.tk-counts').textContent).toContain('Done (30 days)');
  });

  it('accepts a task with one tap and reloads', async () => {
    await open('mine');
    api.listMine.mockClear();
    await click('[data-task="' + T(2) + '"] [data-act="accept"]');
    expect(api.accept).toHaveBeenCalledWith(T(2));
    expect(el.querySelector('.tk-message').textContent).toContain('Task accepted');
    expect(api.listMine).toHaveBeenCalled();
  });

  it('shows the real database refusal in plain words and keeps the list', async () => {
    api.accept.mockRejectedValue({ code: '55000', message: 'this task is no longer waiting for you' });
    await open('mine');
    await click('[data-act="accept"]');
    expect(el.querySelector('.tk-message .note-error').textContent).toContain('This task is no longer waiting for you.');
    expect(el.querySelectorAll('.tk-card').length).toBe(4);
  });

  it('hands in with a note when the task asks for one, and refuses an empty note before sending', async () => {
    api.getTask.mockResolvedValue(detail(1, { task: { status: 'in_progress', evidence_rule: 'note', rank: 1 } }));
    await open('mine');
    await click('[data-task="' + T(1) + '"] [data-act="toggle"]');
    const form = el.querySelector('form[data-act="submit"]');
    expect(form).not.toBeNull();
    expect(form.querySelector('textarea[name="note"]').required).toBe(true);
    await submit('form[data-act="submit"]');
    expect(api.submit).not.toHaveBeenCalled();
    expect(el.querySelector('.tk-message .note-error').textContent).toContain('note');
    fill('textarea[name="note"]', 'Counted all shelves');
    await submit('form[data-act="submit"]');
    expect(api.submit).toHaveBeenCalledWith(T(1), 'Counted all shelves', false);
    expect(el.querySelector('.tk-message').textContent).toContain('Handed in');
  });

  it('needs the tick for a tick task', async () => {
    api.getTask.mockResolvedValue(detail(1, { task: { status: 'in_progress', evidence_rule: 'tick', rank: 1 } }));
    await open('mine');
    await click('[data-act="toggle"]');
    expect(el.querySelector('input[name="tick"]').required).toBe(true);
    el.querySelector('input[name="tick"]').checked = true;
    await submit('form[data-act="submit"]');
    expect(api.submit).toHaveBeenCalledWith(T(1), undefined, true);
  });

  it('asks for a deadline change with a reason and sends it to the owner', async () => {
    api.getTask.mockResolvedValue(detail(1, { task: { status: 'in_progress', rank: 1 } }));
    await open('mine');
    await click('[data-act="toggle"]');
    el.querySelector('details[data-keep^="ask-"]').open = true;
    fill('select[name="kind"]', 'deadline');
    fill('input[name="due"]', '2099-02-01');
    fill('textarea[name="reason"]', 'Stock arrives late');
    await submit('form[data-act="request"]');
    expect(api.requestChange).toHaveBeenCalledWith(T(1), 'deadline', 'Stock arrives late', '2099-02-01');
  });

  it('offers no owner or verifier controls to a staff member', async () => {
    api.getTask.mockResolvedValue(detail(2, { task: { status: 'assigned', rank: 2 } }));
    await open('mine');
    await click('[data-task="' + T(2) + '"] [data-act="toggle"]');
    expect(
      el.querySelector('form[data-act="decide"], form[data-act="assign"], form[data-act="cancel"], form[data-act="deadline"]'),
    ).toBeNull();
    expect(el.textContent).not.toContain('Owner controls');
  });

  it('posts a comment', async () => {
    api.getTask.mockResolvedValue(detail(2, { task: { rank: 2 } }));
    await open('mine');
    await click('[data-task="' + T(2) + '"] [data-act="toggle"]');
    fill('textarea[name="body"]', 'Shelf B is empty');
    await submit('form[data-act="comment"]');
    expect(api.addComment).toHaveBeenCalledWith(T(2), 'Shelf B is empty');
  });

  it('says so when the person has no tasks, and hides itself when tasks are not set up for the login', async () => {
    api.listMine.mockResolvedValue([]);
    api.snapshotMine.mockResolvedValue({
      assigned: 0,
      pending: 0,
      overdue: 0,
      completed: 0,
      awaiting_verification: 0,
      returned: 0,
      upcoming: 0,
      completed_days: 30,
    });
    await open('mine');
    expect(el.textContent).toContain('You have no tasks right now');
    api.listMine.mockResolvedValue(null);
    api.snapshotMine.mockResolvedValue(null);
    await open('mine');
    expect(el.textContent).toContain('not set up for your login');
  });

  it('keeps what a person is typing when the list refreshes by itself', async () => {
    api.getTask.mockResolvedValue(detail(2, { task: { rank: 2 } }));
    await open('mine');
    await click('[data-task="' + T(2) + '"] [data-act="toggle"]');
    fill('textarea[name="body"]', 'half written');
    await vi.advanceTimersByTimeAsync(61_000);
    await flush(vi);
    expect(el.querySelector('textarea[name="body"]').value).toBe('half written');
  });

  it('keeps the old list and warns when a refresh fails', async () => {
    await open('mine');
    api.listMine.mockRejectedValue(new Error('offline'));
    await click('[data-tk-refresh]');
    expect(el.querySelectorAll('.tk-card').length).toBe(4);
    expect(el.textContent).toContain('may be out of date');
  });
});

describe('To Verify', () => {
  it('lists other people’s hand-ins with their note and lets a verifier approve', async () => {
    api.verificationQueue.mockResolvedValue([card(7, { status: 'submitted', submitted_note: 'All done', submitted_tick: false })]);
    api.getTask.mockResolvedValue(detail(7, { task: { status: 'submitted' }, can: { is_assignee: false, verify: true } }));
    await open('verify');
    expect(el.textContent).toContain('“All done”');
    await click('[data-act="toggle"]');
    await submit('form[data-act="decide"]');
    expect(api.verify).not.toHaveBeenCalled(); // no submitter button was pressed
    const approve = el.querySelector('[data-decision="approve"]');
    el.querySelector('form[data-act="decide"]').dispatchEvent(
      Object.assign(new Event('submit', { bubbles: true, cancelable: true }), { submitter: approve }),
    );
    await flush(vi);
    expect(api.verify).toHaveBeenCalledWith(T(7), true, '');
  });

  it('will not send a task back without a reason (the database refuses too)', async () => {
    api.verificationQueue.mockResolvedValue([card(7, { status: 'in_verification' })]);
    api.getTask.mockResolvedValue(detail(7, { task: { status: 'in_verification' }, can: { is_assignee: false, verify: true } }));
    await open('verify');
    await click('[data-act="toggle"]');
    const reject = el.querySelector('[data-decision="reject"]');
    el.querySelector('form[data-act="decide"]').dispatchEvent(
      Object.assign(new Event('submit', { bubbles: true, cancelable: true }), { submitter: reject }),
    );
    await flush(vi);
    expect(api.verify).not.toHaveBeenCalled();
    expect(el.querySelector('.tk-message .note-error').textContent).toContain('corrected');
    fill('textarea[name="comment"]', 'Count the top shelf again');
    el.querySelector('form[data-act="decide"]').dispatchEvent(
      Object.assign(new Event('submit', { bubbles: true, cancelable: true }), { submitter: el.querySelector('[data-decision="reject"]') }),
    );
    await flush(vi);
    expect(api.verify).toHaveBeenCalledWith(T(7), false, 'Count the top shelf again');
  });

  it('tells a person who is not a verifier, and does not offer decisions without can.verify', async () => {
    api.verificationQueue.mockResolvedValue(null);
    await open('verify');
    expect(el.textContent).toContain('not been named to verify');
    api.verificationQueue.mockResolvedValue([card(7, { status: 'submitted' })]);
    api.getTask.mockResolvedValue(detail(7, { task: { status: 'submitted' }, can: { is_assignee: false, verify: false } }));
    await open('verify');
    await click('[data-act="toggle"]');
    expect(el.querySelector('form[data-act="decide"]')).toBeNull();
  });
});

describe('All Tasks (Owner)', () => {
  beforeEach(() => {
    api.listAll.mockResolvedValue([
      card(1, { status: 'created', assignee_id: '', assignee_name: '' }),
      card(2, { status: 'in_progress', overdue: true }),
    ]);
    api.getTask.mockResolvedValue(null);
  });

  it('creates a task with the evidence rule, priority, person and deadline', async () => {
    await open('manage');
    el.querySelector('details.tk-new').open = true;
    fill('input[name="title"]', 'Check fridge temperature');
    fill('select[name="evidence"]', 'tick');
    fill('select[name="priority"]', 'urgent');
    fill('select[name="assignee"]', T(900));
    fill('input[name="due"]', '2099-03-01');
    await submit('form[data-act="create"]');
    expect(api.createTask).toHaveBeenCalledWith({
      title: 'Check fridge temperature',
      instructions: '',
      evidence: 'tick',
      priority: 'urgent',
      assignee: T(900),
      due: '2099-03-01',
    });
    expect(el.querySelector('.tk-message').textContent).toContain('Task created');
    expect(el.querySelector('input[name="title"]').value).toBe(''); // the form starts empty again
  });

  it('refuses a past deadline before sending', async () => {
    await open('manage');
    fill('input[name="title"]', 'Check fridge temperature');
    fill('input[name="due"]', '2020-01-01');
    await submit('form[data-act="create"]');
    expect(api.createTask).not.toHaveBeenCalled();
    expect(el.querySelector('.tk-message .note-error').textContent).toContain('past');
  });

  it('filters by status and person through the database', async () => {
    await open('manage');
    fill('select[name="status"]', 'in_progress');
    fill('select[name="person"]', T(901));
    await submit('form[data-act="filter"]');
    expect(api.listAll).toHaveBeenLastCalledWith('in_progress', T(901), 200);
  });

  it('assigns, re-dates and cancels (with a reason) from the owner controls', async () => {
    api.getTask.mockResolvedValue(detail(2, { task: { status: 'in_progress', overdue: true }, can: { manage: true, is_assignee: false } }));
    await open('manage');
    await click('[data-task="' + T(2) + '"] [data-act="toggle"]');
    fill('form[data-act="assign"] select', T(901));
    await submit('form[data-act="assign"]');
    expect(api.assignTask).toHaveBeenCalledWith(T(2), T(901));
    fill('form[data-act="deadline"] input[name="due"]', '2099-04-01');
    await submit('form[data-act="deadline"]');
    expect(api.setDeadline).toHaveBeenCalledWith(T(2), '2099-04-01', '');
    fill('form[data-act="cancel"] input[name="reason"]', '  ');
    await submit('form[data-act="cancel"]');
    expect(api.cancelTask).not.toHaveBeenCalled();
    fill('form[data-act="cancel"] input[name="reason"]', 'No longer needed');
    await submit('form[data-act="cancel"]');
    expect(api.cancelTask).toHaveBeenCalledWith(T(2), 'No longer needed');
  });

  it('shows the refusal when someone who is not the owner opens it', async () => {
    api.listAll.mockResolvedValue(null);
    await open('manage');
    expect(el.textContent).toContain('Only the owner');
  });
});

describe('Requests (Owner)', () => {
  const req = (n, o = {}) => ({
    id: T(500 + n),
    task_id: T(n),
    task_title: `Task ${n}`,
    kind: 'deadline',
    reason: 'Busy',
    proposed_due_on: '2099-02-01',
    current_due_on: '2099-01-01',
    requested_by_name: 'Ayesha Khan',
    ...o,
  });

  it('approves a deadline request', async () => {
    api.pendingRequests.mockResolvedValue([req(1)]);
    await open('requests');
    expect(el.textContent.replace(/\s+/g, ' ')).toContain('Ayesha Khan asks: Change the deadline to 01 Feb 2099');
    await submit('form[data-act="approve"]');
    expect(api.decideChange).toHaveBeenCalledWith(T(501), true, '', null);
  });

  it('approves a reassignment to a chosen person, or to no one', async () => {
    api.pendingRequests.mockResolvedValue([req(2, { kind: 'reassign', proposed_due_on: null })]);
    await open('requests');
    fill('select[name="assignee"]', T(901));
    await submit('form[data-act="approve"]');
    expect(api.decideChange).toHaveBeenLastCalledWith(T(502), true, '', T(901));
  });

  it('needs a reason to refuse', async () => {
    api.pendingRequests.mockResolvedValue([req(1)]);
    await open('requests');
    await click('[data-from-form]');
    expect(api.decideChange).not.toHaveBeenCalled();
    expect(el.querySelector('.tk-message .note-error').textContent).toContain('Say why');
    fill('input[name="note"]', 'Needed this week');
    await click('[data-from-form]');
    expect(api.decideChange).toHaveBeenCalledWith(T(501), false, 'Needed this week', null);
  });

  it('says so when nothing is waiting', async () => {
    api.pendingRequests.mockResolvedValue([]);
    await open('requests');
    expect(el.textContent).toContain('No requests are waiting');
  });
});

describe('Schedules (Owner)', () => {
  const sched = {
    id: T(700),
    title: 'Expiry check',
    instructions: '',
    evidence_rule: 'tick',
    priority: 'normal',
    assignee: T(900),
    assignee_name: 'Ayesha Khan',
    kind: 'nth_week',
    weekdays: null,
    month_day: null,
    week_of_month: 3,
    active: true,
  };

  it('lists schedules in words and pauses one', async () => {
    api.scheduleList.mockResolvedValue([sched]);
    await open('schedules');
    expect(el.textContent).toContain('3rd week of every month (days 15 to 21)');
    await click('[data-act="toggle-schedule"]');
    expect(api.setScheduleActive).toHaveBeenCalledWith(T(700), false);
  });

  it('creates a weekly schedule from the chosen weekdays, and refuses none', async () => {
    api.scheduleList.mockResolvedValue([]);
    await open('schedules');
    fill('input[name="title"]', 'Clean the counter');
    fill('select[name="kind"]', 'weekly');
    await submit('form[data-act="create-schedule"]');
    expect(api.createSchedule).not.toHaveBeenCalled();
    expect(el.querySelector('.tk-message .note-error').textContent).toContain('weekday');
    for (const n of [1, 4]) el.querySelector(`input[name="weekdays[]"][value="${n}"]`).checked = true;
    await submit('form[data-act="create-schedule"]');
    expect(api.createSchedule).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Clean the counter', kind: 'weekly', weekdays: [1, 4] }),
    );
  });

  it('runs the generator and says how many tasks it made', async () => {
    api.scheduleList.mockResolvedValue([]);
    api.generateNow.mockResolvedValue(2);
    await open('schedules');
    await click('[data-act="generate"]');
    expect(el.querySelector('.tk-message').textContent).toContain('2 tasks made');
    api.generateNow.mockResolvedValue(0);
    await click('[data-act="generate"]');
    expect(el.querySelector('.tk-message').textContent).toContain('Nothing new was due');
  });
});

describe('Team (Owner)', () => {
  it('shows workload and completion rate with the period beside it', async () => {
    await open('team');
    const t = el.textContent;
    expect(t).toContain('Ayesha Khan');
    expect(t).toContain('75% (3 of 4 on time)');
    expect(t).toContain('No tasks were due');
    expect(t).toContain('30 days');
    expect(t).not.toMatch(/attendance|present|leave/i);
  });

  it('asks the database for the period chosen', async () => {
    await open('team');
    await click('[data-act="period"][data-days="90"]');
    expect(api.teamOverview).toHaveBeenLastCalledWith(90);
  });
});

describe('accessibility basics', () => {
  it('every field has a visible label and every action is a real button', async () => {
    api.listAll.mockResolvedValue([card(1)]);
    api.getTask.mockResolvedValue(detail(1, { task: {}, can: { manage: true, is_assignee: false } }));
    await open('manage');
    await click('[data-act="toggle"]');
    for (const f of el.querySelectorAll('input:not([type="checkbox"]), select, textarea'))
      expect(f.closest('label'), f.name).not.toBeNull();
    for (const b of el.querySelectorAll('[data-act]:not(form)')) expect(['BUTTON', 'FORM', 'A']).toContain(b.tagName);
    expect(el.querySelector('[data-act="toggle"]').getAttribute('aria-expanded')).toBe('true');
    expect(el.querySelector('[role="status"]')).not.toBeNull();
  });
});
