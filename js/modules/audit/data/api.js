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

// ── counting, Individual Audit and templates (migration 0406 and 0402) ──
/** The person's own assignments, newest first, with item and counted totals. */
export const myAssignments = () => one(db().rpc('audit_my_assignments'));
/** All of one assignment's items with the latest count on each. The database gives pages; this asks until a page comes back short. */
export async function myItems(assignmentId) {
  const PAGE = 500;
  const out = [];
  for (;;) {
    const page = await one(
      db().rpc('audit_my_items', {
        p_assignment: assignmentId,
        p_after: out.length ? out[out.length - 1].item_position : 0,
        p_limit: PAGE,
      }),
    );
    out.push(...page);
    if (page.length < PAGE) return out;
  }
}
/** Sends counts. Each event carries its own id, so sending the same batch twice changes nothing. Returns { accepted, duplicates }. */
export const countBatch = (assignmentId, events) => one(db().rpc('audit_count_batch', { p_assignment: assignmentId, p_events: events }));
export const submitCount = (assignmentId, extraNote) =>
  one(db().rpc('audit_submit', { p_assignment: assignmentId, p_extra_note: extraNote || null }));
/** Starts the person's own audit from typed codes or a template. Safe to repeat with the same key. */
export const startIndividual = ({ key, codes = [], templateId = null, companies = [] }) =>
  one(db().rpc('audit_individual_start', { p_key: key, p_codes: codes, p_template: templateId, p_companies: companies }));
export const listTemplates = () => one(db().from('audit_templates').select('id, name, codes, updated_at').order('name'));
export const saveTemplate = ({ id = null, name, codes }) =>
  one(db().rpc('audit_template_save', { p_id: id, p_name: name, p_codes: codes }));
export const deleteTemplate = (id) => one(db().rpc('audit_template_delete', { p_id: id }));

// ── review, corrections, conflicts, Force Submit and follow-up rounds (migrations 0402 and 0407) ──
/** Everything the review screen needs in one call: round, people with progress, newest compilation, history, conflicts, corrections. */
export const compileOverview = (roundId) => one(db().rpc('audit_compile_overview', { p_round: roundId }));
/** One page of compiled rows. mode: 'all' | 'diff' | 'missing'. Returns { rows, total }. */
export async function compiledRows({ compilationId, mode = 'diff', text = '', from = 0, to = 49 }) {
  let q = db()
    .from('audit_compiled_rows')
    .select(
      'round_item_id, position, company, code, name, system_qty, retail_price, counted_qty, variance, variance_value, missing, auto_matched, auditor_id, note, corrected_by',
      { count: 'exact' },
    )
    .eq('compilation_id', compilationId)
    .order('position')
    .range(from, to);
  if (mode === 'diff') q = q.neq('variance', 0);
  if (mode === 'missing') q = q.eq('missing', true);
  const t = text.replace(/[,()%*\\]/g, ' ').trim();
  if (t) q = q.or(`name.ilike.*${t}*,code.ilike.*${t}*,company.ilike.*${t}*`);
  const { data, count, error } = await q;
  if (error) throw error;
  return { rows: data, total: count ?? data.length };
}
export const compileRound = ({ roundId, allowMissing = false, version }) =>
  one(db().rpc('audit_compile_round', { p_round: roundId, p_allow_missing: allowMissing, p_expected_version: version }));
export const forceSubmit = ({ assignmentId, mode, reason }) =>
  one(db().rpc('audit_force_submit', { p_assignment: assignmentId, p_mode: mode, p_reason: reason }));
export const reopenAssignment = ({ assignmentId, reason }) =>
  one(db().rpc('audit_reopen', { p_assignment: assignmentId, p_reason: reason }));
export const proposeCorrection = ({ roundId, itemId, qty, reason }) =>
  one(db().rpc('audit_correction_propose', { p_round: roundId, p_item: itemId, p_qty: qty, p_reason: reason }));
export const decideCorrection = ({ id, approve, note }) =>
  one(db().rpc('audit_correction_decide', { p_id: id, p_approve: approve, p_note: note || null }));
export const resolveConflict = ({ id, side, reason }) =>
  one(db().rpc('audit_conflict_resolve', { p_conflict: id, p_side: side, p_reason: reason }));
export const nextRound = ({ key, baseRoundId, mode, sample = null, seed = null }) =>
  one(db().rpc('audit_round_next', { p_key: key, p_base_round: baseRoundId, p_mode: mode, p_sample: sample, p_seed: seed }));

// ── final snapshot, reports and audit trail (migration 0409) ──
/** Creates the Final Snapshot of a compiled round (owner only). The round can never change afterwards. */
export const finalizeRound = ({ roundId, version, note }) =>
  one(db().rpc('audit_finalize', { p_round: roundId, p_expected_version: version, p_note: note || null }));
/** Totals, companies and conflict choices of a final round. Refuses with final_not_found before the final. */
export const finalOverview = (roundId) => one(db().rpc('audit_final_overview', { p_round: roundId }));
/** One page of the final lines (at most 1000). Each row also carries `total`, the count of rows that match. */
export const finalLines = ({ roundId, onlyVariance = false, limit = 500, offset = 0 }) =>
  one(db().rpc('audit_final_lines_page', { p_round: roundId, p_only_variance: onlyVariance, p_limit: limit, p_offset: offset }));
