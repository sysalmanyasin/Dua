// Inventory feed (Foundation F3): Candela export → Dropbox /inventory.json → this function → Dua tables.
// Ported from the previous project's function of the same name. Differences from the old one:
//   - Must be authenticated: either the x-sync-secret header (scheduler) or a signed-in user holding
//     inventory.sync. The old version ran for anyone who sent no token.
//   - One atomic database call (inventory_apply_sync). A failed sync keeps the old rows, and the
//     failure is written to inventory_sync_log.
//   - Changed-rows-only (Inventory 0302): before downloading, the function asks Dropbox for the file's
//     content_hash. Same hash as last time: record "checked" and stop (no download, no writes). Otherwise the
//     database compares every row's hash and writes only what changed. A sync that would remove more than 20%
//     of the products is refused (422); pass {"confirmRemoval": true} as a signed-in user with inventory.sync to
//     override. {"recheck": true} skips the hash shortcut. A second sync while one runs answers 409.
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
  if (!res.ok) {
    // Dropbox's error body names the problem (e.g. invalid_grant, invalid_client) and contains no secrets.
    const detail = (await res.text()).slice(0, 200);
    // Shape only, never the values: lengths and obvious paste mistakes help find a wrong secret.
    const t = Deno.env.get('DROPBOX_REFRESH_TOKEN') ?? '';
    const shape = `refresh_token len=${t.length} starts_sl=${t.startsWith('sl.')} bad_chars=${/[\s"'{}:,]/.test(t)}; ` +
      `app_key len=${(Deno.env.get('DROPBOX_APP_KEY') ?? '').length}; app_secret len=${(Deno.env.get('DROPBOX_APP_SECRET') ?? '').length}`;
    throw new Error(`Dropbox token refresh failed (${res.status}): ${detail} [${shape}]`);
  }
  return (await res.json()).access_token as string;
}

// Dropbox's content_hash of the file (about 1 KB of traffic). null when it cannot be read; the caller then
// simply downloads, so a metadata hiccup never blocks a sync.
async function dropboxContentHash(token: string): Promise<string | null> {
  try {
    const res = await fetch('https://api.dropboxapi.com/2/files/get_metadata', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: DBX_INVENTORY_PATH }),
    });
    if (!res.ok) return null;
    const meta = await res.json();
    return typeof meta?.content_hash === 'string' && meta.content_hash !== '' ? meta.content_hash : null;
  } catch (_e) {
    return null;
  }
}

function buildPayload(file: DropboxInventoryFile) {
  const products = (file.products ?? []).filter((p) => !!p.name).map((p) => ({
    code: str(p.code), name: String(p.name), qty: num(p.stock), price: num(p.unitPrice),
    company: str(p.company, 'Unassigned Manufacturer'), generic: str(p.generic),
    supplier: str(p.supplier, 'Unassigned Supplier'),
    conversion_factor: num(p.conversionFactor) || 1,
    // INV-18: was the pack size in the file a real number above zero? (conversion_factor is 1 when it was not)
    pack_valid: typeof p.conversionFactor === 'number' && Number.isFinite(p.conversionFactor) && p.conversionFactor > 0,
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
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;

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

    // Layer 1: the file did not change since the last sync? Record the check and stop.
    const fileHash = await dropboxContentHash(token);
    if (fileHash !== null && body.recheck !== true) {
      const { data: st } = await db.from('inventory_sync_state').select('content_hash').eq('id', 1).maybeSingle();
      if (st?.content_hash === fileHash) {
        await db.rpc('inventory_note_unchanged', { p_content_hash: fileHash, p_source: 'dropbox', p_triggered_by: triggeredBy });
        return json(req, 200, { ok: true, result: 'unchanged', skipped: true, checkedAt: new Date().toISOString() });
      }
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

    // Only a signed-in person can confirm a large removal; the scheduled call never can.
    const confirmRemoval = body.confirmRemoval === true && triggeredBy !== null;
    const { data, error } = await db.rpc('inventory_apply_sync', {
      p_payload: payload, p_source: 'dropbox', p_triggered_by: triggeredBy,
      p_force: confirmRemoval, p_content_hash: fileHash,
    });
    if (error) return await fail(500, 'Sync failed; previous data kept', error.message);

    const out = (data ?? {}) as Record<string, unknown>;
    if (out.busy === true) return json(req, 409, { error: 'Another sync is already running. Nothing was changed.' });
    // Refusals are already written to the log by the database.
    if (out.refused === true) {
      return json(req, 422, {
        error: `Refused: this sync would remove ${out.wouldRemove} of ${out.active} active products. Nothing was changed.`,
        refused: true, wouldRemove: out.wouldRemove, active: out.active,
      });
    }
    return json(req, 200, { ...out, syncedAt: new Date().toISOString() });
  } catch (e) {
    return await fail(500, 'Sync failed; previous data kept', String(e));
  }
});
