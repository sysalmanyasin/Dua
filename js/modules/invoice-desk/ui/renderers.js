// Immutable template renderers. Each one rebuilds its source worksheet cell by cell: the same columns (proportional widths),
// merged cells, row heights, borders and wording. Sizes are set by classes in css/invoice-desk.css (the page's CSP forbids inline
// styles); every length there is a worksheet point/pixel multiplied by one scale factor, so the slip keeps its shape at any width.
//   bs-mart-v1            <- worksheet "BS Mart (6)"          (columns B:E)
//   safari-book-land-v1   <- worksheet "Safari Book Land (2)" (columns B:E, logo picture)
//   best-choice-store-v1  <- worksheet "Best Choice Store"    (columns A:E)
import { html } from '../../../shared/html.js';
import { amountInWords } from '../domain/amount-in-words.js';

const money = (value) => Number(value ?? 0).toFixed(2);
// Best Choice prints whole amounts without ".00" (850, not 850.00); any paisa still shows two decimals.
const compact = (value) => {
  const n = Number(value ?? 0);
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
};
// Quantities are stored with three decimals ("2.000"); the slip shows 2.
const qty = (value) => String(Number(value ?? 0));
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function dateParts(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''));
  return m ? { y: m[1], m: m[2], d: m[3], mon: MONTHS[Number(m[2]) - 1] } : null;
}
const dateBs = (iso) => {
  const p = dateParts(iso);
  return p ? `${p.d} ${p.mon} ${p.y}` : String(iso ?? '');
};
const dateSafari = (iso) => {
  const p = dateParts(iso);
  return p ? `${p.d}/${p.mon}/${p.y.slice(2)}` : String(iso ?? '');
};
const dateBest = (iso) => {
  const p = dateParts(iso);
  return p ? `${p.d}-${p.m}-${p.y}` : String(iso ?? '');
};
const cash = (v) => (v === undefined || v === null || String(v).trim() === '' ? '' : Number.isFinite(Number(v)) ? money(v) : String(v));
const price = (l) => l.unit_price ?? l.unitPrice;
const total = (l) => l.line_total ?? l.lineTotal;
const words = (invoice) => invoice.amount_words || amountInWords(Math.round(Number(invoice.grand_total) * 100));

