// Inventory feed (Foundation F3): Candela export → Dropbox /inventory.json → this function → Dua tables.
// Ported from the previous project's function of the same name. Differences from the old one:
//   - Must be authenticated: either the x-sync-secret header (scheduler) or a signed-in user holding
//     inventory.sync. The old version ran for anyone who sent no token.
//   - One atomic database call (inventory_apply_sync). A failed sync keeps the old rows, and the
//     failure is written to inventory_sync_log.
//
// Secrets (Dashboard → Edge Functions → Secrets; never in Git):
//   DROPBOX_APP_KEY, DROPBOX_APP_SECRET, DROPBOX_REFRESH_TOKEN, INVENTORY_SYNC_SECRET, ALLOWED_ORIGIN
//   (SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY are injected by Supabase.)
import { serviceClient, userClient } from '../_shared/clients.ts';
import { json, preflight } from '../_shared/http.ts';

const DBX_INVENTORY_PATH = '/inventory.json';

type Item = Record<string, unknown>;
type DropboxInventoryFile = {
  products?: Item[];
  paymentSummaryLast4Days?: Item[];
  creditByCustomerLast4Days?: Item[];
  strLast7Days?: Item[];
  strLineItemsLast7Days?: Item[];
};

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' && v !== '' ? v : fallback);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
// Blank strings on Dropbox mean "no date". Never send "" to a date column.
const dateOrNull = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function dropboxAccessToken(): Promise<string> {
  const res = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: Deno.env.get('DROPBOX_REFRESH_TOKEN')!,
      client_id: Deno.env.get('DROPBOX_APP_KEY')!,
      client_secret: Deno.env.get('DROPBOX_APP_SECRET')!,
    }),
  });
  if (!res.ok) throw new Error(`Dropbox token refresh failed (${res.status})`);
  return (await res.json()).access_token as string;
}

