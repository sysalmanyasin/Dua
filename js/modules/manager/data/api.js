// The only file in this module that talks to Supabase. Reads follow the person's permissions (row-level security, or an
// owner-gated function where core tables are not readable); every write is a database function that checks, validates, logs
// and accepts an idempotency key. Mutations return { data, error } so pages can show the database's plain message.
import { db } from '../../../core/supabase.js';

const one = async (query) => {
  const { data, error } = await query;
  if (error) throw error;
  return data;
};

// ── Staff ──
export const listStaff = () => one(db().rpc('mgmt_staff_list'));
export const getStaff = (id) => one(db().rpc('mgmt_staff_get', { p_staff_id: id }));
export const saveStaff = (payload) => db().rpc('mgmt_staff_save', payload);

// ── Notes ──
export const listNotes = (staffId) =>
  one(
    db()
      .from('mgmt_staff_notes')
      .select('id, body, created_at')
      .eq('staff_id', staffId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false }),
  );
export const addNote = (staffId, body, key) => db().rpc('mgmt_note_add', { p_staff_id: staffId, p_body: body, p_key: key });
export const removeNote = (id, reason) => db().rpc('mgmt_note_remove', { p_note_id: id, p_reason: reason || null });

// ── Staff credit ──
export const creditMonth = (monthIso) => one(db().rpc('mgmt_credit_month', { p_month: monthIso }));
export const creditAdd = (staffId, date, description, amount, key) =>
  db().rpc('mgmt_credit_add', { p_staff_id: staffId, p_date: date, p_description: description, p_amount: amount, p_key: key });
export const creditReverse = (entryId, reason, key) =>
  db().rpc('mgmt_credit_reverse', { p_entry_id: entryId, p_reason: reason, p_key: key });
export const creditSetDeduction = (staffId, month, kind, amount, reason, key) =>
  db().rpc('mgmt_credit_set_deduction', {
    p_staff_id: staffId,
    p_month: month,
    p_kind: kind,
    p_amount: amount,
    p_reason: reason || null,
    p_key: key,
  });
export const creditSetOpening = (staffId, month, amount, reason, key) =>
  db().rpc('mgmt_credit_set_opening', { p_staff_id: staffId, p_month: month, p_amount: amount, p_reason: reason, p_key: key });
