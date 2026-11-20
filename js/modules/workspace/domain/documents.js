// Small helpers for documents. Pure.

// Session storage keys. Both start with "dua.", so they are cleared at sign-out with the other "dua." keys.
export const OPEN_KEY = 'dua.workspace.open';
export const draftKey = (docId) => `dua.workspace.draft.${docId}`;

export const KINDS = Object.freeze(['note', 'workbook']);
export const SCOPES = Object.freeze(['all', 'mine', 'shared', 'archived', 'trash']);

// Random ids made in the browser, so a document can be created offline and a retried request is recognised.
export const newId = (random = globalThis.crypto) => random.randomUUID();

export const normalizeTitle = (title) =>
  String(title ?? '')
    .trim()
    .replace(/\s+/g, ' ');
export const kindLabel = (kind) => ({ note: 'Note', workbook: 'Workbook' })[kind] ?? '';

// A search text that is safe to show or send: trimmed, one line, not absurdly long.
export const cleanQuery = (q) =>
  String(q ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);

// Newest first, then by id so the order is stable (the same order the server pages in).
export const sortDocuments = (rows) =>
  [...rows].sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));

// Cursor for the next page of workspace_list_documents.
export const nextCursor = (rows) => (rows.length ? { after_updated: rows.at(-1).updated_at, after_id: rows.at(-1).id } : null);

// "18 Nov 2026, 14:05" in the given time zone (the person's own by default).
export function formatWhen(iso, timeZone) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone,
  });
}

// "just now", "5 min ago", "3 h ago", or the date for anything older than a day.
export function relativeWhen(iso, now = Date.now(), timeZone) {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return formatWhen(iso, timeZone).slice(0, 11);
}
