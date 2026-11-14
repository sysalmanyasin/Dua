import { diffQty, packFactor, toPackQty } from './pack.js';

export const UNASSIGNED = 'Unassigned Supplier';

// metaByCode[code] = { supplier, factor } from Inventory's published product lookup.
// A code the lookup does not know (or knows without a supplier) is "Unassigned Supplier" with factor 1.
export function enrichLine(line, metaByCode = {}) {
  const meta = metaByCode[line.productCode] || {};
  const factor = packFactor(meta.factor);
  return {
    ...line,
    supplier: (meta.supplier && String(meta.supplier).trim()) || UNASSIGNED,
    factor,
    packStrQty: toPackQty(line.strQty, factor),
    packDispatchQty: toPackQty(line.dispatchQty, factor),
    packReceiveQty: toPackQty(line.receiveQty, factor),
  };
}

const byCode = (a, b) => (a.productCode || '').localeCompare(b.productCode || '', undefined, { numeric: true });

// One STR's lines grouped by supplier: groups by supplier name, rows by product code (numeric-aware).
export function groupBySupplier(lines, metaByCode = {}) {
  const groups = new Map();
  for (const line of lines) {
    const row = enrichLine(line, metaByCode);
    if (!groups.has(row.supplier)) groups.set(row.supplier, []);
    groups.get(row.supplier).push(row);
  }
  return [...groups.entries()]
    .map(([supplier, rows]) => ({ supplier, rows: rows.sort(byCode) }))
    .sort((a, b) => a.supplier.localeCompare(b.supplier));
}

const sum = (rows, key) => rows.reduce((s, r) => s + (r[key] || 0), 0);

// Subtotal of one supplier group: STR and dispatch pack quantities only (no receive total, STR-8).
export function groupTotals(group) {
  return { items: group.rows.length, str: sum(group.rows, 'packStrQty'), dispatch: sum(group.rows, 'packDispatchQty') };
}

export function grandTotals(groups) {
  return groups.reduce(
    (t, g) => {
      const s = groupTotals(g);
      return { items: t.items + s.items, str: t.str + s.str, dispatch: t.dispatch + s.dispatch };
    },
    { items: 0, str: 0, dispatch: 0 },
  );
}

export { diffQty };
