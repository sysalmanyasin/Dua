// The only file in the Inventory module that talks to Supabase. Phones never read the products table directly:
// they read the changed-rows feed (docs/modules/inventory-sync-design.md). Every call that can return rows carries a limit.
import { db } from '../../../core/supabase.js';

export const PAGE = 1000; // the database also caps a page at 1,000 entries (decision INV-16)

async function call(name, args) {
  const { data, error } = await db().rpc(name, args);
  if (error) throw error;
  return data;
}

/** One row (counters, active count, last checked time) or null when nothing has ever been synced. */
export async function latestSync() {
  const rows = await call('inventory_latest_sync');
  return rows?.[0] ?? null;
}

/** Stock group: { reset, cols, rows, removed, next, done, seq, activeCount }. Needs inventory.search. */
export const changesStock = (since) => call('inventory_changes_stock', { p_since: since, p_limit: PAGE });

/** Sales group, same shape. Needs inventory.view. */
export const changesSales = (since) => call('inventory_changes_sales', { p_since: since, p_limit: PAGE });
