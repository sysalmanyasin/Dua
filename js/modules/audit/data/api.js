// The only file in the Audit module that talks to Supabase. Reads follow the person's permissions (row-level security);
// every write is a database function that holds the rules.
import { db } from '../../../core/supabase.js';

const one = async (query) => {
  const { data, error } = await query;
  if (error) throw error;
  return data;
};

/** Audits the person may see (row-level security decides), newest first. */
export const listEngagements = (limit = 50) =>
  one(
    db()
      .from('audit_engagements')
      .select('id, name, scope_type, scope_month, counting_method, status, created_at')
      .order('created_at', { ascending: false })
      .limit(limit),
  );

// ── team access (owner only: reading other people's permissions needs users.manage) ──
/** Everyone with an account, with the staff name. */
export const listPeople = () =>
  one(db().from('profiles').select('user_id, username, role_template, disabled_at, staff:staff_id(full_name)').order('username'));

/** The audit permissions that exist, and which ones each role preset already carries. */
export async function listAuditCatalog() {
  const [p, rp] = await Promise.all([
    db().from('permissions').select('key, description').like('key', 'audit.%').order('key'),
    db().from('role_permissions').select('role, perm_key').like('perm_key', 'audit.%'),
  ]);
  if (p.error || rp.error) throw p.error ?? rp.error;
  return { permissions: p.data, rolePerms: rp.data };
}

/** Every personal Allow or Deny on an audit key, for all people: [{ user_id, perm_key, effect }]. */
export const listAuditOverrides = () => one(db().from('user_permissions').select('user_id, perm_key, effect').like('perm_key', 'audit.%'));

/** One personal setting: effect is 'grant', 'deny' or null (back to the role default). Logged by the database. */
export const setPermission = (userId, key, effect) =>
  one(db().rpc('set_user_permission', { p_user: userId, p_key: key, p_effect: effect, p_reason: 'Audit team access' }));
