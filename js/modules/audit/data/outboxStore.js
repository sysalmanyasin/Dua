// Local storage for counting: the outbox of counts not yet sent (OD-6), and a copy of the person's item list so a screen
// reopened without signal still works. IndexedDB when the browser has it, memory otherwise (tests, private windows).
// Nothing here talks to Supabase. The outbox is safe to resend: every event has its own id and the database ignores repeats.
const DB_NAME = 'dua-audit';
const DB_VERSION = 1;

let counter = 0;
const nextOrder = () => Date.now() * 1000 + (counter = (counter + 1) % 1000);

/** The same small contract as the memory store below. */
export function createIdbStore(factory = globalThis.indexedDB) {
  let opening = null;
  const open = () =>
    (opening ??= new Promise((resolve, reject) => {
      const req = factory.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        d.createObjectStore('events', { keyPath: 'event_id' }).createIndex('assignment', 'assignment');
        d.createObjectStore('kv');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        opening = null;
        reject(req.error);
      };
    }));
  const req2p = (r) =>
    new Promise((resolve, reject) => {
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  async function tx(names, mode, work) {
    const d = await open();
    return new Promise((resolve, reject) => {
      const t = d.transaction(names, mode);
      let out;
      t.oncomplete = () => resolve(out);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error ?? new Error('transaction aborted'));
      try {
        out = work(Object.fromEntries(names.map((n) => [n, t.objectStore(n)])));
      } catch (e) {
        t.abort();
        reject(e);
      }
    });
  }
  const events = async (assignmentId) => {
    const d = await open();
    const store = d.transaction('events').objectStore('events');
    const rows = await req2p(assignmentId ? store.index('assignment').getAll(assignmentId) : store.getAll());
    return rows.sort((a, b) => a.order - b.order);
  };
  return {
    add: (event) => tx(['events'], 'readwrite', ({ events: s }) => void s.put({ ...event, order: nextOrder() })),
    all: events,
    async take(assignmentId, n) {
      return (await events(assignmentId)).slice(0, n);
    },
    remove: (ids) =>
      tx(['events'], 'readwrite', ({ events: s }) => {
        for (const id of ids) s.delete(id);
      }),
    async count(assignmentId) {
      return (await events(assignmentId)).length;
    },
    async clear(assignmentId) {
      const ids = (await events(assignmentId)).map((e) => e.event_id);
      await tx(['events'], 'readwrite', ({ events: s }) => {
        for (const id of ids) s.delete(id);
      });
    },
    reset: () =>
      tx(['events', 'kv'], 'readwrite', ({ events: s, kv }) => {
        s.clear();
        kv.clear();
      }),
    setKv: (key, value) => tx(['kv'], 'readwrite', ({ kv }) => void kv.put(value, key)),
    async getKv(key) {
      const d = await open();
      return (await req2p(d.transaction('kv').objectStore('kv').get(key))) ?? null;
    },
  };
}

export function createMemoryStore() {
  const rows = new Map();
  const kv = new Map();
  const list = (assignmentId) =>
    [...rows.values()].filter((e) => !assignmentId || e.assignment === assignmentId).sort((a, b) => a.order - b.order);
  return {
    async add(event) {
      rows.set(event.event_id, { ...event, order: nextOrder() });
    },
    async all(assignmentId) {
      return list(assignmentId).map((e) => ({ ...e }));
    },
    async take(assignmentId, n) {
      return list(assignmentId)
        .slice(0, n)
        .map((e) => ({ ...e }));
    },
    async remove(ids) {
      for (const id of ids) rows.delete(id);
    },
    async count(assignmentId) {
      return list(assignmentId).length;
    },
    async clear(assignmentId) {
      for (const e of list(assignmentId)) rows.delete(e.event_id);
    },
    async reset() {
      rows.clear();
      kv.clear();
    },
    async setKv(key, value) {
      kv.set(key, structuredClone(value));
    },
    async getKv(key) {
      return kv.has(key) ? structuredClone(kv.get(key)) : null;
    },
  };
}

let shared = null;
/** The one store the screens use. */
export const outboxStore = () => (shared ??= typeof indexedDB === 'undefined' ? createMemoryStore() : createIdbStore());
/** Tests use this to start clean or inject a store. */
export const useStore = (store) => (shared = store);
