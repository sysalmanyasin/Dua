// Emergency Billing History: every invoice with its sync state. Server invoices come from the database (staff see their own;
// ebill.history_all and managers see everyone's). Invoices still only on THIS device (Pending or Failed) are shown first, marked,
// and are never counted in the server totals, so the person can see exactly what has and has not reached the server before
// writing anything down. Offline, the list shows what the device holds. Refunds and corrections are manager-only and need the server.
import { html, render } from '../../../shared/html.js';
import { money } from '../../../shared/format.js';
import { ask } from './dialog.js';
import { allRemaining, previewRefund, STATUS_WORDS } from '../domain/refund.js';
import { normalizeReceiptSettings, receiptFromLocal, receiptFromServer, RECEIPT_TYPES } from '../domain/receipt.js';
import { loadReceiptSettings } from '../data/receiptSettings.js';
import { printCopies } from './receiptPrint.js';
import * as api from '../data/api.js';
import { openLocalDb } from '../data/localDb.js';
import { createSync } from '../data/sync.js';
import { clock } from '../data/products.js';
import { deviceLabel, getDeviceId } from '../data/device.js';

const m2 = (n) => (n === null || n === undefined || n === '' ? '–' : money(n, { decimals: true }));
const PAGE = 50;
const tz = 'Asia/Karachi';
const day = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(iso));
const stamp = (iso) =>
  iso ? `${new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: '2-digit', month: 'short' }).format(new Date(iso))} ${clock(iso)}` : '';
const SYNC = { synced: 'Synced', pending: 'Pending', failed: 'Failed' };

const fromServer = (r) => ({
  key: r.invoice_id,
  invoice_id: r.invoice_id,
  no: r.invoice_no,
  time: r.client_created_at,
  staff: r.staff_name,
  customer: r.customer,
  items: r.items,
  gross: Number(r.gross_total),
  discounts: Number(r.discounts),
  net: Number(r.net_total),
  refunded: Number(r.refunded_amount || 0),
  mode: r.payment_mode,
  status: r.status,
  sync: 'synced',
  device: r.device_label,
  pin: r.pin_check,
  local: false,
});
const fromLocal = (r) => ({
  key: r.invoice_id,
  invoice_id: r.invoice_id,
  no: r.invoice_no || r.local_ref,
  time: r.created_at,
  staff: r.staff_name,
  customer: r.customer || '',
  items: r.payload?.lines?.length ?? 0,
  gross: r.payload?.totals?.gross_total ?? null,
  discounts: null,
  net: r.net_total,
  mode: r.payload?.payment_mode,
  status: 'posted',
  sync: r.status,
  device: deviceLabel(r.device_id || getDeviceId()),
  pin: r.payload?.offline_proof ? 'device' : 'server',
  local: true,
  rec: r,
});

