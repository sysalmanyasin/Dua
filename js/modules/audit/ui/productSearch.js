// "Find a product": one product across the compiled and final rounds the person may see. Read only.
import { html, render } from '../../../shared/html.js';
import { money } from '../../../shared/format.js';
import * as api from '../data/api.js';
import { friendlyError } from '../domain/errors.js';
import { groupByProduct, moreThanShown, searchTerm } from '../domain/history.js';
import { setView } from '../domain/nav.js';

export function mountProductSearch(host) {
  const s = { text: '', busy: false, rows: null, error: '' };

  const result = () => {
    if (s.busy) return html`<p class="muted">Searching…</p>`;
    if (s.error) return html`<p class="aud-hist-error" role="alert">${s.error}</p>`;
    if (s.rows === null) return html`<p class="muted small">Type a code or part of a name. Only finished counts are searched.</p>`;
    if (s.rows.length === 0) return html`<p class="muted">No compiled or final round holds that product.</p>`;
    return html`${groupByProduct(s.rows).map(
      (g) =>
        html`<div class="aud-hist-product" data-product>
          <h3>${g.name} <span class="muted small">${g.code} · ${g.company}</span></h3>
          <ul class="aud-list">
            ${g.rounds.map(
              (r) =>
                html`<li>
                  <span
                    ><strong>${r.where}</strong>
                    <span class="muted small">${r.stateLabel}${r.day ? ` · ${r.day}` : ''}</span>
                    <span class="small"
                      >System ${r.system} · Counted ${r.counted} ·
                      <span class="${r.variance === 0 ? '' : 'aud-hist-diff'}">${r.varianceText}</span>${
                        r.variance === 0 ? '' : ` (${money(r.value, { decimals: true })})`
                      }</span
                    >
                    ${r.flags.length ? html`<span class="muted small">${r.flags.join(' · ')}</span>` : ''}
                  </span>
                  <button
                    type="button"
                    class="btn btn-sm"
                    data-hist-open
                    data-e="${r.engagementId}"
                    data-r="${r.roundId}"
                    data-state="${r.state}"
                  >
                    Open
                  </button>
                </li>`,
            )}
          </ul>
        </div>`,
    )}
    ${moreThanShown(s.rows) ? html`<p class="muted small" data-hist-more>Showing the newest ${s.rows.length}. Search more exactly to narrow it.</p>` : ''}`;
  };

  const draw = () => {
    render(
      host,
      html`<section class="card aud-card" aria-label="Find a product">
        <h2>Find a product</h2>
        <form class="aud-filters" data-hist-form>
          <input
            type="search"
            data-s="hist-q"
            value="${s.text}"
            placeholder="Product code or name"
            aria-label="Product code or name"
            maxlength="80"
          />
          <button type="submit" class="btn" ${s.busy ? 'disabled' : ''}>Search</button>
        </form>
        <div aria-live="polite" data-hist-result>${result()}</div>
      </section>`,
    );
  };

  host.onsubmit = async (e) => {
    e.preventDefault();
    const input = host.querySelector('[data-s="hist-q"]');
    s.text = input ? input.value : s.text;
    const term = searchTerm(s.text);
    if (!term) {
      s.rows = null;
      s.error = '';
      return draw();
    }
    s.busy = true;
    s.error = '';
    draw();
    try {
      s.rows = await api.productHistory(term, 50);
    } catch (err) {
      s.rows = null;
      s.error = friendlyError(err).message;
    }
    s.busy = false;
    draw();
    host.querySelector('[data-s="hist-q"]')?.focus();
  };
  host.onclick = (e) => {
    const b = e.target.closest('button[data-hist-open]');
    if (!b) return;
    setView({ engagement: b.dataset.e, round: b.dataset.r });
    location.hash = b.dataset.state === 'final' ? '#/audit/final' : '#/audit/compile';
  };
  draw();
}
