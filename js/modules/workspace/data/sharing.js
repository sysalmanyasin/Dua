import { rpc } from './api.js';

export const shareCandidates = (query = null) => rpc('workspace_share_candidates', { p_query: query || null });
export const listMembers = (docId) => rpc('workspace_member_list', { p_doc: docId });
// role: editor | viewer (owner only)
export const setMember = (docId, staffId, role, key) =>
  rpc('workspace_member_set', { p_doc: docId, p_staff: staffId, p_role: role, p_key: key });
export const removeMember = (docId, staffId, key) => rpc('workspace_member_remove', { p_doc: docId, p_staff: staffId, p_key: key });
export const transferOwnership = (docId, newOwnerStaffId, key) =>
  rpc('workspace_transfer_ownership', { p_doc: docId, p_new_owner: newOwnerStaffId, p_key: key });