export async function mount(el, { ctx }) {
  const perms = new Set(ctx.permissions || []);
  const manager = perms.has('ebill.manage');
  const store = await openLocalDb();
  let receiptCfg = normalizeReceiptSettings(null);
  loadReceiptSettings({ store, api })
    .then((c) => (receiptCfg = c))
    .catch(() => {});
  const sync = createSync({ store, api, userId: api.currentUserId, deviceId: getDeviceId(), deviceLabel: deviceLabel() });
  const today = day(new Date());
  const f = { from: today, to: today, text: '', status: '', mode: '', sync: '' };
  let offset = 0;
  let view = { rows: [], total: 0, sumNet: 0, sumRefunded: 0, pending: 0, failed: 0, offlineOnly: false, error: '' };
  let timer = null;
  let msg = '';

  render(
    el,
    html`<section class="eb-hist">
      <h1>Emergency Billing history</h1>
      <div class="eb-hist-filters">
        <label class="field"><span>From</span><input id="hs-from" type="date" value="${f.from}" /></label>
        <label class="field"><span>To</span><input id="hs-to" type="date" value="${f.to}" /></label>
        <label class="field eb-grow"
          ><span>Search invoice no., customer, staff</span><input id="hs-text" type="search" autocomplete="off"
        /></label>
        <label class="field"
          ><span>Status</span
          ><select id="hs-status">
            <option value="">All</option>
            <option value="posted">Posted</option>
            <option value="corrected">Corrected</option>
            <option value="partially_refunded">Part refunded</option>
            <option value="refunded">Refunded</option>
          </select></label
        >
        <label class="field"
          ><span>Payment</span
          ><select id="hs-mode">
            <option value="">All</option>
            <option>Cash</option>
            <option>Card</option>
            <option>Credit</option>
          </select></label
        >
        <label class="field"
          ><span>Sync</span
          ><select id="hs-sync">
            <option value="">All</option>
            <option value="synced">Synced</option>
            <option value="pending">Pending</option>
            <option value="failed">Failed</option>
          </select></label
        >
      </div>
      <div id="hs-msg"></div>
      <div id="hs-summary"></div>
      <div class="eb-table-wrap eb-hist-wrap"><div id="hs-table"></div></div>
      <div id="hs-pager" class="eb-hist-pager"></div>
      <div id="hs-detail"></div>
      <div id="hs-dialog"></div>
    </section>`,
  );
  const q = (s) => el.querySelector(s);

  const matchLocal = (r) => {
    const d = day(r.created_at);
    if (f.from && d < f.from) return false;
    if (f.to && d > f.to) return false;
    if (f.mode && r.payload?.payment_mode !== f.mode) return false;
    if (f.status && f.status !== 'posted') return false;
    if (f.sync && r.status !== f.sync) return false;
    const w = f.text.trim().toLowerCase();
    return !w || `${r.invoice_no || ''} ${r.local_ref || ''} ${r.customer || ''} ${r.staff_name || ''}`.toLowerCase().includes(w);
  };

  async function load() {
    const online = navigator.onLine !== false;
    const mine = (await store.allInvoices()).filter((r) => r.user_id === ctx.user_id);
    const waiting = mine
      .filter((r) => r.status !== 'synced' && matchLocal(r))
      .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
    const next = {
      rows: [],
      total: 0,
      sumNet: 0,
      sumRefunded: 0,
      pending: waiting.filter((r) => r.status === 'pending').length,
      failed: waiting.filter((r) => r.status === 'failed').length,
      offlineOnly: !online,
      error: '',
    };
    const wantServer = online && (f.sync === '' || f.sync === 'synced');
    if (wantServer) {
      try {
        const r = await api.history({ from: f.from, to: f.to, text: f.text, status: f.status, mode: f.mode, limit: PAGE, offset });
        next.rows = r.rows.map(fromServer);
        next.total = r.total;
        next.sumNet = Number(r.sum_net);
        next.sumRefunded = Number(r.sum_refunded);
      } catch (e) {
        next.error = e?.message || 'Could not load the history.';
        next.offlineOnly = true;
      }
    }
    if (!online || next.error) {
      // no server list: show what this device has, including what already uploaded
      const here = mine.filter((r) => r.status === 'synced' && matchLocal(r));
      next.rows = here.map(fromLocal);
    }
    const onServer = new Set(next.rows.map((r) => r.invoice_id));
    const top = f.sync === 'synced' ? [] : waiting.filter((r) => !onServer.has(r.invoice_id)).map(fromLocal);
    next.rows = offset === 0 ? [...top, ...next.rows] : next.rows;
    view = next;
    draw();
  }

  function draw() {
    const { rows, total, sumNet, sumRefunded, pending, failed, offlineOnly, error } = view;
    render(
      q('#hs-msg'),
      html`${msg ? html`<p class="note note-info" role="status">${msg}</p>` : ''}
      ${error ? html`<p class="note note-error" role="status">${error} Showing what is on this device.</p>` : ''}
      ${offlineOnly && !error ? html`<p class="note note-info" role="status">You are offline. This shows the invoices on this device only; connect to see the full history. Refunds and corrections need a connection.</p>` : ''}`,
    );
    render(
      q('#hs-summary'),
      html`<div class="eb-hist-sum">
          <span><b>${total}</b> on the server</span>
          <span>Net total <b>${m2(sumNet)}</b></span>
          ${sumRefunded ? html`<span>Refunded <b>${m2(sumRefunded)}</b> <span class="muted">(not in the net total)</span></span>` : ''}
        </div>
        ${
          pending || failed
            ? html`<div class="note ${failed ? 'note-error' : 'note-info'}" role="status">
                <b>${pending} pending${failed ? `, ${failed} failed` : ''}</b>:
                ${pending + failed === 1 ? 'this invoice is' : 'these invoices are'} still only on this device and
                ${pending + failed === 1 ? 'is' : 'are'} <b>not included</b> in the server totals above. Do not export or copy these figures
                as final until they have uploaded.
                ${navigator.onLine !== false ? html`<button type="button" class="btn btn-sm" data-act="upload">Upload now</button>${failed ? html`<button type="button" class="btn btn-sm" data-act="retry">Retry failed</button>` : ''}` : ''}
              </div>`
            : ''
        }`,
    );
    render(
      q('#hs-table'),
      html`<table class="eb-table">
        <thead>
          <tr>
            <th>Invoice</th>
            <th>Date / time</th>
            <th>Staff</th>
            <th>Customer</th>
            <th class="num">Items</th>
            <th class="num">Gross</th>
            <th class="num">Discounts</th>
            <th class="num">Net</th>
            <th>Payment</th>
            <th>Status</th>
            <th>Sync</th>
            ${
              manager
                ? html`<th>Device</th>
                    <th>PIN</th>`
                : ''
            }
          </tr>
        </thead>
        <tbody>
          ${
            rows.length
              ? rows.map(
                  (r) =>
                    html`<tr data-key="${r.key}" class="eb-click ${r.sync === 'failed' ? 'eb-row-failed' : ''}">
                      <td>${r.no}</td>
                      <td>${stamp(r.time)}</td>
                      <td>${r.staff}</td>
                      <td>${r.customer || 'Walk-in'}</td>
                      <td class="num">${r.items}</td>
                      <td class="num">${m2(r.gross)}</td>
                      <td class="num">${m2(r.discounts)}</td>
                      <td class="num"><b>${m2(r.net)}</b></td>
                      <td>${r.mode || ''}</td>
                      <td>
                        ${r.status === 'posted' ? '' : html`<span class="eb-st eb-st-${r.status === 'refunded' ? 'failed' : 'pending'}">${STATUS_WORDS[r.status] || r.status}</span>${r.refunded ? html` <span class="muted">${m2(r.refunded)} back</span>` : ''}`}
                      </td>
                      <td><span class="eb-st eb-st-${r.sync}">${SYNC[r.sync]}</span></td>
                      ${
                        manager
                          ? html`<td>${r.device || ''}</td>
                              <td>${r.pin === 'device' ? 'Device' : 'Server'}</td>`
                          : ''
                      }
                    </tr>`,
                )
              : html`<tr>
                  <td colspan="${manager ? 13 : 11}" class="muted eb-empty">No invoices match.</td>
                </tr>`
          }
        </tbody>
      </table>`,
    );
    const pages = Math.max(1, Math.ceil(total / PAGE));
    render(
      q('#hs-pager'),
      total > PAGE
        ? html`<button type="button" class="btn btn-sm" data-page="prev" ${offset === 0 ? 'disabled' : ''}>Previous</button>
            <span>Page ${Math.floor(offset / PAGE) + 1} of ${pages}</span>
            <button type="button" class="btn btn-sm" data-page="next" ${offset + PAGE >= total ? 'disabled' : ''}>Next</button>`
        : html``,
    );
  }

  const reload = (resetPage = true) => {
    if (resetPage) offset = 0;
    return load();
  };

  // ───────── detail ─────────
  const eventText = (e, names = {}) =>
    e.kind === 'refund'
      ? `Refunded ${m2(e.amount)}${e.lines?.length ? ` (${e.lines.map((x) => `${names[x.line_no] || 'item'} × ${x.qty}`).join(', ')})` : ''}`
      : `Corrected ${Object.entries(e.changes || {})
          .map(([k, v]) => `${k.replace('_', ' ')}: “${v.from ?? ''}” → “${v.to ?? ''}”`)
          .join('; ')}`;

  async function openDetail(key) {
    const row = view.rows.find((r) => r.key === key);
    if (!row) return;
    const host = q('#hs-detail');
    const close = () => host.replaceChildren();
    if (row.local) {
      const r = row.rec;
      render(
        host,
        html`<div class="eb-modal" role="dialog" aria-modal="true" aria-label="Invoice ${row.no}">
          <div class="eb-dlg eb-detail">
            <div class="eb-dlg-head">
              <h2>${row.no}</h2>
              <span class="eb-st eb-st-${r.status}">${SYNC[r.status]}</span><span class="eb-grow"></span
              ><button type="button" class="btn btn-sm" data-act="print">Print receipt</button
              ><button type="button" class="btn btn-sm" data-close>Close</button>
            </div>
            <p class="note ${r.status === 'failed' ? 'note-error' : 'note-info'}">
              ${r.status === 'failed' ? `The server did not accept this invoice: ${r.last_error?.message || ''} It is kept on this device. Ask a manager.` : 'Saved on this device. It has not reached the server yet and will upload by itself.'}
            </p>
            <p>
              ${stamp(r.created_at)} · ${r.staff_name} · ${r.customer || 'Walk-in'} · ${r.payload?.payment_mode || ''} · PIN checked on
              ${r.payload?.offline_proof ? 'this device' : 'the server'}
            </p>
            ${linesTable(r.payload?.lines || [], (l) => ({ code: l.code, name: l.name, unit: l.unit, qty: l.qty, rate: l.rate, total: null }))}
            <p class="eb-net-line">Net total <b>${m2(r.net_total)}</b></p>
          </div>
        </div>`,
      );
      host.querySelector('[data-close]').addEventListener('click', close);
      host.querySelector('[data-act="print"]')?.addEventListener('click', () => printDialog(() => receiptFromLocal(r)));
      return;
    }
    render(
      host,
      html`<div class="eb-modal">
        <div class="eb-dlg eb-detail"><p class="muted">Loading…</p></div>
      </div>`,
    );
    let d;
    try {
      d = await api.invoiceDetail(row.invoice_id);
    } catch {
      render(
        host,
        html`<div class="eb-modal">
          <div class="eb-dlg eb-detail">
            <p class="note note-error">Could not load this invoice. Check your connection.</p>
            <button type="button" class="btn" data-close>Close</button>
          </div>
        </div>`,
      );
      host.querySelector('[data-close]').addEventListener('click', close);
      return;
    }
    if (!d?.ok) {
      render(
        host,
        html`<div class="eb-modal">
          <div class="eb-dlg eb-detail">
            <p class="note note-error">That invoice is not available to you.</p>
            <button type="button" class="btn" data-close>Close</button>
          </div>
        </div>`,
      );
      host.querySelector('[data-close]').addEventListener('click', close);
      return;
    }
    const i = d.invoice;
    const done = i.status === 'refunded';
    const lineNames = Object.fromEntries(d.lines.map((l) => [l.line_no, l.name]));
    render(
      host,
      html`<div class="eb-modal" role="dialog" aria-modal="true" aria-label="Invoice ${i.invoice_no}">
        <div class="eb-dlg eb-detail">
          <div class="eb-dlg-head">
            <h2>${i.invoice_no}</h2>
            ${i.status !== 'posted' ? html`<span class="eb-st eb-st-${done ? 'failed' : 'pending'}">${STATUS_WORDS[i.status] || i.status}</span>` : ''}<span
              class="eb-grow"
            ></span
            ><button type="button" class="btn btn-sm" data-act="print">Print receipt</button
            ><button type="button" class="btn btn-sm" data-close>Close</button>
          </div>
          <p>
            ${stamp(i.client_created_at)} · ${i.staff_name} · ${i.customer || 'Walk-in'} · ${i.payment_mode} · ${i.device_label || ''} · PIN
            checked on ${i.pin_check === 'device' ? 'the device' : 'the server'}${i.comments ? html` · <i>${i.comments}</i>` : ''}
          </p>
          ${linesTable(
            d.lines,
            (l) => ({
              code: l.code,
              name: l.name,
              unit: l.unit,
              qty: l.qty,
              rate: Number(l.rate),
              total: Number(l.line_total),
              refunded: Number(l.refunded),
              remaining: Number(l.remaining),
            }),
            Number(i.refunded_amount) > 0,
          )}
          <dl class="eb-totals">
            <div>
              <dt>Gross total</dt>
              <dd>${m2(i.gross_total)}</dd>
            </div>
            <div>
              <dt>Customer discount (${Number(i.customer_discount_pct)}%)</dt>
              <dd>${m2(i.customer_discount)}</dd>
            </div>
            <div>
              <dt>Receipt discount</dt>
              <dd>${m2(i.receipt_discount)}</dd>
            </div>
            <div>
              <dt>Tax</dt>
              <dd>${m2(i.tax)}</dd>
            </div>
            <div>
              <dt>Adjustment</dt>
              <dd>${m2(i.adjustment)}</dd>
            </div>
            <div>
              <dt><b>Net total</b></dt>
              <dd><b>${m2(i.net_total)}</b></dd>
            </div>
            <div>
              <dt>Cash received</dt>
              <dd>${m2(i.cash_received)}</dd>
            </div>
            ${
              Number(i.refunded_amount) > 0
                ? html`<div>
                      <dt>Refunded so far</dt>
                      <dd>${m2(i.refunded_amount)}</dd>
                    </div>
                    <div>
                      <dt><b>Still with the customer</b></dt>
                      <dd><b>${m2(i.remaining_amount)}</b></dd>
                    </div>`
                : ''
            }
          </dl>
          ${
            d.events.length
              ? html`<h3>Changes</h3>
                  <ul class="eb-events">
                    ${d.events.map((e) => html`<li><b>${eventText(e, lineNames)}</b><br /><span class="muted">${e.by}, ${stamp(e.at)}. Reason: ${e.reason}</span></li>`)}
                  </ul>`
              : ''
          }
          ${
            manager
              ? html`<div class="eb-ask-actions">
                  ${navigator.onLine === false ? html`<span class="muted">Refunds and corrections need a connection.</span>` : ''}
                  <button type="button" class="btn" data-act="correct" ${done || navigator.onLine === false ? 'disabled' : ''}>
                    Correct
                  </button>
                  <button type="button" class="btn btn-primary" data-act="refund" ${done || navigator.onLine === false ? 'disabled' : ''}>
                    Refund…
                  </button>
                </div>`
              : ''
          }
        </div>
      </div>`,
    );
    host.querySelector('[data-close]').addEventListener('click', close);
    host.querySelector('[data-act="print"]')?.addEventListener('click', () => printDialog(() => receiptFromServer(d)));
    host.querySelector('[data-act="refund"]')?.addEventListener('click', async () => {
      const r = await refundDialog(q('#hs-dialog'), i, d.lines);
      if (!r) return;
      await run(
        () => api.refundLines(i.invoice_id, r.lines, r.reason, r.requestId),
        (x) =>
          x.code === 'duplicate'
            ? 'That refund had already gone through.'
            : `Refunded ${m2(x.amount)}.${x.code === 'refunded' ? ' The invoice is now fully refunded.' : ` ${m2(x.remaining_amount)} is still with the customer.`}`,
        i.invoice_id,
      );
    });
    host.querySelector('[data-act="correct"]')?.addEventListener('click', async () => {
      const v = await ask(q('#hs-dialog'), {
        title: `Correct ${i.invoice_no}`,
        intro: 'Only customer, payment mode and comments can be corrected. If an amount is wrong, refund the invoice and bill again.',
        confirm: 'Save correction',
        fields: [
          { id: 'customer', label: 'Customer', value: i.customer || '' },
          { id: 'payment_mode', label: 'Payment mode', value: i.payment_mode, options: ['Cash', 'Card', 'Credit'] },
          { id: 'comments', label: 'Comments', value: i.comments || '' },
          { id: 'why', label: 'Reason (required)', placeholder: 'e.g. wrong name typed' },
        ],
      });
      if (!v) return;
      const changes = {};
      if (v.customer.trim() !== (i.customer || '')) changes.customer = v.customer;
      if (v.payment_mode !== i.payment_mode) changes.payment_mode = v.payment_mode;
      if (v.comments.trim() !== (i.comments || '')) changes.comments = v.comments;
      if (!Object.keys(changes).length) {
        say('Nothing was different, so nothing was saved.');
        return;
      }
      await run(
        () => api.correctInvoice(i.invoice_id, changes, v.why),
        () => 'Correction saved.',
        i.invoice_id,
      );
    });

    async function run(call, ok, id) {
      try {
        const r = await call();
        say(r?.ok ? ok(r) : r?.message || 'The change was not made.');
        await load();
        if (r?.ok) await openDetail(id);
      } catch (e) {
        say(e?.message || 'The change was not made.');
      }
    }
  }

  // Reprint: choose the type and number of copies, then print. A reprint is always marked Duplicate.
  async function printDialog(getData) {
    const v = await ask(q('#hs-dialog'), {
      title: 'Print receipt',
      intro: 'The receipt is marked Duplicate.',
      confirm: 'Print',
      fields: [
        { id: 'type', label: 'Receipt type', options: RECEIPT_TYPES, value: receiptCfg.receipt_type },
        { id: 'copies', label: 'Copies (1 to 5)', type: 'number', value: String(receiptCfg.copies), inputmode: 'numeric' },
      ],
    });
    if (!v) return;
    await printCopies(getData(), receiptCfg, { type: v.type, copies: Number(v.copies), reprint: true });
  }

  // The partial-refund question: what, how many, why. The amount shown is a preview; the server works out the real one.
  function refundDialog(host, inv, lines) {
    return new Promise((resolve) => {
      const requestId = crypto.randomUUID(); // one per opening: a retry of THIS refund can never refund twice
      const state = {};
      const model = {
        net_total: inv.net_total,
        refunded_amount: inv.refunded_amount,
        lines: lines.map((l) => ({
          ...l,
          qty: Number(l.qty),
          line_total: Number(l.line_total),
          refunded: Number(l.refunded),
          remaining: Number(l.remaining),
        })),
      };
      let error = '';
      const draw2 = () => {
        const p = previewRefund(model, state);
        render(
          host,
          html`<div class="eb-modal" role="dialog" aria-modal="true" aria-label="Refund ${inv.invoice_no}">
            <div class="eb-ask eb-refund">
              <h2>Refund ${inv.invoice_no}</h2>
              <p class="muted">
                Type how many of each item came back. The customer gets back their share of what they paid, after discounts.
              </p>
              ${error ? html`<p class="note note-error" role="alert">${error}</p>` : ''}
              <div class="eb-table-wrap">
                <table class="eb-table">
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th class="num">Sold</th>
                      <th class="num">Already back</th>
                      <th class="num">Can refund</th>
                      <th class="num">Refund now</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${model.lines.map(
                      (l) =>
                        html`<tr>
                          <td>${l.name}</td>
                          <td class="num">${l.qty}</td>
                          <td class="num">${l.refunded || ''}</td>
                          <td class="num">${l.remaining}</td>
                          <td class="num">
                            ${
                              l.remaining > 0
                                ? html`<input
                                    class="eb-refund-qty"
                                    data-line="${l.line_no}"
                                    type="number"
                                    min="0"
                                    max="${l.remaining}"
                                    step="any"
                                    inputmode="decimal"
                                    value="${state[l.line_no] || ''}"
                                    aria-label="Quantity of ${l.name} to refund"
                                  />`
                                : html`<span class="muted">all back</span>`
                            }
                          </td>
                        </tr>`,
                    )}
                  </tbody>
                </table>
              </div>
              <div class="eb-refund-sum">
                <button type="button" class="btn btn-sm" data-act="all">Refund all remaining</button>
                <span class="eb-grow"></span>
                <span
                  >${p.ok ? html`Refund <b>${m2(p.amount)}</b>${p.finalRefund ? html` <span class="muted">(everything left)</span>` : ''}` : html`<span class="muted">${p.message}</span>`}</span
                >
              </div>
              <label class="field"
                ><span>Reason (required)</span
                ><input data-f="why" type="text" autocomplete="off" placeholder="e.g. customer returned two strips"
              /></label>
              <div class="eb-ask-actions">
                <button type="button" class="btn" data-act="no">Cancel</button>
                <button type="button" class="btn btn-primary" data-act="yes" ${p.ok ? '' : 'disabled'}>Refund</button>
              </div>
            </div>
          </div>`,
        );
        const root = host.querySelector('.eb-modal');
        const why = root.querySelector('[data-f="why"]');
        why.value = reasonText;
        why.addEventListener('input', () => (reasonText = why.value));
        root.querySelectorAll('.eb-refund-qty').forEach((inp) =>
          inp.addEventListener('input', () => {
            const n = Number(inp.value);
            if (inp.value === '' || n === 0) delete state[inp.dataset.line];
            else state[inp.dataset.line] = n;
            // refresh only the summary and the button, so typing is not interrupted
            const pp = previewRefund(model, state);
            root.querySelector('.eb-refund-sum span:last-child').textContent = pp.ok
              ? `Refund ${m2(pp.amount)}${pp.finalRefund ? ' (everything left)' : ''}`
              : pp.message;
            root.querySelector('[data-act="yes"]').disabled = !pp.ok;
          }),
        );
        root.addEventListener('click', (e) => {
          const act = e.target.closest('[data-act]')?.dataset.act;
          reasonText = why.value;
          if (act === 'no') finish(null);
          if (act === 'all') {
            Object.keys(state).forEach((k) => delete state[k]);
            Object.assign(state, allRemaining(model.lines));
            draw2();
          }
          if (act === 'yes') {
            const pp = previewRefund(model, state);
            if (!pp.ok) return;
            if (reasonText.trim().length < 3) {
              error = 'Please give a reason (at least 3 letters).';
              return draw2();
            }
            finish({ lines: pp.chosen, reason: reasonText.trim(), requestId });
          }
        });
      };
      let reasonText = '';
      const onKey = (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          finish(null);
        }
      };
      const finish = (v) => {
        document.removeEventListener('keydown', onKey, true);
        host.replaceChildren();
        resolve(v);
      };
      document.addEventListener('keydown', onKey, true);
      draw2();
    });
  }

  function linesTable(lines, pick, showRefunds = false) {
    return html`<div class="eb-table-wrap">
      <table class="eb-table">
        <thead>
          <tr>
            <th>Code</th>
            <th>Product</th>
            <th>Unit</th>
            <th class="num">Qty</th>
            <th class="num">Rate</th>
            <th class="num">Total</th>
            ${
              showRefunds
                ? html`<th class="num">Refunded</th>
                    <th class="num">Left</th>`
                : ''
            }
          </tr>
        </thead>
        <tbody>
          ${lines.map((raw) => {
            const l = pick(raw);
            return html`<tr>
              <td>${l.code}</td>
              <td>${l.name}</td>
              <td>${l.unit}</td>
              <td class="num">${l.qty}</td>
              <td class="num">${m2(l.rate)}</td>
              <td class="num">${m2(l.total)}</td>
              ${
                showRefunds
                  ? html`<td class="num">${l.refunded || ''}</td>
                      <td class="num">${l.remaining}</td>`
                  : ''
              }
            </tr>`;
          })}
        </tbody>
      </table>
    </div>`;
  }

  function say(text) {
    msg = text;
    draw();
  }

  // ───────── events ─────────
  const bind = (id, key, ev = 'change') =>
    q(id).addEventListener(ev, (e) => {
      f[key] = e.target.value;
      if (ev === 'input') {
        clearTimeout(timer);
        timer = setTimeout(() => reload(), 300);
      } else reload();
    });
  bind('#hs-from', 'from');
  bind('#hs-to', 'to');
  bind('#hs-text', 'text', 'input');
  bind('#hs-status', 'status');
  bind('#hs-mode', 'mode');
  bind('#hs-sync', 'sync');
  el.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-act],[data-page],tr[data-key]');
    if (!t) return;
    if (t.dataset.act === 'upload') {
      await sync.syncNow().catch(() => {});
      return reload(false);
    }
    if (t.dataset.act === 'retry') {
      await sync.retryFailed().catch(() => {});
      return reload(false);
    }
    if (t.dataset.page) {
      offset = Math.max(0, offset + (t.dataset.page === 'next' ? PAGE : -PAGE));
      return load();
    }
    if (t.dataset.key) openDetail(t.dataset.key);
  });
  const onNet = () => el.isConnected && reload(false);
  window.addEventListener('online', onNet);
  window.addEventListener('offline', onNet);

  await load();
}
