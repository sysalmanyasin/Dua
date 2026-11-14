// The local copy of the products on this phone, kept current by the changed-rows feed.
// This file is the algorithm only: where the rows are kept is an injected `store`, where they come from is an injected
// `feed`, so every hard case (a crash between pages, a reset, another person on the same phone) is unit tested.
//
// Rules (docs/modules/inventory-sync-design.md §6-8):
//  * A page of changes and the new counter are saved in ONE store transaction. A crash between pages resumes
//    from the last saved counter; a half-applied page cannot exist.
//  * Nothing runs on a timer. The caller refreshes when a screen opens, when the tab comes back after 15 minutes,
//    and when the person asks (decision INV-11).
//  * A copy that does not belong to the signed-in person, or to this local/server schema, is wiped, never reused.
//  * After a sync the local row count must equal the server's active count; otherwise one more pass, then one wipe
//    and full reload, then an error. A wrong copy is never shown as if it were right.
export const LOCAL_SCHEMA = 1;
export const STALE_AFTER_MS = 15 * 60 * 1000;

const GROUPS = {
  stock: { seq: 'seqStock', pull: 'changesStock' },
  sales: { seq: 'seqSales', pull: 'changesSales' },
};

const objectify = (cols, row) => Object.fromEntries(cols.map((c, i) => [c, row[i]]));
const isDenied = (e) => e?.code === '42501';

/** Is the copy older than the refresh window? An empty copy is always stale. */
export const isStale = (meta, now = Date.now(), maxAge = STALE_AFTER_MS) => !meta || !meta.fetchedAt || now - meta.fetchedAt > maxAge;

export function createMirror({ store, feed, now = () => Date.now() }) {
  let inflight = null;

  const freshMeta = (userId, serverSchema, canSales) => ({
    schema: LOCAL_SCHEMA,
    serverSchema,
    userId,
    canSales,
    seqStock: 0,
    seqSales: 0,
    syncedAt: null,
    fetchedAt: null,
  });

  // Pull one group to its end. Returns { reset: true } or { meta, activeCount }.
  async function pull(group, meta) {
    const { seq, pull: fn } = GROUPS[group];
    let since = meta[seq];
    for (let pages = 0; pages < 500; pages++) {
      const page = await feed[fn](since);
      if (page.reset) return { reset: true };
      const next = { ...meta, [seq]: page.next };
      await store.applyBatch({
        [group]: { put: page.rows.map((r) => objectify(page.cols, r)), del: page.removed },
        meta: next,
      });
      meta = next;
      since = page.next;
      if (page.done) return { meta, activeCount: page.activeCount };
    }
    throw new Error('The product feed did not finish');
  }

  async function run({ userId, canSales }) {
    let ls;
    try {
      ls = await feed.latestSync();
    } catch (e) {
      if (isDenied(e)) {
        await store.wipe();
        throw e;
      }
      const stored = await store.readMeta();
      if (stored && stored.userId === userId) return { status: 'offline', meta: stored };
      throw e;
    }
    if (!ls) return { status: 'no-data', meta: null };

    let meta = await store.readMeta();
    if (meta && (meta.userId !== userId || meta.schema !== LOCAL_SCHEMA || meta.serverSchema !== ls.schema_version)) {
      await store.wipe();
      meta = null;
    }
    meta ??= freshMeta(userId, ls.schema_version, canSales);
    if (meta.canSales && !canSales) {
      // permission to see sales figures was withdrawn: the sales half goes, the stock half stays
      await store.clear('sales');
      meta = { ...meta, canSales: false, seqSales: 0 };
    }
    if (!meta.canSales && canSales) meta = { ...meta, canSales: true, seqSales: 0 };

    const sameCounters = meta.seqStock === ls.seq_stock && (!canSales || meta.seqSales === ls.seq_sales);
    if (
      sameCounters &&
      (await store.count('stock')) === ls.active_count &&
      (!canSales || (await store.count('sales')) === ls.active_count)
    ) {
      meta = { ...meta, syncedAt: ls.synced_at, fetchedAt: now() };
      await store.putMeta(meta);
      return { status: 'current', meta };
    }

    let repulls = 0;
    let wipes = 0;
    for (;;) {
      const s = await pull('stock', meta);
      let b = null;
      if (!s.reset) {
        meta = s.meta;
        if (canSales) {
          b = await pull('sales', meta);
          if (!b.reset) meta = b.meta;
        }
      }
      const reset = s.reset || b?.reset;
      const wrong =
        !reset && ((await store.count('stock')) !== s.activeCount || (canSales && (await store.count('sales')) !== b.activeCount));
      if (!reset && !wrong) break;
      if (!reset && repulls++ < 1) continue; // the server moved while we were reading: one more pass
      if (wipes++ >= 1) throw new Error('The local product copy does not match the server');
      await store.wipe();
      meta = freshMeta(userId, ls.schema_version, canSales);
    }
    meta = { ...meta, syncedAt: ls.synced_at, fetchedAt: now() };
    await store.putMeta(meta);
    return { status: 'updated', meta };
  }

  return {
    /** Bring the copy up to date. Concurrent calls share one run. */
    sync({ userId, canSales = false }) {
      inflight ??= run({ userId, canSales }).finally(() => (inflight = null));
      return inflight;
    },
    /** What is on this phone now: { meta, stock: [...], sales: Map(code → row) | null }. */
    async read() {
      const meta = await store.readMeta();
      if (!meta) return { meta: null, stock: [], sales: null };
      const stock = await store.readAll('stock');
      const sales = meta.canSales ? new Map((await store.readAll('sales')).map((r) => [r.code, r])) : null;
      return { meta, stock, sales };
    },
    meta: () => store.readMeta(),
    /** Remove everything (sign-out, permission withdrawn). */
    wipe: () => store.wipe(),
    /** Wipe when the stored copy belongs to someone else. Cheap; call before showing anything. */
    async forgetIfNotMine(userId) {
      const meta = await store.readMeta();
      if (meta && meta.userId !== userId) await store.wipe();
    },
  };
}
