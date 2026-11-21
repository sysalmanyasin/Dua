// Local storage for counting: the outbox of counts not yet sent (OD-6), and a copy of the person's item list so a screen
// reopened without signal still works. IndexedDB when the browser has it, memory otherwise (tests, private windows).
// Nothing here talks to Supabase. The outbox is safe to resend: every event has its own id and the database ignores repeats.
// The queue itself is the shared one (js/shared/outbox.js); this file only fixes the database name and registers the outbox
// so the shell's sign-out guard knows about it.
import { createIdbQueue, createMemoryQueue, registerOutbox } from '../../../shared/outbox.js';

const DB_NAME = 'dua-audit';
const DB_VERSION = 1;

/** The same small contract as the memory store below. */
export const createIdbStore = (factory = globalThis.indexedDB) =>
  createIdbQueue({ dbName: DB_NAME, version: DB_VERSION, keyPath: 'event_id', groupField: 'assignment', factory });

export const createMemoryStore = () => createMemoryQueue({ keyPath: 'event_id', groupField: 'assignment' });

let shared = null;
/** The one store the screens use. */
export const outboxStore = () => (shared ??= typeof indexedDB === 'undefined' ? createMemoryStore() : createIdbStore());
/** Tests use this to start clean or inject a store. */
export const useStore = (store) => (shared = store);

// AUD-9: counts waiting here block signing out. Discarding also forgets the saved item list: it holds stock and prices.
registerOutbox({ id: 'audit', label: 'count', plural: 'counts', count: () => outboxStore().count(), discard: () => outboxStore().reset() });
