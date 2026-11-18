// On-device storage for Emergency Billing: invoices waiting to reach the server, and a few small settings. One IndexedDB database,
// so an invoice saved here survives the page being closed or the device restarting. An invoice is written in its own transaction
// BEFORE the screen says "saved", and is never deleted until the server has confirmed it (see sync.js).
// If IndexedDB is unavailable (some private-browsing modes) an in-memory copy is used and `durable` is false: the screen then
// refuses to save offline, because nothing would survive a restart.
const DB_NAME = 'dua-ebill';
const DB_VERSION = 2; // 2 added the held-bills store; opening an older database keeps its invoices

function memory() {
  const inv = new Map();
  const kv = new Map();
  const held = new Map();
  const clone = (v) => (v === undefined ? undefined : structuredClone(v));
  return {
    durable: false,
    putInvoice: async (r) => void inv.set(r.invoice_id, clone(r)),
    getInvoice: async (id) => clone(inv.get(id)) ?? null,
    allInvoices: async () => [...inv.values()].map(clone),
    patchInvoice: async (id, patch) => {
      const r = inv.get(id);
      if (!r) return null;
      const next = { ...r, ...patch };
      inv.set(id, clone(next));
      return clone(next);
    },
    deleteInvoice: async (id) => void inv.delete(id),
    putHeld: async (r) => void held.set(r.id, clone(r)),
    getHeld: async (id) => clone(held.get(id)) ?? null,
    allHeld: async () => [...held.values()].map(clone),
    patchHeld: async (id, patch) => {
      const r = held.get(id);
      if (!r) return null;
      held.set(id, clone({ ...r, ...patch }));
      return clone({ ...r, ...patch });
    },
    deleteHeld: async (id) => void held.delete(id),
    kvGet: async (k) => clone(kv.get(k)) ?? null,
    kvSet: async (k, v) => void kv.set(k, clone(v)),
    kvDelete: async (k) => void kv.delete(k),
    close: () => {},
  };
}

/** Open the local database. Resolves the same interface either way; check `.durable`. */
export async function openLocalDb(factory = globalThis.indexedDB, name = DB_NAME) {
  if (!factory) return memory();
  let d;
  try {
    d = await new Promise((resolve, reject) => {
      const req = factory.open(name, DB_VERSION);
      req.onupgradeneeded = () => {
        const names = req.result.objectStoreNames;
        if (!names.contains('invoices')) req.result.createObjectStore('invoices', { keyPath: 'invoice_id' });
        if (!names.contains('kv')) req.result.createObjectStore('kv');
        if (!names.contains('held')) req.result.createObjectStore('held', { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('local database is blocked'));
    });
  } catch {
    return memory();
  }

  // Run `work` in one transaction; resolve only when it has COMMITTED (so "saved" means saved).
  const tx = (stores, mode, work) =>
    new Promise((resolve, reject) => {
      const t = d.transaction(stores, mode);
      let out;
      t.oncomplete = () => resolve(out);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error ?? new Error('transaction aborted'));
      try {
        out = work(Object.fromEntries(stores.map((s) => [s, t.objectStore(s)])), t);
      } catch (e) {
        t.abort();
        reject(e);
      }
    });
  const req = (r) =>
    new Promise((resolve, reject) => {
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });

  return {
    durable: true,
    putInvoice: (rec) => tx(['invoices'], 'readwrite', ({ invoices }) => void invoices.put(rec)),
    getInvoice: async (id) => (await req(d.transaction('invoices').objectStore('invoices').get(id))) ?? null,
    allInvoices: () => req(d.transaction('invoices').objectStore('invoices').getAll()),
    // read-modify-write in ONE transaction, so two syncs can never overwrite each other's change
    patchInvoice: (id, patch) =>
      new Promise((resolve, reject) => {
        const t = d.transaction(['invoices'], 'readwrite');
        const store = t.objectStore('invoices');
        let next = null;
        const g = store.get(id);
        g.onsuccess = () => {
          if (g.result) {
            next = { ...g.result, ...patch };
            store.put(next);
          }
        };
        t.oncomplete = () => resolve(next);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error ?? new Error('transaction aborted'));
      }),
    putHeld: (rec) => tx(['held'], 'readwrite', ({ held }) => void held.put(rec)),
    getHeld: async (id) => (await req(d.transaction('held').objectStore('held').get(id))) ?? null,
    allHeld: () => req(d.transaction('held').objectStore('held').getAll()),
    patchHeld: (id, patch) =>
      new Promise((resolve, reject) => {
        const t = d.transaction(['held'], 'readwrite');
        const store = t.objectStore('held');
        let next = null;
        const g = store.get(id);
        g.onsuccess = () => {
          if (g.result) {
            next = { ...g.result, ...patch };
            store.put(next);
          }
        };
        t.oncomplete = () => resolve(next);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error ?? new Error('transaction aborted'));
      }),
    deleteHeld: (id) => tx(['held'], 'readwrite', ({ held }) => void held.delete(id)),
    deleteInvoice: (id) => tx(['invoices'], 'readwrite', ({ invoices }) => void invoices.delete(id)),
    kvGet: async (k) => (await req(d.transaction('kv').objectStore('kv').get(k))) ?? null,
    kvSet: (k, v) => tx(['kv'], 'readwrite', ({ kv }) => void kv.put(v, k)),
    kvDelete: (k) => tx(['kv'], 'readwrite', ({ kv }) => void kv.delete(k)),
    close: () => d.close(),
  };
}
