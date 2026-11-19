// Immutable template renderers. Keep business-specific field order and wording separate.
import { html } from '../../../shared/html.js';
import { amountInWords } from '../domain/amount-in-words.js';

const money = (value) => Number(value ?? 0).toFixed(2);
const itemRows = (lines, order) =>
  lines.map((line, i) => {
    const cells = {
      number: html`<td>${i + 1}</td>`,
      description: html`<td>${line.description}</td>`,
      quantity: html`<td class="id-num">${line.quantity}</td>`,
      unit: html`<td>${line.unit ?? 'P'}</td>`,
      rate: html`<td class="id-num">${money(line.unit_price ?? line.unitPrice)}</td>`,
      total: html`<td class="id-num">${money(line.line_total ?? line.lineTotal)}</td>`,
    };
    return html`<tr>
      ${order.map((key) => cells[key])}
    </tr>`;
  });
const cashChange = (fields, cashLabel = 'Cash', changeLabel = 'Change') =>
  html`<div class="id-receipt-pay">
    <span>${cashLabel}: Rs. ${fields.cash || '—'}</span><span>${changeLabel}: Rs. ${fields.change || '—'}</span>
  </div>`;

export function renderBsMart(invoice) {
  const f = invoice.printed_fields ?? {};
  return html`<article class="id-paper id-bs">
    <div class="id-copy">ORIGINIAL</div>
    <header>
      <h2>B.S MART</h2>
      <p>PLAZA # 11 SHAHEEN BLOCK</p>
      <p>OPP SAFARI GATE # 1</p>
      <p>FOR FREE HOME DELIVERY CALL</p>
      <p>PHONE # 0320-0450158</p>
    </header>
    <div class="id-meta"><span>${invoice.invoice_date} · ${f.time || ''}</span><span>Cashier: ${f.cashier || '—'}</span></div>
    <div class="id-meta"><span>Shift: ${f.shift || '—'}</span><span>Invoice: ${invoice.invoice_number}</span></div>
    <table>
      <thead>
        <tr>
          <th>Description</th>
          <th>Rate</th>
          <th>Qty</th>
          <th>Amount</th>
        </tr>
      </thead>
      <tbody>
        ${itemRows(invoice.lines, ['description', 'rate', 'quantity', 'total'])}
      </tbody>
    </table>
    <div class="id-meta"><span>Items: ${invoice.lines.length}</span><strong>Subtotal Rs. ${money(invoice.subtotal)}</strong></div>
    <div class="id-total"><strong>Grand Total</strong><strong>Rs. ${money(invoice.grand_total)}</strong></div>
    <p class="id-thanks">THANK YOU FOR YOU KIND VISIT</p>
    ${cashChange(f)}
    <p class="id-words">${invoice.amount_words || amountInWords(Math.round(Number(invoice.grand_total) * 100))}</p>
    <p class="id-small">FRESH FRUIT, VEGETABLE AVAILABLE</p>
    <p class="id-small">INVOICE REQUIRED FOR ITEM CHANGE</p>
    <p class="id-policy">RETURN WITHIN 2 DAYS NOTE. NON REFUND OR EXCHANGE POLICY ON FROZEN &amp; COSMATIC ITEMS.</p>
    <p class="id-small">for any kind of complaint please contact</p>
    <p class="id-small">کسی بھی شکایات کے لیے اس نمبر پے رابطہ کرے</p>
    <p class="id-small">0320-0450158</p>
  </article>`;
}
export function renderSafariBookLand(invoice) {
  const f = invoice.printed_fields ?? {};
  return html`<article class="id-paper id-safari">
    <div class="id-copy">ORIGINAL SLIP</div>
    <header>
      <h2>SAFARI BOOK LAND</h2>
      <p>PLAZA # 22 UMAR BLOCK SECTOR B</p>
      <p>PHONE # 0333-4888754</p>
    </header>
    <div class="id-meta"><span>Receipt: ${invoice.invoice_number}</span><span>${invoice.invoice_date}</span></div>
    <div class="id-meta"><span>Cashier: ${f.cashier || '—'}</span><span>${f.time || ''}</span></div>
    <table>
      <thead>
        <tr>
          <th>Product</th>
          <th>Qty</th>
          <th>U/Price</th>
          <th>Total</th>
        </tr>
      </thead>
      <tbody>
        ${itemRows(invoice.lines, ['description', 'quantity', 'rate', 'total'])}
      </tbody>
    </table>
    <div class="id-meta"><span>Items: ${invoice.lines.length}</span><strong>Total Rs. ${money(invoice.grand_total)}</strong></div>
    ${cashChange(f, 'Payment Cash', 'Change')}
    <p class="id-small">THANK YOU FOR YOU VISIT</p>
    <p class="id-small">RETURN WITHIN 2 DAYS NOTE.</p>
    <p class="id-small">FOR SERVICES AT DOOR STEP</p>
    <p class="id-small">0333-4888754</p>
  </article>`;
}
export function renderBestChoiceStore(invoice) {
  const f = invoice.printed_fields ?? {};
  return html`<article class="id-paper id-best">
    <div class="id-copy">ORIGINAL</div>
    <header>
      <h2>BEST CHOICE STORE</h2>
      <p>COMMERCIAL MARKET SHAHEEN BLOCK SECTOR B</p>
    </header>
    <div class="id-meta"><span>DATE: ${invoice.invoice_date}</span><strong>${invoice.invoice_number}</strong></div>
    <div class="id-meta"><span>TIME: ${f.time || ''}</span><span>SHIFT: ${f.shift || '—'}</span></div>
    <table>
      <thead>
        <tr>
          <th>ITEM</th>
          <th>QTY</th>
          <th>UNIT</th>
          <th>PRICE</th>
          <th>VALUE</th>
        </tr>
      </thead>
      <tbody>
        ${itemRows(invoice.lines, ['description', 'quantity', 'unit', 'rate', 'total'])}
      </tbody>
    </table>
    <div class="id-summary">
      <div><span>Total</span><strong>Rs. ${money(invoice.subtotal)}</strong></div>
      <div><span>DISCOUNT:</span><strong>Rs. ${money(invoice.discount)}</strong></div>
      <div class="id-total"><strong>NET PAYABLE:</strong><strong>Rs. ${money(invoice.grand_total)}</strong></div>
    </div>
    <p class="id-small">${f.customer || 'WALK IN CUSTOMER'}</p>
    <p class="id-small">WELCOME AT OUR MART</p>
    <p class="id-small">ALL GROCERY ITEMS AVAILABLE</p>
    <p class="id-small">CALL FOR FREE DELIVERY SERVICES</p>
    <p class="id-small">0331-4457293</p>
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
