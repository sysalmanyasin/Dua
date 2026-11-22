// Owner-only Action Centre and Recent Activity on Home. Reads only what the database returns for ops.view, refreshes itself
// through the shared refresher, and never changes an issue: each one links to the module where it is fixed.
import { html, render } from '../../../shared/html.js';
import { createRefresher } from '../../../shared/refresh.js';
import { opsActionItems, opsBiSummary, opsRecentActivity, watchClosings } from '../data/api.js';
import { money } from '../../../shared/format.js';
import { DEFAULT_PERIOD, PERIODS, compareAverages, completeness, normaliseBi, trendBars } from '../domain/bi.js';
import {
  CATEGORY_LABELS,
  PRIORITIES,
  categoriesIn,
  clockTime,
  countBySeverity,
  filterItems,
  freshness,
  normaliseEvents,
  normaliseItems,
  timeAgo,
} from '../domain/ops.js';

const REFRESH_MS = 60_000;

// Loads the three lists. One failing does not hide the others, and a part that fails keeps its last good content marked stale
// (shown with a warning) instead of being blanked. If all three fail the whole refresh fails and everything stays on screen.
async function loadAll(period, prev) {
  const [a, e, b] = await Promise.allSettled([opsActionItems(), opsRecentActivity(10), opsBiSummary(period)]);
  if (a.status === 'rejected' && e.status === 'rejected' && b.status === 'rejected') throw a.reason;
  const part = (res, old, make) => (res.status === 'fulfilled' ? make(res.value) : old?.ok ? { ...old, stale: true } : { ok: false });
  return {
    bi: part(b, prev?.bi, (v) => ({ ok: true, data: normaliseBi(v), allowed: v !== null })),
    items: part(a, prev?.items, (v) => ({ ok: true, rows: normaliseItems(v), allowed: v !== null })),
    events: part(e, prev?.events, (v) => ({ ok: true, rows: normaliseEvents(v), allowed: v !== null })),
  };
}

