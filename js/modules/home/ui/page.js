// Dua Home 3.0 — a quiet, scannable overview. Navigation lives in the application shell.
// Order: what needs doing first (attention / my day), then the numbers, then things to read later (folded).
import { html, render } from '../../../shared/html.js';
import { longDate, money, monthLabel, signed, todayPkt } from '../../../shared/format.js';
import { coverSummary, inventoryCover, notificationsAttention } from '../data/api.js';
import { startOpsSections } from './ops.js';
import { startClosingSummary } from './closing-summary.js';
import { startStaffSections } from './staff.js';
import { startMessages } from './messages.js';
import { startTaskSections } from './tasks.js';
import { buildAttention, buildKpis, buildStockCards, buildTiles, greeting, hourInPkt } from '../domain/cover.js';

const arrow = (value) => (value === null ? '' : `${value >= 0 ? '▲' : '▼'} ${Math.abs(value).toFixed(1)}%`);
const tone = (value) => (value > 0 ? 'pos' : value < 0 ? 'neg' : '');

function kpiBody(kpi) {
  switch (kpi.id) {
    case 'latest':
      return html`<strong class="kv">₨ ${money(kpi.value)}</strong
        ><span class="ks">${longDate(kpi.date)}</span>
        ${kpi.diff === null ? '' : html`<span class="kchip ${tone(kpi.diff)}">${signed(kpi.diff)} vs COMP</span>`}`;
    case 'mtd':
      return html`<strong class="kv">₨ ${money(kpi.value)}</strong
        ><span class="ks">${monthLabel(kpi.month)} · ${kpi.days} day${kpi.days === 1 ? '' : 's'}</span>
        ${kpi.vsLastYear === null ? '' : html`<span class="kchip ${tone(kpi.vsLastYear)}">${arrow(kpi.vsLastYear)} vs same days last year</span>`}
        ${
          kpi.goal
            ? html`<div class="kpbar">
                  <div class="kpfill ${kpi.goal.pct >= 100 ? 'g' : kpi.goal.pct >= 75 ? 'a' : 'r'}" data-w="${kpi.goal.pct}"></div>
                </div>
                <span class="ks">${kpi.goal.pct}% of ₨ ${money(kpi.goal.target)} target · ₨ ${money(kpi.goal.remaining)} to go</span>`
            : ''
        }`;
    default:
      return html`<strong class="kv">${money(kpi.value)}</strong><span class="ks">${longDate(kpi.date)}</span>`;
  }
}

function kpiCard(kpi) {
  const inner = html`<span class="kl">${kpi.label}</span>${kpiBody(kpi)}`;
  return kpi.href
    ? html`<a class="kpi kpi-${kpi.id}" href="${kpi.href}">${inner}</a>`
    : html`<div class="kpi kpi-${kpi.id}">${inner}</div>`;
}

const stockChip = (card) =>
  html`<a class="home-stock-chip s-${card.id}" href="${card.href}">
    <span class="kl">${card.label}</span>
    <strong>₨ ${money(card.value)}</strong>
    <small>${card.count === undefined ? '' : `${money(card.count)} product${card.count === 1 ? '' : 's'} · `}${card.sub}</small>
  </a>`;

// A collapsed section for things people read now and then (the section inside draws itself and hides itself when it has nothing).
const fold = (title, id) =>
  html`<details class="home-fold">
    <summary>${title}</summary>
    <div id="${id}"></div>
  </details>`;

const safeRead = (key) => {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
  } catch {
    return [];
  }
};

const safeWrite = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Personal shortcuts are optional and must never block Home.
  }
};

