// Dua Home 2.0 — permission-aware business command centre.
import { html, render } from '../../../shared/html.js';
import { icon } from '../../../shared/icons.js';
import { longDate, money, monthLabel, signed, todayPkt } from '../../../shared/format.js';
import { BRAND } from '../../../core/config.js';
import { coverSummary, inventoryCover, notificationsAttention } from '../data/api.js';
import {
  buildAttention,
  buildDailyProgress,
  buildKpis,
  buildQuickActions,
  buildStockCards,
  buildTiles,
  greeting,
  hourInPkt,
  searchPages,
} from '../domain/cover.js';

const arrow = (value) => (value === null ? '' : `${value >= 0 ? '▲' : '▼'} ${Math.abs(value).toFixed(1)}%`);
const tone = (value) => (value > 0 ? 'pos' : value < 0 ? 'neg' : '');

function kpiBody(kpi) {
  switch (kpi.id) {
    case 'latest':
      return html`<strong class="kv">₨ ${money(kpi.value)}</strong><span class="ks">${longDate(kpi.date)}</span>
        ${kpi.diff === null ? '' : html`<span class="kchip ${tone(kpi.diff)}">${signed(kpi.diff)} vs COMP</span>`}`;
    case 'mtd':
      return html`<strong class="kv">₨ ${money(kpi.value)}</strong><span class="ks">${monthLabel(kpi.month)} · ${kpi.days} day${kpi.days === 1 ? '' : 's'}</span>
        ${kpi.vsLastYear === null ? '' : html`<span class="kchip ${tone(kpi.vsLastYear)}">${arrow(kpi.vsLastYear)} vs same days last year</span>`}`;
    case 'target':
      return html`<strong class="kv">${kpi.pct}%</strong><span class="ks">of ₨ ${money(kpi.target)}</span>
        <div class="kpbar"><div class="kpfill ${kpi.pct >= 100 ? 'g' : kpi.pct >= 75 ? 'a' : 'r'}" data-w="${kpi.pct}"></div></div>
        <span class="ks">₨ ${money(kpi.remaining)} to go</span>`;
    default:
      return html`<strong class="kv">${money(kpi.value)}</strong><span class="ks">${longDate(kpi.date)}</span>`;
  }
}

function kpiCard(kpi) {
  const inner = html`<span class="kl">${kpi.label}</span>${kpiBody(kpi)}`;
  return kpi.href
    ? html`<a class="kpi" href="${kpi.href}">${inner}</a>`
    : html`<div class="kpi">${inner}</div>`;
}

function stockCard(card) {
  const count = card.count === undefined
    ? ''
    : html`<span class="ks">${money(card.count)} product${card.count === 1 ? '' : 's'}</span>`;

  return html`<a class="kpi" href="${card.href}">
    <span class="kl">${card.label}</span>
    <strong class="kv">₨ ${money(card.value)}</strong>
    ${count}
    <span class="ks">${card.sub}</span>
  </a>`;
}

const pageLink = (page) => html`<a class="home-page-link" href="${page.href}">
  <span><strong>${page.title}</strong><small>${page.module}${page.desc ? ` · ${page.desc}` : ''}</small></span>
  <span aria-hidden="true">↗</span>
</a>`;