function buildPayload(file: DropboxInventoryFile) {
  const products = (file.products ?? []).filter((p) => !!p.name).map((p) => ({
    code: str(p.code), name: String(p.name), qty: num(p.stock), price: num(p.unitPrice),
    company: str(p.company, 'Unassigned Manufacturer'), generic: str(p.generic),
    supplier: str(p.supplier, 'Unassigned Supplier'),
    conversion_factor: num(p.conversionFactor) || 1,
    creation_date: dateOrNull(p.creationDate), last_receive_date: dateOrNull(p.lastReceiveDate),
    last_sale_date: dateOrNull(p.lastSaleDate),
    net_qty_today: num(p.netQtyToday), net_qty_30_days: num(p.netQty30Days),
    net_qty_60_days: num(p.netQty60Days), net_qty_90_days: num(p.netQty90Days),
    sale_value_incl_tax_today: num(p.saleValueInclTaxToday),
    sale_value_incl_tax_30_days: num(p.saleValueInclTax30Days),
    sale_value_incl_tax_60_days: num(p.saleValueInclTax60Days),
    sale_value_incl_tax_90_days: num(p.saleValueInclTax90Days),
    sale_value_excl_tax_today: num(p.saleValueExclTaxToday),
    sale_value_excl_tax_30_days: num(p.saleValueExclTax30Days),
    sale_value_excl_tax_60_days: num(p.saleValueExclTax60Days),
    sale_value_excl_tax_90_days: num(p.saleValueExclTax90Days),
    tax_percent: num(p.taxPercent), is_taxable: p.isTaxable === true,
  }));

  const payment_summary = (file.paymentSummaryLast4Days ?? []).filter((r) => !!dateOrNull(r.saleDay)).map((r) => ({
    sale_day: r.saleDay, cash_sale: num(r.cashSale), card_sale: num(r.cardSale),
    credit_sale: num(r.creditSale), total_sale: num(r.totalSale),
  }));

  const credit_by_customer = (file.creditByCustomerLast4Days ?? []).filter((r) => !!dateOrNull(r.saleDay)).map((r) => ({
    sale_day: r.saleDay, customer_name: str(r.customerName),
    credit_amount: num(r.creditAmount), receipt_count: num(r.receiptCount),
  }));

  const str_headers = (file.strLast7Days ?? []).filter((r) => r.strId != null).map((r) => ({
    str_id: r.strId, str_number: str(r.strNumber), master_str_id: str(r.masterStrId), ref_no: str(r.refNo),
    media: str(r.media), str_status: str(r.strStatus), str_date: dateOrNull(r.strDate), issued_by: str(r.issuedBy),
    dispatched_date: dateOrNull(r.dispatchedDate), dispatch_status: str(r.dispatchStatus),
    dispatched_by: str(r.dispatchedBy), receive_date: dateOrNull(r.receiveDate),
    receive_status: str(r.receiveStatus), received_by: str(r.receivedBy), comments: str(r.comments),
    dispatch_shop_id: numOrNull(r.dispatchShopId), dispatch_branch: str(r.dispatchBranch),
    receive_shop_id: numOrNull(r.receiveShopId), receive_branch: str(r.receiveBranch),
    direction: ['in', 'out'].includes(String(r.direction)) ? r.direction : '',
    driver_name: str(r.driverName), vehicle_number: str(r.vehicleNumber), consignment_no: str(r.consignmentNo),
    no_of_boxes: str(r.noOfBoxes), weight_of_shipment: str(r.weightOfShipment),
  }));

  // Keep only line items whose header is in this batch (foreign key).
  const headerIds = new Set(str_headers.map((h) => h.str_id));
  const str_line_items = (file.strLineItemsLast7Days ?? [])
    .filter((r) => r.strId != null && r.strItemId != null && headerIds.has(r.strId))
    .map((r) => ({
      str_id: r.strId, str_item_id: r.strItemId, product_code: str(r.productCode),
      product_name: str(r.productName), carton_no: str(r.cartonNo), str_qty: num(r.strQty),
      dispatch_qty: numOrNull(r.dispatchQty), receive_qty: numOrNull(r.receiveQty),
      net_dispatch_qty: numOrNull(r.netDispatchQty), product_price: num(r.productPrice), cost_price: num(r.costPrice),
    }));

  return { products, payment_summary, credit_by_customer, str_headers, str_line_items };
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return json(req, 405, { error: 'method' });

  // ── who is calling? ──
  const secret = Deno.env.get('INVENTORY_SYNC_SECRET') ?? '';
  const sentSecret = req.headers.get('x-sync-secret') ?? '';
  const authHeader = req.headers.get('authorization') ?? '';
  let triggeredBy: string | null = null;

  if (secret !== '' && sentSecret !== '' && safeEqual(sentSecret, secret)) {
    // scheduled call
  } else if (authHeader.toLowerCase().startsWith('bearer ')) {
    const caller = userClient(authHeader);
    const { data: who } = await caller.auth.getUser();
    const { data: allowed } = await caller.rpc('has_perm', { p_key: 'inventory.sync' });
    if (!who?.user || allowed !== true) return json(req, 403, { error: 'forbidden' });
    triggeredBy = who.user.id;
  } else {
    return json(req, 401, { error: 'auth' });
  }

  for (const k of ['DROPBOX_APP_KEY', 'DROPBOX_APP_SECRET', 'DROPBOX_REFRESH_TOKEN']) {
    if (!Deno.env.get(k)) return json(req, 500, { error: `${k} secret is not set on this project` });
  }

  const db = serviceClient();
  const fail = async (status: number, error: string, detail?: string) => {
    await db.rpc('inventory_log_sync_failure', { p_error: detail ? `${error}: ${detail}` : error, p_source: 'dropbox', p_triggered_by: triggeredBy });
    return json(req, status, { error });
  };

  try {
    let token: string;
    try {
      token = await dropboxAccessToken();
    } catch (e) {
      return await fail(502, 'Could not refresh the Dropbox token. DROPBOX_REFRESH_TOKEN may be invalid or revoked', String(e));
    }

    const dbx = await fetch('https://content.dropboxapi.com/2/files/download', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Dropbox-API-Arg': JSON.stringify({ path: DBX_INVENTORY_PATH }) },
    });
    if (!dbx.ok) return await fail(502, 'Dropbox fetch failed', `status ${dbx.status}`);

    const raw: unknown = await dbx.json();
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return await fail(422, 'Inventory file on Dropbox is not the expected object shape');
    }
    const payload = buildPayload(raw as DropboxInventoryFile);
    if (payload.products.length === 0) return await fail(422, "Inventory file's products array is empty or missing");

    const { data, error } = await db.rpc('inventory_apply_sync', {
      p_payload: payload, p_source: 'dropbox', p_triggered_by: triggeredBy,
    });
    if (error) return await fail(500, 'Sync failed; previous data kept', error.message);

    return json(req, 200, { ok: true, ...(data as Record<string, number>), syncedAt: new Date().toISOString() });
  } catch (e) {
    return await fail(500, 'Sync failed; previous data kept', String(e));
  }
});
