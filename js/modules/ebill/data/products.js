// Emergency Billing reads products ONLY from the Inventory module's local copy on this device. It never reads the products
// table directly and never treats the copy as live stock: every screen shows when the copy was last updated.
import { localMirror, syncFor } from '../../inventory/data/local.js';

/** Read the local copy. { products, meta }. `meta.syncedAt` is when the server data it holds was last checked. */
export async function readCopy(ctx) {
  const mirror = localMirror();
  await mirror.forgetIfNotMine(ctx.user_id); // a copy left by someone else on this device is removed before anything is shown
  const r = await mirror.read();
  return { products: r.stock, meta: r.meta };
}

/** Try to bring the copy up to date. Returns '' when fine, 'offline', or a short message. The old copy always stays usable. */
export async function refreshCopy(ctx) {
  try {
    const r = await syncFor(ctx);
    return r?.status === 'offline' ? 'offline' : '';
  } catch (e) {
    return e?.code === '42501' ? 'You no longer have access to the product list.' : 'Could not refresh. Showing the copy on this device.';
  }
}

export const clock = (iso) =>
  iso
    ? new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Karachi', hour: '2-digit', minute: '2-digit', hour12: true })
        .format(new Date(iso))
        .toLowerCase()
    : '';
