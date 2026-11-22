// Owner-only Action Centre and Recent Activity on Home. Reads only what the database returns for ops.view, refreshes itself
// through the shared refresher, and never changes an issue: each one links to the module where it is fixed.
import { html, render } from '../../../shared/html.js';
import { createRefresher } from '../../../shared/refresh.js';
import { opsActionItems, opsRecentActivity } from '../data/api.js';
import {
  CATEGORY_LABELS,
  PRIORITIES,
  categoriesIn,
  countBySeverity,
  filterItems,
  freshness,
  normaliseEvents,
  normaliseItems,
  timeAgo,
} from '../domain/ops.js';

const REFRESH_MS = 60_000;

// Loads both lists; one failing does not hide the other. If both fail the refresh fails and the last good data stays on screen.
async function loadAll() {
  const [a, e] = await Promise.allSettled([opsActionItems(), opsRecentActivity(10)]);
  if (a.status === 'rejected' && e.status === 'rejected') throw a.reason;
  return {
    items: a.status === 'fulfilled' ? { ok: true, rows: normaliseItems(a.value), allowed: a.value !== null } : { ok: false },
    events: e.status === 'fulfilled' ? { ok: true, rows: normaliseEvents(e.value), allowed: e.value !== null } : { ok: false },
  };
}

export function startOpsSections({ actionHost, activityHost }) {
  const filters = { priority: 'all', category: 'all' };
  let refresher = null;

  const statusLine = (state) => {
    const f = freshness(state);
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
    if (!actionHost.isConnected) return refresher?.stop();
    drawActions(state);
    drawActivity(state);
  };

  refresher = createRefresher({ load: loadAll, onChange: draw, intervalMs: REFRESH_MS, isAlive: () => actionHost.isConnected });

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

  draw(refresher.getState());
  refresher.start();
  return refresher;
}
