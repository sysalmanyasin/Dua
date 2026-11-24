import { describe, expect, it } from 'vitest';
import {
  checkNewTask,
  checkRequest,
  checkReject,
  checkSchedule,
  checkSubmit,
  describeSchedule,
  dueText,
  friendlyError,
  groupMine,
  nextAction,
  normaliseDetail,
  normaliseSnapshot,
  normaliseSchedules,
  normaliseTasks,
  normaliseTeam,
  rateText,
} from '../../js/modules/tasks/domain/tasks.js';
import { card, detail, T } from './tasks-fixtures.js';

describe('task lists', () => {
  it('returns null (hide the screen) when the database says the person may not see it', () => {
    expect(normaliseTasks(null)).toBeNull();
    expect(normaliseSnapshot(null)).toBeNull();
    expect(normaliseSchedules(null)).toBeNull();
    expect(normaliseTeam(null)).toBeNull();
  });
  it('drops malformed rows and clamps text', () => {
    const rows = normaliseTasks([
      card(1),
      { id: 'x', title: 'bad', status: 'assigned' },
      card(2, { status: 'nonsense' }),
      card(3, { title: 'A'.repeat(500) }),
    ]);
    expect(rows.map((r) => r.id)).toEqual([T(1), T(3)]);
    expect(rows[1].title).toHaveLength(120);
  });
  it('groups a person list in the agreed order and leaves out empty groups', () => {
    const tasks = normaliseTasks([
      card(1, { rank: 6, status: 'submitted' }),
      card(2, { rank: 1 }),
      card(3, { rank: 5, status: 'returned' }),
      card(4, { rank: 4 }),
      card(5, { rank: 2, priority: 'urgent' }),
    ]);
    expect(groupMine(tasks).map((g) => g.title)).toEqual([
      'Overdue',
      'Urgent',
      'Other pending',
      'Returned for correction',
      'Awaiting verification',
    ]);
  });
});

describe('what a person can do next', () => {
  const t = (status) => normaliseTasks([card(1, { status })])[0];
  it('maps each state to one action', () => {
    expect(nextAction(t('assigned')).key).toBe('accept');
    expect(nextAction(t('accepted')).key).toBe('start');
    expect(nextAction(t('returned')).label).toBe('Start the correction');
    expect(nextAction(t('in_progress')).key).toBe('submit');
    expect(nextAction(t('submitted'))).toBeNull();
    expect(nextAction(t('completed'))).toBeNull();
  });
});

describe('deadlines in words', () => {
  const t = (o) => normaliseTasks([card(1, o)])[0];
  it('words overdue, today, tomorrow and later dates', () => {
    expect(dueText(t({ due_on: '2026-11-22', overdue: true }), '2026-11-24')).toBe('Overdue by 2 days');
    expect(dueText(t({ due_on: '2026-11-23', overdue: true }), '2026-11-24')).toBe('Overdue by 1 day');
    expect(dueText(t({ due_on: '2026-11-24' }), '2026-11-24')).toBe('Due today');
    expect(dueText(t({ due_on: '2026-11-25' }), '2026-11-24')).toBe('Due tomorrow');
    expect(dueText(t({ due_on: '2026-12-02' }), '2026-11-24')).toBe('Due 02 Dec 2026');
    expect(dueText(t({ due_on: null }), '2026-11-24')).toBe('No deadline');
  });
  it('does not call work that is already handed in overdue', () => {
    expect(dueText(t({ due_on: '2026-11-20', status: 'submitted' }), '2026-11-24')).toBe('Due 20 Nov 2026');
  });
});

