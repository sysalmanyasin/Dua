// What each role may do. This is the same matrix the database enforces (docs/modules/workspace.md, section 5); the screens
// use it only to decide which buttons to show. Showing a button never grants anything: every action is checked again by
// the database, so a wrong answer here can only hide or show a button, never expose data.

export const ROLES = Object.freeze(['owner', 'editor', 'viewer']);

const OWNER_ONLY = ['share', 'transfer', 'archive', 'delete', 'rename', 'restore', 'history_setting', 'manage_members'];
const EDITOR_UP = ['edit', 'upload', 'snapshot'];
const VIEWER_UP = ['read', 'download', 'resolve_own_conflicts'];

export const ACTIONS = Object.freeze([...VIEWER_UP, 'view_history', ...EDITOR_UP, ...OWNER_ONLY]);

// can(role, action, { archived, historyVisible }) -> boolean. An unknown role or action is always false.
export function can(role, action, { archived = false, historyVisible = true } = {}) {
  if (!ROLES.includes(role) || !ACTIONS.includes(action)) return false;
  if (action === 'view_history') return role !== 'viewer' || historyVisible;
  if (VIEWER_UP.includes(action)) return action === 'resolve_own_conflicts' ? role !== 'viewer' : true;
  if (archived && action !== 'archive' && action !== 'delete') return false; // archived documents are read-only
  if (EDITOR_UP.includes(action)) return role === 'owner' || role === 'editor';
  return role === 'owner';
}

export const roleLabel = (role) => ({ owner: 'Owner', editor: 'Can edit', viewer: 'Can view' })[role] ?? '';
