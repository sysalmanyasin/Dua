// Immutable, versioned receipt renderers. Historical invoices select by their stored template_id.
import { html } from '../../../shared/html.js';
import { amountInWords } from '../domain/amount-in-words.js';

const cash = (fields) => html`<div class="id-receipt-pay"><span>Cash: Rs. ${fields.cash ?? '—'}</span><span>Change: Rs. ${fields.change ?? '—'}</span></div>`;
const rows = (lines) => lines.map((line, i) => html`<tr><td>${i + 1}</td><td>${line.description}</td><td class="id-num">${line.quantity}</td><td class="id-num">${Number(line.unit_price ?? line.unitPrice ?? 0).toFixed(2)}</td><td class="id-num">${Number(line.line_total ?? line.lineTotal ?? 0).toFixed(2)}</td></tr>`);
export function renderBsMart(invoice) {
  const f = invoice.printed_fields ?? {};
  return html`<article class="id-paper id-bs">
    <header><h2>B.S MART</h2><p>INVOICE / CASH MEMO</p><div>Invoice No: ${invoice.invoice_number} · Date: ${invoice.invoice_date}</div></header>
    <table><thead><tr><th>#</th><th>Item Description</th><th>Qty</th><th>Rate</th><th>Amount</th></tr></thead><tbody>${rows(invoice.lines)}</tbody></table>
    <div class="id-total"><strong>GRAND TOTAL</strong><strong>Rs. ${Number(invoice.grand_total).toFixed(2)}</strong></div>
    <p class="id-words">${invoice.amount_words || amountInWords(Math.round(Number(invoice.grand_total) * 100))}</p>
    ${cash(f)}
    <p class="id-small">Thank you for shopping with us.</p><p class="id-small">Goods once sold are subject to the original store return policy.</p>
  </article>`;
}
export function renderSafariBookLand(invoice) {
  const f = invoice.printed_fields ?? {};
  return html`<article class="id-paper id-safari">
    <header><h2>SAFARI BOOK LAND</h2><p>BOOKS · STATIONERY · GENERAL ORDER</p><div>Receipt No: ${invoice.invoice_number}</div><div>Date: ${invoice.invoice_date} · Cashier: ${f.cashier ?? '—'}</div></header>
    <table><thead><tr><th>#</th><th>Product / Description</th><th>Qty</th><th>Unit Price</th><th>Total</th></tr></thead><tbody>${rows(invoice.lines)}</tbody></table>
    <div class="id-total"><strong>TOTAL</strong><strong>Rs. ${Number(invoice.grand_total).toFixed(2)}</strong></div>
    ${cash(f)}
    <p class="id-small">Thank you for visiting Safari Book Land.</p><p class="id-small">Please visit us again.</p>
  </article>`;
}
export function renderBestChoiceStore(invoice) {
  const f = invoice.printed_fields ?? {};
  return html`<article class="id-paper id-best">
    <header><h2>BEST CHOICE STORE</h2><p>SALES INVOICE</p><div>Invoice No: ${invoice.invoice_number} · Date: ${invoice.invoice_date}</div><div>Shift: ${f.shift ?? '—'} · Customer: ${f.customer ?? '—'}</div></header>
    <table><thead><tr><th>#</th><th>Item</th><th>Qty</th><th>Price</th><th>Total</th></tr></thead><tbody>${rows(invoice.lines)}</tbody></table>
    <div class="id-summary"><div><span>Subtotal</span><strong>Rs. ${Number(invoice.subtotal).toFixed(2)}</strong></div><div><span>Discount</span><strong>Rs. ${Number(invoice.discount).toFixed(2)}</strong></div><div class="id-total"><strong>NET PAYABLE</strong><strong>Rs. ${Number(invoice.grand_total).toFixed(2)}</strong></div></div>
    <p class="id-small">Thank you for choosing Best Choice Store.</p>
  </article>`;
}
export function renderInvoice(invoice) {
  const renderers = { 'bs-mart-v1': renderBsMart, 'safari-book-land-v1': renderSafariBookLand, 'best-choice-store-v1': renderBestChoiceStore };
  const renderer = renderers[invoice.template_id];
  if (!renderer) throw new Error('This historical invoice template version is not available.');
  return renderer(invoice);
}
