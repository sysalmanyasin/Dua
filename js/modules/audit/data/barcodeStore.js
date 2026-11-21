// The phone's copy of the barcode list, and the scans waiting to be sent. IndexedDB when the browser has it, memory otherwise.
// Nothing here talks to Supabase: the screens pass the API functions in. Scans are history only (a count still goes through the
// counting outbox), but they are unsent work, so they register with the shell and block signing out until sent (AUD-9, OD-6).
import { createIdbQueue, createMemoryQueue, registerOutbox } from '../../../shared/outbox.js';
import { applyDelta, buildIndex, flushScans, refreshFrom } from '../domain/barcode.js';

const DB_NAME = 'dua-audit-barcode';
const PAGE = 1000;

export const createIdbBarcodeStore = (factory = globalThis.indexedDB) =>
  createIdbQueue({ dbName: DB_NAME, version: 1, keyPath: 'event_id', groupField: 'group', factory });
export const createMemoryBarcodeStore = () => createMemoryQueue({ keyPath: 'event_id', groupField: 'group' });

let shared = null;
export const barcodeStore = () => (shared ??= typeof indexedDB === 'undefined' ? createMemoryBarcodeStore() : createIdbBarcodeStore());
/** Tests inject a store or start clean. */
export const useBarcodeStore = (store) => (shared = store);

/** The copy saved on this device: { index, cursor, count }, empty when nothing was saved yet. */
export async function loadMirror(store = barcodeStore()) {
  const saved = await store.getKv('mirror').catch(() => null);
  const rows = saved?.rows ?? [];
  return { index: buildIndex(rows), cursor: saved?.cursor ?? { since: null, after: null }, count: rows.length };
}

/**
 * Brings the saved copy up to date: only rows that changed since last time are downloaded. `fetchPage({ since, after, limit })`
 * returns one page of changed rows. Throws what the fetch throws (offline), leaving the saved copy as it was.
 * Returns { index, cursor, count, changed }.
 */
export async function refreshMirror({ fetchPage, store = barcodeStore() }) {
  const cur = await loadMirror(store);
  const index = cur.index;
  let cursor = cur.cursor;
  let from = refreshFrom(cursor);
  let changed = 0;
  for (;;) {
    const rows = await fetchPage({ since: from.since, after: from.after, limit: PAGE });
    if (rows.length > 0) {
      cursor = applyDelta(index, rows, cursor);
      from = { since: cursor.since, after: cursor.after };
      changed += rows.length;
    }
    if (rows.length < PAGE) break;
  }
  await store.setKv('mirror', { rows: [...index.values()], cursor }).catch(() => {});
  return { index, cursor, count: index.size, changed };
}

/** Saves one scan on the device. Throws when the device cannot keep it. */
export const saveScan = (event, store = barcodeStore()) => store.add(event);

/** Sends waiting scans (see flushScans). */
export const sendScans = (send, store = barcodeStore()) => flushScans({ store, send });

// Unsent scans block signing out. Discarding forgets the scans only: the copy of the list holds no stock and no prices, and a
// full download after every sign-in would cost the pharmacy data for nothing.
registerOutbox({
  id: 'barcode',
  label: 'barcode scan',
  plural: 'barcode scans',
  count: () => barcodeStore().count('scan'),
  discard: () => barcodeStore().clear('scan'),
});
