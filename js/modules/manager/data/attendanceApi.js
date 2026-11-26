// Attendance data layer: the database functions of migration 0110 and the phone's location. Kept apart from data/api.js so the
// attendance slice never conflicts with the rest of Manager. Writes are database functions with an idempotency key.
import { db } from '../../../core/supabase.js';

const one = async (query) => {
  const { data, error } = await query;
  if (error) throw error;
  return data;
};

// ── the person's own check-in ──
export const today = () => one(db().rpc('mgmt_attendance_today'));
// The person's own days and events for a date range (migration 0111). Only their own: the database picks the person.
export const myHistory = (from, to) => one(db().rpc('mgmt_attendance_my_history', { p_from: from, p_to: to }));
export const checkIn = (kind, fix, key) =>
  db().rpc('mgmt_attendance_check_in', {
    p_kind: kind,
    p_lat: fix.lat,
    p_lng: fix.lng,
    p_accuracy: fix.accuracy,
    p_mock: fix.mock,
    p_source: fix.source,
    p_key: key,
  });

// ── the owner ──
export const list = (from, to) => one(db().rpc('mgmt_attendance_list', { p_from: from, p_to: to }));
export const summary = (from, to) => one(db().rpc('mgmt_attendance_summary', { p_from: from, p_to: to })); // one line per person per day (0111)
export const setup = () => one(db().rpc('mgmt_attendance_setup'));
export const saveSite = (s, reason, key) =>
  db().rpc('mgmt_attendance_site_save', {
    p_id: s.id ?? null,
    p_name: s.name,
    p_lat: s.lat,
    p_lng: s.lng,
    p_radius: s.radius,
    p_active: s.active,
    p_reason: reason,
    p_key: key,
  });
export const setConfig = (maxAccuracy, requireApp, reason, key) =>
  db().rpc('mgmt_attendance_config_set', { p_max_accuracy: maxAccuracy, p_require_app: requireApp, p_reason: reason, p_key: key });

// ── the phone's location ──
// Inside the Android app (Capacitor) the native DuaDevice plugin reads the location AND Android's "mock location" flag, which
// the web cannot see. In a plain browser we fall back to the browser's location and send source "web" (the server may refuse it).
export const insideApp = () => Boolean(globalThis.Capacitor?.isNativePlatform?.());

export async function currentLocation() {
  const native = globalThis.Capacitor?.Plugins?.DuaDevice;
  if (insideApp() && native?.getAttendanceLocation) {
    const r = await native.getAttendanceLocation();
    return { lat: r.latitude, lng: r.longitude, accuracy: r.accuracy, mock: Boolean(r.mock), source: 'app' };
  }
  if (!globalThis.navigator?.geolocation) throw new Error('This device cannot share its location.');
  const pos = await new Promise((resolve, reject) =>
    navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }),
  );
  return { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy, mock: false, source: 'web' };
}

// Plain wording for why the location could not be read.
export function locationProblem(err) {
  const code = err?.code ?? err?.errorMessage ?? '';
  if (code === 1 || /denied|permission/i.test(String(err?.message ?? code)))
    return 'Location is switched off for Dua. Allow location for this app in your phone settings.';
  if (code === 3 || /timeout|timed out/i.test(String(err?.message ?? code)))
    return 'Your phone could not find its location in time. Try again outside or near a window.';
  return 'Your phone could not read its location. Turn location on and try again.';
}
