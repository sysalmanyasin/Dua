// Database rows (snake_case) -> the shapes the screens and the domain functions use (camelCase). Pure.
const text = (v) => (v === null || v === undefined ? '' : String(v));
const num = (v) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

export const toHeader = (r) => ({
  strId: Number(r.str_id),
  strNumber: text(r.str_number),
  masterStrId: text(r.master_str_id),
  refNo: text(r.ref_no),
  media: text(r.media),
  strStatus: text(r.str_status),
  strDate: r.str_date || null,
  issuedBy: text(r.issued_by),
  dispatchedDate: r.dispatched_date || null,
  dispatchStatus: text(r.dispatch_status),
  dispatchedBy: text(r.dispatched_by),
  receiveDate: r.receive_date || null,
  receiveStatus: text(r.receive_status),
  receivedBy: text(r.received_by),
  comments: text(r.comments),
  dispatchBranch: text(r.dispatch_branch),
  receiveBranch: text(r.receive_branch),
  direction: text(r.direction),
  noOfBoxes: text(r.no_of_boxes),
  stage: ['awaited', 'dispatched', 'received'].includes(r.stage) ? r.stage : 'awaited',
  lineCount: Number(r.line_count) || 0,
});

export const toLine = (r) => ({
  strId: Number(r.str_id),
  itemId: Number(r.str_item_id),
  productCode: text(r.product_code),
  productName: text(r.product_name),
  strQty: Number(r.str_qty) || 0,
  dispatchQty: num(r.dispatch_qty),
  receiveQty: num(r.receive_qty),
  productPrice: Number(r.product_price) || 0,
});

// Inventory's product lookup rows ({ code, supplier, conversion_factor, found }) -> { [code]: { supplier, factor } }.
// A code Inventory does not know (found = false) is left out, so it becomes "Unassigned Supplier" with factor 1.
export function toMetaMap(rows) {
  const out = {};
  for (const r of rows ?? []) {
    if (r.found === false || !r.code) continue;
    out[String(r.code)] = { supplier: text(r.supplier), factor: r.conversion_factor };
  }
  return out;
}

// Running Sr# across supplier groups, as on the old printout.
export function numberRows(groups) {
  let sr = 0;
  return groups.map((g) => ({ ...g, rows: g.rows.map((row) => ({ ...row, sr: ++sr })) }));
}

export const titleOf = (h) => `STR #${h.strNumber || h.strId}`;
