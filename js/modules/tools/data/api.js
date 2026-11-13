// The only file in this module that talks to Supabase.
import { db } from '../../../core/supabase.js';

// Everything the Tools tab shows (null for anyone who is not the owner with the second factor).
export async function toolsOverview() {
  const { data, error } = await db().rpc('tools_overview');
  if (error) throw error;
  return data;
}
export async function ackNotification(id) {
  const { error } = await db().rpc('notifications_ack', { p_id: id });
  if (error) throw error;
}
