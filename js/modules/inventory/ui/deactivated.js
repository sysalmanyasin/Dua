// Deactivated products: the ones the hourly stock file no longer lists. They are left out of audits and out of the other
// screens; their quantity is the last one seen, so it may be out of date. Read only, with a search box.
import { hero } from '../../../shared/ui.js';
import { html, render } from '../../../shared/html.js';
import { deactivatedProducts } from '../data/feed.js';
import { qty, rs } from './fmt.js';
import { emptyCard, errorCard, loadingCard } from './parts.js';

const day = (iso) => (iso ? String(iso).slice(0, 10) : '—');

export async function mount(el) {
  render(el, loadingCard('Opening Deactivated…'));
  let rows;
  try {
    rows = (await deactivatedProducts()) ?? [];
  } catch {
    return render(el, errorCard('the deactivated products'));
  }
  let text = '';

  const visible = () => {
    const q = text.trim().toLowerCase();
    return q ? rows.filter((r) => `${r.code} ${r.name} ${r.company}`.toLowerCase().includes(q)) : rows;
  };

  function drawList() {
    const box = el.querySelector('#inv-deact-list');
    if (!box) return;
    const list = visible();
    render(
      box,
      list.length === 0
        ? emptyCard(rows.length === 0 ? 'No product has been deactivated.' : 'Nothing matches.')
        : html`<p class="muted small">${list.length} of ${rows.length} products</p>
            <div class="inv-list">
              ${list.map(
                (r) =>
                  html`<div class="inv-row" data-code="${r.code}">
                    <div>
                      <strong>${r.name}</strong>
                      <span class="muted small">${r.code} · ${r.company}</span>
                      <span class="muted small"
                        >Deactivated ${day(r.deactivated_at)} · last sale ${day(r.last_sale_date)} · last received
                        ${day(r.last_receive_date)}</span
                      >
                    </div>
                    <div class="inv-qty">
                      <strong>${qty(r.qty)}</strong>
                      <span class="muted small">last known · ${rs(Number(r.qty) * Number(r.price))}</span>
                    </div>
                  </div>`,
              )}
            </div>`,
    );
  }

  render(
    el,
    html`${hero({ label: 'Inventory', title: 'Deactivated', sub: 'Products the stock file no longer lists' })}
      <section class="card">
        <p class="muted small">
          These are left out of audits and the other stock screens. The quantity shown is the last one seen before the product left the
          file, so it may not be real stock.
        </p>
        <label class="field"
          ><span>Search</span><input type="search" data-f="text" placeholder="Name, code or company" autocomplete="off"
        /></label>
      </section>
      <div id="inv-deact-list"></div>`,
  );
  el.oninput = (e) => {
    if (e.target.dataset?.f === 'text') {
      text = e.target.value;
      drawList();
    }
  };
  drawList();
}
