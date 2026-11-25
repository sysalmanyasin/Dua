// Pure helpers for the Inbox. No Supabase, no DOM. The database sends only the caller's own messages (ntf_list_mine); this
// file tidies them and words the time. Messages hold a task title and plain words, never salary or cash (D-58).

const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const id = (v) => (typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v) ? v : '');

// null means "not for you" (the database answers null without ntf.view_own); the screen hides itself.
export function normaliseMessages(result) {
  if (result === null || result === undefined) return null;
  return (Array.isArray(result) ? result : [])
    .map((m) => ({
      id: id(m?.id),
      kind: text(m?.kind, 60),
      title: text(m?.title, 120),
      body: text(m?.body, 300),
      // a link is only ever an address inside this app
      href: typeof m?.href === 'string' && /^\/[a-z0-9/_-]{0,60}$/.test(m.href) ? m.href : null,
      at: typeof m?.at === 'string' && !Number.isNaN(Date.parse(m.at)) ? m.at : null,
      read: m?.read === true,
    }))
    .filter((m) => m.id && m.title && m.at);
}

export const unreadOf = (messages) => messages.filter((m) => !m.read);

// "Just now", "5 min ago", "3 hours ago", "Yesterday", "3 days ago", then the date (Pakistan time).
export function ago(iso, now = Date.now()) {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return 'Just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} hour${Math.floor(s / 3600) === 1 ? '' : 's'} ago`;
  const d = Math.floor(s / 86_400);
  if (d === 1) return 'Yesterday';
  if (d < 7) return `${d} days ago`;
  return new Date(iso).toLocaleDateString('en-GB', { timeZone: 'Asia/Karachi', day: 'numeric', month: 'short', year: 'numeric' });
}

export const unreadText = (n) => (n === 0 ? 'No new messages' : n === 1 ? '1 new message' : `${n} new messages`);
