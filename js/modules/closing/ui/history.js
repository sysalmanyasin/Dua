// History tabs: CC, RBD (returns, book bills, deposits) and MEDIQ, read from the same pages as the Closing Book.
import { html, render } from '../../../shared/html.js';
import { hero } from '../../../shared/ui.js';
import * as api from '../data/api.js';
import { HISTORY_TABS, historyRows } from '../domain/book.js';
import { friendlyError } from '../domain/errors.js';
import { errorCard, loadingCard } from './parts.js';

export async function mountTab(el, tab) {
  render(el, loadingCard());
  let pages;
  try {
    pages = await api.closingBook({ limit: 60 });
  } catch (e) {
    return render(el, errorCard('the history', friendlyError(e).message));
  }
  const info = HISTORY_TABS.find((t) => t.id === tab);
  const items = historyRows(pages, tab);
  render(
    el,
    html`<div class="cls">
      ${hero({ label: 'Closing', title: `${info.label} history`, sub: info.blurb })}
      <div class="cls-grid">
        <section class="card">
          <nav class="cls-bk-bar" aria-label="History tabs">
            ${HISTORY_TABS.map((t) => html`<a class="btn btn-sm" href="#${t.path}" aria-current="${t.id === tab ? 'page' : 'false'}">${t.label}</a>`)}
          </nav>
          <p class="cls-meta">The last 60 submitted closings. <a href="#/closing">Back to Closing</a></p>
        </section>
        ${
          items.length
            ? items.map(
                (it) =>
                  html`<section class="card" data-closing="${it.key}">
                    <h2>${it.title}</h2>
                    <dl class="cls-kv">
                      ${it.rows.map(
                        (r) =>
                          html`<div>
                            <dt>${r.label}</dt>
                            <dd>${r.value}</dd>
                          </div>`,
                      )}
                    </dl>
                  </section>`,
              )
            : html`<section class="card"><p class="muted">Nothing recorded yet.</p></section>`
        }
      </div>
    </div>`,
  );
}
