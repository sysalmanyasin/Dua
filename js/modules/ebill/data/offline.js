// The service worker is what lets the page itself open with no connection. It is registered when Emergency Billing is used.
// Nothing here is needed for online billing; if it is unsupported or fails, billing simply stays online-only.
const SW_CACHE = 'dua-shell-v1';
const REFRESH_KEY = 'dua.ebill.swrefresh';
const REFRESH_EVERY_MS = 6 * 3600_000;

export async function registerServiceWorker({
  nav = globalThis.navigator,
  base = globalThis.document?.baseURI,
  store = globalThis.localStorage,
  now = Date.now,
} = {}) {
  if (!nav?.serviceWorker || !base) return { supported: false };
  try {
    await nav.serviceWorker.register(new URL('sw.js', base).href);
    // keep the saved copies close to the live site: ask for a refresh now and then while online
    const last = Number(store?.getItem(REFRESH_KEY) || 0);
    if (nav.onLine !== false && now() - last > REFRESH_EVERY_MS) {
      const reg = await nav.serviceWorker.ready;
      reg.active?.postMessage({ type: 'REFRESH' });
      store?.setItem(REFRESH_KEY, String(now()));
    }
    return { supported: true };
  } catch {
    return { supported: false, failed: true };
  }
}

/** Is this page controlled by the worker, and are the Emergency Billing screens saved for offline use? */
export async function shellReady({ nav = globalThis.navigator, cacheStorage = globalThis.caches } = {}) {
  try {
    if (!nav?.serviceWorker?.controller || !cacheStorage) return false;
    const c = await cacheStorage.open(SW_CACHE);
    return !!(await c.match('js/modules/ebill/ui/pos.js')) && !!(await c.match('index.html'));
  } catch {
    return false;
  }
}
