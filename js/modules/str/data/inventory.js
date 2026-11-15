// What STR asks Inventory for, through Inventory's published interface only (docs/MODULES.md section 8).
// D1 `inventory_product_meta(p_codes text[])` returns code, supplier, conversion_factor, found (at most 500 codes a call).
// Until Inventory ships it the call is simply unavailable: productMeta() then returns null and the screens say so,
// showing loose quantities under "Unassigned Supplier" (factor 1) instead of guessing.
import { db } from '../../../core/supabase.js';
import { toMetaMap } from '../domain/mapping.js';

const CHUNK = 500;
const missing = (error) =>
  error?.code === 'PGRST202' || error?.code === '42883' || /could not find the function|does not exist/i.test(error?.message ?? '');

/** { [code]: { supplier, factor } } for the codes Inventory knows, or null when the lookup is not available. */
export async function productMeta(codes) {
  const unique = [...new Set(codes.filter(Boolean))];
  if (!unique.length) return {};
  const rows = [];
  for (let i = 0; i < unique.length; i += CHUNK) {
    const { data, error } = await db().rpc('inventory_product_meta', { p_codes: unique.slice(i, i + CHUNK) });
    if (error) {
      if (missing(error)) return null;
      throw error;
    }
    rows.push(...(data ?? []));
  }
  return toMetaMap(rows);
}
