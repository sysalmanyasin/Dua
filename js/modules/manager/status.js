// The "Credit inbox" pill in the status bar: how many Closing credit lines still wait for the owner to file.
// Kept in memory only; the database decides who may count (mgmt.inbox_file and credit.view).
import { inboxCount } from './data/api.js';

export async function pill() {
  const n = await inboxCount();
  return { label: 'Credit inbox', value: n > 0 ? `${n} to file` : 'All filed', href: '#/manager/inbox' };
}
