// A round's live counting progress, in a popup over the page: how far the count has got, who has counted how much, and when it
// was last read. It reads the round again every few seconds while it is open and stops by itself when it is closed, when the
// page is left, or when counting has finished. Nothing is written; the numbers are the ones the counting screens send.
import { html, render } from '../../../shared/html.js';
import * as api from '../data/api.js';
import { friendlyError } from '../domain/errors.js';
import { applyProgressBars, progressBar } from './parts.js';

const EVERY_MS = 8000;
const clock = (d) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const STATE = { counting: 'Counting', compiled: 'Compiled', final: 'Finalized', draft: 'Getting ready', locked: 'Locked' };

/** Totals and per-person rows from audit_compile_overview. Pure. */
export function progressFrom(overview) {
  const list = (overview?.assignments ?? []).filter((a) => a.status !== 'revoked');
  const items = list.reduce((n, a) => n + Number(a.items || 0), 0);
  const counted = Math.min(
    items,
    list.reduce((n, a) => n + Number(a.counted || 0), 0),
  );
  return {
    items,
    counted,
    remaining: Math.max(0, items - counted),
    percent: items ? Math.round((counted / items) * 100) : 0,
    state: overview?.round?.state ?? null,
    people: list.map((a) => {
      const total = Number(a.items || 0);
      const done = Math.min(total, Number(a.counted || 0));
      return {
        name: a.name || 'Counter',
        total,
        done,
        percent: total ? Math.round((done / total) * 100) : 0,
        submitted: a.status === 'submitted',
      };
    }),
  };
}

/**
 * Opens the popup for one round. `title` names it ("Round 10 · Mian Waqas"). `deps` lets tests replace the document, the read
 * and the interval. Returns { close, refresh }.
 */
export function openRoundProgress({ roundId, title = 'Round', deps = {} } = {}) {
  const doc = deps.doc ?? document;
  const read = deps.read ?? api.compileOverview;
  const every = deps.every ?? EVERY_MS;
  const opener = doc.activeElement;
  let closed = false;
  let model = null;
  let error = '';
  let at = null;
  let busy = false;

  const host = doc.createElement('div');
  host.className = 'aud-pop';
  host.setAttribute('role', 'dialog');
  host.setAttribute('aria-modal', 'true');
  host.setAttribute('aria-labelledby', 'aud-pop-title');
  doc.body.append(host);

  function draw() {
    const m = model;
    const finished = m && m.state && m.state !== 'counting';
    render(
      host,
      html`<div class="aud-pop-box">
        <div class="aud-pop-head">
          <div>
            <p class="aud-eyebrow">Live progress</p>
            <h2 id="aud-pop-title">${title}</h2>
          </div>
          <button type="button" class="btn btn-ghost btn-sm" data-s="close" aria-label="Close progress">Close</button>
        </div>
        ${
          error
            ? html`<p class="note note-error" role="alert">${error}</p>`
            : !m
              ? html`<p class="muted" role="status">Reading the count…</p>`
              : html`<div class="aud-pop-hero">
                    <div class="aud-pop-percent" data-percent>${m.percent}<span>%</span></div>
                    <div>
                      <strong data-counted>${m.counted.toLocaleString()} of ${m.items.toLocaleString()} counted</strong>
                      <p class="muted small" data-remaining>${m.remaining.toLocaleString()} remaining</p>
                    </div>
                  </div>
                  ${progressBar(m.percent)}
                  ${
                    finished
                      ? html`<p class="aud-pop-state" data-finished>${STATE[m.state] ?? m.state}: counting has finished.</p>`
                      : html`<p class="aud-pop-state aud-live" data-live-state>
                          <span class="aud-dot" aria-hidden="true"></span> Counting now
                        </p>`
                  }
                  <ul class="aud-pop-people">
                    ${m.people.map(
                      (p) =>
                        html`<li data-person>
                          <span
                            ><strong>${p.name}</strong>
                            <span class="muted small">${p.done.toLocaleString()} of ${p.total.toLocaleString()}</span></span
                          >
                          <span class="aud-badge ${p.submitted ? 'aud-badge-submitted' : 'aud-badge-counting'}"
                            >${p.submitted ? 'Submitted' : `${p.percent}%`}</span
                          >
                          ${progressBar(p.percent)}
                        </li>`,
                    )}
                  </ul>`
        }
        <div class="aud-pop-foot">
          <span class="muted small" data-updated>${at ? `Updated ${clock(at)}${finished ? '' : ' · refreshes by itself'}` : ''}</span>
          <button type="button" class="btn btn-sm" data-s="refresh" ${busy ? 'disabled' : ''}>${busy ? 'Reading…' : 'Refresh now'}</button>
        </div>
      </div>`,
    );
    applyProgressBars(host);
  }

  async function refresh() {
    if (closed || busy) return;
    busy = true;
    try {
      model = progressFrom(await read(roundId));
      error = '';
      at = new Date();
    } catch (e) {
      // keep the last numbers on screen; say that the read failed
      error = model ? '' : friendlyError(e).message;
      if (model) at = at ?? null;
    }
    busy = false;
    if (closed) return;
    draw();
    if (model?.state && model.state !== 'counting') stop();
  }

  let timer = null;
  const stop = () => {
    if (timer) (deps.clear ?? clearInterval)(timer);
    timer = null;
  };
  function close() {
    if (closed) return;
    closed = true;
    stop();
    doc.defaultView?.removeEventListener('hashchange', close);
    host.remove();
    opener?.focus?.();
  }

  host.onclick = (e) => {
    const action = e.target.closest('button[data-s]')?.dataset.s;
    if (action === 'close') close();
    else if (action === 'refresh') void refresh();
    else if (e.target === host) close(); // a tap on the dimmed area
  };
  host.onkeydown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  };
  doc.defaultView?.addEventListener('hashchange', close);

  draw();
  host.querySelector('button[data-s="close"]')?.focus();
  void refresh().then(() => {
    if (!closed && !(model?.state && model.state !== 'counting')) timer = (deps.timer ?? setInterval)(() => void refresh(), every);
  });
  return { close, refresh };
}
