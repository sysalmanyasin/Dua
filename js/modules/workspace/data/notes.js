import { read, rpc, table } from './api.js';

export const openNote = (docId) => rpc('workspace_note_open', { p_doc: docId });

// Saves from the version the editor started with. Returns { status: 'saved', version } or { status: 'conflict', conflict_id,
// head_version }. A conflict changes nothing on the server except keeping this text as an open conflict.
export const saveNote = ({ docId, baseVersion, content, opId, seal = false, resolves = null, resolution = 'merged' }) =>
  rpc('workspace_note_save', {
    p_doc: docId,
    p_base_version: baseVersion,
    p_content: content,
    p_op_id: opId,
    p_seal: seal,
    p_resolves: resolves,
    p_resolution: resolution,
  });

export const restoreNote = (docId, version, opId) => rpc('workspace_note_restore', { p_doc: docId, p_version: version, p_op_id: opId });
export const searchNotes = (query, limit = 20) => rpc('workspace_search_notes', { p_query: query, p_limit: limit });

export const listConflicts = (docId) =>
  read(
    table('workspace_conflicts')
      .select('id,op_id,kind,target,status,created_at,resolved_at')
      .eq('document_id', docId)
      .order('created_at', { ascending: false }),
  );
export const getConflict = (id) => read(table('workspace_conflicts').select('*').eq('id', id).single());
export const resolveConflict = (id, choice, key) => rpc('workspace_conflict_resolve', { p_id: id, p_choice: choice, p_key: key });
