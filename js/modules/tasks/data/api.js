import { db } from '../../../core/supabase.js';

// Every call is a Task Master database function. Each checks who is asking again; null means "not for you".
async function rpc(name, args) {
  const { data, error } = await db().rpc(name, args);
  if (error) throw error;
  return data;
}

// ── reads ──
export const listMine = (scope = 'open') => rpc('task_list_mine', { p_scope: scope });
export const snapshotMine = () => rpc('task_snapshot_mine');
export const listAll = (status = null, assignee = null, limit = 200) =>
  rpc('task_list_all', { p_status: status, p_assignee: assignee, p_limit: limit });
export const verificationQueue = () => rpc('task_verification_queue');
export const getTask = (task) => rpc('task_get', { p_task: task });
export const pendingRequests = () => rpc('task_change_requests_pending');
export const teamOverview = (days = 30) => rpc('task_team_overview', { p_days: days });
export const scheduleList = () => rpc('task_schedule_list');

// ── staff ──
export const accept = (task) => rpc('task_accept', { p_task: task });
export const start = (task) => rpc('task_start', { p_task: task });
export const submit = (task, note, tick) => rpc('task_submit', { p_task: task, p_note: note || null, p_tick: tick === true });
export const addComment = (task, body) => rpc('task_comment_add', { p_task: task, p_body: body });
export const requestChange = (task, kind, reason, due) =>
  rpc('task_request_change', { p_task: task, p_kind: kind, p_reason: reason, p_proposed_due: due || null });

// ── verifiers ──
export const beginVerification = (task) => rpc('task_begin_verification', { p_task: task });
export const verify = (task, approve, comment) => rpc('task_verify', { p_task: task, p_approve: approve, p_comment: comment || null });

// ── the Owner ──
export const createTask = (f) =>
  rpc('task_create', {
    p_title: f.title,
    p_instructions: f.instructions || '',
    p_evidence: f.evidence,
    p_priority: f.priority,
    p_assignee: f.assignee || null,
    p_due: f.due || null,
  });
export const assignTask = (task, assignee) => rpc('task_assign', { p_task: task, p_assignee: assignee });
export const setDeadline = (task, due, reason) => rpc('task_set_deadline', { p_task: task, p_due: due, p_reason: reason || null });
export const cancelTask = (task, reason) => rpc('task_cancel', { p_task: task, p_reason: reason });
export const decideChange = (request, approve, note, newAssignee) =>
  rpc('task_decide_change', { p_request: request, p_approve: approve, p_note: note || null, p_new_assignee: newAssignee || null });
export const createSchedule = (f) =>
  rpc('task_schedule_create', {
    p_title: f.title,
    p_instructions: f.instructions || '',
    p_evidence: f.evidence,
    p_priority: f.priority,
    p_assignee: f.assignee || null,
    p_kind: f.kind,
    p_weekdays: f.kind === 'weekly' ? f.weekdays : null,
    p_month_day: f.kind === 'monthly' ? Number(f.monthDay) : null,
    p_week: f.kind === 'nth_week' ? Number(f.week) : null,
  });
export const setScheduleActive = (schedule, active) => rpc('task_schedule_set_active', { p_schedule: schedule, p_active: active });
export const generateNow = () => rpc('task_generate_now');
