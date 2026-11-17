// Held bills: unfinished bills parked so the counter can serve the next customer. The device's own copy comes FIRST (it works with no
// connection); the server copy follows when there is one, so the bill can also be picked up from another device. A hold is a working
// copy, not an invoice: it can be replaced or removed, and when its bill is finally saved the hold is released.
const MAX_HELD = 6; // the Candela "Receipt Holding [0 / 6]" limit

/** What a hold stores: enough to rebuild the screen exactly. */
export const heldState = ({ cart, bill, totals }) => ({
  v: 1,
  customer: bill.customer || '',
  net_total: totals.netTotal,
  lines: cart.lines,
  bill: {
    customer: bill.customer,
    customerDiscountPct: bill.customerDiscountPct,
    receiptOn: bill.receiptOn,
    receiptDiscount: bill.receiptDiscount,
    adjustment: bill.adjustment,
    taxPct: bill.taxPct,
    cash: bill.cash,
    mode: bill.mode,
    comments: bill.comments,
    more: bill.more,
  },
});

export function createHeld({ store, api, userId, deviceId, online = () => navigator.onLine !== false, now = () => new Date() }) {
  const mine = async () => {
    const uid = await userId();
    return (await store.allHeld()).filter((h) => h.user_id === uid);
  };

  /** Park a bill. Resolves { ok, id } or { ok:false, code:'too_many'|'empty'|'not_durable' }. Same id again = update. */
  async function hold({ id, state, label = '' }) {
    if (!store.durable)
      return { ok: false, code: 'not_durable', message: 'This browser cannot keep a held bill safely. Connect to the internet to hold.' };
    if (!state?.lines?.length) return { ok: false, code: 'empty', message: 'There is nothing to hold.' };
    const list = (await mine()).filter((h) => !h.release_pending);
    const existing = list.find((h) => h.id === id);
    if (!existing && list.length >= MAX_HELD)
      return { ok: false, code: 'too_many', message: `You can hold ${MAX_HELD} bills at most. Resume or delete one first.` };
    const t = now().toISOString();
    await store.putHeld({
      id,
      user_id: await userId(),
      device_id: deviceId,
      label: label || existing?.label || '',
      customer: state.customer || '',
      item_count: state.lines.length,
      net_total: state.net_total,
      state,
      created_at: existing?.created_at ?? t,
      updated_at: t,
      synced: false, // the server has not seen this version yet
      release_pending: false,
      last_error: null,
    });
    return { ok: true, id };
  }

  /** Everything held for this person: this device's copies plus (when online) holds made on other devices. */
  async function list() {
    const local = (await mine()).filter((h) => !h.release_pending);
    const byId = new Map(local.map((h) => [h.id, { ...h, where: h.synced ? 'both' : 'device' }]));
    let serverError = false;
    if (online()) {
      try {
        const pendingRelease = new Set((await mine()).filter((h) => h.release_pending).map((h) => h.id));
        for (const s of await api.listHeld()) {
          if (byId.has(s.id) || pendingRelease.has(s.id)) continue;
          byId.set(s.id, {
            id: s.id,
            label: s.label,
            customer: s.customer,
            item_count: s.item_count,
            net_total: Number(s.net_total),
            updated_at: s.updated_at,
            created_at: s.created_at,
            where: 'server',
          });
        }
      } catch {
        serverError = true; // show what the device has; the server list is simply unavailable right now
      }
    }
    return {
      items: [...byId.values()].sort((a, b) => (a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : 0)),
      serverError,
    };
  }

  /** The bill to put back on screen. A hold that only exists on the server is copied to this device first. */
  async function load(id) {
    const local = await store.getHeld(id);
    if (local) return { ok: true, state: local.state };
    if (!online()) return { ok: false, message: 'That bill is only on the server. Connect to the internet to open it.' };
    try {
      const state = await api.getHeldState(id);
      if (!state) return { ok: false, message: 'That held bill is no longer there.' };
      await store.putHeld({
        id,
        user_id: await userId(),
        device_id: deviceId,
        label: '',
        customer: state.customer || '',
        item_count: state.lines?.length ?? 0,
        net_total: state.net_total ?? 0,
        state,
        created_at: now().toISOString(),
        updated_at: now().toISOString(),
        synced: true,
        release_pending: false,
        last_error: null,
      });
      return { ok: true, state };
    } catch {
      return { ok: false, message: 'Could not reach the server.' };
    }
  }

  /** Remove a hold (its bill was saved, or the person deleted it). The server copy is removed by the next sync if it has one. */
  async function release(id) {
    const local = await store.getHeld(id);
    if (!local) {
      if (!online()) return { ok: false, message: 'That bill is only on the server. Connect to the internet to delete it.' };
      try {
        await api.releaseHeld(id);
        return { ok: true };
      } catch {
        return { ok: false, message: 'Could not reach the server.' };
      }
    }
    if (local.synced) await store.patchHeld(id, { release_pending: true });
    else await store.deleteHeld(id); // the server never had it: nothing more to do
    return { ok: true };
  }

  /** How many holds this person has on this device (no network). */
  const count = async () => (await mine()).filter((h) => !h.release_pending).length;

  return { hold, list, load, release, count, MAX_HELD };
}
