import { isNetworkDown, loadOfflineContext, saveOfflineContext } from './offlineContext.js';
import { callFunction, db } from './supabase.js';
import { log } from './logger.js';

export async function adminSignIn(email, password) {
  const { error } = await db().auth.signInWithPassword({ email: String(email).trim(), password });
  return error ? { ok: false, message: 'Invalid email or password.' } : { ok: true };
}

export async function staffSignIn(username, pin) {
  const r = await callFunction('staff-login', { username: String(username).trim().toLowerCase(), pin });
  if (!r.ok) return { ok: false, message: r.body.message ?? 'Sign-in failed.' };
  const { error } = await db().auth.setSession({ access_token: r.body.access_token, refresh_token: r.body.refresh_token });
  return error ? { ok: false, message: 'Sign-in failed.' } : { ok: true };
}

// ── MFA (admins) ──
export async function mfaState() {
  const { data: aal } = await db().auth.mfa.getAuthenticatorAssuranceLevel();
  const { data: factors } = await db().auth.mfa.listFactors();
  const verified = (factors?.totp ?? []).find((f) => f.status === 'verified');
  return { current: aal?.currentLevel, next: aal?.nextLevel, factorId: verified?.id ?? null };
}
export async function mfaEnroll() {
  // Remove any half-finished enrolment first so the QR code is fresh.
  const { data: factors } = await db().auth.mfa.listFactors();
  for (const f of factors?.all ?? []) if (f.status !== 'verified') await db().auth.mfa.unenroll({ factorId: f.id });
  const { data, error } = await db().auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Authenticator' });
  if (error) return { ok: false, message: 'Could not start MFA setup.' };
  return { ok: true, factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret };
}
export async function mfaVerify(factorId, code) {
  const { error } = await db().auth.mfa.challengeAndVerify({ factorId, code: String(code).trim() });
  return error ? { ok: false, message: 'That code is not correct.' } : { ok: true };
}

export async function loadContext() {
  const { data, error } = await db().rpc('my_context');
  if (error) {
    log.error('my_context failed', { code: error.code });
    // No connection: a device that was signed in may still open Emergency Billing (see offlineContext.js).
    return isNetworkDown(error) ? loadOfflineContext() : null;
  }
  saveOfflineContext(data);
  return data;
}

// Work kept on this phone (unsent check-list drafts, page hand-offs) is removed when someone signs out,
// so the next person using the same phone cannot see it.
export function clearLocalWork(storages = [globalThis.localStorage, globalThis.sessionStorage]) {
  for (const st of storages) {
    if (!st) continue;
    for (const key of Object.keys(st)) if (key.startsWith('dua.') || key.startsWith('sales.')) st.removeItem(key);
  }
}

export async function signOut() {
  clearLocalWork();
  await db().auth.signOut();
}
