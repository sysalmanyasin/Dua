// Small helpers for documents. Pure.

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
