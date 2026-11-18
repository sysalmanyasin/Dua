// The only file in this module that talks to Supabase. Reads follow the person's permissions (row-level security);
// every write is a database function that checks permissions, validates, and records an audit entry.
import { db } from '../../../core/supabase.js';

const one = async (query) => {
  const { data, error } = await query;
  if (error) throw error;
  return data;
};

/** The signed-in person's id, or null. Works offline (read from the saved session). */
export async function currentUserId() {
  const { data } = await db().auth.getSession();
  return data.session?.user?.id ?? null;
}

export const registerDevice = (deviceId, label) => one(db().rpc('ebill_register_device', { p_device_id: deviceId, p_label: label }));
/** Save one invoice. Resolves { ok, code, message?, invoice_no? }; a refusal is a result, not an exception. Network errors throw. */
export const saveInvoice = (invoice, pin) => one(db().rpc('ebill_save_invoice', { p_invoice: invoice, p_pin: pin || null }));

/** Online, after typing the PIN: the server issues this device the secret that lets it save offline. Resolves { ok, secret?, code?, message? }. */
export const offlineGrant = (deviceId, pin) => one(db().rpc('ebill_offline_grant', { p_device_id: deviceId, p_pin: pin }));
/** This person's discount limits and PIN rule, for the offline check. */
export const myLimits = () => one(db().rpc('ebill_my_limits'));

export const holdBill = (id, deviceId, state, label) =>
  one(db().rpc('ebill_hold_bill', { p_id: id, p_device: deviceId, p_state: state, p_label: label || '' }));
export const releaseHeld = (id) => one(db().rpc('ebill_release_held', { p_id: id }));
/** This person's holds on the server (without the bill itself). */
export const listHeld = () =>
  one(
    db()
      .from('ebill_held_bills')
      .select('id, label, customer, item_count, net_total, device_id, created_at, updated_at')
      .order('updated_at', { ascending: false }),
  );
export const getHeldState = async (id) =>
  (await one(db().from('ebill_held_bills').select('state').eq('id', id).maybeSingle()))?.state ?? null;

export const history = (f = {}) =>
  one(
    db().rpc('ebill_history', {
      p_from: f.from || null,
      p_to: f.to || null,
      p_text: f.text || null,
      p_status: f.status || null,
      p_mode: f.mode || null,
      p_limit: f.limit ?? 50,
      p_offset: f.offset ?? 0,
    }),
  );
export const invoiceDetail = (id) => one(db().rpc('ebill_invoice_detail', { p_invoice: id }));
export const refundInvoice = (id, reason) => one(db().rpc('ebill_refund_invoice', { p_invoice: id, p_reason: reason }));
export const correctInvoice = (id, changes, reason) =>
  one(db().rpc('ebill_correct_invoice', { p_invoice: id, p_changes: changes, p_reason: reason }));

export const listStaff = () => one(db().rpc('ebill_staff_list'));
export const setPin = (userId, pin) => one(db().rpc('ebill_set_pin', { p_user: userId, p_pin: pin }));
export const removePin = (userId) => one(db().rpc('ebill_remove_pin', { p_user: userId }));
export const setLimits = (userId, pct, amount, reason) =>
  one(db().rpc('ebill_set_limits', { p_user: userId, p_pct: pct, p_amount: amount, p_reason: reason }));

export const listDevices = () =>
  one(
    db()
      .from('ebill_devices')
      .select('device_id, label, status, registered_at, last_seen_at, deactivated_at, deactivate_reason')
      .order('registered_at'),
  );
export const deactivateDevice = (deviceId, reason) => one(db().rpc('ebill_deactivate_device', { p_device_id: deviceId, p_reason: reason }));

const SETTING_KEYS = ['ebill.max_discount_pct', 'ebill.max_discount_amount', 'ebill.pin_required'];
export async function getShopSettings() {
  const rows = await one(db().from('settings').select('key, value').in('key', SETTING_KEYS));
  const m = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    maxPct: Number(m['ebill.max_discount_pct'] ?? 10),
    maxAmount: Number(m['ebill.max_discount_amount'] ?? 1000),
    pinRequired: m['ebill.pin_required'] !== false,
  };
}
export const setShopSetting = (key, value, reason) => one(db().rpc('settings_set', { p_key: key, p_value: value, p_reason: reason }));
