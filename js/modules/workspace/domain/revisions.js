// Revision helpers. The server decides everything that matters (see 1101_workspace_notes.sql); these mirror the rules so
// screens can show honest labels and hints.

export const AUTOSAVE_WINDOW_MS = 5 * 60 * 1000;

const LABELS = Object.freeze({
  create: 'Created',
  edit: 'Edited',
  merge: 'Merged after a conflict',
  restore: 'Restored',
});

// Would the server update this author's open revision in place, rather than start a new version?
export function wouldSaveInPlace(head, { userId, now = Date.now(), resolvingConflict = false } = {}) {
  if (!head || resolvingConflict || head.sealed) return false;
  if (head.created_by !== userId) return false;
  if (head.kind !== 'create' && head.kind !== 'edit') return false;
  return now - new Date(head.saved_at).getTime() < AUTOSAVE_WINDOW_MS;
}

export function describeRevision(rev) {
  const base = LABELS[rev.kind] ?? 'Saved';
  if (rev.kind === 'restore' && rev.restored_from) return `${base} version ${rev.restored_from}`;
  return base;
}

// Versions the owner may restore: everything except the current one.
export const restorableVersions = (history) => history.filter((h) => !h.is_head);

// The server returns { status: 'saved' | 'conflict', ... } from a note save.
export const isConflict = (result) => result?.status === 'conflict';
export const isSaved = (result) => result?.status === 'saved';
