// The only file in the Closing module that talks to Supabase. Reads follow the person's permissions (row-level security);
// every write goes through a closing_* database function, which holds the rules (slots, carry, versions, locks).
import { db } from '../../../core/supabase.js';

const one = async (query) => {
  const { data, error } = await query;
  if (error) throw error;
  return data;
};

const DRAFT_SELECT = '*, closing_slots(business_date, kind, seq), closing_hs_rows(*), closing_strip_lines(*), closing_mediq_orders(*)';

/** Active strips from the catalogue, in the order the owner set. */
export const listStrips = () =>
  one(db().from('closing_strips').select('id, label, group_name, price, sort').eq('active', true).order('sort').order('label'));

/** One closing with its slot and the sections built so far, found by the key the browser holds. */
export const loadByKey = (key) => one(db().from('closings').select(DRAFT_SELECT).eq('idempotency_key', key).maybeSingle());
export const loadById = (id) => one(db().from('closings').select(DRAFT_SELECT).eq('id', id).maybeSingle());

/** The person's own drafts and submitted closings, newest first (closing_my_recent). */
export const myRecent = (limit = 30) => one(db().rpc('closing_my_recent', { p_limit: limit }));
/** Active staff as [{ id, name }] for the "who is responsible" choice (CLS-14). */
export const staffChoices = () => one(db().rpc('closing_staff_choices'));

/**
 * Saves the draft. `expectedVersion` is the version the browser last saw; a newer save elsewhere is refused with
 * the draft_conflict code (CLS-13). Returns { closing_id, slot_id, status, version, updated_at, is_opening }.
 */
export const saveDraft = ({ key, date, kind, mode, payload, handoverSeq = null, expectedVersion = null }) =>
  one(
    db().rpc('closing_save_draft', {
      p_key: key,
      p_date: date,
      p_kind: kind,
      p_mode: mode,
      p_payload: payload,
      p_handover_seq: handoverSeq,
      p_expected_version: expectedVersion,
    }),
  );

/** Admin only: starts the one-time opening closing (CLS-10). */
export const startOpening = ({ key, date, kind }) => one(db().rpc('closing_start_opening', { p_key: key, p_date: date, p_kind: kind }));

/** The full calculation for a saved draft, run by the server (the browser may not read every setting). */
export const computePreview = (closingId) => one(db().rpc('closing_compute', { p_closing: closingId }));
/** The "since the last Final" roll-up for a saved closing. */
export const periodFor = (closingId) => one(db().rpc('closing_period', { p_closing: closingId }));

export const reopen = ({ closingId, reason, key }) =>
  one(db().rpc('closing_reopen', { p_closing: closingId, p_reason: reason, p_key: key }));
export const discardRevision = (closingId) => one(db().rpc('closing_discard_revision', { p_closing: closingId }));

/** Credit accounts the owner configured: named accounts and the names of the staff-credit tiers. */
export const listCreditAccounts = () =>
  one(db().from('closing_credit_accounts').select('id, kind, tier_no, label, sort').eq('active', true).order('sort').order('label'));

/** Submit the draft. Safe to repeat: a second call for the same key answers { already: true } and does nothing twice. */
export const submit = (key) => one(db().rpc('closing_submit', { p_key: key }));

// The inventory-audit requirement (CLS-8). It is on in code; an owner can switch it off with a reason, and the change is logged.
const AUDIT_KEY = 'closing.require_inventory_audit';
export const readAuditRequired = async () => {
  const { data, error } = await db().from('settings').select('value').eq('key', AUDIT_KEY).maybeSingle();
  if (error || !data) return null; // not visible to this person: unknown
  return data.value === true || data.value === 'true';
};
export const setAuditRequired = (required, reason) =>
  one(db().rpc('settings_set', { p_key: AUDIT_KEY, p_value: required, p_reason: reason }));

// ── ledgers (migration 0206): read-only, for people who may see every closing ──
/** One snapshot per submitted closing, newest first. `from` / `to` are 'YYYY-MM-DD' or null. */
export const creditLedger = ({ from = null, to = null, limit = 60 } = {}) =>
  one(db().rpc('closing_credit_ledger', { p_from: from, p_to: to, p_limit: limit }));
/** Open and closed misc charges, aged by their stable charge id: { as_of, open: [...], closed: [...] }. */
export const miscLedger = (closedLimit = 100) => one(db().rpc('closing_misc_ledger', { p_closed_limit: closedLimit }));
