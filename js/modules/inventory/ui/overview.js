// Overview: find a product and see its stock. Everything here reads the copy kept on this phone, so typing is instant
// and costs no data. The copy is refreshed when this screen opens, when the tab returns after 15 minutes, and on "Refresh".
import { hero } from '../../../shared/ui.js';
import { money } from '../../../shared/format.js';
import { html, render } from '../../../shared/html.js';
import { localMirror, refreshOnReturn, syncFor } from '../data/local.js';
import { joinProducts } from '../domain/join.js';
import { filterAndRank, SEARCH_FIELDS } from '../domain/search.js';
import { downRound } from '../domain/stockMath.js';
import { emptyCard, errorCard, loadingCard } from './parts.js';

const PAGE = 100; // rows shown at once; "Show more" adds another page
const qty = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
const clock = (iso) =>
  new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Karachi', hour: '2-digit', minute: '2-digit', hour12: true })
    .format(new Date(iso))
    .toLowerCase();

export async function mount(el, { ctx }) {
  const canSales = ctx.permissions.includes('inventory.view');
  const mirror = localMirror();
  let products = [];
  let meta = null;
  let query = '';
  let shown = PAGE;
  let busy = false;
  let note = ''; // 'offline' | error text | ''

  render(el, loadingCard('Opening the product list…'));
  await mirror.forgetIfNotMine(ctx.user_id); // a copy left by someone else on this phone is removed before anything is shown

  const readLocal = async () => {
    const r = await mirror.read();
    meta = r.meta;
    products = joinProducts(r.stock, r.sales);
  };

  async function refresh() {
    if (busy) return;
    busy = true;
    note = '';
    drawStatus();
    try {
      const r = await syncFor(ctx);
      if (r.status === 'offline') note = 'offline';
      await readLocal();
    } catch (e) {
      note = e?.code === '42501' ? 'You no longer have access to the product list.' : 'Could not refresh. Showing the copy on this phone.';
      await readLocal();
    }
    busy = false;
    drawStatus();
    drawResults();
  }

  function skeleton() {
    render(
      el,
      html`${hero({ label: 'Inventory', title: 'Overview', sub: 'Find a product and see its stock' })}
        <section class="card inv-top">
          <div id="inv-status"></div>
          <label class="field">
            <span>Search</span>
            <input
              id="inv-q"
              type="search"
              inputmode="search"
              autocomplete="off"
              autocapitalize="none"
              spellcheck="false"
              placeholder="Name, code, generic, company or supplier"
              value="${query}"
            />
          </label>
        </section>
        <div id="inv-results"></div>`,
    );
  }

  function drawStatus() {
    const box = el.querySelector('#inv-status');
    if (!box) return;
    const count = products.length;
    const value = canSales ? products.reduce((s, p) => s + (p.qty > 0 ? p.qty * p.price : 0), 0) : null;
    render(
      box,
      html`<div class="inv-status">
          <div>
            <strong>${count ? `${qty(count)} products` : 'No products yet'}</strong>
            <span class="muted"
              >${meta?.syncedAt ? ` · as of ${clock(meta.syncedAt)}` : ''}${value === null ? '' : ` · stock worth ${money(Math.round(value))}`}</span
            >
          </div>
          <button type="button" class="btn btn-sm" data-act="refresh" ${busy ? 'disabled' : ''}>${busy ? 'Updating…' : 'Refresh'}</button>
        </div>
        ${note === 'offline' ? html`<p class="note note-info" role="status">Offline. Showing the copy from ${meta?.syncedAt ? clock(meta.syncedAt) : 'earlier'}.</p>` : ''}
        ${note && note !== 'offline' ? html`<p class="note note-error" role="status">${note}</p>` : ''}`,
    );
  }

  function row(p) {
    const { packs, loose } = downRound(p.qty, p.pack);
    const packText =
      p.pack > 1 && p.qty > 0
        ? ` · ${qty(packs)} pack${packs === 1 ? '' : 's'}${loose ? ` + ${qty(loose)}` : ''} (pack of ${qty(p.pack)})`
        : '';
    return html`<li class="inv-row">
      <div class="inv-main">
        <strong>${p.name}</strong>
        <span class="muted">${p.code}${p.company ? ` · ${p.company}` : ''}${p.supplier ? ` · ${p.supplier}` : ''}</span>
        <span class="muted">${money(p.price)} each${packText}</span>
        ${canSales ? html`<span class="muted">Sold: ${qty(p.n30 ?? 0)} in 30 days · ${qty(p.n90 ?? 0)} in 90 days</span>` : ''}
      </div>
      <div class="inv-qty ${p.qty < 0 ? 'neg' : p.qty === 0 ? 'zero' : ''}"><b>${qty(p.qty)}</b><span>in stock</span></div>
    </li>`;
  }

  function drawResults() {
    const box = el.querySelector('#inv-results');
    if (!box) return;
    if (!products.length) {
      render(box, meta === null && !busy ? emptyCard('No stock data has been synced yet. Check back after the next hourly sync.') : html``);
      return;
    }
    const q = query.trim();
    if (!q) {
      render(box, html`<p class="muted inv-hint">Type a name, code, generic, company or supplier to see stock.</p>`);
      return;
    }
    const found = filterAndRank(products, q, SEARCH_FIELDS);
    const list = found.slice(0, shown);
    render(
      box,
      found.length
        ? html`<p class="muted inv-hint">
              ${qty(found.length)} found${found.length > list.length ? `, showing the best ${qty(list.length)}` : ''}
            </p>
            <ul class="inv-list">
              ${list.map(row)}
            </ul>
            ${found.length > list.length ? html`<button type="button" class="btn" data-act="more">Show more</button>` : ''}`
        : html`<p class="muted inv-hint">Nothing matches “${q}”.</p>`,
    );
  }

  el.addEventListener('input', (e) => {
    if (e.target.id !== 'inv-q') return;
    query = e.target.value;
    shown = PAGE;
    drawResults();
  });
  el.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'refresh') refresh();
    if (act === 'more') {
      shown += PAGE;
      drawResults();
    }
  });
  refreshOnReturn(ctx, {
    alive: () => el.isConnected,
    onUpdated: async () => {
      await readLocal();
      drawStatus();
      drawResults();
    },
  });

  // First paint: whatever is already on the phone, then bring it up to date.
  try {
    await readLocal();
  } catch {
    return render(el, errorCard('the product list'));
  }
  skeleton();
  drawStatus();
  drawResults();
  await refresh();
}
