// The only file in this module that talks to Supabase.
import { callAdminFunction, db } from '../../../core/supabase.js';

export async function listPeople() {
  const { data, error } = await db()
    .from('profiles')
    .select('user_id, username, role_template, disabled_at, staff:staff_id(full_name)')
    .order('username');
  if (error) throw error;
  return data;
}
// Usernames locked right now (5 wrong PINs in the last hour). Owner only.
export async function lockedUsernames() {
  const { data, error } = await db().rpc('access_locked_usernames');
  if (error) throw error;
  return data ?? [];
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
// Every personal Allow/Deny setting, for the "By permission" view. Owner only (RLS: users.manage).
export async function listAllUserPermissions() {
  const { data, error } = await db().from('user_permissions').select('user_id, perm_key, effect');
  if (error) throw error;
  return data;
}
export const setPin = (userId, pin) => callAdminFunction('admin-users', { action: 'set_pin', user_id: userId, pin });
export const unlock = (userId) => callAdminFunction('admin-users', { action: 'unlock', user_id: userId });
export const setDisabled = (userId, disabled) => callAdminFunction('admin-users', { action: 'set_disabled', user_id: userId, disabled });
export const setRole = (userId, role) => db().rpc('set_user_role', { p_user: userId, p_role: role });
export const setPermission = (userId, key, effect) =>
  db().rpc('set_user_permission', { p_user: userId, p_key: key, p_effect: effect, p_reason: null });
