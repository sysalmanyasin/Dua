// "Search receipt": find an earlier invoice by number, customer or staff and print it again (marked Duplicate).
// Looks on the server when online and always on this device, so a bill that has not uploaded yet can still be reprinted.
import { html, render } from '../../../shared/html.js';
import { money } from '../../../shared/format.js';
import { receiptFromLocal, receiptFromServer, receiptTime } from '../domain/receipt.js';
import { printCopies } from './receiptPrint.js';

const m2 = (v) => money(v, { decimals: true });
const MAX = 20;

/**
 * @param {{ host: HTMLElement, store: { allInvoices: Function }, userId: string,
 *           api: { history: Function, invoiceDetail: Function },
 *           settings: () => object, options: () => { type: string, copies: number }, onClose?: () => void }} o
 * @returns {() => void} close
 */
export function openReceiptSearch({ host, store, userId, api, settings, options, onClose }) {
  let rows = [];
  let message = '';
  let busy = false;
  let text = '';

  const close = () => {
    document.removeEventListener('keydown', onKey, true);
    host.replaceChildren();
    onClose?.();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };
  document.addEventListener('keydown', onKey, true);

  const matches = (r, w) =>
    !w || `${r.invoice_no || ''} ${r.local_ref || ''} ${r.customer || ''} ${r.staff_name || ''}`.toLowerCase().includes(w);

  async function find() {
    busy = true;
    message = '';
    draw();
    const w = text.trim().toLowerCase();
    const found = new Map();
    try {
      const mine = (await store.allInvoices()).filter((r) => r.user_id === userId && matches(r, w));
      for (const r of mine) {
        found.set(r.invoice_id, {
          id: r.invoice_id,
          no: r.invoice_no || r.local_ref,
          time: r.created_at,
          customer: r.customer || '',
          net: r.net_total,
          where: r.status === 'synced' ? 'Server' : 'This device only',
          local: r,
        });
      }
    } catch {
      /* the device copy could not be read; the server may still answer */
    }
    if (navigator.onLine !== false) {
      try {
        const r = await api.history({ text, limit: MAX });
        for (const x of r.rows) {
          const have = found.get(x.invoice_id);
          found.set(x.invoice_id, {
            id: x.invoice_id,
            no: x.invoice_no,
            time: x.client_created_at,
            customer: x.customer || '',
            net: x.net_total,
            where: 'Server',
            local: have?.local,
            server: true,
          });
        }
      } catch {
        message = 'Could not reach the server. Showing what is on this device.';
      }
    } else message = 'You are offline. Showing only what is on this device.';
    rows = [...found.values()].sort((a, b) => (a.time < b.time ? 1 : -1)).slice(0, MAX);
    if (!rows.length && !message) message = 'No receipt found.';
    busy = false;
    draw();
  }

  async function print(id) {
    const row = rows.find((r) => r.id === id);
    if (!row) return;
    busy = true;
    message = '';
    draw();
    try {
      let data;
      if (row.server && navigator.onLine !== false) {
        const d = await api.invoiceDetail(id);
        if (!d?.ok) throw new Error('missing');
        data = receiptFromServer(d);
      } else if (row.local) data = receiptFromLocal(row.local);
      else throw new Error('missing');
      const o = options();
      await printCopies(data, settings(), { type: o.type, copies: o.copies, reprint: true });
    } catch {
      message = 'That receipt could not be opened. Try again when you are online.';
    }
    busy = false;
    draw();
  }

  function draw() {
    render(
      host,
      html`<div class="eb-modal" role="dialog" aria-modal="true" aria-label="Search receipt">
        <div class="eb-ask eb-rsearch">
          <h2>Search receipt</h2>
          <p class="muted">Find an earlier invoice by its number, the customer or the staff name. It prints marked Duplicate.</p>
          <div class="eb-rsearch-bar">
            <input
              id="eb-rs-text"
              type="search"
              autocomplete="off"
              placeholder="Invoice number, customer or staff"
              aria-label="Search receipts"
              value="${text}"
            />
            <button type="button" class="btn btn-primary" data-act="find" ${busy ? 'disabled' : ''}>Search</button>
          </div>
          ${message ? html`<p class="note note-info" role="status">${message}</p>` : ''}
          ${
            rows.length
              ? html`<div class="eb-table-wrap">
                  <table class="eb-table">
                    <thead>
                      <tr>
                        <th>Invoice</th>
                        <th>Date</th>
                        <th>Customer</th>
                        <th class="num">Net</th>
                        <th>On</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      ${rows.map(
                        (r) =>
                          html`<tr>
                            <td>${r.no}</td>
                            <td>${receiptTime(r.time)}</td>
                            <td>${r.customer || '–'}</td>
                            <td class="num">${m2(r.net)}</td>
                            <td>${r.where}</td>
                            <td><button type="button" class="btn btn-sm" data-print="${r.id}" ${busy ? 'disabled' : ''}>Print</button></td>
                          </tr>`,
                      )}
                    </tbody>
                  </table>
                </div>`
              : ''
          }
          <div class="eb-ask-actions"><button type="button" class="btn" data-act="close">Close</button></div>
        </div>
      </div>`,
    );
    const root = host.querySelector('.eb-modal');
    const input = root.querySelector('#eb-rs-text');
    input.addEventListener('input', () => (text = input.value));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        text = input.value;
        find();
      }
    });
    root.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      text = input.value;
      if (b.dataset.act === 'close') close();
      else if (b.dataset.act === 'find') find();
      else if (b.dataset.print) print(b.dataset.print);
    });
    if (!busy) input.focus();
  }

  draw();
  find(); // show the latest receipts at once
  return close;
}
