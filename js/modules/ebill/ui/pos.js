// Emergency POS (Phase 1): the desktop billing screen. Bill building, Product Help and the totals work now.
// Saving, holding, printing and returns arrive in later phases; their controls are shown but switched off, never faked.
// Stock comes only from this device's saved product copy and is always labelled as such.
import { html, render } from '../../../shared/html.js';
import { money } from '../../../shared/format.js';
import { addProduct, emptyCart, removeLine, setLineDiscount, setQty, stockIssue } from '../domain/cart.js';
import { billTotals, lineTotals, payment } from '../domain/calc.js';
import { emptyState } from '../domain/productFilter.js';
import { clock, readCopy, refreshCopy } from '../data/products.js';
import { openProductHelp } from './productHelp.js';

const m2 = (n) => money(n, { decimals: true });
const PAYMENT_MODES = ['Cash', 'Card', 'Credit'];
const SOON = 'Coming in a later phase';

export async function mount(el, { ctx }) {
  let products = [];
  let meta = null;
  let cart = emptyCart();
  let note = '';
  let closeHelp = null;
  const helpHolder = { state: emptyState() }; // survives closing and reopening Product Help
  const byCode = new Map();
  const bill = {
    customer: '',
    customerDiscountPct: 0,
    receiptDiscount: { mode: 'amt', value: 0 },
    adjustment: 0,
    taxPct: 0,
    cash: 0,
    mode: 'Cash',
    comments: '',
    qty: 1,
  };

  const load = async () => {
    ({ products, meta } = await readCopy(ctx));
    byCode.clear();
    for (const p of products) byCode.set(String(p.code).toLowerCase(), p);
  };

  render(
    el,
    html`<section class="card eb">
      <div class="eb-head">
        <label class="field"><span>Salesperson</span><input value="${ctx.full_name || ctx.username || ''}" readonly /></label>
        <label class="field eb-w2"><span>Customer / member</span><input id="eb-customer" autocomplete="off" placeholder="Walk-in" /></label>
        <label class="field eb-qty"
          ><span>Qty</span><input id="eb-qty" type="number" min="1" step="any" value="1" inputmode="decimal"
        /></label>
        <label class="field eb-w2"
          ><span>Product / SKU (F2 for Product Help)</span>
          <span class="eb-sku"
            ><input id="eb-sku" autocomplete="off" spellcheck="false" placeholder="Scan or type a code, then Enter" /><button
              type="button"
              class="btn"
              data-act="help"
              title="Product Help (F2)"
              aria-label="Open Product Help"
            >
              🔍
            </button></span
          ></label
        >
        <div class="eb-actions">
          <button type="button" class="btn btn-sm" disabled title="${SOON}">Hold bill</button>
          <label class="eb-check"><input type="checkbox" disabled title="${SOON}" /> Return</label>
          <input class="eb-reason" placeholder="Return reason" disabled title="${SOON}" />
        </div>
        <div class="eb-meta">
          <span><b>Receipt</b> Draft</span><span id="eb-now"></span><span id="eb-status"></span>
        </div>
      </div>
      <div id="eb-note"></div>
      <div class="eb-main">
        <div class="eb-grid">
          <div class="eb-table-wrap"><div id="eb-lines"></div></div>
        </div>
        <aside class="eb-side" aria-label="Totals and payment">
          <dl class="eb-totals">
            <div>
              <dt>Gross total</dt>
              <dd data-out="grossTotal"></dd>
            </div>
            <div>
              <dt>Customer discount %</dt>
              <dd>
                <input id="eb-cdisc" type="number" min="0" max="100" step="any" value="0" /> <span data-out="customerDiscount"></span>
              </dd>
            </div>
            <div>
              <dt>Receipt discount</dt>
              <dd>
                <select id="eb-rmode">
                  <option value="amt">Rs</option>
                  <option value="pct">%</option></select
                ><input id="eb-rdisc" type="number" min="0" step="any" value="0" /> <span data-out="receiptDiscount"></span>
              </dd>
            </div>
            <div>
              <dt>Net gross total</dt>
              <dd data-out="netGross"></dd>
            </div>
            <div>
              <dt>Tax / VAT %</dt>
              <dd><input id="eb-tax" type="number" min="0" step="any" value="0" /> <span data-out="tax"></span></dd>
            </div>
            <div>
              <dt>Adjustment (+/−)</dt>
              <dd><input id="eb-adj" type="number" step="any" value="0" /></dd>
            </div>
          </dl>
          <div class="eb-net"><span>Net total</span><strong data-out="netTotal" id="eb-net"></strong></div>
          <dl class="eb-totals">
            <div>
              <dt>Cash received</dt>
              <dd><input id="eb-cash" type="number" min="0" step="any" value="0" /></dd>
            </div>
            <div>
              <dt>Change</dt>
              <dd class="eb-change" data-out="change"></dd>
            </div>
            <div>
              <dt>Still due</dt>
              <dd data-out="due"></dd>
            </div>
          </dl>
        </aside>
      </div>
      <div class="eb-bottom">
        <button type="button" class="btn btn-sm" disabled title="${SOON}">◀ Held</button
        ><button type="button" class="btn btn-sm" disabled title="${SOON}">Held ▶</button>
        <label class="field"
          ><span>Payment mode</span
          ><select id="eb-mode">
            ${PAYMENT_MODES.map((x) => html`<option>${x}</option>`)}
          </select></label
        >
        <label class="field eb-grow"><span>Comments</span><input id="eb-comments" autocomplete="off" /></label>
        <label class="field eb-copies"><span>Copies</span><input type="number" value="1" min="1" disabled title="${SOON}" /></label>
        <label class="field"
          ><span>Receipt type</span
          ><select disabled title="${SOON}">
            <option>Customer</option>
          </select></label
        >
        <button type="button" class="btn" disabled title="${SOON}">Print</button>
        <button type="button" class="btn" disabled title="${SOON}">Search receipt</button>
        <button type="button" class="btn btn-primary" disabled title="Saving arrives in Phase 2">Save invoice</button>
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
      receiptDiscount: bill.receiptDiscount,
      adjustment: bill.adjustment,
      taxPct: bill.taxPct,
    });
  }
  function drawTotals() {
    const t = totals();
    const p = payment(t.netTotal, bill.cash);
    const out = { ...t, change: p.change, due: p.due };
    for (const node of el.querySelectorAll('[data-out]')) node.textContent = m2(out[node.dataset.out]);
  }

  function drawLines() {
    const t = totals();
    render(
      q('#eb-lines'),
      html`<table class="eb-table eb-lines">
        <thead>
          <tr>
            <th>#</th>
            <th>Code</th>
            <th>Product</th>
            <th>Generic</th>
            <th>Unit</th>
            <th class="num">Rate</th>
            <th class="num">Qty</th>
            <th>Disc</th>
            <th class="num">Line total</th>
            <th><span class="sr">Remove</span></th>
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
                    <td>${l.name}${issue ? html`<div class="eb-warn" role="status">⚠ ${issue.text}</div>` : ''}</td>
                    <td>${l.generic}</td>
                    <td>
                      <select data-edit="unit" aria-label="Unit for ${l.name}">
                        <option value="unit" ${l.unit === 'unit' ? 'selected' : ''}>Unit</option>
                        ${l.pack > 1 ? html`<option value="pack" ${l.unit === 'pack' ? 'selected' : ''}>Pack of ${l.pack}</option>` : ''}
                      </select>
                    </td>
                    <td class="num">${m2(l.rate)}</td>
                    <td class="num">
                      <input data-edit="qty" type="number" min="0" step="any" value="${l.qty}" aria-label="Quantity of ${l.name}" />
                    </td>
                    <td class="eb-disc">
                      <input
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
                    <td><button type="button" class="btn btn-sm" data-del="${l.id}" aria-label="Remove ${l.name}">✕</button></td>
                  </tr>`;
                })
              : html`<tr>
                  <td colspan="10" class="muted eb-empty">
                    No items yet. Scan or type a code and press Enter, or press F2 to search the whole list.
                  </td>
                </tr>`
          }
        </tbody>
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
    const n = q('#eb-now');
    if (n)
      n.textContent = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Karachi', dateStyle: 'medium', timeStyle: 'short' }).format(
        new Date(),
      );
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
  q('#eb-mode').addEventListener('change', (e) => {
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

  q('#eb-lines').addEventListener('input', (e) => {
    const edit = e.target.dataset.edit;
    const id = e.target.closest('tr')?.dataset.id;
    if (!id || (edit !== 'qty' && edit !== 'disc')) return;
    const line = cart.lines.find((l) => l.id === id);
    cart = edit === 'qty' ? setQty(cart, id, e.target.value) : setLineDiscount(cart, id, line.discount.mode, e.target.value);
    const row = cart.lines.find((l) => l.id === id);
    q(`[data-line-total="${id}"]`).textContent = m2(lineTotals(row).total); // update in place: typing never loses focus
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