export function startOpsSections({ actionHost, biHost, activityHost }) {
  const filters = { priority: 'all', category: 'all' };
  let period = DEFAULT_PERIOD;
  let refresher = null;
  let stopWatching = () => {};
  let last = null;

  const statusLine = (state) => {
    const partlyStale = state.status === 'ok' && state.data && Object.values(state.data).some((x) => x?.stale);
    const f = partlyStale
      ? { tone: 'warn', text: `Updated ${clockTime(state.lastSuccess)}. Some figures could not be refreshed and may be out of date.` }
      : freshness(state);
    return html`<div class="ops-status ops-${f.tone}" role="status" aria-live="polite">
      <span>${f.text}</span>
      <button
        class="btn btn-sm"
        type="button"
        data-ops-refresh
        ${state.status === 'loading' || state.status === 'refreshing' ? 'disabled' : ''}
      >
        Refresh
      </button>
    </div>`;
  };

  const issueRow = (i) =>
    html`<li class="ops-issue ops-sev-${i.severity}">
      <span class="ops-badge" title="${PRIORITIES[i.severity].label}"
        ><span aria-hidden="true">${PRIORITIES[i.severity].mark}</span> ${PRIORITIES[i.severity].label}</span
      >
      <div class="ops-issue-body">
        <strong>${i.title}</strong>
        <p>${i.detail}</p>
        <small>${CATEGORY_LABELS[i.category]} · Responsible: ${i.responsible}${i.deadline ? ` · Due ${i.deadline}` : ''}</small>
      </div>
      ${i.href ? html`<a class="btn btn-sm" href="${i.href}">Open</a>` : ''}
    </li>`;

  function drawActions(state) {
    const part = state.data?.items;
    if (part && part.ok && !part.allowed) return render(actionHost, html``); // not for this person
    const all = part?.ok ? part.rows : [];
    const shown = filterItems(all, filters);
    const counts = countBySeverity(all);
    const cats = categoriesIn(all);
    render(
      actionHost,
      html`<section class="home-section ops-section" aria-label="Action Centre">
        <div class="home-section-head">
          <div>
            <span class="home-kicker">PRIORITY</span>
            <h2>Action Centre</h2>
          </div>
          <span class="home-count">${part?.ok ? (all.length ? `${all.length} open` : 'All clear') : ''}</span>
        </div>
        ${statusLine(state)}
        ${part && !part.ok ? html`<p class="note note-error" role="status">The issue list could not be loaded. Your other pages still work.</p>` : ''}
        ${
          all.length
            ? html`<p class="ops-counts">
                  <span>Critical <b>${counts.critical}</b></span
                  ><span>Needs attention <b>${counts.warning}</b></span
                  ><span>For information <b>${counts.info}</b></span>
                </p>
                <div class="ops-filters">
                  <label
                    >Priority
                    <select data-ops-filter="priority">
                      <option value="all">All</option>
                      ${Object.entries(PRIORITIES).map(([k, v]) => html`<option value="${k}" ${filters.priority === k ? 'selected' : ''}>${v.label}</option>`)}
                    </select>
                  </label>
                  <label
                    >Area
                    <select data-ops-filter="category">
                      <option value="all">All</option>
                      ${cats.map((c) => html`<option value="${c}" ${filters.category === c ? 'selected' : ''}>${CATEGORY_LABELS[c]}</option>`)}
                    </select>
                  </label>
                </div>
                ${
                  shown.length
                    ? html`<ul class="ops-issues">
                        ${shown.map(issueRow)}
                      </ul>`
                    : html`<p class="home-empty">No issues match these filters.</p>`
                }`
            : part?.ok
              ? html`<p class="home-clear">
                  ✓ Nothing needs your action right now. Issues clear themselves when they are fixed in their own page.
                </p>`
              : ''
        }
      </section>`,
    );
  }

  const card = (title, body) =>
    html`<div class="bi-card">
      <h3>${title}</h3>
      ${body}
    </div>`;

  function drawBi(state) {
    if (!biHost) return;
    const part = state.data?.bi;
    if (part && part.ok && !part.allowed) return render(biHost, html``);
    const d = part?.ok ? part.data : null;
    const periodButtons = html`<div class="bi-periods" role="group" aria-label="Period">
      ${PERIODS.map((p) => html`<button type="button" class="btn btn-sm" data-bi-period="${p}" aria-pressed="${p === period ? 'true' : 'false'}">${p} days</button>`)}
    </div>`;
    let body = '';
    if (part && !part.ok) body = html`<p class="note note-error" role="status">Business figures could not be loaded.</p>`;
    else if (d) {
      const sc = compareAverages(d.sales.avg, d.sales.prevAvg, d.sales.recordedDays, d.sales.prevDays, d.days);
      const tc = compareAverages(d.transactions.avg, d.transactions.prevAvg, d.transactions.countedDays, d.transactions.prevDays, d.days);
      const bars = trendBars(d.sales.series, d.from, d.to);
      const inv = d.inventory;
      body = html`<div class="bi-grid">
          ${card(
            'Sales',
            html`<p class="bi-big">Rs ${money(d.sales.total)}</p>
              <p>${d.sales.avg === null ? 'No sales entered in this period' : `Average Rs ${money(d.sales.avg)} per day entered`}</p>
              <p class="bi-compare">${sc.text}</p>
              <p class="bi-small">${completeness(d.sales.recordedDays, d.days, 'Sales entered')}</p>
              ${
                d.sales.series.length
                  ? html`<svg
                      class="bi-trend"
                      viewBox="0 0 300 80"
                      role="img"
                      aria-label="Daily sales trend for the last ${d.days} days"
                      preserveAspectRatio="none"
                    >
                      ${bars.map((b) => (b.missing ? '' : html`<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}"><title>${b.date}: Rs ${money(b.total)}</title></rect>`))}
                    </svg>`
                  : ''
              }`,
          )}
          ${card(
            'Transactions',
            html`<p class="bi-big">${money(d.transactions.total)}</p>
              <p>
                ${d.transactions.avg === null ? 'No customer counts in this period' : `Average ${money(d.transactions.avg)} per day counted`}
              </p>
              <p class="bi-compare">${tc.text}</p>
              <p class="bi-small">${completeness(d.transactions.countedDays, d.days, 'Counted')}</p>`,
          )}
          ${card(
            'Inventory health (now)',
            d.inventoryFailed || !inv
              ? html`<p class="note note-error" role="status">Stock figures could not be loaded.</p>`
              : html`<p>Stock value <b>Rs ${money(inv.stockValue)}</b></p>
                  <p>To reorder <b>${inv.reorder.count}</b> products (Rs ${money(inv.reorder.value)})</p>
                  <p>Not selling <b>${inv.notSold.count}</b> (Rs ${money(inv.notSold.value)})</p>
                  <p>Excess stock <b>${inv.excess.count}</b> (Rs ${money(inv.excess.value)})</p>
                  <p class="bi-small">Stock is as of now, not for the period.</p>`,
          )}
          ${card(
            'Operations',
            html`<p>${completeness(d.operations.daysWithSales, d.operations.daysInPeriod, 'Sales entered')}</p>
              <p>${completeness(d.operations.daysWithClosing, d.operations.daysInPeriod, 'Closing submitted')}</p>
              <p>Closings submitted <b>${d.operations.closingsSubmitted}</b></p>
              <p>Drafts still open <b>${d.operations.openDrafts}</b></p>`,
          )}
        </div>
        <p class="bi-small">${d.from} to ${d.to} compared with the ${d.days} days before. For detailed analysis open Sales or Reports.</p>`;
    }
    render(
      biHost,
      html`<section class="home-section ops-section" aria-label="Business intelligence">
        <div class="home-section-head">
          <div>
            <span class="home-kicker">INSIGHT</span>
            <h2>Business intelligence</h2>
          </div>
        </div>
        ${periodButtons} ${body}
      </section>`,
    );
  }

  function drawActivity(state) {
    const part = state.data?.events;
    if (part && part.ok && !part.allowed) return render(activityHost, html``);
    const rows = part?.ok ? part.rows : [];
    render(
      activityHost,
      html`<section class="home-section ops-section" aria-label="Recent activity">
        <div class="home-section-head">
          <div>
            <span class="home-kicker">LATEST</span>
            <h2>Recent activity</h2>
          </div>
        </div>
        ${part && !part.ok ? html`<p class="note note-error" role="status">Recent activity could not be loaded.</p>` : ''}
        ${
          rows.length
            ? html`<ul class="ops-activity">
                ${rows.map(
                  (e) =>
                    html`<li>
                      <span class="ops-when">${timeAgo(e.at, Date.now())}</span>
                      <span><strong>${e.title}</strong><small>${e.detail}</small></span>
                      ${e.href ? html`<a class="home-text-link" href="${e.href}">Open</a>` : ''}
                    </li>`,
                )}
              </ul>`
            : part?.ok
              ? html`<p class="home-empty">No recent activity in the categories you have switched on.</p>`
              : ''
        }
      </section>`,
    );
  }

  const draw = (state) => {
    if (!actionHost.isConnected) {
      stopWatching();
      return refresher?.stop();
    }
    drawActions(state);
    drawBi(state);
    drawActivity(state);
  };

  refresher = createRefresher({
    load: async () => (last = await loadAll(period, last)),
    onChange: draw,
    intervalMs: REFRESH_MS,
    isAlive: () => actionHost.isConnected,
  });

  actionHost.addEventListener('click', (ev) => {
    if (ev.target.closest('[data-ops-refresh]')) refresher.refresh();
  });
  actionHost.addEventListener('change', (ev) => {
    const sel = ev.target.closest('[data-ops-filter]');
    if (!sel) return;
    filters[sel.dataset.opsFilter] = sel.value;
    drawActions(refresher.getState());
  });
  activityHost.addEventListener('click', (ev) => {
    if (ev.target.closest('[data-ops-refresh]')) refresher.refresh();
  });
  biHost?.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-bi-period]');
    if (!b) return;
    const p = Number(b.dataset.biPeriod);
    if (!PERIODS.includes(p) || p === period) return;
    period = p;
    drawBi(refresher.getState());
    refresher.refresh();
  });

  draw(refresher.getState());
  refresher.start();

  // Important events (a closing saved or submitted) refresh the lists at once; the timer covers everything else.
  let pending = null;
  stopWatching = watchClosings(() => {
    clearTimeout(pending);
    pending = setTimeout(() => refresher.refresh(), 1500);
  });
  return refresher;
}
