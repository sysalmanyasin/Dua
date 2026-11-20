// Draws a receipt (see domain/receipt.js) and prints it through the browser's print dialog, on a 58 mm or 80 mm roll.
// The same drawing is used for the preview in Settings, so what the owner sees there is what comes out of the printer.
import { html, render } from '../../../shared/html.js';
import { buildReceipt } from '../domain/receipt.js';

/** One receipt, as markup. `model` comes from buildReceipt(). */
export function receiptHtml(model) {
  const m = model;
  return html`<section class="eb-rc eb-rc-${m.width}">
    ${m.logo ? html`<img class="eb-rc-logo" src="${m.logo}" alt="" />` : ''}
    ${m.duplicate ? html`<div class="eb-rc-dup">Duplicate</div>` : ''}
    <div class="eb-rc-title">${m.title}</div>
    ${m.shop ? html`<div class="eb-rc-shop">${m.shop}</div>` : ''}
    ${m.address.length ? html`<div class="eb-rc-addr">${m.address.map((l) => html`<div>${l}</div>`)}</div>` : ''}
    ${m.phone ? html`<div class="eb-rc-addr">${m.phone}</div>` : ''} ${m.flags.map((f) => html`<div class="eb-rc-flag">${f}</div>`)}
    <div class="eb-rc-info">
      ${m.info.map((r) => html`<div class="eb-rc-row"><span>${r.left}</span><span class="eb-rc-r">${r.right}</span></div>`)}
    </div>
    ${
      m.rows
        ? html`<table class="eb-rc-items">
            <thead>
              <tr>
                <th class="eb-rc-name">Product</th>
                <th class="eb-rc-n">Qty</th>
                ${
                  m.showPrices
                    ? html`<th class="eb-rc-n">U/Price</th>
                        <th class="eb-rc-n">Total</th>`
                    : ''
                }
              </tr>
            </thead>
            <tbody>
              ${m.rows.map(
                (r) =>
                  html`<tr>
                    <td class="eb-rc-name">
                      ${r.name} <span class="eb-rc-u">${r.unit}</span>${r.generic ? html`<div class="eb-rc-gen">${r.generic}</div>` : ''}
                    </td>
                    <td class="eb-rc-n">${r.qty}</td>
                    ${
                      m.showPrices
                        ? html`<td class="eb-rc-n">${r.rate}</td>
                            <td class="eb-rc-n">${r.total}</td>`
                        : ''
                    }
                  </tr>`,
              )}
            </tbody>
          </table>`
        : html`<hr class="eb-rc-line" />`
    }
    ${
      m.totals.length
        ? html`<div class="eb-rc-totals">
            ${m.totals.map((t) => html`<div class="eb-rc-trow${t.strong ? ' eb-rc-strong' : ''}"><span>${t.label}</span><span>${t.value}</span></div>`)}
          </div>`
        : ''
    }
    <div class="eb-rc-count">${m.itemsLine}</div>
    ${m.temporary ? html`<div class="eb-rc-temp">${m.temporary}</div>` : ''}
    ${
      m.footer.length
        ? html`<hr class="eb-rc-line" />
            <div class="eb-rc-foot">${m.footer.map((l) => html`<div>${l}</div>`)}</div>`
        : ''
    }
  </section>`;
}

let busy = false;

/**
 * Print one or more receipts (each on its own page). Resolves when the print dialog closes.
 * @param {ReturnType<import('../domain/receipt.js').buildReceipt>[]} models
 */
export function printReceipts(models) {
  if (busy || !models.length) return Promise.resolve(false);
  busy = true;
  const root = document.createElement('div');
  root.id = 'eb-print-root';
  render(root, html`${models.map(receiptHtml)}`);
  document.body.append(root);
  document.body.classList.add('eb-printing');
  return new Promise((resolve) => {
    const done = () => {
      window.removeEventListener('afterprint', done);
      document.body.classList.remove('eb-printing');
      root.remove();
      busy = false;
      resolve(true);
    };
    window.addEventListener('afterprint', done);
    try {
      window.print();
    } catch {
      done();
    }
  });
}

/** Print N copies (1 to 5) of one invoice. Copies after the first are marked Duplicate. */
export function printCopies(data, settings, { type, copies = 1, reprint = false } = {}) {
  const n = Math.max(1, Math.min(5, Math.trunc(Number(copies)) || 1));
  return printReceipts(Array.from({ length: n }, (_, i) => buildReceipt(data, settings, { type, copy: i + 1, copies: n, reprint })));
}
