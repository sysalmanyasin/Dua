// The Sale Report as it appears on screen and on paper (same black-header table as the original app).
import { html, render } from '../../../shared/html.js';
import { fv, reportDate, reportTitle } from '../domain/saleReport.js';

const noteOf = (r) => (r.note ? html` <small class="sr-note">(${r.note})</small>` : '');
const row = (r) => html`<div class="sr-row"><span>${r.label}${noteOf(r)}</span><span class="sr-v">${fv(r.value)}</span></div>`;

export function saleReportView(rep, { branch, date }) {
  return html`<div class="sr" id="sr-printable">
    <div class="sr-head">${reportTitle(branch)}</div>
    <div class="sr-date"><span>Date:</span><span>${reportDate(date)}</span></div>
    <div class="sr-sec">Cash Sale:</div>
    ${rep.cashRows.map(row)}
    <div class="sr-net"><span>Net Cash Sale:</span><span class="sr-v">${fv(rep.netCash)}</span></div>
    <div class="sr-sec">Credit Sale:</div>
    ${rep.creditRows.map(row)}
    <div class="sr-net"><span>Net Credit Sale:</span><span class="sr-v">${fv(rep.netCredit)}</span></div>
    <div class="sr-grand"><span>Grand Total:</span><span class="sr-v">₨${fv(rep.grand)}</span></div>
    ${rep.misc.map((m) => html`<div class="sr-misc ${m.tone ? `t-${m.tone}` : ''} ${m.red ? 'red' : ''} ${m.strong ? 'strong' : ''}"><span>${m.label}</span><span class="sr-v">${fv(m.value)}</span></div>`)}
  </div>`;
}

export function printSaleReport(rep, ctx) {
  const root = document.createElement('div');
  root.id = 'print-root';
  render(root, saleReportView(rep, ctx));
  document.body.append(root);
  document.body.classList.add('printing-report');
  const done = () => {
    document.body.classList.remove('printing-report');
    root.remove();
    window.removeEventListener('afterprint', done);
  };
  window.addEventListener('afterprint', done);
  window.print();
}
