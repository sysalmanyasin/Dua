// The Cover: a calm landing page with the day's key numbers, what needs doing, and everything you can open.
import { html, render } from '../../../shared/html.js';
import { icon } from '../../../shared/icons.js';
import { longDate, money, monthLabel, signed, todayPkt } from '../../../shared/format.js';
import { hero } from '../../../shared/ui.js';
import { BRAND } from '../../../core/config.js';
import { coverSummary, inventoryCover, notificationsAttention } from '../data/api.js';
import { buildAttention, buildKpis, buildStockCards, buildTiles, greeting, hourInPkt } from '../domain/cover.js';

const arrow = (v) => (v === null ? '' : `${v >= 0 ? '▲' : '▼'} ${Math.abs(v).toFixed(1)}%`);
const tone = (v) => (v > 0 ? 'pos' : v < 0 ? 'neg' : '');

function kpiBody(k) {
  switch (k.id) {
    case 'latest':
      return html`<strong class="kv">₨ ${money(k.value)}</strong
        ><span class="ks">${longDate(k.date)}</span
        >${k.diff === null ? '' : html`<span class="kchip ${tone(k.diff)}">${signed(k.diff)} vs COMP</span>`}`;
    case 'mtd':
      return html`<strong class="kv">₨ ${money(k.value)}</strong
        ><span class="ks">${monthLabel(k.month)} · ${k.days} day${k.days === 1 ? '' : 's'}</span
        >${k.vsLastYear === null ? '' : html`<span class="kchip ${tone(k.vsLastYear)}">${arrow(k.vsLastYear)} vs same days last year</span>`}`;
    case 'target':
      return html`<strong class="kv">${k.pct}%</strong><span class="ks">of ₨ ${money(k.target)}</span>
        <div class="kpbar"><div class="kpfill ${k.pct >= 100 ? 'g' : k.pct >= 75 ? 'a' : 'r'}" data-w="${k.pct}"></div></div>
        <span class="ks">₨ ${money(k.remaining)} to go</span>`;
    default:
      return html`<strong class="kv">${money(k.value)}</strong><span class="ks">${longDate(k.date)}</span>`;
  }
}

function stockCard(c) {
  const lead = c.count === undefined ? '' : html`<span class="ks">${money(c.count)} product${c.count === 1 ? '' : 's'}</span>`;
  return html`<a class="kpi" href="${c.href}"
    ><span class="kl">${c.label}</span><strong class="kv">₨ ${money(c.value)}</strong>${lead}<span class="ks">${c.sub}</span></a
  >`;
}

function kpiCard(k) {
  const inner = html`<span class="kl">${k.label}</span>${kpiBody(k)}`;
  return k.href ? html`<a class="kpi" href="${k.href}">${inner}</a>` : html`<div class="kpi">${inner}</div>`;
}

export async function mount(el, { ctx, modules = [] }) {
  const first = ctx.full_name.split(' ')[0];
  const hour = hourInPkt();
  const head = hero({ label: `${BRAND.title} · ${BRAND.branch}`, title: `${greeting(hour)}, ${first}`, sub: longDate(todayPkt()) });
  const tiles = buildTiles(modules);

  render(
    el,
    html`${head}
      <section class="kpis" aria-busy="true">
        <div class="kpi skel"></div>
        <div class="kpi skel"></div>
        <div class="kpi skel"></div>
      </section>`,
  );

  // Started now so the stock call runs alongside the sales call instead of after it.
  const stockPromise = ctx.permissions.includes('inventory.view') ? inventoryCover().catch(() => null) : Promise.resolve(null);
  let summary = null;
  let failed = false;
  try {
    summary = await coverSummary();
  } catch {
    failed = true;
  }
  // Owner alerts are separate and optional: if they cannot load, the rest of the Cover is unaffected.
  let alerts = null;
  if (ctx.permissions.includes('notifications.view')) {
    try {
      alerts = await notificationsAttention();
    } catch {
      alerts = null;
    }
  }
  // Stock numbers are separate and optional too: only for people who may view inventory, and a failure leaves them out.
  const stock = buildStockCards(await stockPromise);
  const kpis = buildKpis(summary);
  const todo = buildAttention(summary, ctx.permissions, hour, alerts);

  render(
    el,
    html`${head} ${failed ? html`<p class="note note-error">Today's numbers could not be loaded. The rest of the app still works.</p>` : ''}
      ${kpis.length ? html`<section class="kpis" aria-label="Key numbers">${kpis.map(kpiCard)}</section>` : ''}
      ${
        stock.length
          ? html`<h2 class="sec-label">Stock</h2>
              <section class="kpis" aria-label="Stock numbers">${stock.map(stockCard)}</section>`
          : ''
      }
      ${
        summary
          ? html`<section class="card">
              <h2>Needs attention</h2>
              ${todo.length === 0 ? html`<p class="ok-line">✓ You are all caught up.</p>` : todo.map((t) => html`<div class="todo"><span>${t.text}</span>${t.action ? html`<a class="btn btn-sm" href="${t.action.href}" ${t.action.handoff ? html`data-handoff="${t.action.handoff}"` : ''}>${t.action.label}</a>` : ''}</div>`)}
            </section>`
          : ''
      }
      <section class="tiles-group">
        <h2 class="sec-label">Open</h2>
        <div class="tiles">
          ${tiles.map(
            (g) =>
              html`<a class="tile" href="${g.pages[0].href}"
                ><span class="tile-ic">${icon(g.icon)}</span><span class="tile-t">${g.title}</span
                ><span class="tile-d">${g.blurb || g.pages[0].desc}</span></a
              >`,
          )}
        </div>
      </section>
      <p class="small muted center">${ctx.username} · ${ctx.permissions.length} permission${ctx.permissions.length === 1 ? '' : 's'}</p>`,
  );

  el.querySelectorAll('.kpfill[data-w]').forEach((b) => (b.style.width = `${b.dataset.w}%`));
  // "Add entry" for a missed day opens the entry page on that day.
  el.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-handoff]');
    if (a) sessionStorage.setItem('sales.entry.date', a.dataset.handoff);
  });
}
