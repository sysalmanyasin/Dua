// Shared screen controller for Task Master pages: loads through the shared refresher (60 s, on return, when back online), keeps
// what a person is typing when the list refreshes, runs one action at a time, and reports the real outcome in plain words.
import { html, render } from '../../../shared/html.js';
import { createRefresher } from '../../../shared/refresh.js';
import { freshness } from '../../home/domain/ops.js';
import { friendlyError } from '../domain/tasks.js';

const REFRESH_MS = 60_000;

// Remembers typed values, ticks and focus across a redraw, keyed by data-keep.
function capture(host) {
  const kept = new Map();
  for (const n of host.querySelectorAll('[data-keep]')) kept.set(n.dataset.keep, n.type === 'checkbox' ? n.checked : n.value);
  const active = host.querySelector('[data-keep]:focus')?.dataset.keep ?? null;
  const details = [...host.querySelectorAll('details[data-keep]')].filter((d) => d.open).map((d) => d.dataset.keep);
  return { kept, active, details };
}
function restore(host, mem) {
  for (const n of host.querySelectorAll('[data-keep]')) {
    if (n.tagName === 'DETAILS') n.open = mem.details.includes(n.dataset.keep);
    else if (mem.kept.has(n.dataset.keep)) {
      if (n.type === 'checkbox') n.checked = mem.kept.get(n.dataset.keep);
      else if (n.tagName === 'SELECT' && ![...n.options].some((o) => o.value === mem.kept.get(n.dataset.keep))) continue;
      else n.value = mem.kept.get(n.dataset.keep);
    }
  }
  if (mem.active) [...host.querySelectorAll('[data-keep]')].find((n) => n.dataset.keep === mem.active)?.focus();
}

// head: html for the page banner. load(ui) returns the page data. view(data, ui, state) returns html. act(name, payload, ui) does
// the work and returns an optional success message; it throws on failure. A plain click uses node.dataset; a form uses its fields.
export function mountScreen(el, { head, load, view, act, extra, refreshMs = REFRESH_MS }) {
  const ui = {};
  let message = null;
  let busy = false;
  let refresher = null;

  render(
    el,
    html`${head}
      <div class="tk-page" data-tk-body></div>`,
  );
  const body = el.querySelector('[data-tk-body]');

  const statusLine = (state) => {
    const f = freshness(state);
    return html`<div class="ops-status ops-${f.tone}" role="status" aria-live="polite">
      <span>${f.text}</span>
      <button
        class="btn btn-sm"
        type="button"
        data-tk-refresh
        ${state.status === 'loading' || state.status === 'refreshing' ? 'disabled' : ''}
      >
        Refresh
      </button>
    </div>`;
  };

  function draw(state) {
    if (!body.isConnected) return refresher?.stop();
    const mem = capture(body);
    for (const prefix of ui.forget ?? []) for (const key of mem.kept.keys()) if (key.startsWith(prefix)) mem.kept.delete(key);
    ui.forget = null; // a finished form starts empty again
    render(
      body,
      html`${statusLine(state)}
        <div class="tk-message" role="status" aria-live="polite">
          ${message ? html`<p class="note ${message.error ? 'note-error' : 'note-ok'}">${message.text}</p>` : ''}
        </div>
        ${state.data ? view(state.data, ui, state) : state.status === 'error' ? html`<p class="note note-error">Could not load. Check your connection and press Refresh.</p>` : html`<p class="home-empty">Loading…</p>`}`,
    );
    restore(body, mem);
  }

  refresher = createRefresher({
    load: () => load(ui),
    onChange: draw,
    intervalMs: refreshMs,
    staleAfterMs: 2 * refreshMs + 60_000,
    isAlive: () => body.isConnected,
  });

  async function reload() {
    const s = refresher.getState().status;
    if (s === 'loading' || s === 'refreshing') await refresher.refresh(); // let the load already running finish, then read again
    await refresher.refresh();
  }

  async function run(name, payload) {
    if (busy) return;
    busy = true;
    message = null;
    try {
      const text = await act(name, payload, ui);
      message = text ? { text, error: false } : null;
    } catch (e) {
      message = { text: friendlyError(e), error: true };
    }
    busy = false;
    await reload();
    draw(refresher.getState());
  }

  el.addEventListener('click', (ev) => {
    if (ev.target.closest('[data-tk-refresh]')) return void refresher.refresh();
    const node = ev.target.closest('button[data-act], a[data-act]');
    if (!node) return;
    ev.preventDefault();
    run(node.dataset.act, { ...node.dataset });
  });
  el.addEventListener('submit', (ev) => {
    const form = ev.target.closest('form[data-act]');
    if (!form) return;
    ev.preventDefault();
    const fields = {};
    for (const n of form.elements) {
      if (!n.name || n.tagName === 'BUTTON') continue;
      if (n.type === 'checkbox') {
        if (n.name.endsWith('[]')) {
          const key = n.name.slice(0, -2);
          fields[key] ??= [];
          if (n.checked) fields[key].push(n.value);
        } else fields[n.name] = n.checked;
      } else fields[n.name] = n.value;
    }
    run(form.dataset.act, { ...form.dataset, ...fields, decision: ev.submitter?.dataset?.decision });
  });

  extra?.({ ui, refresh: () => refresher.refresh(), run });
  draw(refresher.getState());
  refresher.start();
  return refresher;
}
