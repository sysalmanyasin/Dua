// Owner-only "Latest closing summary" on Home. Reads one database answer (ops_closing_summary, null for anyone without ops.view),
// refreshes itself through the shared refresher and when a closing is saved or submitted, and keeps the last good figures on a failed refresh.
import { html, render } from '../../../shared/html.js';
import { createRefresher } from '../../../shared/refresh.js';
import { opsClosingSummary, watchClosings } from '../data/api.js';
import { buildClosingSummary } from '../domain/closing-summary.js';

const REFRESH_MS = 60_000;

export function startClosingSummary({ host }) {
  if (!host) return null;
  let stopWatching = () => {};
  let pending = null;
  let refresher = null;

  const draw = (state) => {
    if (!host.isConnected) {
      clearTimeout(pending);
      stopWatching();
      return refresher?.stop();
    }
    const view = buildClosingSummary(state.data);
    if (view.state === 'hidden' && state.status !== 'error') return render(host, html``); // not for this person (or still loading)
    const failedFirst = state.status === 'error' && state.data === null;
    render(
      host,
      html`<section class="home-section ops-section" aria-label="Latest closing summary">
        <div class="home-section-head">
          <div>
            <span class="home-kicker">CLOSING</span>
            <h2>Latest closing summary</h2>
          </div>
          ${view.state === 'ready' ? html`<span class="home-count">${view.mode}</span>` : ''}
        </div>
        ${failedFirst ? html`<p class="note note-error" role="status">The closing summary could not be loaded. Your other pages still work.</p>` : ''}
        ${view.state === 'empty' ? html`<p class="home-empty">No closing has been submitted yet.</p>` : ''}
        ${
          view.state === 'ready'
            ? html`<p class="cs-title">${view.title}</p>
                <div class="cs-grid">
                  ${view.cards.map((c) => html`<div class="cs-cell" data-cs="${c.id}"><span class="cs-label">${c.label}</span><strong class="cs-value">${c.value}</strong></div>`)}
                </div>
                <p class="bi-small">${view.note}</p>
                ${state.status === 'error' ? html`<p class="note note-error" role="status">Could not refresh. These are the last figures that loaded.</p>` : ''}
                <a class="home-text-link" href="#/closing">Open Closing</a>`
            : ''
        }
      </section>`,
    );
  };

  refresher = createRefresher({
    load: () => opsClosingSummary(),
    onChange: draw,
    intervalMs: REFRESH_MS,
    isAlive: () => host.isConnected,
  });
  draw(refresher.getState());
  refresher.start();

  // a closing saved or submitted anywhere refreshes the figures at once; the timer covers everything else
  stopWatching = watchClosings(() => {
    clearTimeout(pending);
    pending = setTimeout(() => refresher.refresh(), 1500);
  }, 'home-closing-summary');
  return refresher;
}
