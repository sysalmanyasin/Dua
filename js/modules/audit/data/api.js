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

// ── audits, members and rounds (migrations 0401, 0403) ──
/** Creates an audit. Safe to repeat with the same key. Returns the new audit's id. */
export const createEngagement = ({ key, name, scopeType, companies = [], method = 'manual' }) =>
  one(
    db().rpc('audit_engagement_create', {
      p_key: key,
      p_name: name,
      p_scope_type: scopeType,
      p_companies: companies,
      p_codes: [],
      p_method: method,
    }),
  );
/** One audit: its facts, members with names and rounds with counts (audit_engagement_overview). */
export const engagementOverview = (id) => one(db().rpc('audit_engagement_overview', { p_engagement: id }));
/** One round: state, version, who has which part and what is still unassigned (audit_round_overview). */
export const roundOverview = (id) => one(db().rpc('audit_round_overview', { p_round: id }));
/** Active accounts with whether they may count (audit_people). Owner and assigners only. */
export const listPeopleForAudit = () => one(db().rpc('audit_people'));
/** role is 'lead', 'deputy', 'counter' or 'observer'; null removes the person. */
export const setMember = (engagementId, userId, role) =>
  one(db().rpc('audit_member_set', { p_engagement: engagementId, p_user: userId, p_role: role }));
/** Creates a round from the audit's scope. The stock list comes from the Inventory interface. Returns the round id. */
export const createRound = ({ key, engagementId, unit }) =>
  one(db().rpc('audit_round_create', { p_key: key, p_engagement: engagementId, p_unit: unit }));
export const assignAuto = ({ roundId, auditors, split, version }) =>
  one(db().rpc('audit_assign_auto', { p_round: roundId, p_auditors: auditors, p_split: split, p_expected_version: version }));
export const assignMove = ({ roundId, itemIds, toUser, version }) =>
  one(db().rpc('audit_assign_move', { p_round: roundId, p_items: itemIds, p_to: toUser, p_expected_version: version }));
export const revokeAssignment = (assignmentId, reason) =>
  one(db().rpc('audit_assign_revoke', { p_assignment: assignmentId, p_reason: reason }));
export const lockRound = (roundId, version) => one(db().rpc('audit_round_lock', { p_round: roundId, p_expected_version: version }));
export const startRound = (roundId, version) => one(db().rpc('audit_round_start', { p_round: roundId, p_expected_version: version }));
/** The ids of one company's items in a round, so a whole company can be moved to another person. */
export const companyItemIds = async (roundId, company) =>
  (await one(db().from('audit_round_items').select('id').eq('round_id', roundId).eq('company', company).limit(6000))).map((r) => r.id);