// ── B.S Mart: a 4-column slip (Description 104 | Rate 60 | Qty 36 | Amount 74 worksheet pixels) ──
export function renderBsMart(invoice) {
  const f = invoice.printed_fields ?? {};
  // The sheet cell is only 60 px wide and clips "PM" off a 24-hour time, so the slip shows 16:40:40.
  const time = String(f.time ?? '')
    .replace(/\s*[AP]M\s*$/i, '')
    .trim();
  const rows = invoice.lines.map(
    (l) =>
      html`<tr class="h27">
        <td class="bm-l bt-t bt-b bt-r bs-desc">${l.description}</td>
        <td class="bt-l bt-r bt-t bt-b ctr s11">${money(price(l))}</td>
        <td class="bt-l bt-r bt-t bt-b rgt s11">${qty(l.quantity)}</td>
        <td class="bt-l bt-t bt-b rgt s11">${money(total(l))}</td>
      </tr>`,
  );
  return html`<article class="id-paper id-bs">
    <table>
      <colgroup>
        <col />
        <col />
        <col />
        <col />
      </colgroup>
      <tbody>
        <tr class="h30">
          <td colspan="4" class="ctr s24 ul">B.S MART</td>
        </tr>
        <tr class="h15">
          <td colspan="4" class="ctr s11">PLAZA # 11 SHAHEEN BLOCK</td>
        </tr>
        <tr class="h15-75">
          <td colspan="4" class="ctr s12">OPP SAFARI GATE # 1</td>
        </tr>
        <tr class="h15-75">
          <td colspan="4" class="ctr s12">FOR FREE HOME DELIVERY CALL</td>
        </tr>
        <tr class="h15-75">
          <td colspan="4" class="ctr s12">PHONE # 0320-0450158</td>
        </tr>
        <tr class="h15">
          <td colspan="4"></td>
        </tr>
        <tr class="h15 s9">
          <td class="bt-l bt-t lft">${dateBs(invoice.invoice_date)}</td>
          <td class="bt-t lft nw">${time}</td>
          <td colspan="2" class="bt-t bt-r rgt">Cashier: ${f.cashier || ''}</td>
        </tr>
        <tr class="h15 s9">
          <td class="bt-l bt-b lft">Shift: ${f.shift || ''}</td>
          <td class="bt-b ctr">${invoice.invoice_number}</td>
          <td colspan="2" class="bt-b bt-r rgt">001</td>
        </tr>
        <tr class="h13">
          <td colspan="4" class="ctr s11">ORIGINIAL</td>
        </tr>
        <tr class="h15-75 s11">
          <td class="bm-l bm-t bm-b bt-r ctr">Description</td>
          <td class="bt-l bt-r bm-t bm-b ctr">Rate</td>
          <td class="bt-l bt-r bm-t bm-b ctr">Qty</td>
          <td class="bt-l bm-r bm-t bm-b ctr">Amount</td>
        </tr>
        <tr class="h3">
          <td colspan="4"></td>
        </tr>
        ${rows}
        <tr class="h8">
          <td colspan="4"></td>
        </tr>
        <tr class="h15 s11">
          <td class="dist">
            <div><span>Items:</span><span>${invoice.lines.length}</span></div>
          </td>
          <td colspan="3" class="bm-l bm-r bm-t dist">
            <div><span>Subtotal</span><span>${money(invoice.subtotal)}</span></div>
          </td>
        </tr>
        <tr class="h15-75 s11">
          <td></td>
          <td colspan="2" class="bm-l bm-b">Grand Total</td>
          <td class="bm-r bm-b rgt">${money(invoice.grand_total)}</td>
        </tr>
        <tr class="h15 s11">
          <td rowspan="2" class="ctr s9 thanks">THANK YOU FOR YOU KIND VISIT</td>
          <td colspan="2" class="bm-l bm-t">Cash</td>
          <td class="bm-r bm-t rgt">${cash(f.cash)}</td>
        </tr>
        <tr class="h22 s11">
          <td colspan="2" class="bm-l bm-b">Change</td>
          <td class="bm-r bm-b rgt">${cash(f.change)}</td>
        </tr>
        <tr class="h28">
          <td colspan="4" class="ctr s9 top wrap">${words(invoice)}</td>
        </tr>
        <tr class="h28">
          <td colspan="4"></td>
        </tr>
        <tr class="h15">
          <td colspan="4" class="s10">FRESH FRUIT, VEGETABLE AVAILABLE</td>
        </tr>
        <tr class="h15">
          <td colspan="4"></td>
        </tr>
        <tr class="h15">
          <td colspan="4" class="s10">INVOICE REQUIRED FOR ITEM CHANGE</td>
        </tr>
        <tr class="h15">
          <td colspan="4"></td>
        </tr>
        <tr class="h42">
          <td colspan="4" class="s10 ul wrap">RETURN WITHIN 2 DAYS NOTE. NON REFUND OR EXCHANGE POLICY ON FROZEN &amp; COSMATIC ITEMS.</td>
        </tr>
        <tr class="h6">
          <td colspan="4"></td>
        </tr>
        <tr class="h36">
          <td colspan="4" class="s12 wrap">for any kind of complaint please contact</td>
        </tr>
        <tr class="h39">
          <td colspan="4" class="ctr s11 urdu wrap">کسی بھی شکایات کے لیے اس نمبر پے رابطہ کرے</td>
        </tr>
        <tr class="h15">
          <td colspan="4" class="ctr s11 ul">0320-0450158</td>
        </tr>
      </tbody>
    </table>
  </article>`;
}

