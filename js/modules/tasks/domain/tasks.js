// Pure helpers for Task Master screens. No Supabase, no DOM.
// The database decides who may see or do what, what is overdue and in which order a person's list runs (D-65); this file
// only checks input before it is sent, words things for ordinary users, and tidies what comes back.
import { shortDate } from '../../../shared/format.js';

export const STATUS = {
  created: { label: 'Not assigned', tone: 'muted' },
  assigned: { label: 'To accept', tone: 'info' },
  accepted: { label: 'Accepted', tone: 'info' },
  in_progress: { label: 'In progress', tone: 'info' },
  submitted: { label: 'Handed in', tone: 'warn' },
  in_verification: { label: 'Being checked', tone: 'warn' },
  completed: { label: 'Done', tone: 'ok' },
  returned: { label: 'Needs correction', tone: 'bad' },
  cancelled: { label: 'Cancelled', tone: 'muted' },
};
export const EVIDENCE = {
  none: 'Nothing to hand in',
  note: 'A short note about the work',
  tick: 'A tick to confirm it is done',
};
// The order in which a person's own list is shown (rank is worked out by the database, task_list_mine).
export const MINE_GROUPS = [
  { rank: 1, title: 'Overdue', tone: 'bad' },
  { rank: 2, title: 'Urgent', tone: 'warn' },
  { rank: 3, title: 'Due within two days', tone: 'warn' },
  { rank: 4, title: 'Other pending', tone: 'info' },
  { rank: 5, title: 'Returned for correction', tone: 'bad' },
  { rank: 6, title: 'Awaiting verification', tone: 'muted' },
];
export const WEEKDAYS = [
  [1, 'Mon'],
  [2, 'Tue'],
  [3, 'Wed'],
  [4, 'Thu'],
  [5, 'Fri'],
  [6, 'Sat'],
  [7, 'Sun'],
];
export const REQUEST_KINDS = { reassign: 'Give this to someone else', deadline: 'Change the deadline' };

const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const isoDate = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
const isoStamp = (v) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : null);
const id = (v) => (typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v) ? v : '');

export function normaliseTask(c) {
  const status = Object.hasOwn(STATUS, c?.status) ? c.status : null;
  if (!id(c?.id) || !status) return null;
  return {
    id: c.id,
    title: text(c.title, 120),
    instructions: text(c.instructions, 2000),
    evidence: Object.hasOwn(EVIDENCE, c.evidence_rule) ? c.evidence_rule : 'none',
    priority: c.priority === 'urgent' ? 'urgent' : 'normal',
    status,
    source: text(c.source, 20),
    assigneeId: id(c.assignee_id),
    assigneeName: text(c.assignee_name, 80),
    dueOn: isoDate(c.due_on),
    overdue: c.overdue === true,
    rank: num(c.rank),
    submittedAt: isoStamp(c.submitted_at),
    completedAt: isoStamp(c.completed_at),
    cancelledReason: text(c.cancelled_reason, 300),
    pendingRequest: c.pending_request === 'reassign' || c.pending_request === 'deadline' ? c.pending_request : null,
    version: num(c.version),
    // verification queue extras
    submittedNote: text(c.submitted_note, 1000),
    submittedTick: c.submitted_tick === true,
  };
}

// null means "you may not see this" (the database answers null); a screen hides itself. Malformed rows are dropped.
export function normaliseTasks(result) {
  if (result === null || result === undefined) return null;
  return (Array.isArray(result) ? result : []).map(normaliseTask).filter((t) => t && t.title);
}

export function groupMine(tasks) {
  return MINE_GROUPS.map((g) => ({ ...g, tasks: tasks.filter((t) => t.rank === g.rank) })).filter((g) => g.tasks.length > 0);
}

export function normaliseSnapshot(s) {
  if (s === null || s === undefined || typeof s !== 'object') return null;
  const keys = ['assigned', 'pending', 'overdue', 'completed', 'awaiting_verification', 'returned', 'upcoming'];
  return { ...Object.fromEntries(keys.map((k) => [k, num(s[k])])), days: num(s.completed_days) || 30 };
}

// The one thing a staff member can do next on their own task (the database enforces it again).
export function nextAction(task) {
  if (task.status === 'assigned') return { key: 'accept', label: 'Accept task' };
  if (task.status === 'accepted') return { key: 'start', label: 'Start work' };
  if (task.status === 'returned') return { key: 'start', label: 'Start the correction' };
  if (task.status === 'in_progress') return { key: 'submit', label: 'Hand in' };
  return null;
}
export const canAskChange = (task) => ['assigned', 'accepted', 'in_progress', 'returned'].includes(task.status) && !task.pendingRequest;

