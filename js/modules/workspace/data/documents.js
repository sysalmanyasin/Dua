import { read, rpc, table } from './api.js';

export const createDocument = ({ id = null, kind, title, key }) =>
  rpc('workspace_create_document', { p_id: id, p_kind: kind, p_title: title, p_key: key });

export const listDocuments = ({ scope = 'all', query = null, after = null, limit = 50 } = {}) =>
  rpc('workspace_list_documents', {
    p_scope: scope,
    p_query: query || null,
    p_after_updated: after?.after_updated ?? null,
    p_after_id: after?.after_id ?? null,
    p_limit: limit,
  });

// action: archive | unarchive | delete | undelete (owner only)
export const setDocumentState = (docId, action, key) => rpc('workspace_document_state', { p_doc: docId, p_action: action, p_key: key });
export const renameDocument = (docId, title, key) => rpc('workspace_document_rename', { p_doc: docId, p_title: title, p_key: key });
export const setHistoryVisible = (docId, visible, key) =>
  rpc('workspace_document_set_history_visible', { p_doc: docId, p_visible: visible, p_key: key });

// Personal organisation: my folders and my flags per document.
export const listFolders = () => read(table('workspace_folders').select('id,parent_id,name,created_at').order('name'));
export const listUserState = () => read(table('workspace_user_state').select('document_id,folder_id,pinned,offline_pinned,last_opened_at'));
export const saveFolder = ({ id = null, parentId = null, name, key }) =>
  rpc('workspace_folder_save', { p_id: id, p_parent: parentId, p_name: name, p_key: key });
export const removeFolder = (id, key) => rpc('workspace_folder_remove', { p_id: id, p_key: key });
export const setDocumentFlags = (docId, { folderId = null, pinned = false, offline = false, opened = false } = {}) =>
  rpc('workspace_state_set', { p_doc: docId, p_folder: folderId, p_pinned: pinned, p_offline: offline, p_opened: opened });