// ── Safari Book Land: Product 119 | Qty 42 | U/Price 82 | Total 107 worksheet pixels, logo picture at the foot ──
export function renderSafariBookLand(invoice) {
  const f = invoice.printed_fields ?? {};
  const rows = invoice.lines.map(
    (l) =>
      html`<tr class="h15">
        <td class="bt-l bt-r bt-t bt-b s11 wrap">${l.description}</td>
        <td class="bt-l bt-r bt-t bt-b ctr s11">${qty(l.quantity)}</td>
        <td class="bt-l bt-r bt-t bt-b rgt s11">${money(price(l))}</td>
        <td class="bt-l bt-r bt-t bt-b rgt s11">${money(total(l))}</td>
      </tr>`,
  );
  return html`<article class="id-paper id-safari">
    <table>
      <colgroup>
        <col />
        <col />
        <col />
        <col />
      </colgroup>
      <tbody>
        <tr class="h30">
          <td colspan="4" class="ctr s11 calibri">ORIGINAL SLIP</td>
        </tr>
        <tr class="h15">
          <td colspan="4"></td>
        </tr>
        <tr class="h15">
          <td colspan="4"></td>
        </tr>
        <tr class="h15">
          <td colspan="4"></td>
        </tr>
        <tr class="h25-5">
          <td colspan="4" class="ctr s20 ul">SAFARI BOOK LAND</td>
        </tr>
        <tr class="h15">
          <td colspan="4" class="ctr s11 ul">PLAZA # 22 UMAR BLOCK SECTOR B</td>
        </tr>
        <tr class="h15">
          <td colspan="4" class="ctr s11 ul">PHONE # 0333-4888754</td>
        </tr>
        <tr class="h15-75">
          <td colspan="4"></td>
        </tr>
        <tr class="h15-75 s12">
          <td class="lft">Receipt:</td>
          <td colspan="2" class="lft">${invoice.invoice_number}</td>
          <td class="ctr nw">${dateSafari(invoice.invoice_date)}</td>
        </tr>
        <tr class="h15-75 s12">
          <td class="lft">Cashier:</td>
          <td colspan="2" class="lft">${f.cashier || ''}</td>
          <td class="ctr nw">${f.time || ''}</td>
        </tr>
        <tr class="h15-75">
          <td colspan="4"></td>
        </tr>
        <tr class="h15-75">
          <td colspan="4"></td>
        </tr>
        <tr class="h15-75 s12">
          <td class="ds-l ds-t ds-b lft">Product</td>
          <td class="ds-t ds-b lft">Qty</td>
          <td class="ds-t ds-b lft">U/Price</td>
          <td class="ds-r ds-t ds-b ctr">Total</td>
        </tr>
        <tr class="h15-75">
          <td colspan="4"></td>
        </tr>
        ${rows}
        <tr class="h15-75">
          <td colspan="4"></td>
        </tr>
        <tr class="h15-75 s12">
          <td class="ds-l ds-t ds-b dist">
            <div><span>Items:</span><span>${invoice.lines.length}</span></div>
          </td>
          <td colspan="3" class="ds-r ds-t ds-b dist">
            <div><span>Total</span><span>${money(invoice.grand_total)}</span></div>
          </td>
        </tr>
        <tr class="h15-75 s12">
          <td></td>
          <td colspan="2" class="lft nw">Payment Cash</td>
          <td class="rgt">${cash(f.cash)}</td>
        </tr>
        <tr class="h15-75 s12">
          <td></td>
          <td colspan="2" class="lft">Change</td>
          <td class="rgt">${cash(f.change)}</td>
        </tr>
        <tr class="h60">
          <td colspan="4"></td>
        </tr>
        <tr class="h16-5">
          <td colspan="4" class="ctr s13">THANK YOU FOR YOU VISIT</td>
        </tr>
        <tr class="h16-5">
          <td colspan="4"></td>
        </tr>
        <tr class="h16-5">
          <td colspan="4" class="ctr s13 ul">RETURN WITHIN 2 DAYS NOTE.</td>
        </tr>
        <tr class="h16-5">
          <td colspan="4"></td>
        </tr>
        <tr class="h30">
          <td colspan="4" class="ctr s13 wrap">FOR SERVICES AT DOOR STEP</td>
        </tr>
        <tr class="h16-5">
          <td colspan="4" class="ctr s13 ul">0333-4888754</td>
        </tr>
        <tr class="h30">
          <td colspan="4"></td>
        </tr>
        <tr>
          <td colspan="4" class="logo-cell"><div class="id-logo" role="img" aria-label="Book Land logo"></div></td>
        </tr>
      </tbody>
    </table>
  </article>`;
}

