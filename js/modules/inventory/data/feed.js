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

/** Units already on their way to this branch: { code: packs }. Needs inventory.view. */
export async function inTransit() {
  const rows = await call('inventory_in_transit', { p_limit: 2000 });
  return Object.fromEntries((rows ?? []).map((r) => [r.code, r.packs]));
}

/** The four Home numbers as the database computes them. Needs inventory.view. */
export const coverSummary = () => call('inventory_cover_summary');

/** The shared Excess Working state: { retained: [{ name_key, name }], settings: { misc, ho_value, updated_at } | null }. */
export async function excessState() {
  const [retained, settings] = await Promise.all([
    db().from('inventory_excess_retained').select('name_key,name').order('name_key').limit(2000),
    db().from('inventory_excess_settings').select('misc,ho_value,updated_at').maybeSingle(),
  ]);
  if (retained.error) throw retained.error;
  if (settings.error) throw settings.error;
  return { retained: retained.data ?? [], settings: settings.data };
}
export const setRetained = (name, on) => call('inventory_excess_retain_set', { p_name: name, p_on: on });
export const saveExcessSettings = (misc, hoValue) => call('inventory_excess_settings_set', { p_misc: misc, p_ho_value: hoValue });

/** The last sync runs, newest first (owner only: inventory.sync). */
export async function syncHistory() {
  const { data, error } = await db()
    .from('inventory_sync_log')
    .select(
      'synced_at,status,result,item_count,added_count,changed_count,removed_count,unchanged_count,skipped_blank,duplicate_count,error,source',
    )
    .order('synced_at', { ascending: false })
    .limit(40);
  if (error) throw error;
  return data ?? [];
}

/**
 * Start a sync now (the Edge Function checks that the caller holds inventory.sync). Resolves with the function's answer,
 * including the refused (422) and busy (409) answers, which carry a message the screen shows.
 */
export async function syncNow(body = {}) {
  const { data, error } = await db().functions.invoke('sync-inventory-from-dropbox', { body });
  if (!error) return { ok: true, ...(data ?? {}) };
  const res = error.context;
  if (res && typeof res.json === 'function') {
    const answer = await res.json().catch(() => ({}));
    return { ok: false, status: res.status, ...answer };
  }
  return { ok: false, status: 0, error: error.message };
}
