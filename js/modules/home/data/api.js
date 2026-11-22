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
