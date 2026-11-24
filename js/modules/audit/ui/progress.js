// One person's items, counted and not counted, opened from a counter's row on the Round and Review pages. Read only.
// The page keeps the state object and calls these; Force submit and Reopen stay where they are, beside the button that opens this.
import { html } from '../../../shared/html.js';
import * as api from '../data/api.js';
import { friendlyError } from '../domain/errors.js';
import { qtyText } from '../domain/history.js';
import { FILTERS, filterCounts, filterItems, progressModel } from '../domain/progress.js';

export const progressState = () => ({ id: null, loading: false, error: '', model: null, filter: 'left' });

/** Opens (or closes, when it is already open) the panel for one assignment, then asks the page to redraw. */
export async function openProgress(p, id, redraw) {
  if (p.id === id) {
    p.id = null;
    return redraw();
  }
  p.id = id;
  p.loading = true;
  p.error = '';
  p.model = null;
  p.filter = 'left';
  redraw();
  try {
    const res = await api.assignmentProgress(id);
    if (p.id !== id) return; // another person was opened meanwhile
    p.model = progressModel(res);
    if (p.model.left === 0) p.filter = 'all';
  } catch (e) {
    if (p.id !== id) return;
    p.error = friendlyError(e).message;
  }
  p.loading = false;
  redraw();
}

/** Handles the panel's own buttons. Returns true when the click was one of them. */
export function progressClick(p, e, redraw) {
  const open = e.target.closest('button[data-peek]');
  if (open) {
    openProgress(p, open.dataset.peek, redraw);
    return true;
  }
  const f = e.target.closest('button[data-pf]');
  if (f) {
    p.filter = f.dataset.pf;
    redraw();
    return true;
  }
  return false;
}

const SHOWN = 300;

export function progressPanel(p) {
  if (p.loading) return html`<p class="muted small" data-prog>Loading…</p>`;
  if (p.error) return html`<p class="note note-error" role="alert" data-prog>${p.error}</p>`;
  const m = p.model;
  if (!m) return '';
  if (m.total === 0) return html`<p class="muted small" data-prog>Nothing was given to this person.</p>`;
  const counts = filterCounts(m.items);
  const rows = filterItems(m.items, p.filter);
  return html`<div class="aud-prog" data-prog>
    <p class="small"><strong>${m.counted} of ${m.total} counted</strong>${m.left ? ` · ${m.left} not counted` : ' · everything counted'}</p>
    <div class="aud-prog-filters" role="group" aria-label="Show items">
      ${FILTERS.map(
        (f) =>
          html`<button
            type="button"
            class="btn btn-sm ${p.filter === f.key ? 'btn-primary' : 'btn-ghost'}"
            data-pf="${f.key}"
            aria-pressed="${p.filter === f.key}"
          >
            ${f.label} (${counts[f.key]})
          </button>`,
      )}
    </div>
    ${
      rows.length === 0
        ? html`<p class="muted small" data-prog-empty>No items in this view.</p>`
        : html`<ul class="aud-list">
            ${rows.slice(0, SHOWN).map(
              (i) =>
                html`<li>
                  <span
                    ><strong>${i.name}</strong> <span class="muted small">${i.code} · ${i.company}</span><br />
                    <span class="small"
                      >${i.counted ? `Counted ${qtyText(i.qty)}` : 'Not counted'}${i.assumed ? ' · assumed to match' : ''}${
                        i.note ? ` · note: ${i.note}` : ''
                      }</span
                    ></span
                  >
                </li>`,
            )}
          </ul>`
    }
    ${rows.length > SHOWN ? html`<p class="muted small" data-prog-more>Showing the first ${SHOWN} of ${rows.length}. Use a filter to narrow it.</p>` : ''}
  </div>`;
}
