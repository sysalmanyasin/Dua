import { db } from '../../../core/supabase.js';

// Each call is an Inbox database function that works on the caller's own messages only.
async function rpc(name, args) {
  const { data, error } = await db().rpc(name, args);
  if (error) throw error;
  return data;
}
export const listMine = (limit = 50) => rpc('ntf_list_mine', { p_limit: limit });
export const unreadCount = () => rpc('ntf_unread_count');
// After a message is cleared the bell in the top bar updates straight away instead of waiting for its next check.
const changed = (n) => {
  if (typeof document !== 'undefined') document.dispatchEvent(new CustomEvent('dua:inbox-changed'));
  return n;
};
export const markRead = async (ids) => changed(await rpc('ntf_mark_read', { p_ids: ids }));
export const markAllRead = async () => changed(await rpc('ntf_mark_all_read'));
