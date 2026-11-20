// What a printed receipt says. Pure functions: a receipt is first turned into a plain description (shop header, who/when,
// lines, totals, footer), and only then drawn (ui/receiptPrint.js). The same description feeds the printout and the preview in
// Settings, so the two can never disagree.
//
// The layout follows the shop's own printed slip: "Duplicate" (on reprints and extra copies), "Purchase Slip", shop name, address
// and licence, STN/NTN with the payment type, Receipt# with the bill date, POS NO, the Product / Qty / U/Price / Total table,
// Total, Net Payable, the item count and the shop's terms. No FBR logo, QR code or FBR invoice number.
//
// Four types (the Candela names): Primary (everything, with prices), Gift (items and quantities, NO prices or totals),
// Summary (totals only, no item lines) and Secondary (marked Duplicate). An invoice that is still only on this
// device carries a LOCAL- reference; the receipt says it is temporary.
import { billTotals, payment, round2 } from './calc.js';
import { money } from '../../../shared/format.js';

export const RECEIPT_TYPES = ['Primary Receipt', 'Gift Receipt', 'Summary Receipt', 'Secondary Receipt'];

/** The same defaults the server holds (ebill_receipt_defaults), for a device that has never reached the server. */
export const DEFAULT_RECEIPT = {
  shop_name: '',
  address: '',
  phone: '',
  logo: '',
  width_mm: 80,
  footer: 'Thank you for your visit',
  copies: 1,
  receipt_type: 'Primary Receipt',
  auto_print: false,
  show_customer: true,
  show_staff: true,
  show_generic: false,
  tax_no: '',
  pos_no: '',
  slip_title: 'Purchase Slip',
};

/** Settings from anywhere (server, device copy, nothing) made safe to use. */
export function normalizeReceiptSettings(s) {
  const v = { ...DEFAULT_RECEIPT, ...(s && typeof s === 'object' ? s : {}) };
  v.width_mm = Number(v.width_mm) === 58 ? 58 : 80;
  const c = Math.trunc(Number(v.copies));
  v.copies = c >= 1 && c <= 5 ? c : 1;
  if (!RECEIPT_TYPES.includes(v.receipt_type)) v.receipt_type = 'Primary Receipt';
  for (const k of ['shop_name', 'address', 'phone', 'footer', 'logo', 'tax_no', 'pos_no', 'slip_title'])
    v[k] = typeof v[k] === 'string' ? v[k] : '';
  for (const k of ['auto_print', 'show_customer', 'show_staff', 'show_generic']) v[k] = v[k] === true;
  return v;
}

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const m2 = (v) => money(v, { decimals: true });

const TZ = 'Asia/Karachi';
/** 11/19/2026 10:26:19 PM (Pakistan time), as on the shop's slip. */
export function receiptTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  })
    .format(d)
    .replace(',', '');
}

// ── three ways to get the same description of an invoice ──

/** The bill still on screen, at the moment it is saved. `totals` is billTotals() for it. */
export function receiptFromBill({ no, time, staff, local, bill, cart, totals }) {
  return {
    no,
    time,
    staff: staff || '',
    customer: bill.customer || '',
    mode: bill.mode,
    local: !!local,
    lines: cart.lines.map((l, i) => ({
      code: l.code,
      name: l.name,
      generic: l.generic || '',
      unit: l.unit,
      qty: num(l.qty),
      rate: num(l.rate),
      total: totals.lines[i].total,
    })),
    gross: totals.grossTotal,
    customerDiscount: totals.customerDiscount,
    receiptDiscount: totals.receiptDiscount,
    tax: totals.tax,
    adjustment: totals.adjustment,
    net: totals.netTotal,
    cash: bill.mode === 'Cash' ? num(bill.cash) : 0,
    refunded: 0,
  };
}

/** The server's invoice detail (ebill_invoice_detail). */
export function receiptFromServer(d) {
  const i = d.invoice;
  return {
    no: i.invoice_no,
    time: i.client_created_at,
    staff: i.staff_name || '',
    customer: i.customer || '',
    mode: i.payment_mode,
    local: false,
    lines: d.lines.map((l) => ({
      code: l.code,
      name: l.name,
      generic: l.generic || '',
      unit: l.unit,
      qty: num(l.qty),
      rate: num(l.rate),
      total: num(l.line_total),
    })),
    gross: num(i.gross_total),
    customerDiscount: num(i.customer_discount),
    receiptDiscount: num(i.receipt_discount),
    tax: num(i.tax),
    adjustment: num(i.adjustment),
    net: num(i.net_total),
    cash: i.payment_mode === 'Cash' ? num(i.cash_received) : 0,
    refunded: num(i.refunded_amount),
  };
}

