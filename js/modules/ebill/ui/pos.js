// Emergency POS: Candela-inspired desktop billing screen with keyboard-first cashier controls, laid out like the Candela "Sale and Return" screen the cashiers already know
// (header rows, invoice grid with totals row, right-hand totals panel, bottom payment and receipt bar) in Dua's own look.
// Phase 1 works: bill building, Product Help, totals, new bill and cancel. Saving, holding, printing and returns arrive in
// later phases; their controls are shown but switched off, never faked.
// Stock comes only from this device's saved product copy and is always labelled as such.
import { html, render } from '../../../shared/html.js';
import { money } from '../../../shared/format.js';
import { BRAND } from '../../../core/config.js';
import { addProduct, emptyCart, removeLine, setLineDiscount, setQty, stockIssue } from '../domain/cart.js';
import { billTotals, lineTotals, payment } from '../domain/calc.js';
import { emptyState } from '../domain/productFilter.js';
import { clock, readCopy, refreshCopy } from '../data/products.js';
import { openProductHelp } from './productHelp.js';
import { openHeldBills } from './heldBills.js';
import { ask } from './dialog.js';
import {
  currentUserId,
  getHeldState,
  holdBill,
  listHeld,
  myLimits,
  offlineGrant,
  registerDevice,
  releaseHeld,
  saveInvoice,
} from '../data/api.js';
import { createHeld, heldState } from '../data/held.js';
import { openLocalDb } from '../data/localDb.js';
import { createKit } from '../data/offlineKit.js';
import { createSync, startAutoSync } from '../data/sync.js';
import { registerServiceWorker, shellReady } from '../data/offline.js';
import { deviceLabel, getDeviceId } from '../data/device.js';
import { buildInvoice, isPinRetry, newInvoiceId, refusalText } from '../domain/invoice.js';
import { checkDiscount, classifyError, localRef } from '../domain/offline.js';

const m2 = (n) => money(n, { decimals: true });
const PAYMENT_MODES = ['Cash', 'Credit', 'Card'];
const RECEIPT_TYPES = ['Primary Receipt', 'Gift Receipt', 'Summary Receipt', 'Secondary Receipt'];
const SOON = 'Coming in a later phase';

