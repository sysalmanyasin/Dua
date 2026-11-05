// The only file in this module that talks to Supabase.
import { callAdminFunction, db } from '../../../core/supabase.js';

export async function listPending() {
  const { data, error } = await db()
    .from('access_requests')
    .select('id, full_name, username, requested_at')
    .eq('status', 'pending')
    .order('requested_at');
  if (error) throw error;
  return data;
}
export async function listPeople() {
  const { data, error } = await db()
    .from('profiles')
    .select('user_id, username, role_template, disabled_at, staff:staff_id(full_name)')
    .order('username');
  if (error) throw error;
  return data;
}
export async function listPermissionCatalog() {
  const [p, rp] = await Promise.all([
    db().from('permissions').select('key, description').order('key'),
    db().from('role_permissions').select('role, perm_key'),
  ]);
  if (p.error || rp.error) throw p.error ?? rp.error;
  return { permissions: p.data, rolePerms: rp.data };
}
export async function listUserPermissions(userId) {
  const { data, error } = await db().from('user_permissions').select('perm_key, effect').eq('user_id', userId);
  if (error) throw error;
  return data;
}
export const approve = (requestId, role) => callAdminFunction('admin-users', { action: 'approve_request', request_id: requestId, role });
export const reject = (requestId) => callAdminFunction('admin-users', { action: 'reject_request', request_id: requestId });
export const resetPin = (userId) => callAdminFunction('admin-users', { action: 'reset_pin', user_id: userId });
export const setDisabled = (userId, disabled) => callAdminFunction('admin-users', { action: 'set_disabled', user_id: userId, disabled });
export const setRole = (userId, role) => db().rpc('set_user_role', { p_user: userId, p_role: role });
export const setPermission = (userId, key, effect) =>
  db().rpc('set_user_permission', { p_user: userId, p_key: key, p_effect: effect, p_reason: null });
