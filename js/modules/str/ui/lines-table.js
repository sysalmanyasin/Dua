// The table both Report and Zero Dispatch use: Sr#, Product, then the columns the person chose.
import { html } from '../../../shared/html.js';
import { money } from '../../../shared/format.js';
import { grandTotals, groupTotals } from '../domain/group.js';
import { visibleColumns } from '../domain/report.js';
import { diffCell, fmtQty } from './parts.js';

const cell = {
  price: (l) => html`<td class="num">${money(l.productPrice, { decimals: true })}</td>`,
  strQty: (l) => html`<td class="num">${fmtQty(l.packStrQty)}</td>`,
  dispatchQty: (l) => html`<td class="num">${fmtQty(l.packDispatchQty)}</td>`,
  receiveQty: (l) => html`<td class="num">${fmtQty(l.packReceiveQty)}</td>`,
  diff: (l) => diffCell(l),
};
const total = { strQty: (s) => s.str, dispatchQty: (s) => s.dispatch };
const items = (n) => `${n} item${n === 1 ? '' : 's'}`;

export function linesTable(groups, defs, cols) {
  const vis = visibleColumns(defs, cols);
  const all = grandTotals(groups);
  const foot = (label, s) =>
    html`<td colspan="2">${label} — ${items(s.items)}</td>
      ${vis.map((c) => html`<td class="num">${total[c.key] ? total[c.key](s) : ''}</td>`)}`;
  return html`<div class="str-scroll">
    <table class="str-table">
      <thead>
        <tr>
          <th>Sr#</th>
          <th>Product</th>
          ${vis.map((c) => html`<th class="num">${c.label}</th>`)}
        </tr>
      </thead>
      <tbody>
        ${groups.map(
          (g) =>
            html`<tr class="str-group">
                <th colspan="${2 + vis.length}">${g.supplier}</th>
              </tr>
              ${g.rows.map(
                (l) =>
                  html`<tr>
                    <td>${l.sr}</td>
                    <td>[${l.productCode}] ${l.productName}</td>
                    ${vis.map((c) => cell[c.key](l))}
                  </tr>`,
              )}
              <tr class="str-sub">
                ${foot('Subtotal', groupTotals(g))}
              </tr>`,
        )}
      </tbody>
      <tfoot>
        <tr>
          ${foot('Total', all)}
        </tr>
      </tfoot>
    </table>
  </div>`;
}
