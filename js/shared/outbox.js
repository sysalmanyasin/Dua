// Shared outbox and sign-out guard (Foundation request OD-6, AUD-9).
// A module that keeps work on the device until it reaches the database (counts, barcode scans) builds its local queue with
// createIdbQueue and registers it here. Signing out is then blocked while anything is waiting, until the person either lets it
// send or confirms discarding it. Nothing here talks to Supabase. A queue holds records with an id; the server ignores a record
// it has already seen, so sending the same record again is safe.

let counter = 0;
const nextOrder = () => Date.now() * 1000 + (counter = (counter + 1) % 1000);

/**
 * A queue in IndexedDB. `keyPath` is the record id; `groupField` names the field the records can be grouped by (an assignment,
 * a kind of work). A second small store, kv, keeps anything else the module wants offline (a copy of a list).
 */
export function createIdbQueue({ dbName, version = 1, keyPath = 'event_id', groupField = 'assignment', factory = globalThis.indexedDB }) {
  let opening = null;
  const open = () =>
    (opening ??= new Promise((resolve, reject) => {
      const req = factory.open(dbName, version);
      req.onupgradeneeded = () => {
        const d = req.result;
        d.createObjectStore('events', { keyPath }).createIndex(groupField, groupField);
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
  const events = async (group) => {
    const d = await open();
    const store = d.transaction('events').objectStore('events');
    const rows = await req2p(group ? store.index(groupField).getAll(group) : store.getAll());
    return rows.sort((a, b) => a.order - b.order);
  };
  return {
    add: (event) => tx(['events'], 'readwrite', ({ events: s }) => void s.put({ ...event, order: nextOrder() })),
    all: events,
    async take(group, n) {
      return (await events(group)).slice(0, n);
    },
    remove: (ids) =>
      tx(['events'], 'readwrite', ({ events: s }) => {
        for (const id of ids) s.delete(id);
      }),
    async count(group) {
      return (await events(group)).length;
    },
    async clear(group) {
      const ids = (await events(group)).map((e) => e[keyPath]);
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

/** The same contract in memory: tests, and browsers that refuse IndexedDB (private windows). */
export function createMemoryQueue({ keyPath = 'event_id', groupField = 'assignment' } = {}) {
  const rows = new Map();
  const kv = new Map();
  const list = (group) => [...rows.values()].filter((e) => !group || e[groupField] === group).sort((a, b) => a.order - b.order);
  return {
    async add(event) {
      rows.set(event[keyPath], { ...event, order: nextOrder() });
    },
    async all(group) {
      return list(group).map((e) => ({ ...e }));
    },
    async take(group, n) {
      return list(group)
        .slice(0, n)
        .map((e) => ({ ...e }));
    },
    async remove(ids) {
      for (const id of ids) rows.delete(id);
    },
    async count(group) {
      return list(group).length;
    },
    async clear(group) {
      for (const e of list(group)) rows.delete(e[keyPath]);
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

// ───────── registry ─────────
const registry = new Map();

/** Tell the shell that this module keeps unsent work. `label`/`plural` name one and many ("count", "counts"). `count` says how much; `discard` forgets it (and anything private it holds). */
export function registerOutbox({ id, label, plural = `${label}s`, count, discard }) {
  registry.set(id, { id, label, plural, count, discard });
}
export const clearOutboxRegistry = () => registry.clear();

/** What is waiting on this device: [{ id, label, count }] for every registered outbox that has something. */
export async function unsentSummary() {
  const out = [];
  for (const o of registry.values()) {
    let n = 0;
    try {
      n = await o.count();
    } catch {
      n = 0; // an outbox that cannot be read must not trap the person in the app
    }
    if (n > 0) out.push({ id: o.id, label: n === 1 ? o.label : o.plural, count: n });
  }
  return out;
}

/** Forget everything on this device. Used only after the person agreed, or when nothing is waiting. Never throws. */
export async function discardAll() {
  for (const o of registry.values()) {
    try {
      await o.discard();
    } catch {
      // nothing to forget, or the browser refused: signing out still goes ahead
    }
  }
}

/** Load each module's outbox registration (manifest.outbox) so the guard knows them before any page is opened. */
export async function registerManifestOutboxes(manifests) {
  await Promise.allSettled(manifests.filter((m) => typeof m.outbox === 'function').map(async (m) => (await m.outbox()).default?.()));
}

// ───────── sign-out guard ─────────
let installed = null; // { doc, handler }
let passing = false;
const sentence = (list) => list.map((x) => `${x.count} ${x.label}`).join(', ');

export function signOutMessage(list) {
  const total = list.reduce((n, x) => n + x.count, 0);
  return `${sentence(list)} ${total === 1 ? 'has' : 'have'} not been sent yet. If you sign out now ${total === 1 ? 'it is' : 'they are'} lost.\n\nOK discards ${total === 1 ? 'it' : 'them'} and signs out. Cancel keeps you signed in so ${total === 1 ? 'it' : 'they'} can send.`;
}

/**
 * Blocks the Sign out button while anything is unsent. The shell's button is core code, so this listens for its click first
 * (capture phase) and lets it through only after the person confirmed. Safe to call more than once.
 */
export function installSignOutGuard(doc = document, ask = (message) => window.confirm(message)) {
  if (installed?.doc === doc) return;
  const handler = (e) => {
    const button = e.target?.closest?.('[data-action="signout"]');
    if (!button || passing) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    (async () => {
      const waiting = await unsentSummary();
      if (waiting.length > 0 && !ask(signOutMessage(waiting))) return;
      await discardAll();
      passing = true;
      try {
        button.click();
      } finally {
        passing = false;
      }
    })();
  };
  doc.addEventListener('click', handler, true);
  installed = { doc, handler };
}
/** Tests: start with no guard. */
export const resetSignOutGuard = () => {
  installed?.doc.removeEventListener('click', installed.handler, true);
  installed = null;
  passing = false;
};