describe('input checks', () => {
  it('checks a new task', () => {
    expect(checkNewTask({ title: 'ab' }, '2026-11-24')).toMatch(/title/);
    expect(checkNewTask({ title: 'Count the fridge', due: '2026-11-23' }, '2026-11-24')).toMatch(/past/);
    expect(checkNewTask({ title: 'Count the fridge', due: '2026-11-24', evidence: 'photo' }, '2026-11-24')).toMatch(/hands in/);
    expect(checkNewTask({ title: 'Count the fridge', evidence: 'note', due: '2026-11-24' }, '2026-11-24')).toBeNull();
  });
  it('follows the evidence rule on hand-in (D-57)', () => {
    const t = (evidence) => normaliseTasks([card(1, { evidence_rule: evidence })])[0];
    expect(checkSubmit(t('none'), {})).toBeNull();
    expect(checkSubmit(t('note'), { note: '  ' })).toMatch(/note/);
    expect(checkSubmit(t('note'), { note: 'done' })).toBeNull();
    expect(checkSubmit(t('tick'), { tick: false })).toMatch(/Tick/);
    expect(checkSubmit(t('tick'), { tick: true })).toBeNull();
  });
  it('needs a reason for a request and a reject, and a future date for a deadline request', () => {
    expect(checkRequest({ kind: 'reassign', reason: '' }, '2026-11-24')).toMatch(/reason/);
    expect(checkRequest({ kind: 'deadline', reason: 'busy', due: '2026-11-20' }, '2026-11-24')).toMatch(/today or later/);
    expect(checkRequest({ kind: 'deadline', reason: 'busy', due: '2026-11-30' }, '2026-11-24')).toBeNull();
    expect(checkReject('')).toMatch(/corrected/);
    expect(checkReject('Count again')).toBeNull();
  });
  it('checks schedules for each kind', () => {
    expect(checkSchedule({ title: 'Expiry check', kind: 'weekly', weekdays: [] })).toMatch(/weekday/);
    expect(checkSchedule({ title: 'Expiry check', kind: 'monthly', monthDay: 32 })).toMatch(/1 to 31/);
    expect(checkSchedule({ title: 'Expiry check', kind: 'nth_week', week: 6 })).toMatch(/1 to 5/);
    expect(checkSchedule({ title: 'Expiry check', kind: 'nth_week', week: 3 })).toBeNull();
    expect(checkSchedule({ title: 'Expiry check', kind: 'daily' })).toBeNull();
  });
});

describe('schedules in words (D-56)', () => {
  it('words each kind, with the Nth-week day ranges', () => {
    expect(describeSchedule({ kind: 'daily' })).toBe('Every day');
    expect(describeSchedule({ kind: 'weekly', weekdays: [1, 5] })).toBe('Every Mon, Fri');
    expect(describeSchedule({ kind: 'monthly', monthDay: 10 })).toBe('On day 10 of every month');
    expect(describeSchedule({ kind: 'nth_week', week: 3 })).toBe('3rd week of every month (days 15 to 21)');
    expect(describeSchedule({ kind: 'nth_week', week: 5 })).toBe('5th week of every month (days 29 to month end)');
  });
});

describe('team figures', () => {
  it('words the completion rate from the two counts the database sends', () => {
    expect(rateText({ rateDue: 0, rateOnTime: 0 })).toBe('No tasks were due');
    expect(rateText({ rateDue: 8, rateOnTime: 6 })).toBe('75% (6 of 8 on time)');
  });
  it('keeps only people with an id and a name', () => {
    const team = normaliseTeam({ days: 30, staff: [{ staff_id: T(1), name: 'A', assigned_open: 2 }, { name: 'no id' }] });
    expect(team.staff).toHaveLength(1);
    expect(team.staff[0].open).toBe(2);
  });
});

describe('one task opened', () => {
  it('keeps the permissions the database sends, and shows only plain history details', () => {
    const d = normaliseDetail(
      detail(1, {
        can: { verify: true },
        events: [
          { at: '2026-11-24T05:00:00Z', kind: 'returned', by: 'Owner', detail: { comment: 'Count again', submission: 1, secret: 'x' } },
        ],
      }),
    );
    expect(d.can).toEqual({ manage: false, isAssignee: true, verify: true });
    expect(d.events[0].label).toBe('Sent back for correction');
    expect(d.events[0].detail).toBe('Count again');
  });
  it('returns null for something that is not a task', () => {
    expect(normaliseDetail(null)).toBeNull();
    expect(normaliseDetail({ task: { id: 'x' } })).toBeNull();
  });
});

describe('error messages', () => {
  it('shows the database wording for bad input and wrong state, and a generic one otherwise', () => {
    expect(friendlyError({ code: '22023', message: 'give a reason' })).toBe('Give a reason.');
    expect(friendlyError({ code: '55000', message: 'start the task before handing it in' })).toBe('Start the task before handing it in.');
    expect(friendlyError({ code: '42501', message: 'not allowed' })).toBe('You cannot do that.');
    expect(friendlyError({ code: 'XX000', message: 'internal table task_items broke' })).toMatch(/did not work/);
    expect(friendlyError(new TypeError('Failed to fetch'))).toMatch(/did not work/);
  });
});
