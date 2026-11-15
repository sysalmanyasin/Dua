// Emergency POS: the desktop billing screen, laid out like the Candela "Sale and Return" screen the cashiers already know
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

const m2 = (n) => money(n, { decimals: true });
const PAYMENT_MODES = ['Cash', 'Credit', 'Card'];
const RECEIPT_TYPES = ['Primary Receipt', 'Gift Receipt', 'Summary Receipt', 'Secondary Receipt'];
const SOON = 'Coming in a later phase';

export async function mount(el, { ctx }) {
  let products = [];
  let meta = null;
  let cart = emptyCart();
  let note = '';
  let closeHelp = null;
  const helpHolder = { state: emptyState() }; // survives closing and reopening Product Help
  const byCode = new Map();
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
  });
  let bill = fresh();

  const load = async () => {
    ({ products, meta } = await readCopy(ctx));
    byCode.clear();
    for (const p of products) byCode.set(String(p.code).toLowerCase(), p);
  };

  render(
    el,
    html`<section class="eb">
      <div class="eb-titlebar">
        <span class="eb-tab">Sale and Return</span>
        <span class="eb-title">${BRAND.title} · Emergency POS</span>
        <span class="eb-grow"></span>
        <span id="eb-status" class="eb-status"></span>
      </div>
      <div id="eb-note"></div>

      <div class="eb-top">
        <div class="eb-row">
          <div class="eb-group">
            <span class="eb-lbl">Sale person</span>
            <input class="eb-code" value="${ctx.username || ''}" readonly aria-label="Salesperson code" />
            <input class="eb-wide" id="eb-sp-name" value="${ctx.full_name || ctx.username || ''}" readonly aria-label="Salesperson" />
          </div>
          <div class="eb-group eb-grow">
            <span class="eb-lbl">Customer / member</span>
            <input class="eb-code" disabled title="${SOON}" aria-label="Customer code" />
            <button type="button" class="btn btn-sm" disabled title="${SOON}" aria-label="Add customer">+</button>
            <input class="eb-wide eb-grow" id="eb-customer" autocomplete="off" placeholder="Walk-in" aria-label="Customer name" />
            <output class="eb-bal" title="Customer balance">0.00</output>
          </div>
        </div>
        <div class="eb-row">
          <div class="eb-group">
            <span class="eb-lbl">Qty / product (SKU)</span>
            <input class="eb-qtyin" id="eb-qty" type="number" min="1" step="any" value="1" inputmode="decimal" aria-label="Quantity" />
            <input
              class="eb-sku"
              id="eb-sku"
              autocomplete="off"
              spellcheck="false"
              placeholder="Scan or type a code, then Enter (F2: Product Help)"
              aria-label="Product code"
            />
            <button type="button" class="btn" data-act="help" title="Product Help (F2)" aria-label="Open Product Help">🔍</button>
          </div>
          <label class="eb-check"><input type="checkbox" disabled title="${SOON}" /> Hold</label>
          <button type="button" class="btn btn-sm" disabled title="${SOON}">Return</button>
          <button type="button" class="btn btn-sm" disabled title="${SOON}">Reason</button>
          <div class="eb-group">
            <span class="eb-lbl">Receipt #</span><input class="eb-code" value="Draft" readonly aria-label="Receipt number" />
          </div>
          <div class="eb-group">
            <span class="eb-lbl">Date / time</span><input class="eb-date" id="eb-date" readonly aria-label="Date" /><input
              class="eb-time"
              id="eb-time"
              readonly
              aria-label="Time"
            />
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
          <span class="eb-lbl">Receipt holding [0 / 6]</span>
          <div class="eb-navs">
            <button type="button" class="btn btn-sm" disabled title="${SOON}" aria-label="First held bill">«</button
            ><button type="button" class="btn btn-sm" disabled title="${SOON}" aria-label="Previous held bill">‹</button
            ><button type="button" class="btn btn-sm" disabled title="${SOON}" aria-label="Next held bill">›</button
            ><button type="button" class="btn btn-sm" disabled title="${SOON}" aria-label="Last held bill">»</button>
          </div>
          <div class="eb-navs">
            <button type="button" class="btn btn-sm" disabled title="${SOON}">Hold</button
            ><button type="button" class="btn btn-sm" data-act="cancel" title="Clear this bill">Cancel</button>
          </div>
        </div>
        <fieldset class="eb-pay">
          <legend>Payment mode</legend>
          ${PAYMENT_MODES.map((x) => html`<label class="eb-check"><input type="radio" name="eb-mode" value="${x}" ${x === 'Cash' ? 'checked' : ''} /> ${x}</label>`)}
        </fieldset>
        <label class="eb-area"><span class="eb-lbl">Comments</span><textarea id="eb-comments" rows="3"></textarea></label>
        <label class="eb-area"><span class="eb-lbl">Additional comments</span><textarea id="eb-more" rows="3"></textarea></label>
        <div class="eb-print">
          <label class="eb-check"><input type="checkbox" checked disabled title="${SOON}" /> Print receipt</label>
          <label class="eb-copies"><span>No. of copies</span><input type="number" value="1" min="1" disabled title="${SOON}" /></label>
          <button type="button" class="btn btn-sm" disabled title="${SOON}">Search receipt</button>
        </div>
        <div class="eb-rtype">
          <label class="eb-lbl" for="eb-rtype">Receipt type</label>
          <select id="eb-rtype" disabled title="${SOON}">
            ${RECEIPT_TYPES.map((x) => html`<option>${x}</option>`)}
          </select>
        </div>
      </div>
      <div class="eb-toolbar">
        <button type="button" class="btn" data-act="new" title="New bill">＋ New</button>
        <button type="button" class="btn btn-primary" disabled title="Saving arrives in Phase 2">💾 Save invoice</button>
        <button type="button" class="btn" disabled title="Managers only, later phase">✎ Edit</button>
        <button type="button" class="btn" data-act="cancel" title="Clear this bill">⃠ Cancel</button>
      </div>
      <div id="eb-help"></div>
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
                  return html`<tr data-id="${l.id}">
                    <td>${i + 1}</td>
                    <td>${l.code}</td>
                    <td>
                      ${l.name}${l.generic ? html`<div class="eb-sub">${l.generic}</div>` : ''}${issue ? html`<div class="eb-warn" role="status">⚠ ${issue.text}</div>` : ''}
                    </td>
                    <td>
                      <select data-edit="unit" aria-label="Unit for ${l.name}">
                        <option value="unit" ${l.unit === 'unit' ? 'selected' : ''}>Single</option>
                        ${l.pack > 1 ? html`<option value="pack" ${l.unit === 'pack' ? 'selected' : ''}>Pack of ${l.pack}</option>` : ''}
                      </select>
                    </td>
                    <td class="num">${m2(l.rate)}</td>
                    <td class="num">
                      <input
                        class="eb-edit"
                        data-edit="qty"
                        type="number"
                        min="0"
                        step="any"
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
                    <td><button type="button" class="eb-del" data-del="${l.id}" aria-label="Remove ${l.name}">Delete</button></td>
                  </tr>`;
                })
              : html`<tr>
                  <td colspan="10" class="muted eb-empty">
                    No items yet. Scan or type a code and press Enter, or press F2 to search the whole list.
                  </td>
                </tr>`
          }
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
  }

  function drawStatus() {
    const online = navigator.onLine !== false;
    render(
      q('#eb-status'),
      html`<span class="pill ${online ? '' : 'eb-pill-off'}">${online ? 'Online' : 'Offline'}</span>
        <span class="muted"
          >Stock copy: ${meta?.syncedAt ? `updated ${clock(meta.syncedAt)} (saved on this device, not live)` : 'none yet'}</span
        >`,
    );
    render(
      q('#eb-note'),
      html`${note === 'offline' ? html`<p class="note note-info" role="status">Offline. Using the product copy saved on this device${meta?.syncedAt ? `, updated ${clock(meta.syncedAt)}` : ''}. Stock shown may be out of date.</p>` : ''}
      ${note && note !== 'offline' ? html`<p class="note note-error" role="status">${note}</p>` : ''}
      ${!products.length ? html`<p class="note note-info" role="status">No product copy on this device yet. Connect to the internet once so it can download.</p>` : ''}`,
    );
  }
  const tick = () => {
    const d = new Date();
    const f = (opts) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Karachi', ...opts }).format(d);
    if (q('#eb-date')) q('#eb-date').value = f({ day: '2-digit', month: 'short', year: 'numeric' });
    if (q('#eb-time')) q('#eb-time').value = f({ hour: '2-digit', minute: '2-digit', hour12: true }).toLowerCase();
  };

  function add(product) {
    cart = addProduct(cart, product, { qty: bill.qty });
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
      onClose: () => {
        closeHelp = null;
        q('#eb-sku')?.focus();
      },
    });
  }

  function newBill() {
    if (cart.lines.length && !window.confirm('Clear this bill? The items will be removed.')) return;
    cart = emptyCart();
    bill = fresh();
    const set = (id, v) => {
      q(id).value = v;
    };
    set('#eb-customer', '');
    set('#eb-qty', '1');
    set('#eb-cdisc', '0');
    set('#eb-rdisc', '0');
    set('#eb-adj', '0');
    set('#eb-tax', '0');
    set('#eb-cash', '0');
    set('#eb-comments', '');
    set('#eb-more', '');
    set('#eb-rmode', 'amt');
    q('#eb-rdon').checked = false;
    q('#eb-rdisc').disabled = true;
    q('#eb-rmode').disabled = true;
    q('input[name="eb-mode"][value="Cash"]').checked = true;
    drawLines();
    q('#eb-sku').focus();
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
  for (const b of el.querySelectorAll('[data-act="cancel"]')) b.addEventListener('click', newBill);
  q('[data-act="new"]').addEventListener('click', newBill);
  const onF2 = (e) => {
    if (!el.isConnected) return document.removeEventListener('keydown', onF2);
    if (e.key === 'F2') {
      e.preventDefault();
      openHelp();
    }
  };
  document.addEventListener('keydown', onF2);

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
    drawLines();
    q('#eb-sku').focus();
  });

  // ───────── start ─────────
  tick();
  setInterval(() => (el.isConnected ? tick() : null), 30_000);
  window.addEventListener('online', () => el.isConnected && drawStatus());
  window.addEventListener('offline', () => el.isConnected && drawStatus());
  await load();
  drawStatus();
  drawLines();
  q('#eb-sku').focus();
  note = await refreshCopy(ctx); // the saved copy is usable at once; the refresh happens behind it
  await load();
  drawStatus();
}
