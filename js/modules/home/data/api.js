import { db } from '../../../core/supabase.js';

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