export async function mount(el, { ctx, modules = [] }) {
  const perms = Array.isArray(ctx.permissions) ? ctx.permissions : [];
  const first = String(ctx.full_name ?? ctx.username ?? 'there')
    .trim()
    .split(/\s+/)[0];
  const hour = hourInPkt();
  const tiles = buildTiles(modules);
  const allPages = tiles.flatMap((group) => group.pages.map((page) => ({ ...page, module: group.title })));
  const validHrefs = new Set(allPages.map((page) => page.href));
  const prefKey = `dua.home.favourites.${String(ctx.username ?? 'user')}`;
  let favourites = safeRead(prefKey).filter((href) => validHrefs.has(href));

  const head = html`<header class="home-top">
      <div>
        <h1>${greeting(hour)}, ${first}</h1>
        <p>${longDate(todayPkt())}</p>
      </div>
      <button class="home-refresh" type="button" data-home-refresh title="Refresh everything">↻ Refresh</button>
    </header>
    <nav id="home-favourites" class="home-favs" aria-label="Favourites" hidden></nav>`;

  render(
    el,
    html`${head}
      <section class="home-loading" aria-live="polite">
        <span class="sr-only">Loading your overview…</span>
        <div class="home-skeletons" aria-hidden="true">
          <span class="home-skel"></span><span class="home-skel"></span><span class="home-skel"></span>
        </div>
      </section>`,
  );

  // Everything the page needs up front loads at the same time; one slow part no longer delays the rest.
  let failed = false;
  const [summary, alerts, stockData] = await Promise.all([
    coverSummary().catch(() => {
      failed = true;
      return null;
    }),
    perms.includes('notifications.view') ? notificationsAttention().catch(() => null) : null,
    perms.includes('inventory.view') ? inventoryCover().catch(() => null) : null,
  ]);

  const stock = buildStockCards(stockData);
  const showOps = perms.includes('ops.view'); // Owner only: Action Centre, Business Intelligence and Recent Activity
  const showStaff = !showOps && (perms.includes('payroll.view_own') || perms.includes('closing.enter_own')); // own payroll and own work, read only
  const showMyTasks = !showOps && perms.includes('tasks.view_own'); // My Work Snapshot and My Tasks (Task Master)
  const showMessages = perms.includes('ntf.view_own'); // Inbox (Stage 4)
  const showTeam = showOps && perms.includes('tasks.manage'); // Owner: Staff & Team
  const allKpis = buildKpis(summary, perms);
  const goal = allKpis.find((k) => k.id === 'target');
  const kpis = allKpis.filter((k) => k.id !== 'target').map((k) => (k.id === 'mtd' && goal ? { ...k, goal } : k));
  const attention = buildAttention(summary, perms, hour, alerts);
  const hasAttentionContext = Boolean(summary?.sales || summary?.checklist || alerts);
  const n = attention.length;

  // One "Needs attention" block. For the owner the Action Centre is drawn inside it, so there is a single list of things to do.
  const priority =
    showOps || hasAttentionContext
      ? html`<section class="home-section home-priority" aria-label="Needs attention">
          <div class="home-section-head">
            <h2>Needs attention</h2>
            ${
              showOps
                ? n
                  ? html`<span class="home-count is-warn">${n} item${n === 1 ? '' : 's'}</span>`
                  : ''
                : html`<span class="home-count ${n ? 'is-warn' : 'is-ok'}">${n ? `${n} item${n === 1 ? '' : 's'}` : 'All clear'}</span>`
            }
          </div>
          ${
            n
              ? html`<div class="home-attention-list">
                  ${attention.map(
                    (item) =>
                      html`<div class="home-attention-row">
                        <span class="home-attention-dot"></span>
                        <span>${item.text}</span>
                        ${
                          item.action
                            ? html`<a
                                class="btn btn-sm"
                                href="${item.action.href}"
                                ${item.action.handoff ? html`data-handoff="${item.action.handoff}"` : ''}
                                >${item.action.label}</a
                              >`
                            : ''
                        }
                      </div>`,
                  )}
                </div>`
              : showOps
                ? ''
                : html`<p class="home-clear">✓ No outstanding items were reported.</p>`
          }
          ${showOps ? html`<div id="home-ops-actions"></div>` : ''}
        </section>`
      : '';

  const numbers = kpis.length
    ? html`<section class="home-section" aria-label="Business snapshot">
        <div class="kpis home-kpis">${kpis.map(kpiCard)}</div>
      </section>`
    : '';

  const stockRow = stock.length
    ? html`<section class="home-section" aria-label="Stock">
        <div class="home-stock">${stock.map(stockChip)}</div>
      </section>`
    : '';

  const messages = showMessages ? html`<div id="home-messages"></div>` : '';

  const ownerBody = html`${priority}${numbers}${stockRow}
    <div id="home-closing-summary"></div>
    <div id="home-ops-bi"></div>
    ${messages}${showTeam ? html`<div id="home-team"></div>` : ''}${fold('Recent activity', 'home-ops-activity')}`;

  const staffBody = html`${showMyTasks ? html`<div id="home-staff-work"></div>` : ''}${priority}${numbers}${stockRow}${messages}
  ${showStaff ? html`${fold('My recent activity', 'home-staff-activity')}${fold('My payroll (private)', 'home-staff-pay')}` : ''}`;

  render(
    el,
    html`${head}
    ${failed ? html`<p class="note note-error" role="status">Business figures could not be loaded. Your navigation is still available.</p>` : ''}
    ${showOps ? ownerBody : staffBody}`,
  );

  renderFavourites();

  if (showOps) {
    startClosingSummary({ host: el.querySelector('#home-closing-summary') });
    startOpsSections({
      actionHost: el.querySelector('#home-ops-actions'),
      biHost: el.querySelector('#home-ops-bi'),
      activityHost: el.querySelector('#home-ops-activity'),
    });
  }
  if (showMessages) startMessages({ host: el.querySelector('#home-messages'), perms });
  if (showMyTasks || showTeam) {
    startTaskSections({ workHost: el.querySelector('#home-staff-work'), teamHost: el.querySelector('#home-team'), perms });
  }
  if (showStaff) {
    startStaffSections({ payrollHost: el.querySelector('#home-staff-pay'), activityHost: el.querySelector('#home-staff-activity'), perms });
  }

  function renderFavourites() {
    const host = el.querySelector('#home-favourites');
    if (!host) return;
    const saved = allPages.filter((page) => favourites.includes(page.href));
    host.hidden = saved.length === 0;
    render(
      host,
      saved.length
        ? html`<div class="home-chips">
            ${saved.map(
              (page) =>
                html`<span class="home-chip"
                  ><a href="${page.href}">${page.title}</a
                  ><button
                    class="home-unpin"
                    type="button"
                    data-unpin="${page.href}"
                    aria-label="Remove ${page.title} from favourites"
                    title="Remove favourite"
                  >
                    ×
                  </button></span
                >`,
            )}
          </div>`
        : html`<p class="home-empty">Pin the pages you use most. Your favourites stay on this device.</p>`,
    );
  }

  // One Refresh for the whole page: it presses each section's own (hidden) refresh button.
  const refreshAll = () =>
    el
      .querySelectorAll('[data-ops-refresh], [data-task-refresh], [data-msg-refresh], [data-staff-refresh]')
      .forEach((button) => button.click());

  el.addEventListener('click', (event) => {
    const unpin = event.target.closest('[data-unpin]');
    const handoff = event.target.closest('a[data-handoff]');

    if (handoff) sessionStorage.setItem('sales.entry.date', handoff.dataset.handoff);
    if (event.target.closest('[data-home-refresh]')) refreshAll();

    if (unpin) {
      favourites = favourites.filter((item) => item !== unpin.dataset.unpin);
      safeWrite(prefKey, favourites);
      renderFavourites();
    }
  });

  el.querySelectorAll('.kpfill[data-w]').forEach((bar) => {
    bar.style.width = `${bar.dataset.w}%`;
  });
}
