// The receipt settings, with a copy kept on this device so a receipt can still be printed with no connection.
// Online: ask the server and refresh the copy. Offline (or the server fails): use the copy. Never been online: the defaults.
import { normalizeReceiptSettings } from '../domain/receipt.js';

const KEY = 'receipt-settings';

/** @param {{ store: { kvGet: Function, kvSet: Function }, api: { getReceipt: Function }, online?: boolean }} deps */
export async function loadReceiptSettings({ store, api, online = globalThis.navigator?.onLine !== false }) {
  if (online) {
    try {
      const fresh = normalizeReceiptSettings(await api.getReceipt());
      await store.kvSet(KEY, fresh).catch(() => {});
      return fresh;
    } catch {
      /* fall through to the copy on this device */
    }
  }
  try {
    const kept = await store.kvGet(KEY);
    if (kept) return normalizeReceiptSettings(kept);
  } catch {
    /* no copy */
  }
  return normalizeReceiptSettings(null);
}

/** Remember settings just saved, so this device does not wait for the next refresh. */
export const rememberReceiptSettings = (store, value) => store.kvSet(KEY, normalizeReceiptSettings(value)).catch(() => {});
