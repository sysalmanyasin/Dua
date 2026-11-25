// Small UI helpers for the Audit pages. Audit keeps its own copy so it never imports from another module (MODULES section 3.1).
import { html } from '../../../shared/html.js';
import { nextStep, pipelineSteps } from '../domain/pipeline.js';
import { getView, setView } from '../domain/nav.js';

export function toast(message, kind = 'ok') {
  let box = document.getElementById('toasts');
  if (!box) {
    box = document.createElement('div');
    box.id = 'toasts';
    box.setAttribute('role', 'status');
    box.setAttribute('aria-live', 'polite');
    document.body.append(box);
  }
  const t = document.createElement('div');
  t.className = `toast toast-${kind}`;
  t.textContent = message;
  box.append(t);
  setTimeout(() => t.remove(), kind === 'error' ? 6000 : 3500);
}

export const loadingCard = () => html`<div class="card aud-card"><p class="muted">Loading…</p></div>`;
export const errorCard = (what = 'this page', message = '') =>
  html`<div class="card aud-card">
    <h2>Could not load ${what}</h2>
    <p class="muted">${message || 'Check your connection and try again. If it keeps happening, tell the owner.'}</p>
  </div>`;

/** Where the person is: Audits › Audit › Round 2 › Review. The last item is the page itself; the others are links. */
export const crumbs = (items) =>
  html`<nav class="aud-crumbs" aria-label="Breadcrumb">
    <ol>
      ${items.map((c, i) =>
        i === items.length - 1 || !c.href
          ? html`<li aria-current="${i === items.length - 1 ? 'page' : 'false'}">${c.label}</li>`
          : html`<li><a href="${c.href}">${c.label}</a></li>`,
      )}
    </ol>
  </nav>`;

const MARK = { done: '✓', current: '●', todo: '○' };
const SAYS = { done: 'done', current: 'now', todo: 'not yet' };

/**
 * The round's road from set-up to Final, with one button for the next step. `model` is { round, assignments, compilation };
 * `page` is the page it is drawn on ('engagement', 'round' or 'compile'): a next step that lives on this very page is
 * shown as a line of text, since the button for it is already below.
 */
export function pipelineStrip(model, permissions, page) {
  const steps = pipelineSteps(model);
  const next = nextStep(model.round.state, permissions);
  return html`<section class="card aud-card aud-pipe" aria-label="Where this round is">
    <ol class="aud-pipe-steps">
      ${steps.map(
        (st) =>
          html`<li class="aud-pipe-${st.state}" aria-current="${st.state === 'current' ? 'step' : 'false'}">
            <span class="aud-pipe-mark" aria-hidden="true">${MARK[st.state]}</span>
            <span class="aud-pipe-name">${st.label}<span class="sr-only"> (${SAYS[st.state]})</span></span>
            ${st.detail ? html`<span class="aud-pipe-detail muted small">${st.detail}</span>` : ''}
          </li>`,
      )}
    </ol>
    ${
      next
        ? next.page === page
          ? html`<p class="small" data-pipe-next>Next: <strong>${next.label}</strong> (below).</p>`
          : html`<p class="aud-actions">
              <button type="button" class="btn btn-primary" data-pipe="${next.page}">${next.label}</button>
            </p>`
        : ''
    }
  </section>`;
}

/** Opens a round page from the strip's button, keeping the audit and round the person is on. */
export function goPipe(page, { engagement, round }) {
  const view = getView() ?? {};
  setView({ ...view, engagement: engagement ?? view.engagement, round: round ?? view.round });
  location.hash = `#/audit/${page}`;
}

/** CSP forbids inline style attributes, so each bar's width is set as a DOM property after the escaped markup is rendered. */
export function applyProgressBars(root) {
  root.querySelectorAll('[data-progress]').forEach((b) => {
    b.style.width = `${Math.max(0, Math.min(100, Number(b.dataset.progress) || 0))}%`;
  });
}

/** A thin progress bar (percent 0 to 100). Call applyProgressBars on the page after rendering. */
export const progressBar = (percent) =>
  html`<div class="aud-progress" role="progressbar" aria-label="Progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}">
    <span data-progress="${percent}"></span>
  </div>`;
