// One STR: header, items by supplier in pack quantities, subtotals, grand total, comments, Prev/Next, print.
// Pack sizes and suppliers come from Inventory (data/inventory.js); when that lookup is not available every item is shown
// in loose units under "Unassigned Supplier" and the page says so.
import { html, render } from '../../../shared/html.js';
import { money, shortDate } from '../../../shared/format.js';
import * as api from '../data/api.js';
import * as inventory from '../data/inventory.js';
import { diffQty, diffText, diffTone } from '../domain/pack.js';
import { grandTotals, groupBySupplier, groupTotals } from '../domain/group.js';
import { numberRows, titleOf, toHeader, toLine } from '../domain/mapping.js';
import { errorCard, fmtQty, loadingCard, stageBadge } from './parts.js';
import { printPage } from './print.js';
import { state } from './state.js';

const date = (v) => (v ? shortDate(v) : '');
const TONE_MARK = { short: '▼', over: '▲', even: '=', none: '' };
const TONE_WORD = { short: 'short', over: 'extra', even: 'even', none: '' };

function fields(h) {
  return [
    ['From', h.dispatchBranch],
    ['To', h.receiveBranch],
    ['Master STR #', h.masterStrId],
    ['STR #', h.strNumber],
    ['Media', h.media],
    ['Ref #', h.refNo],
    ['STR Date', date(h.strDate)],
    ['STR Status', h.strStatus],
    ['Issued By', h.issuedBy],
    ['Dispatched Date', date(h.dispatchedDate)],
    ['Dispatch Status', h.dispatchStatus],
    ['Dispatched By', h.dispatchedBy],
    ['Receive Date', date(h.receiveDate)],
    ['Receive Status', h.receiveStatus],
    ['Received By', h.receivedBy],
    ['Cartons', h.noOfBoxes],
  ];
}

const diffCell = (l) => {
  const d = diffQty(l);
  const tone = diffTone(d);
  return html`<td class="num str-diff str-diff-${tone}">
    ${d === null ? '' : html`<span aria-hidden="true">${TONE_MARK[tone]}</span> ${diffText(d)} <span class="str-word">${TONE_WORD[tone]}</span>`}
  </td>`;
};

function table(groups) {
  const total = grandTotals(groups);
  return html`<div class="str-scroll">
    <table class="str-table">
      <thead>
        <tr>
          <th>Sr#</th>
          <th>Product</th>
          <th class="num">R. Price</th>
          <th class="num">STR Qty</th>
          <th class="num">Dispatch Qty</th>
          <th class="num">Receive Qty</th>
          <th class="num">Difference</th>
        </tr>
      </thead>
      <tbody>
        ${groups.map((g) => {
          const s = groupTotals(g);
          return html`<tr class="str-group">
              <th colspan="7">${g.supplier}</th>
            </tr>
            ${g.rows.map(
              (l) =>
                html`<tr>
                  <td>${l.sr}</td>
                  <td>[${l.productCode}] ${l.productName}</td>
                  <td class="num">${money(l.productPrice, { decimals: true })}</td>
                  <td class="num">${fmtQty(l.packStrQty)}</td>
                  <td class="num">${fmtQty(l.packDispatchQty)}</td>
                  <td class="num">${fmtQty(l.packReceiveQty)}</td>
                  ${diffCell(l)}
                </tr>`,
            )}
            <tr class="str-sub">
              <td colspan="3">Subtotal — ${s.items} item${s.items === 1 ? '' : 's'}</td>
              <td class="num">${s.str}</td>
              <td class="num">${s.dispatch}</td>
              <td></td>
              <td></td>
            </tr>`;
        })}
      </tbody>
      <tfoot>
        <tr>
          <td colspan="3">Grand total — ${total.items} item${total.items === 1 ? '' : 's'}</td>
          <td class="num">${total.str}</td>
          <td class="num">${total.dispatch}</td>
          <td></td>
          <td></td>
        </tr>
      </tfoot>
    </table>
  </div>`;
}

export async function mount(el) {
  if (state.selectedId === null || state.selectedId === undefined) {
    location.hash = '#/str'; // reloaded on the detail address: go back to the list
    return;
  }
  let ticket = 0;

  async function show(id) {
    const mine = ++ticket;
    state.selectedId = id;
    render(el, html`<div class="str">${loadingCard()}</div>`);
    let h;
    let lineRows;
    let meta;
    try {
      [h, lineRows] = await Promise.all([api.headerById(id), api.lines(id)]);
      if (mine !== ticket) return;
      if (!h) {
        render(
          el,
          html`<div class="str">
            <div class="card">
              <h2>Transfer not found</h2>
              <p class="muted">It may be older than the history kept, or you may not have access.</p>
              <a class="btn" href="#/str">Back to the list</a>
            </div>
          </div>`,
        );
        return;
      }
      meta = await inventory.productMeta(lineRows.map((r) => r.product_code)).catch(() => null);
      if (mine !== ticket) return;
    } catch {
      if (mine === ticket)
        render(el, html`<div class="str">${errorCard('this transfer')}<a class="btn" href="#/str">Back to the list</a></div>`);
      return;
    }
    const header = toHeader(h);
    const groups = numberRows(groupBySupplier(lineRows.map(toLine), meta ?? {}));
    const at = state.orderedIds.indexOf(id);
    const prev = at > 0 ? state.orderedIds[at - 1] : null;
    const next = at >= 0 && at < state.orderedIds.length - 1 ? state.orderedIds[at + 1] : null;
    const grid = html`<dl class="str-fields">
      ${fields(header).map(
        ([k, v]) =>
          html`<div>
            <dt>${k}</dt>
            <dd>${v || '—'}</dd>
          </div>`,
      )}
    </dl>`;
    const body = groups.length ? table(groups) : html`<p class="muted">No line items for this transfer.</p>`;

    render(
      el,
      html`<div class="str">
        <section class="card">
          <p class="str-back"><a href="#/str">← All transfers</a></p>
          <div class="str-title">
            <h2>${titleOf(header)}</h2>
            ${stageBadge(header.stage)}
          </div>
          ${grid}
        </section>
        <section class="card">
          ${meta === null ? html`<p class="str-note">Supplier names and pack sizes come from Inventory and are not available yet, so quantities are shown in loose units.</p>` : ''}
          ${body} ${header.comments ? html`<p class="str-comments"><strong>Comments:</strong> ${header.comments}</p>` : ''}
          <div class="actions str-actions">
            <button type="button" class="btn" id="str-prev" ${prev === null ? 'disabled' : ''}>← Previous</button>
            <button type="button" class="btn" id="str-next" ${next === null ? 'disabled' : ''}>Next →</button>
            <button type="button" class="btn btn-primary" id="str-print">Print</button>
          </div>
        </section>
      </div>`,
    );
    el.querySelector('#str-prev')?.addEventListener('click', () => prev !== null && show(prev));
    el.querySelector('#str-next')?.addEventListener('click', () => next !== null && show(next));
    el.querySelector('#str-print')?.addEventListener('click', () =>
      printPage(
        html`<header class="str-print-head">
            <div>
              <h1>STOCK TRANSFER REPORT</h1>
              <p>
                Printed
                ${new Date().toLocaleDateString('en-PK', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Karachi' })}
              </p>
            </div>
            <div><strong>${titleOf(header)}</strong><br />Master ${header.masterStrId || '—'}</div>
          </header>
          ${grid}${body}${header.comments ? html`<p><strong>Comments:</strong> ${header.comments}</p>` : ''}`,
      ),
    );
  }

  await show(state.selectedId);
}
