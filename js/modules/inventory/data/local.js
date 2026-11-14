// The one local copy of the products on this phone, and the rules for when it is refreshed or removed.
// Screens use this file; they never touch IndexedDB or Supabase themselves.
import { db } from '../../../core/supabase.js';
import * as feed from './feed.js';
import { idbStore } from './idbStore.js';
import { memoryStore } from './memoryStore.js';
import { createMirror, isStale } from './mirror.js';

let mirror = null;
/** The shared mirror. Falls back to memory (lost on reload) on a browser with no IndexedDB, e.g. some private modes. */
export const localMirror = () => (mirror ??= createMirror({ store: typeof indexedDB === 'undefined' ? memoryStore() : idbStore(), feed }));

let watching = false;
/**
 * Remove the local copy when the person signs out (decision INV-15). The shell has no sign-out hook for modules yet, so
 * this listens to the auth event; it also covers a session that simply expires. Safe to call many times.
 * Backstop: sync() and forgetIfNotMine() also discard a copy that belongs to someone else.
 */
export function wipeOnSignOut() {
  if (watching) return;
  watching = true;
  db().auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT')
      localMirror()
        .wipe()
        .catch(() => {});
  });
}

/** Bring the copy up to date for this person. `ctx` is the shell context ({ user_id, permissions }). */
export function syncFor(ctx) {
  const perms = new Set(ctx.permissions);
  return localMirror().sync({ userId: ctx.user_id, canSales: perms.has('inventory.view') });
}

/**
 * Refresh when the tab becomes visible again after 15 minutes (decision INV-11: no timers).
 * `alive()` says whether the screen that asked is still on show; once it is not, the listener removes itself,
 * because the shell gives every page a fresh container and has no clean-up hook.
 */
export function refreshOnReturn(ctx, { alive, onUpdated }) {
  const handler = async () => {
    if (!alive()) return document.removeEventListener('visibilitychange', handler);
    if (document.visibilityState !== 'visible') return;
    const meta = await localMirror().meta();
    if (!isStale(meta)) return;
    try {
      await syncFor(ctx);
      if (alive()) onUpdated?.();
    } catch {
      /* the screen keeps showing the copy it has; a manual refresh shows the error */
    }
  };
  document.addEventListener('visibilitychange', handler);
}
