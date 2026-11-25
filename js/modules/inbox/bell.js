// What the bell in the top bar asks Inbox every minute: how many messages are unread and which ones. Returns null when
// the person has no inbox (the bell then stays hidden). Only the caller's own messages are ever returned.
import * as api from './data/api.js';
import { normaliseMessages, unreadOf } from './domain/inbox.js';

export async function poll() {
  const [count, list] = await Promise.all([api.unreadCount(), api.listMine(20)]);
  const messages = normaliseMessages(list);
  if (messages === null || typeof count !== 'number') return null;
  return { count, items: unreadOf(messages).map(({ id, title, body, href }) => ({ id, title, body, href })) };
}
