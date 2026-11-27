import { db } from '../../../core/supabase.js';

// Read only for people with sales.view_history. The view is security_invoker and keeps the
// same row-level permission boundary as the Sales Dashboard, including monthly-only history.
export async function lifetimeSalesMonths() {
  const { data, error } = await db().from('v_monthly_full').select('month, days, total').gte('month', '2020-04-01').order('month');
  if (error) throw error;
  return data ?? [];
}

export async function coverSummary() {
  const { data, error } = await db().rpc('cover_summary');
  if (error) throw error;
  return data;
}

// Owner alerts for "Needs attention" (null for anyone without notifications.view). Never breaks the Cover.
export async function notificationsAttention() {
  const { data, error } = await db().rpc('notifications_attention');
  if (error) throw error;
  return data;
}

// The four stock numbers, worked out inside the database (inventory_cover_summary). Needs inventory.view; the Cover only
// asks when the person has it, and a failure here never breaks the rest of the Cover.
export async function inventoryCover() {
  const { data, error } = await db().rpc('inventory_cover_summary');
  if (error) throw error;
  return data;
}

// Owner Action Centre: issues worked out live by the database from each module's own data and the Owner's rules (ops_rules).
// null for anyone without ops.view. Nothing here can dismiss or change an issue; it is fixed in the module that owns it.
export async function opsActionItems() {
  const { data, error } = await db().rpc('ops_action_items');
  if (error) throw error;
  return data;
}

// Latest events from the categories the Owner has switched on (null without ops.view).
export async function opsRecentActivity(limit = 10) {
  const { data, error } = await db().rpc('ops_recent_activity', { p_limit: limit });
  if (error) throw error;
  return data;
}

// Owner Business Intelligence: sales, transactions, inventory health and operations for 7, 30 or 90 complete days, with the
// same-length period before it (null without ops.view). Detailed analysis stays in Sales and Reports.
export async function opsBiSummary(days = 30) {
  const { data, error } = await db().rpc('ops_bi_summary', { p_days: days });
  if (error) throw error;
  return data;
}

// Owner "Latest closing summary": the latest submitted closing, with book bills, manual returns, deposits and MEDIQ added up since the
// last Final Closing, and the carried CC. Worked out by Closing (closing_ops_summary) behind ops_closing_summary; null without ops.view.
export async function opsClosingSummary() {
  const { data, error } = await db().rpc('ops_closing_summary');
  if (error) throw error;
  return data;
}

// The caller's OWN closed payslips (Manager's saved values). null unless the owner granted payroll.view_own.
export async function myPayslips(months = 3) {
  const { data, error } = await db().rpc('mgmt_my_payslips', { p_months: months });
  if (error) throw error;
  return data;
}

// The caller's own recent closings (Closing's own list for people who enter closings). Throws for people who may not.
export async function myRecentClosings(limit = 10) {
  const { data, error } = await db().rpc('closing_my_recent', { p_limit: limit });
  if (error) throw error;
  return data ?? [];
}

// Important events arrive immediately: tell `onChange` whenever any closing is saved or submitted. Returns a function that
// stops listening. A realtime failure is silent by design; the periodic refresh still keeps the page up to date.
export function watchClosings(onChange, name = 'home-closings') {
  try {
    const client = db();
    const channel = client
      .channel(name)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'closings' }, () => onChange())
      .subscribe();
    return () => client.removeChannel(channel);
  } catch {
    return () => {};
  }
}

// ── Task Master on Home (each is one of Task Master's own database functions; null means "not for you") ──
// The caller's own tasks and counts (people with tasks.view_own).
export async function myTaskSnapshot() {
  const { data, error } = await db().rpc('task_snapshot_mine');
  if (error) throw error;
  return data;
}
export async function myTaskList() {
  const { data, error } = await db().rpc('task_list_mine', { p_scope: 'open' });
  if (error) throw error;
  return data;
}
// Work waiting for this person to check (null unless they are the Owner or a named verifier).
export async function taskVerificationQueue() {
  const { data, error } = await db().rpc('task_verification_queue');
  if (error) throw error;
  return data;
}
// Owner only (tasks.manage): each person's workload and completion rate, and the change requests waiting for a decision.
export async function taskTeamOverview(days = 30) {
  const { data, error } = await db().rpc('task_team_overview', { p_days: days });
  if (error) throw error;
  return data;
}
export async function taskPendingRequests() {
  const { data, error } = await db().rpc('task_change_requests_pending');
  if (error) throw error;
  return data;
}

// ── Inbox on Home (the caller's own messages; null means "not for you") ──
export async function myInboxList(limit = 5) {
  const { data, error } = await db().rpc('ntf_list_mine', { p_limit: limit });
  if (error) throw error;
  return data;
}
export async function myInboxUnread() {
  const { data, error } = await db().rpc('ntf_unread_count');
  if (error) throw error;
  return data;
}