// ── Best Choice Store: Item 83 | Qty 60 | Unit 47 | Price 56 | Value 55 worksheet pixels; whole amounts without decimals ──
export function renderBestChoiceStore(invoice) {
  const f = invoice.printed_fields ?? {};
  const rows = invoice.lines.map(
    (l) =>
      html`<tr class="h21 s10">
        <td class="bt-l bt-r bt-t bt-b wrap">${l.description}</td>
        <td class="bt-l bt-r bt-t bt-b ctr">${qty(l.quantity)}</td>
        <td class="bt-l bt-r bt-t bt-b ctr">${l.unit ?? 'P'}</td>
        <td class="bt-l bt-r bt-t bt-b ctr">${compact(price(l))}</td>
        <td class="bt-l bt-r bt-t bt-b ctr">${compact(total(l))}</td>
      </tr>`,
  );
  return html`<article class="id-paper id-best">
    <table>
      <colgroup>
        <col />
        <col />
        <col />
        <col />
        <col />
      </colgroup>
      <tbody>
        <tr class="h15">
          <td colspan="5"></td>
        </tr>
        <tr class="h15">
          <td></td>
          <td colspan="2" class="ctr s11 calibri">ORIGINAL</td>
          <td colspan="2"></td>
        </tr>
        <tr class="h15">
          <td colspan="5"></td>
        </tr>
        <tr class="h60">
          <td colspan="5" class="ctr s18 cambria best-name">BEST CHOICE STORE</td>
        </tr>
        <tr class="h30">
          <td colspan="5" class="ctr s9 comic wrap">COMMERCIAL MARKET SHAHEEN BLOCK SECTOR B</td>
        </tr>
        <tr class="h3">
          <td colspan="5"></td>
        </tr>
        <tr class="h4">
          <td colspan="5"></td>
        </tr>
        <tr class="h15 s8">
          <td colspan="2" class="lft">DATE: ${dateBest(invoice.invoice_date)}</td>
          <td></td>
          <td colspan="2" class="ctr">${invoice.invoice_number}</td>
        </tr>
        <tr class="h15 s8">
          <td colspan="2" class="lft">TIME: ${f.time || ''}</td>
          <td></td>
          <td colspan="2" class="ctr">SHIFT: ${f.shift || ''}</td>
        </tr>
        <tr class="h21">
          <td colspan="5"></td>
        </tr>
        <tr class="h15-75 s11">
          <td class="bt-l bt-r bt-t bt-b lft">ITEM</td>
          <td class="bt-l bt-r bt-t bt-b lft">QTY</td>
          <td class="bt-l bt-r bt-t bt-b lft">UNIT</td>
          <td class="bt-l bt-r bt-t bt-b lft">PRICE</td>
          <td class="bt-l bt-r bt-t bt-b ctr">VALUE</td>
        </tr>
        <tr class="h15">
          <td colspan="5"></td>
        </tr>
        ${rows}
        <tr class="h15">
          <td colspan="5"></td>
        </tr>
        <tr class="h15">
          <td colspan="5"></td>
        </tr>
        <tr class="h15-75 s11">
          <td></td>
          <td colspan="3" class="lft">Total</td>
          <td class="rgt">${compact(invoice.subtotal)}</td>
        </tr>
        <tr class="h15-75 s11">
          <td></td>
          <td colspan="3" class="lft">DISCOUNT:</td>
          <td class="rgt">${compact(invoice.discount)}</td>
        </tr>
        <tr class="h15-75 s11">
          <td></td>
          <td colspan="3" class="lft">NET PAYABLE:</td>
          <td class="rgt">${compact(invoice.grand_total)}</td>
        </tr>
        <tr class="h15-75 s10">
          <td colspan="2" class="ctr">${f.customer || 'WALK IN CUSTOMER'}</td>
          <td colspan="3"></td>
        </tr>
        <tr class="h16-5">
          <td colspan="5" class="ctr s12">WELCOME AT OUR MART</td>
        </tr>
        <tr class="h18">
          <td colspan="5" class="ctr s11 comic">ALL GROCERY ITEMS AVAILABLE</td>
        </tr>
        <tr class="h18">
          <td colspan="5" class="ctr s11 comic">CALL FOR FREE DELIVERY SERVICES</td>
        </tr>
        <tr class="h18">
          <td colspan="5" class="ctr s11 comic">0331-4457293</td>
        </tr>
      </tbody>
    </table>
  </article>`;
}
export function renderInvoice(invoice) {
  const renderers = {
    'bs-mart-v1': renderBsMart,
    'safari-book-land-v1': renderSafariBookLand,
    'best-choice-store-v1': renderBestChoiceStore,
  };
  const renderer = renderers[invoice.template_id];
  if (!renderer) throw new Error('This historical invoice template version is not available.');
  return renderer(invoice);
}
