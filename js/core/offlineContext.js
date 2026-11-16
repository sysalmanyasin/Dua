// Starting the app with no connection. A device that was signed in keeps a SMALL copy of who the person is, so Emergency Billing
// can still open. This is deliberately narrow:
//   * only the Emergency Billing right is kept (nothing else opens offline: every other module needs the server anyway);
//   * only for 30 days after the person last signed in with a connection;
//   * it is used only when the server cannot be reached, never instead of a normal sign-in when online;
//   * signing out removes it (the key starts with "dua.", which clearLocalWork already clears).
// Saving still needs the person's PIN, and the server re-checks everything when the invoice is uploaded.
const KEY = 'dua.offline.ctx';
const MAX_AGE_MS = 30 * 86_400_000;
const KEPT = ['ebill.use'];

export function saveOfflineContext(ctx, store = globalThis.localStorage, now = Date.now()) {
  try {
    if (!ctx?.user_id || !ctx.mfa_ok || !(ctx.permissions || []).some((p) => KEPT.includes(p))) {
      store?.removeItem(KEY);
      return;
    }
    const small = {
      user_id: ctx.user_id,
      username: ctx.username,
      full_name: ctx.full_name,
      role: ctx.role,
      mfa_ok: true,
      permissions: ctx.permissions.filter((p) => KEPT.includes(p)),
      modules_disabled: [],
    };
    store?.setItem(KEY, JSON.stringify({ savedAt: now, ctx: small }));
  } catch {
    /* storage full or blocked: the app simply will not start offline */
  }
}

/** The kept context marked `offline: true`, or null if there is none, it is too old, or it is damaged. */
export function loadOfflineContext(store = globalThis.localStorage, now = Date.now()) {
  try {
    const v = JSON.parse(store?.getItem(KEY) ?? 'null');
    if (!v?.ctx?.user_id || typeof v.savedAt !== 'number' || now - v.savedAt > MAX_AGE_MS || v.savedAt > now + 60_000) return null;
    return { ...v.ctx, offline: true };
  } catch {
    return null;
  }
}

/** Did a request fail because there is no connection (rather than because the server said no)? */
export const isNetworkDown = (error, online = globalThis.navigator?.onLine) =>
  online === false || /failed to fetch|networkerror|network request failed|load failed|fetch/i.test(String(error?.message ?? error ?? ''));