// "Overdue by 2 days", "Due today", "Due tomorrow", "Due 24 Nov 2026", "No deadline". today is YYYY-MM-DD (Pakistan).
export function dueText(task, today) {
  if (!task.dueOn) return 'No deadline';
  const d = Math.round((Date.parse(`${task.dueOn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (task.overdue || (d < 0 && !['completed', 'cancelled', 'submitted', 'in_verification'].includes(task.status))) {
    return `Overdue by ${Math.abs(d)} day${Math.abs(d) === 1 ? '' : 's'}`;
  }
  if (d === 0) return 'Due today';
  if (d === 1) return 'Due tomorrow';
  return `Due ${shortDate(task.dueOn)}`;
}

// ── input checks (the database checks again; these give the message before a round trip) ──
export function checkNewTask(f, today) {
  const title = (f.title ?? '').trim();
  if (title.length < 3 || title.length > 120) return 'Write a title of 3 to 120 characters.';
  if ((f.instructions ?? '').length > 2000) return 'The instructions are too long (2,000 characters at most).';
  if (!Object.hasOwn(EVIDENCE, f.evidence ?? 'none')) return 'Choose what the person hands in.';
  if (f.due && (!isoDate(f.due) || f.due < today)) return 'The deadline cannot be in the past.';
  return null;
}
export function checkSubmit(task, f) {
  if (task.evidence === 'note' && (f.note ?? '').trim() === '') return 'Write a short note about the work you did.';
  if (task.evidence === 'tick' && f.tick !== true) return 'Tick the box to confirm the work is done.';
  if ((f.note ?? '').length > 1000) return 'The note is too long (1,000 characters at most).';
  return null;
}
export function checkRequest(f, today) {
  if (!['reassign', 'deadline'].includes(f.kind)) return 'Choose what you want to ask for.';
  if ((f.reason ?? '').trim().length < 3) return 'Give a reason.';
  if (f.kind === 'deadline' && (!isoDate(f.due) || f.due < today)) return 'Choose a new deadline that is today or later.';
  return null;
}
export const checkReject = (reason) => ((reason ?? '').trim() === '' ? 'Say what needs to be corrected.' : null);
export function checkSchedule(f) {
  const title = (f.title ?? '').trim();
  if (title.length < 3 || title.length > 120) return 'Write a title of 3 to 120 characters.';
  if (f.kind === 'weekly' && !(f.weekdays ?? []).length) return 'Choose at least one weekday.';
  if (f.kind === 'monthly' && !(Number(f.monthDay) >= 1 && Number(f.monthDay) <= 31)) return 'Choose a day of the month (1 to 31).';
  if (f.kind === 'nth_week' && !(Number(f.week) >= 1 && Number(f.week) <= 5)) return 'Choose a week of the month (1 to 5).';
  if (!['daily', 'weekly', 'monthly', 'nth_week'].includes(f.kind)) return 'Choose how often it repeats.';
  return null;
}

const ORD = ['', '1st', '2nd', '3rd', '4th', '5th'];
export function describeSchedule(s) {
  if (s.kind === 'daily') return 'Every day';
  if (s.kind === 'weekly')
    return `Every ${WEEKDAYS.filter(([n]) => s.weekdays.includes(n))
      .map(([, d]) => d)
      .join(', ')}`;
  if (s.kind === 'monthly') return `On day ${s.monthDay} of every month`;
  const [from, to] = [(s.week - 1) * 7 + 1, s.week === 5 ? 'month end' : s.week * 7];
  return `${ORD[s.week]} week of every month (days ${from} to ${to})`;
}

export function normaliseSchedules(result) {
  if (result === null || result === undefined) return null;
  return (Array.isArray(result) ? result : [])
    .map((s) => ({
      id: id(s?.id),
      title: text(s?.title, 120),
      instructions: text(s?.instructions, 2000),
      evidence: Object.hasOwn(EVIDENCE, s?.evidence_rule) ? s.evidence_rule : 'none',
      priority: s?.priority === 'urgent' ? 'urgent' : 'normal',
      assigneeId: id(s?.assignee),
      assigneeName: text(s?.assignee_name, 80),
      kind: ['daily', 'weekly', 'monthly', 'nth_week'].includes(s?.kind) ? s.kind : null,
      weekdays: Array.isArray(s?.weekdays) ? s.weekdays.map(Number).filter((n) => n >= 1 && n <= 7) : [],
      monthDay: num(s?.month_day),
      week: num(s?.week_of_month),
      active: s?.active === true,
    }))
    .filter((s) => s.id && s.title && s.kind);
}

export function normaliseRequests(result) {
  if (result === null || result === undefined) return null;
  return (Array.isArray(result) ? result : [])
    .map((r) => ({
      id: id(r?.id),
      taskId: id(r?.task_id),
      taskTitle: text(r?.task_title, 120),
      kind: r?.kind === 'deadline' ? 'deadline' : 'reassign',
      reason: text(r?.reason, 500),
      proposedDue: isoDate(r?.proposed_due_on),
      currentDue: isoDate(r?.current_due_on),
      by: text(r?.requested_by_name, 80) || 'A team member',
    }))
    .filter((r) => r.id && r.taskId);
}

// Completion rate (D-65 (7)): the database sends the two counts; the percentage is only worded here.
export function rateText(row) {
  if (!row.rateDue) return 'No tasks were due';
  return `${Math.round((row.rateOnTime / row.rateDue) * 100)}% (${row.rateOnTime} of ${row.rateDue} on time)`;
}
export function normaliseTeam(result) {
  if (result === null || result === undefined || !Array.isArray(result.staff)) return null;
  return {
    days: num(result.days) || 30,
    staff: result.staff
      .map((s) => ({
        id: id(s?.staff_id),
        name: text(s?.name, 80),
        open: num(s?.assigned_open),
        overdue: num(s?.overdue),
        verification: num(s?.verification_pending),
        returned: num(s?.returned),
        completed: num(s?.completed),
        rateDue: num(s?.rate_due),
        rateOnTime: num(s?.rate_on_time),
      }))
      .filter((s) => s.id && s.name),
  };
}

const EVENTS = {
  created: 'Created',
  assigned: 'Assigned',
  reassigned: 'Given to someone else',
  unassigned: 'Taken off the person',
  accepted: 'Accepted',
  started: 'Work started',
  correction_started: 'Correction started',
  submitted: 'Handed in',
  verification_started: 'Checking started',
  verified: 'Approved and done',
  returned: 'Sent back for correction',
  deadline_changed: 'Deadline changed',
  cancelled: 'Cancelled',
  change_requested: 'Change requested',
  change_decided: 'Request decided',
};
export const eventLabel = (k) => EVENTS[k] ?? 'Updated';

export function normaliseDetail(d) {
  const task = normaliseTask(d?.task);
  if (!task) return null;
  return {
    task,
    events: (Array.isArray(d.events) ? d.events : [])
      .map((e) => ({ at: isoStamp(e?.at), label: eventLabel(e?.kind), by: text(e?.by, 80), detail: eventDetail(e?.kind, e?.detail) }))
      .filter((e) => e.at),
    comments: (Array.isArray(d.comments) ? d.comments : [])
      .map((c) => ({ at: isoStamp(c?.at), by: text(c?.by, 80), mine: c?.mine === true, body: text(c?.body, 1000) }))
      .filter((c) => c.at && c.body),
    submissions: (Array.isArray(d.submissions) ? d.submissions : []).map((s) => ({
      n: num(s?.n),
      at: isoStamp(s?.at),
      note: text(s?.note, 1000),
      tick: s?.tick === true,
      decision: s?.decision === 'approved' || s?.decision === 'rejected' ? s.decision : null,
      decisionComment: text(s?.decision_comment, 500),
      decidedBy: text(s?.decided_by, 80),
    })),
    requests: (Array.isArray(d.requests) ? d.requests : []).map((r) => ({
      kind: r?.kind === 'deadline' ? 'deadline' : 'reassign',
      reason: text(r?.reason, 500),
      status: ['pending', 'approved', 'rejected'].includes(r?.status) ? r.status : 'pending',
      proposedDue: isoDate(r?.proposed_due_on),
      decisionNote: text(r?.decision_note, 500),
    })),
    can: { manage: d.can?.manage === true, isAssignee: d.can?.is_assignee === true, verify: d.can?.verify === true },
  };
}
// Only short, plain facts from a history line are shown (a reason, a comment); ids and raw JSON never are.
function eventDetail(kind, detail) {
  const d = detail && typeof detail === 'object' ? detail : {};
  const bits = [d.reason, d.comment, d.note].map((x) => text(x, 300)).filter(Boolean);
  if (kind === 'deadline_changed' && isoDate(d.to ?? d.due_on)) bits.unshift(`New deadline ${shortDate(isoDate(d.to ?? d.due_on))}`);
  return bits.join(' · ');
}

// Database messages for 22023 (bad input), 55000 (wrong state) and 42501 (not allowed) are written for people; anything else is generic.
export function friendlyError(e) {
  const code = e?.code;
  const msg = text(e?.message, 200);
  if (code === '42501') return 'You cannot do that.';
  if ((code === '22023' || code === '55000') && msg) return msg.charAt(0).toUpperCase() + msg.slice(1) + (/[.!?]$/.test(msg) ? '' : '.');
  return 'That did not work. Check your connection and try again.';
}