const pageRow = (page, favourites) => {
  const pinned = favourites.includes(page.href);
  return html`<div class="home-page-row">
    ${pageLink(page)}
    <button
      class="home-pin"
      type="button"
      data-pin="${page.href}"
      data-pin-title="${page.title}"
      aria-label="${pinned ? 'Remove' : 'Add'} ${page.title} ${pinned ? 'from' : 'to'} favourites"
      title="${pinned ? 'Remove favourite' : 'Add to favourites'}"
    >${pinned ? '★' : '☆'}</button>
  </div>`;
};

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
  const first = String(ctx.full_name ?? ctx.username ?? 'there').trim().split(/\s+/)[0];
  const hour = hourInPkt();
  const tiles = buildTiles(modules);
  const quick = buildQuickActions(modules);
  const allPages = tiles.flatMap((group) =>
    group.pages.map((page) => ({ ...page, module: group.title })),
  );
  const validHrefs = new Set(allPages.map((page) => page.href));
  const prefKey = `dua.home.favourites.${String(ctx.username ?? 'user')}`;
  let favourites = safeRead(prefKey).filter((href) => validHrefs.has(href));

  const head = html`<section class="home-welcome">
    <div class="home-welcome-copy">
      <div class="home-eyebrow">${BRAND.title} · ${BRAND.branch}</div>
      <h1>${greeting(hour)}, ${first}</h1>
      <p>${longDate(todayPkt())} <span class="home-dot">•</span> Your business at a glance</p>
    </div>
    <div class="home-welcome-mark" aria-hidden="true">${icon('home')}</div>
  </section>`;

  render(el, html`${head}
    <section class="home-loading" aria-live="polite">
      <span class="home-spinner"></span> Loading your business overview…
    </section>`);

  const stockPromise = perms.includes('inventory.view')
    ? inventoryCover().catch(() => null)
    : Promise.resolve(null);

  let summary = null;
  let failed = false;
  try {
    summary = await coverSummary();
  } catch {
    failed = true;
  }

  let alerts = null;
  if (perms.includes('notifications.view')) {
    try {
      alerts = await notificationsAttention();
    } catch {
      alerts = null;
    }
  }

  const stock = buildStockCards(await stockPromise);
  const kpis = buildKpis(summary);
  const attention = buildAttention(summary, perms, hour, alerts);
  const progress = buildDailyProgress(summary, perms);

  const renderFavourites = () => {
    const saved = allPages.filter((page) => favourites.includes(page.href));
    const host = el.querySelector('#home-favourites');
    if (!host) return;

    render(
      host,
      saved.length
        ? html`<div class="home-favourite-grid">
            ${saved.map((page) => html`<div class="home-favourite-item">
              ${pageLink(page)}
              <button
                class="home-unpin"
                type="button"
                data-unpin="${page.href}"
                aria-label="Remove ${page.title} from favourites"
                title="Remove favourite"
              >★</button>
            </div>`)}
          </div>`
        : html`<p class="home-empty">Pin the pages you use most. Your favourites stay on this device.</p>`,
    );
  };

  const renderSearch = (query) => {
    const host = el.querySelector('#home-search-results');
    if (!host) return;

    const matches = searchPages(modules, query);
    render(
      host,
      query.trim()
        ? matches.length
          ? html`<div class="home-search-list">${matches.map((page) => pageRow(page, favourites))}</div>`
          : html`<p class="home-empty">No accessible page matches “${query.trim()}”.</p>`
        : html`<p class="home-search-hint">Search only includes pages you are allowed to open.</p>`,
    );
  };

  render(
    el,
    html`${head}
      ${failed
        ? html`<p class="note note-error" role="status">Business figures could not be loaded. Your navigation is still available.</p>`
        : ''}
      ${kpis.length
        ? html`<section class="home-section" aria-label="Business snapshot">
            <div class="home-section-head">
              <div><span class="home-kicker">THE NUMBERS</span><h2>Business snapshot</h2></div>
              <span class="home-live-label">Live data</span>
            </div>
            <div class="kpis home-kpis">${kpis.map(kpiCard)}</div>
          </section>`
        : ''}
      ${stock.length
        ? html`<section class="home-section">
            <div class="home-section-head">
              <div><span class="home-kicker">INVENTORY</span><h2>Stock snapshot</h2></div>
            </div>
            <div class="kpis home-kpis">${stock.map(stockCard)}</div>
          </section>`
        : ''}
      <section class="home-section home-search-section">
        <div class="home-section-head">
          <div><span class="home-kicker">FIND IT FAST</span><h2>Search Dua</h2></div>
        </div>
        <label class="home-search-box">
          <span class="sr-only">Search accessible pages and actions</span>
          <span class="home-search-icon" aria-hidden="true">⌕</span>
          <input id="home-search" type="search" autocomplete="off" placeholder="Search modules, pages and tasks…" />
          <kbd>⌕</kbd>
        </label>
        <div id="home-search-results" aria-live="polite">
          <p class="home-search-hint">Search only includes pages you are allowed to open.</p>
        </div>
      </section>
      ${quick.length
        ? html`<section class="home-section">
            <div class="home-section-head">
              <div><span class="home-kicker">ONE-TAP ACCESS</span><h2>Quick actions</h2></div>
            </div>
            <div class="home-quick-grid">
              ${quick.map((page) => html`<a class="home-quick" href="${page.href}">
                <span class="home-quick-icon" aria-hidden="true">↗</span>
                <strong>${page.title}</strong>
                <small>${page.module}</small>
              </a>`)}
            </div>
          </section>`
        : ''}
      <section class="home-section">
        <div class="home-section-head">
          <div><span class="home-kicker">YOUR WORKSPACE</span><h2>Explore modules</h2></div>
          <span class="home-count">${tiles.length} available</span>
        </div>
        ${tiles.length
          ? html`<div class="home-module-grid">
              ${tiles.map((group) => html`<details class="home-module">
                <summary>
                  <span class="home-module-icon">${icon(group.icon)}</span>
                  <span class="home-module-copy">
                    <strong>${group.title}</strong>
                    <small>${group.pages.length} accessible page${group.pages.length === 1 ? '' : 's'}</small>
                  </span>
                  <span class="home-module-chevron">⌄</span>
                </summary>
                <div class="home-module-pages">
                  ${group.pages.map((page) => pageRow({ ...page, module: group.title }, favourites))}
                </div>
              </details>`)}
            </div>`
          : html`<p class="home-empty">No additional modules are currently available to this account.</p>`}
      </section>
      ${progress.length
        ? html`<section class="home-section">
            <div class="home-section-head">
              <div><span class="home-kicker">TODAY</span><h2>Daily progress</h2></div>
            </div>
            <div class="home-progress-list">
              ${progress.map((item) => html`<div class="home-progress-row">
                <span class="home-progress-mark ${item.started ? 'is-started' : ''}">${item.started ? '◷' : '•'}</span>
                <span class="home-progress-copy">
                  <strong>${item.label}</strong>
                  <small>${item.status}</small>
                </span>
                ${item.href ? html`<a class="home-text-link" href="${item.href}">Open</a>` : ''}
              </div>`)}
            </div>
          </section>`
        : ''}
      ${summary
        ? html`<section class="home-section home-attention">
            <div class="home-section-head">
              <div><span class="home-kicker">PRIORITY</span><h2>Needs attention</h2></div>
              <span class="home-count">${attention.length
                ? `${attention.length} item${attention.length === 1 ? '' : 's'}`
                : 'All clear'}</span>
            </div>
            ${attention.length
              ? html`<div class="home-attention-list">
                  ${attention.map((item) => html`<div class="home-attention-row">
                    <span class="home-attention-dot"></span>
                    <span>${item.text}</span>
                    ${item.action
                      ? html`<a class="btn btn-sm" href="${item.action.href}" ${item.action.handoff
                        ? html`data-handoff="${item.action.handoff}"`
                        : ''}>${item.action.label}</a>`
                      : ''}
                  </div>`)}
                </div>`
              : html`<p class="home-clear">✓ No outstanding items were reported.</p>`}
          </section>`
        : ''}
      <section class="home-section">
        <div class="home-section-head">
          <div><span class="home-kicker">PERSONAL SPACE</span><h2>Favourites</h2></div>
        </div>
        <div id="home-favourites"></div>
      </section>
      <p class="home-footer">Dua · Your access is tailored to your account</p>`,
  );

  renderFavourites();
  el.querySelector('#home-search')?.addEventListener('input', (event) => renderSearch(event.target.value));

  const syncPins = () => {
    el.querySelectorAll('[data-pin]').forEach((button) => {
      const pinned = favourites.includes(button.dataset.pin);
      button.textContent = pinned ? '★' : '☆';
      button.title = pinned ? 'Remove favourite' : 'Add to favourites';
      button.setAttribute(
        'aria-label',
        `${pinned ? 'Remove' : 'Add'} ${button.dataset.pinTitle} ${pinned ? 'from' : 'to'} favourites`,
      );
    });
  };

  el.addEventListener('click', (event) => {
    const pin = event.target.closest('[data-pin]');
    const unpin = event.target.closest('[data-unpin]');
    const handoff = event.target.closest('a[data-handoff]');

    if (handoff) sessionStorage.setItem('sales.entry.date', handoff.dataset.handoff);

    if (pin) {
      const href = pin.dataset.pin;
      favourites = favourites.includes(href)
        ? favourites.filter((item) => item !== href)
        : [...favourites, href].slice(-12);
      safeWrite(prefKey, favourites);
      renderFavourites();
      syncPins();
    }

    if (unpin) {
      favourites = favourites.filter((item) => item !== unpin.dataset.unpin);
      safeWrite(prefKey, favourites);
      renderFavourites();
      syncPins();
    }
  });

  el.querySelectorAll('.kpfill[data-w]').forEach((bar) => {
    bar.style.width = `${bar.dataset.w}%`;
  });
}