/** Every final line of a round, for a file download. Asks page by page until a page comes back short. */
export async function finalLinesAll(roundId, onlyVariance = false) {
  const PAGE = 1000;
  const out = [];
  for (;;) {
    const page = await finalLines({ roundId, onlyVariance, limit: PAGE, offset: out.length });
    out.push(...page);
    if (page.length < PAGE) return out;
  }
}
/** One audit's report: rounds with totals, and who counted what. */
export const reportEngagement = (engagementId) => one(db().rpc('audit_report_engagement', { p_engagement: engagementId }));
/** One audit's trail, newest first. Pass the smallest id you already have as `before` for the next page. */
export const auditTrail = ({ engagementId, limit = 100, before = null }) =>
  one(db().rpc('audit_trail', { p_engagement: engagementId, p_limit: limit, p_before: before }));

// ── expiry tracking (migration 0410) ──
/** Racks, this month's assignments and the racks the caller may log against. Pass 'YYYY-MM' for another month. */
export const expiryOverview = (month = null) => one(db().rpc('audit_expiry_overview', { p_month: month }));
/** Product search for the logging form (two letters at least). */
export const expiryProducts = (query, limit = 20) => one(db().rpc('audit_expiry_products', { p_query: query, p_limit: limit }));
/** Saves one entry. The same key sent again returns the same entry, so a resend never doubles it. */
export const logExpiry = ({ key, productId, qty, month, rack, status }) =>
  one(db().rpc('audit_expiry_log', { p_key: key, p_product: productId, p_qty: qty, p_month: month, p_rack: rack, p_status: status }));
/** The shared register. Each row carries `total`, the number of rows that match. */
export const searchExpiry = ({ query = '', month = '', status = '', limit = 50, offset = 0 } = {}) =>
  one(db().rpc('audit_expiry_search', { p_query: query, p_month: month, p_status: status, p_limit: limit, p_offset: offset }));
/** Owner only: unlock, change and lock again, or delete (with a reason). */
export const reopenExpiry = (id) => one(db().rpc('audit_expiry_reopen', { p_id: id }));
export const updateExpiry = ({ id, qty, month, rack, status }) =>
  one(db().rpc('audit_expiry_update', { p_id: id, p_qty: qty, p_month: month, p_rack: rack, p_status: status }));
export const deleteExpiry = (id, reason) => one(db().rpc('audit_expiry_delete', { p_id: id, p_reason: reason }));
/** Owner only: racks and who checks which rack in a month. */
export const saveRack = ({ id = null, name, active = true }) =>
  one(db().rpc('audit_rack_save', { p_id: id, p_name: name, p_active: active }));
export const expiryPeople = () => one(db().rpc('audit_expiry_people'));
export const assignRack = ({ rackId, userId, month }) =>
  one(db().rpc('audit_rack_assign', { p_rack: rackId, p_user: userId, p_month: month }));
export const unassignRack = (id) => one(db().rpc('audit_rack_unassign', { p_assignment: id }));

// ── barcodes (migration 0411) ──
/** Product search for registering a barcode (two letters at least). Each row says how many barcodes the product already has. */
export const barcodeProducts = (query, limit = 20) => one(db().rpc('audit_barcode_products', { p_query: query, p_limit: limit }));
/** Registers a barcode for a product. Returns { outcome: 'created'|'exists'|'conflict'|'disabled', id, status }. Safe to repeat. */
export const registerBarcode = ({ barcode, productId, type = 'unknown', notes = null }) =>
  one(db().rpc('audit_barcode_register', { p_barcode: barcode, p_product: productId, p_type: type, p_notes: notes }));
export const verifyBarcode = (id) => one(db().rpc('audit_barcode_verify', { p_id: id }));
/** Administrators: move a barcode to another product, switch it off or on, or settle a conflict (keep, reassign, disable). */
export const changeBarcode = ({ id, productId, reason }) =>
  one(db().rpc('audit_barcode_change', { p_id: id, p_product: productId, p_reason: reason }));
export const disableBarcode = (id, reason) => one(db().rpc('audit_barcode_disable', { p_id: id, p_reason: reason }));
export const enableBarcode = (id, reason) => one(db().rpc('audit_barcode_enable', { p_id: id, p_reason: reason }));
export const resolveBarcodeConflict = ({ id, decision, reason }) =>
  one(db().rpc('audit_barcode_conflict_resolve', { p_id: id, p_decision: decision, p_reason: reason }));
/** The Center list. Each row carries `total`, the number of rows that match. status: '' for all. */
export const listBarcodes = ({ status = '', query = '', limit = 50, offset = 0 } = {}) =>
  one(db().rpc('audit_barcode_list', { p_status: status || null, p_query: query, p_limit: limit, p_offset: offset }));
export const barcodeOverview = () => one(db().rpc('audit_barcode_overview'));
/** One page of rows changed since a cursor, for the phone's copy of the list. */
export const barcodeMirrorPage = ({ since = null, after = null, limit = 1000 } = {}) =>
  one(db().rpc('audit_barcode_mirror', { p_since: since, p_after: after, p_limit: limit }));
export const barcodeHistory = (id, limit = 100) => one(db().rpc('audit_barcode_history', { p_id: id, p_limit: limit }));
/** Scan history: everyone's for administrators, the person's own for everyone else. */
export const scanHistory = ({ limit = 50, offset = 0 } = {}) => one(db().rpc('audit_scan_history', { p_limit: limit, p_offset: offset }));
/** Saves scans. Each carries its own id, so sending a batch twice changes nothing. Returns { saved, duplicates, rejected }. */
export const scanBatch = (events) => one(db().rpc('audit_scan_batch', { p_events: events }));
/** Owner: how an audit is counted ('manual', 'barcode' or 'hybrid'). */
export const setCountingMethod = (engagementId, method) =>
  one(db().rpc('audit_engagement_set_method', { p_engagement: engagementId, p_method: method }));
