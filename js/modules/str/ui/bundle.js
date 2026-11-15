// Loads what the Report and Zero Dispatch pages show: every STR in the live feed with its lines grouped by supplier.
// One batch of reads for all STRs; Inventory is asked once for every product code.
import * as api from '../data/api.js';
import * as inventory from '../data/inventory.js';
import { groupBySupplier } from '../domain/group.js';
import { numberRows, toHeader, toLine } from '../domain/mapping.js';

export async function loadEntries() {
  const headers = (await api.feedHeaders()).map(toHeader);
  const rows = headers.length ? await api.linesFor(headers.map((h) => h.strId)) : [];
  const meta = rows.length ? await inventory.productMeta([...new Set(rows.map((r) => r.product_code))]).catch(() => null) : {};
  const byId = new Map();
  for (const r of rows) {
    if (!byId.has(Number(r.str_id))) byId.set(Number(r.str_id), []);
    byId.get(Number(r.str_id)).push(toLine(r));
  }
  const entries = headers.map((h) => ({ h, groups: numberRows(groupBySupplier(byId.get(h.strId) ?? [], meta ?? {})) }));
  return { entries, metaMissing: meta === null };
}