/** An invoice kept on this device (waiting to upload, or already uploaded but not fetched). Totals are worked out with the same rules as billing. */
export function receiptFromLocal(rec) {
  const p = rec.payload || {};
  const t = billTotals({
    lines: p.lines || [],
    customerDiscountPct: p.customer_discount_pct,
    receiptDiscount: p.receipt_discount,
    adjustment: p.adjustment,
    taxPct: p.tax_pct,
  });
  const synced = rec.status === 'synced' && rec.invoice_no;
  return {
    no: synced ? rec.invoice_no : rec.local_ref || rec.invoice_no || '',
    time: rec.created_at || p.client_created_at,
    staff: rec.staff_name || '',
    customer: rec.customer || p.customer || '',
    mode: p.payment_mode,
    local: !synced,
    lines: (p.lines || []).map((l, i) => ({
      code: l.code,
      name: l.name,
      generic: l.generic || '',
      unit: l.unit,
      qty: num(l.qty),
      rate: num(l.rate),
      total: t.lines[i].total,
    })),
    gross: t.grossTotal,
    customerDiscount: t.customerDiscount,
    receiptDiscount: t.receiptDiscount,
    tax: t.tax,
    adjustment: t.adjustment,
    net: t.netTotal,
    cash: p.payment_mode === 'Cash' ? num(p.cash_received) : 0,
    refunded: 0,
  };
}

const two = (v) => Number(v).toFixed(2);
const splitLines = (t) =>
  String(t || '')
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean);

/**
 * @param {ReturnType<typeof receiptFromBill>} data
 * @param {ReturnType<typeof normalizeReceiptSettings>} settingsIn
 * @param {{ type?: string, copy?: number, copies?: number, reprint?: boolean }} [opt]
 */
export function buildReceipt(data, settingsIn, { type, copy = 1, copies = 1, reprint = false } = {}) {
  const s = normalizeReceiptSettings(settingsIn);
  const kind = RECEIPT_TYPES.includes(type) ? type : s.receipt_type;
  const prices = kind !== 'Gift Receipt';
  const title = kind === 'Gift Receipt' ? 'Gift Slip' : kind === 'Summary Receipt' ? 'Summary Slip' : s.slip_title || 'Purchase Slip';

  const info = [];
  if (s.tax_no || prices)
    info.push({ left: s.tax_no ? `STN/NTN# ${s.tax_no}` : '', right: prices && data.mode ? `MOP. ${data.mode} Sales` : '' });
  info.push({ left: `Receipt# ${data.no || '–'}`, right: `Bill Date ${receiptTime(data.time)}`.trim() });
  if (s.pos_no) info.push({ left: `POS NO: ${s.pos_no}`, right: '' });
  if (s.show_customer) info.push({ left: `Customer: ${data.customer || 'Walk-in'}`, right: '' });
  if (s.show_staff && data.staff) info.push({ left: `Served by: ${data.staff}`, right: '' });

  const rows =
    kind === 'Summary Receipt'
      ? null
      : data.lines.map((l) => ({
          name: l.name,
          generic: s.show_generic ? l.generic : '',
          unit: l.unit === 'pack' ? 'P' : 'L',
          qty: two(l.qty),
          rate: prices ? two(l.rate) : '',
          total: prices ? two(l.total) : '',
        }));

  const totals = [];
  if (prices) {
    totals.push({ label: 'Total', value: m2(data.gross) });
    if (data.customerDiscount) totals.push({ label: 'Customer Discount', value: `-${m2(data.customerDiscount)}` });
    if (data.receiptDiscount) totals.push({ label: 'Receipt Discount', value: `-${m2(data.receiptDiscount)}` });
    if (data.tax) totals.push({ label: 'Tax', value: m2(data.tax) });
    if (data.adjustment) totals.push({ label: 'Adjustment', value: (data.adjustment > 0 ? '+' : '-') + m2(Math.abs(data.adjustment)) });
    totals.push({ label: 'Net Payable', value: m2(data.net), strong: true });
    if (data.refunded > 0) {
      totals.push({ label: 'Refunded', value: `-${m2(data.refunded)}` });
      totals.push({ label: 'Net after refund', value: m2(round2(data.net - data.refunded)), strong: true });
    }
    if (data.mode === 'Cash' && data.cash > 0) {
      const p = payment(data.net, data.cash);
      totals.push({ label: 'Cash Received', value: m2(p.received) });
      if (p.change > 0) totals.push({ label: 'Change', value: m2(p.change) });
    }
  }

  const flags = [];
  if (kind === 'Gift Receipt') flags.push('Prices are not shown');
  if (copies > 1) flags.push(`Copy ${copy} of ${copies}`);

  return {
    type: kind,
    width: s.width_mm,
    logo: s.logo,
    duplicate: reprint || copy > 1 || kind === 'Secondary Receipt',
    flags,
    title,
    shop: s.shop_name,
    address: splitLines(s.address),
    phone: s.phone,
    info,
    rows,
    showPrices: prices,
    totals,
    itemsLine: `Total No. of Items : ${data.lines.length}`,
    temporary: data.local ? 'Temporary reference. The final invoice number is given once this bill reaches the server.' : '',
    footer: splitLines(s.footer),
  };
}
