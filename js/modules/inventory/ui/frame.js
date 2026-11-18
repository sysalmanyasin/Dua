// The frame every report screen sits in: title, "as of" line with a Refresh button, offline and revoked-access notes, and
// the data refresh rules (on open, on tab return after 15 minutes, by hand). A screen supplies `build(body, api)`:
//   api.state()        { rows, meta, ctx, canSales, hasSales }  rows = stock and sales halves joined
//   api.onData(fn)     called after every refresh with the new state; a screen redraws its results there
//   api.empty()        what to show when there are no products (still loading, or nothing synced yet)
import { hero } from '../../../shared/ui.js';
import { html, render } from '../../../shared/html.js';
import { localMirror, refreshOnReturn, syncFor } from '../data/local.js';
import { joinProducts } from '../domain/join.js';
import { clock } from './fmt.js';
import { emptyCard, errorCard, loadingCard } from './parts.js';

export async function openReport(el, ctx, { label = 'Inventory', title, sub, needsSales = true, build }) {
  const mirror = localMirror();
  const st = { rows: [], meta: null, ctx, canSales: ctx.permissions.includes('inventory.view'), hasSales: false };
  let busy = false;
  let note = '';
  const listeners = [];

  render(el, loadingCard(`Opening ${title}…`));
  if (needsSales && !st.canSales) {
    return render(el, emptyCard('This report needs permission to see sales figures. Ask the owner.'));
  }
  await mirror.forgetIfNotMine(ctx.user_id); // another person's copy on this phone is removed before anything is shown

  const readLocal = async () => {
    const r = await mirror.read();
    st.meta = r.meta;
    st.hasSales = !!r.sales;
    st.rows = joinProducts(r.stock, r.sales);
  };
  const notify = async () => {
    for (const fn of listeners) {
      try {
        await fn(st);
      } catch {
        /* one screen's extra data failing must not break the others */
      }
    }
  };

  function drawStatus() {
    const box = el.querySelector('#inv-status');
    if (!box) return;
    render(
      box,
      html`<div class="inv-status">
          <div>
            <strong>${st.rows.length ? `${st.rows.length.toLocaleString('en-US')} products` : 'No products yet'}</strong>
            <span class="muted">${st.meta?.syncedAt ? ` · as of ${clock(st.meta.syncedAt)}` : ''}</span>
          </div>
          <button type="button" class="btn btn-sm" data-act="refresh" ${busy ? 'disabled' : ''}>${busy ? 'Updating…' : 'Refresh'}</button>
        </div>
        ${note === 'offline' ? html`<p class="note note-info" role="status">Offline. Showing the copy from ${st.meta?.syncedAt ? clock(st.meta.syncedAt) : 'earlier'}.</p>` : ''}
        ${note && note !== 'offline' ? html`<p class="note note-error" role="status">${note}</p>` : ''}`,
    );
  }

  async function refresh() {
    if (busy) return;
    busy = true;
    note = '';
    drawStatus();
    try {
      const r = await syncFor(ctx);
      if (r.status === 'offline') note = 'offline';
    } catch (e) {
      note = e?.code === '42501' ? 'You no longer have access to the product list.' : 'Could not refresh. Showing the copy on this phone.';
    }
    try {
      await readLocal();
    } catch {
      /* keep what is on screen */
    }
    busy = false;
    drawStatus();
    await notify();
  }

  const api = {
    state: () => st,
    onData: (fn) => listeners.push(fn),
    refresh,
    busy: () => busy,
    empty: () =>
      busy
        ? loadingCard('Loading the product list (first time only)…')
        : emptyCard('No stock data has been synced yet. Check back after the next hourly sync.'),
  };

  try {
    await readLocal();
  } catch {
    return render(el, errorCard(title));
  }
  render(
    el,
    html`${hero({ label, title, sub })}
      <section class="card inv-top"><div id="inv-status"></div></section>
      <div id="inv-body"></div>`,
  );
  drawStatus();
  el.addEventListener('click', (e) => {
    if (e.target.closest('[data-act="refresh"]')) refresh();
  });
  refreshOnReturn(ctx, {
    alive: () => el.isConnected,
    onUpdated: async () => {
      await readLocal();
      drawStatus();
      await notify();
    },
  });
  await build(el.querySelector('#inv-body'), api);
  await refresh();
}
