// The real local store: one IndexedDB database. A batch (rows + the new counters) is ONE transaction, so a phone that
// loses power between pages keeps the last complete state. Same contract as memoryStore.js.
const DB_NAME = 'dua-inventory';
const DB_VERSION = 1;
const META_KEY = 'meta';

export function idbStore(factory = globalThis.indexedDB) {
  let opening = null;

  const open = () =>
    (opening ??= new Promise((resolve, reject) => {
      const req = factory.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        d.createObjectStore('stock', { keyPath: 'code' });
        d.createObjectStore('sales', { keyPath: 'code' });
        d.createObjectStore('meta');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        opening = null;
        reject(req.error);
      };
    }));

  // Run `work(stores)` in one readwrite transaction; resolve when it has committed.
  async function tx(names, mode, work) {
    const d = await open();
    return new Promise((resolve, reject) => {
      const t = d.transaction(names, mode);
      const stores = Object.fromEntries(names.map((n) => [n, t.objectStore(n)]));
      let out;
      t.oncomplete = () => resolve(out);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error ?? new Error('transaction aborted'));
      try {
        out = work(stores, t);
      } catch (e) {
        t.abort();
        reject(e);
      }
    });
  }
  const result = (req) =>
    new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

  return {
    async readMeta() {
      const d = await open();
      return (await result(d.transaction('meta').objectStore('meta').get(META_KEY))) ?? null;
    },
    putMeta: (meta) => tx(['meta'], 'readwrite', ({ meta: m }) => void m.put(meta, META_KEY)),
    applyBatch: ({ stock, sales, meta }) =>
      tx(['stock', 'sales', 'meta'], 'readwrite', (s) => {
        for (const [name, part] of [['stock', stock], ['sales', sales]]) {
          if (!part) continue;
          for (const code of part.del ?? []) s[name].delete(code);
          for (const row of part.put ?? []) s[name].put(row);
        }
        if (meta) s.meta.put(meta, META_KEY);
      }),
    async readAll(name) {
      const d = await open();
      return result(d.transaction(name).objectStore(name).getAll());
    },
    async count(name) {
      const d = await open();
      return result(d.transaction(name).objectStore(name).count());
    },
    clear: (name) => tx([name], 'readwrite', (s) => void s[name].clear()),
    wipe: () =>
      tx(['stock', 'sales', 'meta'], 'readwrite', (s) => {
        s.stock.clear();
        s.sales.clear();
        s.meta.clear();
      }),
  };
}
