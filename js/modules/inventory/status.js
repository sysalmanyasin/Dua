// The "Stock" pill in the status bar: when the product data was last checked. One small call, no product rows.
// Loading this file also arms the sign-out wipe of the local copy for everyone who may see inventory.
import { latestSync } from './data/feed.js';
import { wipeOnSignOut } from './data/local.js';

const clock = (iso) =>
  new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Karachi', hour: '2-digit', minute: '2-digit', hour12: true })
    .format(new Date(iso))
    .toLowerCase();

export async function pill() {
  wipeOnSignOut();
  const ls = await latestSync();
  return ls?.synced_at ? { label: 'Stock', value: clock(ls.synced_at), href: '#/inventory' } : null;
}
