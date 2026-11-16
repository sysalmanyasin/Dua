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
