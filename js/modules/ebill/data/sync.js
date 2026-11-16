// Offline invoice sync: ONE place that uploads, for the whole module. Rules:
//  * An invoice is marked "synced" only after the server says it saved it (or says it already had it: "duplicate").
//  * Nothing local is deleted until then. A refusal marks the invoice "failed" with the server's reason; it is kept for review.
//  * A dropped connection or a failed login leaves invoices "pending" and stops the run; the next run starts again safely,
//    because the server treats the same invoice_id as the same invoice.
//  * Only the signed-in person's own invoices are uploaded; another person's stay on the device, untouched.
import { classifyError } from '../domain/offline.js';

const KEEP_SYNCED_DAYS = 30;

export function createSync({
  store,
  api,
  userId,
  deviceId,
  deviceLabel = 'Device',
  online = () => navigator.onLine !== false,
  now = () => new Date(),
  afterSync = null,
}) {
  let running = null;
  const listeners = new Set();
  const emit = () => listeners.forEach((f) => f());

  async function snapshot() {
    const uid = await userId();
    const all = await store.allInvoices();
    const mine = all.filter((r) => r.user_id === uid);
    const by = (s) => mine.filter((r) => r.status === s);
    return {
      pending: by('pending').length,
      failed: by('failed').length,
      synced: by('synced').length,
      others: all.length - mine.length, // waiting for a different login on this device
      lastSyncAt: (await store.kvGet('lastSyncAt')) ?? null,
      items: [...mine].sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).slice(0, 50),
    };
  }

  async function queue(rec) {
    await store.putInvoice(rec); // committed before this resolves
    emit();
  }

  async function run() {
    const out = { offline: false, needsLogin: false, network: false, uploaded: 0, failed: 0 };
    if (!online()) return { ...out, offline: true };
    const uid = await userId().catch(() => null);
    if (!uid) return { ...out, needsLogin: true };

    const todo = (await store.allInvoices())
      .filter((r) => r.user_id === uid && r.status === 'pending')
      .sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
    let registered = false;
    for (const rec of todo) {
      const tries = (rec.attempts ?? 0) + 1;
      let res;
      try {
        res = await api.saveInvoice(rec.payload, null);
        if (res?.code === 'device_unknown' && !registered) {
          registered = true;
          await api.registerDevice(deviceId, deviceLabel);
          res = await api.saveInvoice(rec.payload, null);
        }
      } catch (e) {
        const kind = classifyError(e, online());
        if (kind === 'network' || kind === 'auth') {
          await store.patchInvoice(rec.invoice_id, {
            attempts: tries,
            last_try_at: now().toISOString(),
            last_error: { code: kind, message: kind === 'auth' ? 'Sign in again to upload.' : 'No connection.' },
          });
          return { ...out, network: kind === 'network', needsLogin: kind === 'auth', ...(await tally(uid)) };
        }
        await store.patchInvoice(rec.invoice_id, {
          status: 'failed',
          attempts: tries,
          last_try_at: now().toISOString(),
          last_error: { code: 'error', message: String(e?.message || e) },
        });
        out.failed++;
        continue;
      }
      if (res?.ok) {
        await store.patchInvoice(rec.invoice_id, {
          status: 'synced',
          invoice_no: res.invoice_no,
          synced_at: now().toISOString(),
          attempts: tries,
          last_error: null,
        });
        out.uploaded++;
      } else {
        await store.patchInvoice(rec.invoice_id, {
          status: 'failed',
          attempts: tries,
          last_try_at: now().toISOString(),
          last_error: { code: res?.code || 'refused', message: res?.message || 'The server did not accept this invoice.' },
        });
        out.failed++;
      }
    }
    await store.kvSet('lastSyncAt', now().toISOString()); // the server was reached
    await prune();
    if (afterSync) await Promise.resolve(afterSync()).catch(() => {}); // fresh products and settings while we are online
    return { ...out, ...(await tally(uid)) };
  }

  async function tally(uid) {
    const mine = (await store.allInvoices()).filter((r) => r.user_id === uid);
    return { pending: mine.filter((r) => r.status === 'pending').length, left: mine.filter((r) => r.status !== 'synced').length };
  }

  async function prune() {
    const cutoff = now().getTime() - KEEP_SYNCED_DAYS * 86_400_000;
    for (const r of await store.allInvoices())
      if (r.status === 'synced' && r.synced_at && new Date(r.synced_at).getTime() < cutoff) await store.deleteInvoice(r.invoice_id);
  }

  /** Upload what is pending. Safe to call at any time and as often as you like: one run at a time. */
  function syncNow() {
    running ??= run().finally(() => {
      running = null;
      emit();
    });
    return running;
  }

  /** The manual Retry: failed invoices go back to pending, then a normal run. */
  async function retryFailed() {
    const uid = await userId();
    for (const r of await store.allInvoices())
      if (r.user_id === uid && r.status === 'failed') await store.patchInvoice(r.invoice_id, { status: 'pending' });
    emit();
    return syncNow();
  }

  return {
    queue,
    snapshot,
    syncNow,
    retryFailed,
    subscribe(f) {
      listeners.add(f);
      return () => listeners.delete(f);
    },
  };
}

/**
 * Run a sync when the connection returns, when the page is shown again, and every minute while something is waiting.
 * `alive()` says whether the page that started this is still on screen; once it is not, everything switches itself off.
 */
export function startAutoSync(sync, { intervalMs = 60_000, win = globalThis.window, doc = globalThis.document, alive = () => true } = {}) {
  let t = null;
  let timer = null;
  const stop = () => {
    clearTimeout(t);
    clearInterval(timer);
    win?.removeEventListener('online', onOnline);
    doc?.removeEventListener('visibilitychange', onVisible);
  };
  const kick = () => {
    if (!alive()) return stop();
    void sync.syncNow().catch(() => {});
  };
  function onOnline() {
    clearTimeout(t);
    t = setTimeout(kick, 1000); // let the connection settle
  }
  function onVisible() {
    if (doc?.visibilityState === 'visible') kick();
  }
  win?.addEventListener('online', onOnline);
  doc?.addEventListener('visibilitychange', onVisible);
  timer = setInterval(async () => {
    if (!alive()) return stop();
    const s = await sync.snapshot().catch(() => null);
    if (s && s.pending > 0) kick();
  }, intervalMs);
  kick();
  return stop;
}
