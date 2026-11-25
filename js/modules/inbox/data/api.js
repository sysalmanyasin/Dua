import { db } from '../../../core/supabase.js';

// Each call is an Inbox database function that works on the caller's own messages only.
async function rpc(name, args) {
  const { data, error } = await db().rpc(name, args);
  if (error) throw error;
  return data;
}
export const listMine = (limit = 50) => rpc('ntf_list_mine', { p_limit: limit });
export const unreadCount = () => rpc('ntf_unread_count');
export const markRead = (ids) => rpc('ntf_mark_read', { p_ids: ids });
export const markAllRead = () => rpc('ntf_mark_all_read');
