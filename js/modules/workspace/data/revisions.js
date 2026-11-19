import { read, rpc, table } from './api.js';

export const listHistory = (docId, { before = null, limit = 50 } = {}) =>
  rpc('workspace_note_history', { p_doc: docId, p_before: before, p_limit: limit });

// One version with its content (for compare and restore previews).
export const getRevision = (docId, version) =>
  read(
    table('workspace_note_revisions')
      .select('version,content,kind,created_at,sealed')
      .eq('document_id', docId)
      .eq('version', version)
      .single(),
  );