export async function mount(el, { ctx }) {
  let products = [];
  let meta = null;
  let cart = emptyCart();
  let note = '';
  let device = { status: 'unknown' }; // 'active' | 'deactivated' | 'unknown' (not registered yet or offline)
  let saving = false;
  let saved = null; // { no, local } for the last saved invoice, shown above the grid until the next bill
  const stops = []; // things to switch off when this page is left
  let closeHelp = null;
  const helpHolder = { state: emptyState() }; // survives closing and reopening Product Help
  const byCode = new Map();
  const store = await openLocalDb(); // invoices waiting to upload live here; durable=false means this browser cannot keep them
  const kit = createKit({ store, api: { offlineGrant, myLimits }, deviceId: getDeviceId(), userId: () => ctx.user_id });
  const sync = createSync({
    store,
    api: { saveInvoice, registerDevice, holdBill, releaseHeld },
    userId: currentUserId,
    deviceId: getDeviceId(),
    deviceLabel: deviceLabel(),
    afterSync: async () => {
      await refreshCopy(ctx); // fresh products...
      await kit.refreshLimits(); // ...and fresh limits and PIN rule
    },
  });
  const held = createHeld({
    store,
    api: { listHeld, getHeldState, releaseHeld },
    userId: async () => ctx.user_id,
    deviceId: getDeviceId(),
  });
  let flash = ''; // a short information line: held, resumed, connection lost / back
  let flashTimer = null;
  let closeHeld = null;
  let activeRowId = null;
  const fresh = () => ({
    customer: '',
    customerDiscountPct: 0,
    receiptOn: false,
    receiptDiscount: { mode: 'amt', value: 0 },
    adjustment: 0,
    taxPct: 0,
    cash: 0,
    mode: 'Cash',
    comments: '',
    more: '',
    qty: 1,
    invoiceId: null,
    heldId: null, // set while a bill that was held is on screen, so saving it releases the hold
  });
  let bill = fresh();

  const load = async () => {
    ({ products, meta } = await readCopy(ctx));
    byCode.clear();
    for (const p of products) byCode.set(String(p.code).toLowerCase(), p);
  };

  render(
    el,
    html`<section class="eb eb-desk">
      <div class="eb-bar">
        <span class="eb-tab">Sale and Return</span>
        <span class="eb-title">${BRAND.title}</span>
        <span id="eb-status" class="eb-status"></span>
        <span class="eb-grow"></span>
        <div id="eb-sync" class="eb-sync"></div>
        <button
          type="button"
          class="btn btn-sm"
          data-act="fullscreen"
          id="eb-full"
          title="Use the whole screen: hides the menu and the browser bars"
        >
          ⛶ Full screen
        </button>
      </div>
      <div id="eb-note"></div>

      <div class="eb-top">
        <div class="eb-row">
          <div class="eb-group">
            <span class="eb-lbl">Sale person</span>
            <input class="eb-wide" id="eb-sp-name" value="${ctx.full_name || ctx.username || ''}" readonly aria-label="Salesperson" />
          </div>
          <div class="eb-group eb-grow">
            <span class="eb-lbl">Customer / member</span>
            <input class="eb-wide" id="eb-customer" autocomplete="off" placeholder="Walk-in" aria-label="Customer name" />
          </div>
          <div class="eb-group eb-grow2">
            <span class="eb-lbl">Qty / product (SKU)</span>
            <span class="eb-inline">
              <input class="eb-qtyin" id="eb-qty" type="text" inputmode="decimal" value="1" aria-label="Quantity" />
              <input
                class="eb-sku"
                id="eb-sku"
                autocomplete="off"
                spellcheck="false"
                placeholder="Scan or type a code, then Enter · F2"
                aria-label="Product code"
              />
              <button type="button" class="btn" data-act="help" title="Product Help (F2)" aria-label="Open Product Help">🔍</button>
            </span>
          </div>
          <div class="eb-group">
            <span class="eb-lbl">Receipt #</span><input class="eb-code" value="Draft" readonly aria-label="Receipt number" />
          </div>
          <div class="eb-group">
            <span class="eb-lbl">Date / time</span>
            <span class="eb-inline"
              ><input class="eb-date" id="eb-date" readonly aria-label="Date" /><input
                class="eb-time"
                id="eb-time"
                readonly
                aria-label="Time"
            /></span>
          </div>
        </div>
      </div>

      <div class="eb-main">
        <div class="eb-grid">
          <div class="eb-table-wrap eb-lines-wrap"><div id="eb-lines"></div></div>
        </div>
        <aside class="eb-side" aria-label="Totals and payment">
          <dl class="eb-totals">
            <div>
              <dt>Gross total</dt>
              <dd><output data-out="grossTotal"></output></dd>
            </div>
            <div>
              <dt>Customer discount %</dt>
              <dd>
                <input
                  id="eb-cdisc"
                  class="eb-num"
                  type="number"
                  min="0"
                  max="100"
                  step="any"
                  value="0"
                  aria-label="Customer discount percent"
                /><output data-out="customerDiscount"></output>
              </dd>
            </div>
            <div>
              <dt>
                <label class="eb-check"><input id="eb-rdon" type="checkbox" /> Receipt disc</label>
              </dt>
              <dd>
                <select id="eb-rmode" disabled aria-label="Receipt discount type">
                  <option value="amt">Rs</option>
                  <option value="pct">%</option></select
                ><input
                  id="eb-rdisc"
                  class="eb-num"
                  type="number"
                  min="0"
                  step="any"
                  value="0"
                  disabled
                  aria-label="Receipt discount"
                /><output data-out="receiptDiscount"></output>
              </dd>
            </div>
            <div>
              <dt>Net gross total</dt>
              <dd><output data-out="netGross"></output></dd>
            </div>
            <div>
              <dt>Adjustment</dt>
              <dd><input id="eb-adj" class="eb-num" type="number" step="any" value="0" aria-label="Adjustment" /></dd>
            </div>
            <div>
              <dt>VAT / sales tax %</dt>
              <dd>
                <input id="eb-tax" class="eb-num" type="number" min="0" step="any" value="0" aria-label="Tax percent" /><output
                  data-out="tax"
                ></output>
              </dd>
            </div>
          </dl>
          <div class="eb-netlabel">Net total</div>
          <div class="eb-net"><output data-out="netTotal" id="eb-net"></output></div>
          <fieldset class="eb-receipt">
            <legend>Receipt</legend>
            <dl class="eb-totals">
              <div>
                <dt>Cash</dt>
                <dd><input id="eb-cash" class="eb-cash" type="number" min="0" step="any" value="0" aria-label="Cash received" /></dd>
              </div>
              <div>
                <dt>Change</dt>
                <dd class="eb-change"><output data-out="change"></output></dd>
              </div>
              <div>
                <dt>Still due</dt>
                <dd><output data-out="due"></output></dd>
              </div>
            </dl>
          </fieldset>
        </aside>
      </div>

      <div class="eb-bottom">
        <div class="eb-hold">
          <span class="eb-lbl">Receipt holding [<span id="eb-held-n">0</span> / 6]</span>
          <div class="eb-navs">
            <button type="button" class="btn btn-sm" data-held-nav="first" title="First held bill" aria-label="First held bill">«</button
            ><button type="button" class="btn btn-sm" data-held-nav="prev" title="Previous held bill" aria-label="Previous held bill">
              ‹</button
            ><button type="button" class="btn btn-sm" data-held-nav="next" title="Next held bill" aria-label="Next held bill">›</button
            ><button type="button" class="btn btn-sm" data-held-nav="last" title="Last held bill" aria-label="Last held bill">»</button
            ><button type="button" class="btn btn-sm" data-act="hold" title="Hold this bill and serve the next customer">Hold</button
            ><button type="button" class="btn btn-sm" data-act="cancel" title="Clear this bill">Cancel</button>
          </div>
        </div>
        <fieldset class="eb-pay">
          <legend>Payment mode</legend>
          ${PAYMENT_MODES.map((x) => html`<label class="eb-check"><input type="radio" name="eb-mode" value="${x}" ${x === 'Cash' ? 'checked' : ''} /> ${x}</label>`)}
        </fieldset>
        <label class="eb-area"><span class="eb-lbl">Comments</span><textarea id="eb-comments" rows="2"></textarea></label>
        <label class="eb-area"><span class="eb-lbl">Additional comments</span><textarea id="eb-more" rows="2"></textarea></label>
        <div class="eb-print">
          <label class="eb-check"><input type="checkbox" checked disabled title="${SOON}" /> Print receipt</label>
          <label class="eb-copies"><span>Copies</span><input type="number" value="1" min="1" disabled title="${SOON}" /></label>
          <button type="button" class="btn btn-sm" disabled title="${SOON}">Search receipt</button>
        </div>
        <div class="eb-rtype">
          <label class="eb-lbl" for="eb-rtype">Receipt type</label>
          <select id="eb-rtype" disabled title="${SOON}">
            ${RECEIPT_TYPES.map((x) => html`<option>${x}</option>`)}
          </select>
        </div>
        <div class="eb-actions">
          <button type="button" class="btn btn-primary eb-save" id="eb-save" data-act="save" disabled title="Add items to save">
            💾 Save invoice
          </button>
          <div class="eb-navs">
            <button type="button" class="btn btn-sm" data-act="new" title="New bill">＋ New</button

          </div>
        </div>
      </div>
      <div id="eb-help"></div>
      <div id="eb-dialog"></div>
    </section>`,
  );
  const q = (s) => el.querySelector(s);
  const num = (id) => Number(q(id).value) || 0;

  function totals() {
    return billTotals({
      lines: cart.lines,
      customerDiscountPct: bill.customerDiscountPct,
      receiptDiscount: bill.receiptOn ? bill.receiptDiscount : null,
      adjustment: bill.adjustment,
      taxPct: bill.taxPct,
    });
  }
  const udist = (l, total) => (l.qty > 0 ? total.discount / l.qty : 0);

  function drawTotals() {
    const t = totals();
    const p = payment(t.netTotal, bill.cash);
    const out = { ...t, change: p.change, due: p.due };
    for (const node of el.querySelectorAll('[data-out]')) node.textContent = m2(out[node.dataset.out]);
    const sum = (f) => cart.lines.reduce((s, l, i) => s + f(l, t.lines[i]), 0);
    const set = (k, v) => {
      const n = q(`[data-sum="${k}"]`);
      if (n) n.textContent = v;
    };
    set('qty', String(sum((l) => l.qty)));
    set('udist', m2(sum((l, x) => udist(l, x))));
    set('disc', m2(t.lineDiscounts));
    set('total', m2(t.grossTotal));
    set('count', `Records: ${cart.lines.length}`);
  }

  function drawLines() {
    const t = totals();
    render(
      q('#eb-lines'),
      html`<table class="eb-table eb-lines">
        <thead>
          <tr>
            <th>Sr. #</th>
            <th>Product code</th>
            <th>Product name</th>
            <th>Unit</th>
            <th class="num">Rate</th>
            <th class="num">Qty</th>
            <th class="num">U.Dist</th>
            <th>Discount</th>
            <th class="num">Total</th>
            <th><span class="sr">Delete</span></th>
          </tr>
        </thead>
        <tbody>
          ${
            cart.lines.length
              ? cart.lines.map((l, i) => {
                  const issue = stockIssue(l, byCode.get(String(l.code).toLowerCase()));
                  return html`<tr data-id="${l.id}" tabindex="0" aria-label="Bill item ${i + 1}: ${l.name}">
                    <td>${i + 1}</td>
                    <td>${l.code}</td>
                    <td>
                      ${l.name}${l.generic ? html`<div class="eb-sub">${l.generic}</div>` : ''}${issue ? html`<div class="eb-warn" role="status">⚠ ${issue.text}</div>` : ''}
                    </td>
                    <td>
                      <select data-edit="unit" aria-label="Unit for ${l.name}">
                        <option value="unit" ${l.unit === 'unit' ? 'selected' : ''}>Loose</option>
                        ${l.pack > 1 ? html`<option value="pack" ${l.unit === 'pack' ? 'selected' : ''}>Pack of ${l.pack}</option>` : ''}
                      </select>
                    </td>
                    <td class="num">${m2(l.rate)}</td>
                    <td class="num">
                      <input
                        class="eb-edit"
                        data-edit="qty"
                        type="text"
                        inputmode="decimal"
                        value="${l.qty}"
                        aria-label="Quantity of ${l.name}"
                      />
                    </td>
                    <td class="num" data-udist="${l.id}">${m2(udist(l, t.lines[i]))}</td>
                    <td class="eb-disc">
                      <input
                        class="eb-edit"
                        data-edit="disc"
                        type="number"
                        min="0"
                        step="any"
                        value="${l.discount.value}"
                        aria-label="Discount for ${l.name}"
                      /><select data-edit="dmode" aria-label="Discount type">
                        <option value="pct" ${l.discount.mode === 'pct' ? 'selected' : ''}>%</option>
                        <option value="amt" ${l.discount.mode === 'amt' ? 'selected' : ''}>Rs</option>
                      </select>
                    </td>
                    <td class="num" data-line-total="${l.id}">${m2(t.lines[i].total)}</td>
                    <td>
                      <button type="button" class="eb-del" data-del="${l.id}" aria-label="Remove ${l.name}" title="Remove item">🗑</button>
                    </td>
                  </tr>`;
                })
              : html`<tr>
                  <td colspan="10" class="muted eb-empty">
                    No items yet. Scan or type a code and press Enter, or press F2 to search the whole list.
                  </td>
                </tr>`
          }
          ${Array.from(
            { length: Math.max(0, 8 - cart.lines.length) },
            () =>
              html`<tr class="eb-filler" aria-hidden="true">
                ${Array.from({ length: 10 }, () => html`<td>&nbsp;</td>`)}
              </tr>`,
          )}
        </tbody>
        <tfoot>
          <tr>
            <td>Σ</td>
            <td></td>
            <td data-sum="count"></td>
            <td></td>
            <td></td>
            <td class="num" data-sum="qty"></td>
            <td class="num" data-sum="udist"></td>
            <td class="num" data-sum="disc"></td>
            <td class="num" data-sum="total"></td>
            <td></td>
          </tr>
        </tfoot>
      </table>`,
    );
    drawTotals();
    syncSave();
  }

  function drawStatus() {
    const online = navigator.onLine !== false;
    render(q('#eb-status'), html``);
    render(
      q('#eb-note'),
      html`${!online ? html`<p class="note note-info" role="status">You are offline. You can keep billing: bills are saved on this device and upload by themselves when you are back online. Products and stock come from the copy saved on this device${meta?.syncedAt ? `, updated ${clock(meta.syncedAt)}` : ''}, so stock may be out of date.</p>` : ''}
      ${flash ? html`<p class="note note-info" role="status">${flash}</p>` : ''}
      ${note && note !== 'offline' ? html`<p class="note note-error" role="status">${note}</p>` : ''}
      ${saved ? (saved.local ? html`<p class="note note-info" role="status">Saved on this device as <b>${saved.no}</b>. It will upload by itself when you are online.</p>` : html`<p class="note note-info" role="status">Saved as <b>${saved.no}</b>. The invoice is on the server.</p>`) : ''}
      ${device.status === 'deactivated' ? html`<p class="note note-error" role="status">This device has been switched off by the manager. Invoices cannot be saved from it.</p>` : ''}
      ${!products.length ? html`<p class="note note-info" role="status">No product copy on this device yet. Connect to the internet once so it can download.</p>` : ''}`,
    );
  }
  function syncSave() {
    const btn = q('#eb-save');
    if (!btn) return;
    btn.disabled = !cart.lines.length || saving || device.status === 'deactivated';
    btn.title = !cart.lines.length
      ? 'Add items to save'
      : device.status === 'deactivated'
        ? 'This device has been switched off'
        : 'Save invoice (asks for your PIN)';
  }

  async function registerThisDevice() {
    if (navigator.onLine === false) return;
    try {
      const r = await registerDevice(getDeviceId(), deviceLabel());
      device = { status: r?.status === 'deactivated' ? 'deactivated' : 'active' };
    } catch {
      /* stays unknown; saving tries again */
    }
    drawStatus();
  }

  // Offline path: check the PIN and discount on this device, then write the invoice to local storage. It is committed BEFORE
  // the screen says saved, and stays until the server confirms it (sync.js).
  async function saveLocally(invoice, pin, t) {
    if (!store.durable)
      return {
        ok: false,
        code: 'not_durable',
        message: 'This browser cannot keep an invoice safely without a connection. Connect to the internet to save.',
      };
    const v = await kit.verifyPinLocally(pin);
    if (!v.ok) return v;
    const d = checkDiscount(t, cart.lines, v.limits);
    if (!d.ok) return d;
    const payload = { ...invoice, ...(v.proof ? { offline_proof: v.proof } : {}) };
    const rec = {
      invoice_id: invoice.invoice_id,
      user_id: ctx.user_id,
      device_id: getDeviceId(),
      status: 'pending',
      payload,
      local_ref: localRef(invoice.invoice_id),
      net_total: t.netTotal,
      customer: bill.customer || '',
      staff_name: ctx.full_name || ctx.username || '',
      created_at: invoice.client_created_at,
      attempts: 0,
      last_error: null,
      invoice_no: null,
      synced_at: null,
    };
    await sync.queue(rec);
    return { ok: true, ref: rec.local_ref };
  }

  async function save() {
    if (saving || !cart.lines.length) return;
    const t = totals();
    if (
      bill.mode === 'Cash' &&
      payment(t.netTotal, bill.cash).due > 0 &&
      !window.confirm('Cash received is less than the net total. Save anyway?')
    )
      return;
    saving = true;
    syncSave();
    try {
      let local = navigator.onLine === false;
      if (!local && device.status !== 'active') await registerThisDevice();
      if (device.status === 'deactivated') return;
      bill.invoiceId ||= newInvoiceId(); // made once per bill: a retry sends the same id, so it can never save twice
      const invoice = buildInvoice({ cart, bill, totals: t, deviceId: getDeviceId(), invoiceId: bill.invoiceId });
      let err = '';
      for (;;) {
        const v = await ask(q('#eb-dialog'), {
          title: local ? 'Enter your PIN to save on this device' : 'Enter your PIN to save',
          intro: local
            ? `No connection. This bill is kept on this device and uploads by itself later. Net total ${m2(t.netTotal)}`
            : `Net total ${m2(t.netTotal)}`,
          error: err,
          confirm: 'Save',
          fields: [{ id: 'pin', label: 'PIN', type: 'password', inputmode: 'numeric', maxlength: 6, autocomplete: 'one-time-code' }],
        });
        if (!v) return;
        if (!local) {
          let r;
          try {
            r = await saveInvoice(invoice, v.pin);
          } catch (e) {
            if (classifyError(e, navigator.onLine !== false) !== 'network') throw e;
            local = true; // the connection dropped: carry on with the same PIN, on this device
          }
          if (r?.ok) {
            saved = { no: r.invoice_no, local: false };
            note = '';
            releaseCurrentHold();
            resetBill();
            drawStatus();
            kit.afterOnlineSave(v.pin).then(drawSync); // quietly get this device ready for offline billing
            return;
          }
          if (r) {
            if (isPinRetry(r)) {
              err = refusalText(r);
              continue;
            }
            if (r.code === 'device_inactive') device = { status: 'deactivated' };
            note = refusalText(r);
            drawStatus();
            return;
          }
        }
        const r = await saveLocally(invoice, v.pin, t);
        if (r.ok) {
          saved = { no: r.ref, local: true };
          note = '';
          releaseCurrentHold();
          resetBill();
          drawStatus();
          drawSync();
          sync.syncNow().catch(() => {}); // a no-op while offline; uploads at once if the connection is back
          return;
        }
        if (r.code === 'bad_pin') {
          err = r.message;
          continue;
        }
        note = r.message || 'The invoice was not saved.';
        drawStatus();
        return;
      }
    } catch {
      note = 'Could not save. Your bill is still open; try again.';
      drawStatus();
    } finally {
      saving = false;
      syncSave();
    }
  }

  // The sync strip: connection, what is waiting, what failed, when the server was last reached, and each local invoice's state.
  const STATE = { pending: 'Pending', synced: 'Synced', failed: 'Failed' };
  async function drawSync() {
    if (!q('#eb-sync')) return;
    const [s, ready, shell] = await Promise.all([sync.snapshot(), kit.readiness(), shellReady()]);
    if (s.items.some((i) => i.last_error?.code === 'device_inactive') && device.status !== 'deactivated') {
      device = { status: 'deactivated' };
      drawStatus();
      syncSave();
    }
    const online = navigator.onLine !== false;
    render(
      q('#eb-sync'),
      html`<div class="eb-sync-row">
          <span class="pill ${online ? '' : 'eb-pill-off'}">${online ? 'Online' : 'Offline'}</span>
          <span>Pending <b>${s.pending}</b></span>
          ${s.failed ? html`<span class="neg">Failed <b>${s.failed}</b></span>` : ''}
          <span class="muted">Last sync: ${s.lastSyncAt ? clock(s.lastSyncAt) : 'never'}</span>
          <span class="${ready.ready && shell ? '' : 'muted eb-ellip'}" title="${ready.ready ? '' : ready.why}"
            >${ready.ready && shell ? '✓ Ready for offline billing' : 'Not ready for offline billing yet'}</span
          >
          ${s.failed ? html`<button type="button" class="btn btn-sm" data-act="retry">Retry failed</button>` : ''}
          ${s.pending && online ? html`<button type="button" class="btn btn-sm" data-act="syncnow">Upload now</button>` : ''}
          ${online && !ready.ready && !String(ready.why).includes('Ask the owner') ? html`<button type="button" class="btn btn-sm" data-act="prep">Prepare offline</button>` : ''}
        </div>
        ${s.others ? html`<span class="muted">${s.others} invoice${s.others === 1 ? '' : 's'} on this device belong to another login and will upload when that person signs in.</span>` : ''}
        ${
          s.items.length
            ? html`<details class="eb-sync-list">
                <summary>Invoices on this device (${s.items.length})</summary>
                <div class="eb-table-wrap">
                  <table class="eb-table">
                    <thead>
                      <tr>
                        <th>Invoice</th>
                        <th>Time</th>
                        <th>Customer</th>
                        <th class="num">Net total</th>
                        <th>Status</th>
                        <th>Detail</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${s.items.map(
                        (i) =>
                          html`<tr>
                            <td>${i.invoice_no || i.local_ref}</td>
                            <td>${clock(i.created_at)}</td>
                            <td>${i.customer || '–'}</td>
                            <td class="num">${m2(i.net_total)}</td>
                            <td><span class="eb-st eb-st-${i.status}">${STATE[i.status] || i.status}</span></td>
                            <td class="muted">
                              ${i.status === 'failed' ? i.last_error?.message || '' : i.status === 'pending' && i.last_error?.code === 'network' ? 'Waiting for a connection' : ''}
                            </td>
                          </tr>`,
                      )}
                    </tbody>
                  </table>
                </div>
              </details>`
            : ''
        }`,
    );
  }

  const tick = () => {
    const d = new Date();
    const f = (opts) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Karachi', ...opts }).format(d);
    if (q('#eb-date')) q('#eb-date').value = f({ day: '2-digit', month: 'short', year: 'numeric' });
    if (q('#eb-time')) q('#eb-time').value = f({ hour: '2-digit', minute: '2-digit', hour12: true }).toLowerCase();
  };

  function add(product) {
    if (saved) {
      saved = null;
      drawStatus();
    }
    cart = addProduct(cart, product, { qty: bill.qty });
    const activeLine = cart.lines.find((line) => line.code === product.code && line.unit === 'unit');
    activeRowId = activeLine?.id ?? null;
    bill.qty = 1;
    q('#eb-qty').value = '1';
    drawLines();
    q('#eb-sku').value = '';
    q('#eb-sku').focus();
  }

  function openHelp(text) {
    if (closeHelp) return;
    closeHelp = openProductHelp({
      host: q('#eb-help'),
      holder: helpHolder,
      products,
      meta,
      online: navigator.onLine !== false,
      initialText: text,
      onPick: (p) => {
        closeHelp();
        add(p);
      },
      onRefresh: async () => {
        await refreshCopy(ctx); // download the latest stock, then show it
        await load();
        drawStatus();
        return { products, meta };
      },
      onClose: () => {
        closeHelp = null;
        q('#eb-sku')?.focus();
      },
    });
  }

  function newBill() {
    if (cart.lines.length && !window.confirm('Clear this bill? The items will be removed.')) return;
    saved = null;
    resetBill();
    drawStatus();
  }
  async function cancelCurrent() {
    if (!bill.heldId) return newBill();
    if (!window.confirm('Discard this held bill? It will be permanently removed.')) return;
    const id = bill.heldId;
    const result = await held.release(id);
    if (!result.ok) {
      note = result.message;
      drawStatus();
      return;
    }
    saved = null;
    note = '';
    resetBill();
    say('Held bill discarded.');
    await drawHeldCount();
    sync.syncNow().catch(() => {});
  }
  // Put every input on the screen in step with `bill`.
  function syncInputs() {
    const set = (id, v) => {
      q(id).value = v;
    };
    set('#eb-customer', bill.customer || '');
    set('#eb-qty', String(bill.qty));
    set('#eb-cdisc', String(bill.customerDiscountPct));
    set('#eb-rdisc', String(bill.receiptDiscount.value));
    set('#eb-rmode', bill.receiptDiscount.mode);
    set('#eb-adj', String(bill.adjustment));
    set('#eb-tax', String(bill.taxPct));
    set('#eb-cash', String(bill.cash));
    set('#eb-comments', bill.comments || '');
    set('#eb-more', bill.more || '');
    q('#eb-rdon').checked = bill.receiptOn;
    q('#eb-rdisc').disabled = !bill.receiptOn;
    q('#eb-rmode').disabled = !bill.receiptOn;
    const r = q(`input[name="eb-mode"][value="${bill.mode}"]`);
    if (r) r.checked = true;
  }
  function resetBill() {
    cart = emptyCart();
    activeRowId = null;
    bill = fresh();
    syncInputs();
    drawLines();
    q('#eb-sku').focus();
  }

  // ───────── fit the screen ─────────
  // The billing screen is laid out like Candela's: it takes exactly the height left in the window, the grid takes whatever is left in
  // the middle and scrolls inside itself, and the page itself never scrolls. The height is measured from where the screen starts.
  const root = document.documentElement;
  const section = q('.eb');
  const fit = () => {
    const top = section.getBoundingClientRect().top + window.scrollY;
    section.style.setProperty('--eb-top', `${Math.max(0, Math.round(top))}px`);
  };
  const setFullLabel = () => {
    const b = q('#eb-full');
    if (b) b.textContent = root.classList.contains('eb-full') ? '⛶ Exit full screen' : '⛶ Full screen';
  };
  const lockFullscreenEscape = () => {
    try {
      // Progressive enhancement: Chromium's Keyboard Lock API keeps a normal Esc
      // press inside the POS. Browsers without this API retain their native behaviour.
      return navigator.keyboard?.lock?.(['Escape', 'F11']) || Promise.resolve();
    } catch {
      return Promise.resolve();
    }
  };
  /** Enter fullscreen from the button; the explicit Exit full screen button is the normal exit path. */
  async function toggleFull() {
    const on = !root.classList.contains('eb-full');
    if (on) {
      root.classList.add('eb-full');
      try {
        // Request the lock and fullscreen in the same user gesture. Do not await
        // the lock first: requestFullscreen needs the button's transient activation.
        const lockRequest = lockFullscreenEscape();
        const fullscreenRequest = root.requestFullscreen?.();
        await Promise.allSettled([lockRequest, Promise.resolve(fullscreenRequest)]);
        if (document.fullscreenElement) await lockFullscreenEscape();
      } catch {
        /* CSS full view remains available if the browser denies fullscreen. */
      }
    } else {
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
      } catch {
        /* Keep the UI usable if the browser refuses the exit request. */
      }
      try {
        navigator.keyboard?.unlock?.();
      } catch {
        /* Keyboard Lock is an optional browser capability. */
      }
      root.classList.remove('eb-full');
    }
    setFullLabel();
    fit();
  }
  const onFullChange = () => {
    if (document.fullscreenElement) {
      lockFullscreenEscape().catch(() => {});
    } else {
      try {
        navigator.keyboard?.unlock?.();
      } catch {
        /* Keyboard Lock is an optional browser capability. */
      }
      root.classList.remove('eb-full');
    }
    setFullLabel();
    fit();
  };
  window.addEventListener('resize', fit);
  document.addEventListener('fullscreenchange', onFullChange);
  stops.push(() => {
    window.removeEventListener('resize', fit);
    document.removeEventListener('fullscreenchange', onFullChange);
    root.classList.remove('eb-full'); // leaving this page always gives the menu back
    try {
      navigator.keyboard?.unlock?.();
    } catch {
      /* Keyboard Lock is an optional browser capability. */
    }
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  });

  // ───────── held bills ─────────
  const say = (text, ms = 8000) => {
    flash = text;
    clearTimeout(flashTimer);
    if (ms) {
      flashTimer = setTimeout(() => {
        flash = '';
        drawStatus();
      }, ms);
    }
    drawStatus();
  };
  async function drawHeldCount() {
    const n = await held.count();
    const out = q('#eb-held-n');
    if (out) out.textContent = String(n);
    for (const b of el.querySelectorAll('[data-held-nav]')) b.disabled = n === 0 && navigator.onLine === false;
  }
  /** Park the bill on screen and clear it for the next customer. Works offline: the device keeps it first. */
  async function holdCurrent() {
    if (!cart.lines.length) {
      note = 'There is nothing to hold.';
      drawStatus();
      return;
    }
    const id = bill.heldId || newInvoiceId();
    const r = await held.hold({ id, state: heldState({ cart, bill, totals: totals() }) });
    if (!r.ok) {
      flash = ''; // an earlier "Bill held" message would contradict this refusal
      note = r.message;
      drawStatus();
      return;
    }
    note = '';
    saved = null;
    resetBill();
    await drawHeldCount();
    say('Bill held. Serve the next customer; open "Held" to bring it back.');
    sync.syncNow().catch(() => {}); // sends the hold to the server when there is a connection
  }
  async function resumeHeld(id) {
    if (cart.lines.length && !window.confirm('Replace the bill on the screen? Hold it first if you want to keep it.')) return;
    const r = await held.load(id);
    if (!r.ok) {
      note = r.message;
      drawStatus();
      return;
    }
    note = '';
    saved = null;
    cart = { lines: r.state.lines };
    activeRowId = null;
    bill = { ...fresh(), ...r.state.bill, invoiceId: null, heldId: id, qty: 1 };
    syncInputs();
    drawLines();
    say('Held bill brought back. Saving it will remove the hold.');
    q('#eb-sku').focus();
  }
  function openHeld(start) {
    if (closeHeld) return;
    closeHeld = openHeldBills({
      host: q('#eb-help'),
      held,
      start,
      currentId: bill.heldId,
      onResume: (id) => resumeHeld(id),
      onDeleted: (id) => {
        if (bill.heldId === id) bill.heldId = null;
        drawHeldCount();
        sync.syncNow().catch(() => {});
      },
      onClose: () => {
        closeHeld = null;
        drawHeldCount();
        q('#eb-sku')?.focus();
      },
    });
  }
  /** The bill on screen was saved: its hold (if it had one) is no longer needed. */
  function releaseCurrentHold() {
    const id = bill.heldId;
    if (!id) return;
    held.release(id).then(() => {
      drawHeldCount();
      sync.syncNow().catch(() => {});
    });
  }

  // ───────── events ─────────
  q('#eb-sku').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const text = e.target.value.trim();
    if (!text) return;
    const hit = byCode.get(text.toLowerCase());
    if (hit) return add(hit);
    openHelp(text); // not an exact code: search for it instead of guessing
    e.target.value = '';
  });
  q('[data-act="help"]').addEventListener('click', () => openHelp());
  q('#eb-full').addEventListener('click', toggleFull);
  for (const b of el.querySelectorAll('[data-act="hold"]')) b.addEventListener('click', holdCurrent);
  for (const b of el.querySelectorAll('[data-held-nav]')) b.addEventListener('click', () => openHeld(b.dataset.heldNav));
  q('#eb-save').addEventListener('click', save);
  for (const b of el.querySelectorAll('[data-act="cancel"]')) b.addEventListener('click', cancelCurrent);
  q('[data-act="new"]').addEventListener('click', newBill);
  // F5 (and F2) open Product Help from anywhere on this page. F5 would otherwise RELOAD the page and lose the bill, so it is taken here;
  // Ctrl+F5 and Shift+F5 are left alone for anyone who really wants to reload. Whatever is typed in the code box goes into the search.
  const onF2 = (e) => {
    if (!el.isConnected) return document.removeEventListener('keydown', onF2);
    if ((e.key !== 'F2' && e.key !== 'F5') || e.ctrlKey || e.shiftKey || e.metaKey || e.altKey) return;
    e.preventDefault();
    if (closeHelp) return;
    const typed = q('#eb-sku').value.trim();
    if (typed) q('#eb-sku').value = '';
    openHelp(typed || undefined);
  };
  document.addEventListener('keydown', onF2);
  stops.push(() => document.removeEventListener('keydown', onF2));
  const focusSelect = (node) => {
    if (node) {
      node.focus();
      node.select?.();
    }
  };
  const onPosKeys = (e) => {
    if (!el.isConnected) return;
    if (e.key === 'Escape' && root.classList.contains('eb-full')) {
      // Escape is never a POS command. Keyboard Lock (where supported) routes
      // it here instead of allowing the browser's ordinary fullscreen exit.
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      return;
    }
    if (e.key === 'F11') {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      if (closeHelp || closeHeld) return;
      const line = cart.lines.find((x) => x.id === activeRowId);
      if (!line || line.pack <= 1) return;
      const unit = line.unit === 'pack' ? 'unit' : 'pack';
      const product = byCode.get(String(line.code).toLowerCase());
      if (!product) return;
      cart = addProduct(removeLine(cart, line.id), product, { qty: line.qty, unit });
      const switched = cart.lines.find((x) => x.code === line.code && x.unit === unit);
      activeRowId = switched?.id || null;
      drawLines();
      focusSelect(activeRowId && q(`tr[data-id="${activeRowId}"] [data-edit="qty"]`));
      return;
    }
    if (e.key === 'F9') {
      e.preventDefault();
      e.stopPropagation();
      focusSelect((activeRowId && q(`tr[data-id="${activeRowId}"] [data-edit="qty"]`)) || q('#eb-qty'));
      return;
    }
    if (e.key === 'Delete' && activeRowId) {
      const row = e.target.closest?.('tr[data-id]');
      if (!row || e.target.matches?.('input,select,textarea,button')) return;
      e.preventDefault();
      cart = removeLine(cart, row.dataset.id);
      activeRowId = null;
      drawLines();
      q('#eb-sku').focus();
    }
  };
  const trackRow = (e) => {
    const row = e.target.closest?.('tr[data-id]');
    if (row) activeRowId = row.dataset.id;
  };
  window.addEventListener('keydown', onPosKeys, { capture: true });
  q('#eb-lines').addEventListener('focusin', trackRow);
  q('#eb-lines').addEventListener('click', trackRow);
  stops.push(() => {
    window.removeEventListener('keydown', onPosKeys, { capture: true });
    q('#eb-lines')?.removeEventListener('focusin', trackRow);
  });

  q('#eb-qty').addEventListener('input', (e) => {
    bill.qty = Number(e.target.value) > 0 ? Number(e.target.value) : 1;
  });
  q('#eb-customer').addEventListener('input', (e) => {
    bill.customer = e.target.value;
  });
  q('#eb-comments').addEventListener('input', (e) => {
    bill.comments = e.target.value;
  });
  q('#eb-more').addEventListener('input', (e) => {
    bill.more = e.target.value;
  });
  for (const r of el.querySelectorAll('input[name="eb-mode"]'))
    r.addEventListener('change', (e) => {
      bill.mode = e.target.value;
    });
  const bindNum = (id, set) =>
    q(id).addEventListener('input', () => {
      set(num(id));
      drawTotals();
    });
  bindNum('#eb-cdisc', (v) => (bill.customerDiscountPct = Math.min(Math.max(v, 0), 100)));
  bindNum('#eb-rdisc', (v) => (bill.receiptDiscount = { ...bill.receiptDiscount, value: v }));
  bindNum('#eb-tax', (v) => (bill.taxPct = v));
  bindNum('#eb-adj', (v) => (bill.adjustment = v));
  bindNum('#eb-cash', (v) => (bill.cash = v));
  q('#eb-rmode').addEventListener('change', (e) => {
    bill.receiptDiscount = { ...bill.receiptDiscount, mode: e.target.value };
    drawTotals();
  });
  q('#eb-rdon').addEventListener('change', (e) => {
    bill.receiptOn = e.target.checked;
    q('#eb-rdisc').disabled = !bill.receiptOn;
    q('#eb-rmode').disabled = !bill.receiptOn;
    drawTotals();
  });

  q('#eb-lines').addEventListener('input', (e) => {
    const edit = e.target.dataset.edit;
    const id = e.target.closest('tr')?.dataset.id;
    if (!id || (edit !== 'qty' && edit !== 'disc')) return;
    const line = cart.lines.find((l) => l.id === id);
    cart = edit === 'qty' ? setQty(cart, id, e.target.value) : setLineDiscount(cart, id, line.discount.mode, e.target.value);
    const row = cart.lines.find((l) => l.id === id);
    const lt = lineTotals(row);
    q(`[data-line-total="${id}"]`).textContent = m2(lt.total); // update in place: typing never loses focus
    q(`[data-udist="${id}"]`).textContent = m2(udist(row, lt));
    drawTotals();
  });
  q('#eb-lines').addEventListener('change', (e) => {
    const edit = e.target.dataset.edit;
    const id = e.target.closest('tr')?.dataset.id;
    if (!id) return;
    const line = cart.lines.find((l) => l.id === id);
    if (edit === 'dmode') cart = setLineDiscount(cart, id, e.target.value, line.discount.value);
    else if (edit === 'unit') {
      const p = byCode.get(String(line.code).toLowerCase());
      const without = removeLine(cart, id);
      cart = p ? addProduct(without, p, { qty: line.qty, unit: e.target.value }) : cart; // re-price for the new unit
    } else if (edit !== 'qty' && edit !== 'disc') return;
    drawLines();
  });
  q('#eb-lines').addEventListener('click', (e) => {
    const id = e.target.closest('[data-del]')?.dataset.del;
    if (!id) return;
    cart = removeLine(cart, id);
    activeRowId = null;
    drawLines();
    q('#eb-sku').focus();
  });

  // ───────── start ─────────
  tick();
  fit();
  const clockTimer = setInterval(() => {
    if (el.isConnected) return tick();
    stops.forEach((f) => f());
    clearInterval(clockTimer);
  }, 30_000);
  const onNet = () => {
    if (!el.isConnected) return;
    if (navigator.onLine === false) say('Connection lost. Carry on: nothing on the screen is lost, and bills are saved on this device.');
    else {
      say('Back online. Anything saved on this device is being uploaded.');
      sync.syncNow().catch(() => {});
    }
    drawSync();
    drawHeldCount();
  };
  window.addEventListener('online', onNet);
  window.addEventListener('offline', onNet);
  stops.push(() => {
    window.removeEventListener('online', onNet);
    window.removeEventListener('offline', onNet);
  });
  el.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-act="retry"],[data-act="syncnow"],[data-act="prep"]')?.dataset.act;
    if (!a) return;
    if (a === 'retry') await sync.retryFailed().catch(() => {});
    else if (a === 'syncnow') await sync.syncNow().catch(() => {});
    else if (a === 'prep') {
      const v = await ask(q('#eb-dialog'), {
        title: 'Prepare this device for offline billing',
        intro: 'Type your PIN once while online. Your PIN is not kept on the device, only a check of it.',
        confirm: 'Prepare',
        fields: [{ id: 'pin', label: 'PIN', type: 'password', inputmode: 'numeric', maxlength: 6, autocomplete: 'one-time-code' }],
      });
      if (v) {
        try {
          if (device.status !== 'active') await registerThisDevice();
          const r = await kit.earnGrant(v.pin);
          if (r?.ok) {
            await kit.refreshLimits();
            note = '';
          } else note = refusalText(r);
        } catch {
          note = 'Could not reach the server. Try again when you are online.';
        }
        drawStatus();
      }
    }
    drawSync();
  });
  await load();
  drawStatus();
  drawLines();
  drawSync();
  drawHeldCount();
  q('#eb-sku').focus();
  registerServiceWorker(); // lets the page open offline; nothing breaks if it is unsupported
  registerThisDevice(); // quietly, when online; the owner sees this device in Settings
  stops.push(sync.subscribe(drawSync));
  stops.push(startAutoSync(sync, { alive: () => el.isConnected })); // uploads when the connection returns, when the page is shown, and every minute while something waits
  note = await refreshCopy(ctx); // the saved copy is usable at once; the refresh happens behind it
  if (note === '') kit.refreshLimits().catch(() => {});
  await load();
  drawStatus();
  drawSync();
}
