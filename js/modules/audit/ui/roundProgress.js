// A round's live counting progress, in a popup over the page: how far the count has got, who has counted how much, every product with
// its count, system quantity and difference (filter: All, Differences, Counted, Not counted; always A to Z), and, for the main
// auditor, Force Submit for a counter who has not submitted. It reads the round again every few seconds while it is open and stops by
// itself when it is closed, when the page is left, or when counting has finished. The only thing it can write is Force Submit, and
// only when the person who opened it holds audit.compile (the database checks the same key).
import { html, render } from '../../../shared/html.js';
import { money } from '../../../shared/format.js';
import * as api from '../data/api.js';
import { friendlyError } from '../domain/errors.js';
import { qtyText } from '../domain/history.js';
import { LIVE_FILTERS, diffText, filterLive, liveCounts, liveFrom } from '../domain/roundLive.js';
import { applyProgressBars, progressBar } from './parts.js';

const EVERY_MS = 8000;
const SHOWN = 300;
const clock = (d) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const STATE = { counting: 'Counting', compiled: 'Compiled', final: 'Finalized', draft: 'Getting ready', locked: 'Locked' };

/** Opens the popup for one round. `title` names it ("Round 10 · Mian Waqas"). `canForce` shows Force Submit (audit.compile).
 * `onChange` is called after a Force Submit so the page behind can reload. `deps` lets tests replace the document, the read, the
 * submit and the interval. Returns { close, refresh }. */
export function openRoundProgress({ roundId, title = 'Round', canForce = false, onChange = null, deps = {} } = {}) {
  const doc = deps.doc ?? document;
  const read = deps.read ?? api.roundLive;
  const submit = deps.submit ?? api.forceSubmit;
  const every = deps.every ?? EVERY_MS;
  const opener = doc.activeElement;
  let closed = false;
  let model = null;
  let error = '';
  let notice = '';
  let at = null;
  let busy = false;
  let filter = 'all';
  let force = null; // { id, name, mode, reason, busy, error } while the Force Submit form is open

  const host = doc.createElement('div');
  host.className = 'aud-pop';
  host.setAttribute('role', 'dialog');
  host.setAttribute('aria-modal', 'true');
  host.setAttribute('aria-labelledby', 'aud-pop-title');
  doc.body.append(host);

  const finishedNow = () => Boolean(model?.state && model.state !== 'counting');

  function forceForm() {
    return html`<div class="aud-pop-form" data-force-form>
      <p class="small">What should happen to the products <strong>${force.name}</strong> has not counted?</p>
      <label class="aud-pop-radio"
        ><input type="radio" name="aud-fmode" data-field="mode" value="as_counted" ${force.mode === 'as_counted' ? 'checked' : ''} /> Leave
        them uncounted (they count as zero in stock)</label
      >
      <label class="aud-pop-radio"
        ><input type="radio" name="aud-fmode" data-field="mode" value="match" ${force.mode === 'match' ? 'checked' : ''} /> Mark them as
        matching the system (kept flagged as assumed)</label
      >
      <label class="aud-pop-field"
        ><span>Why? (kept in the history)</span><input type="text" data-field="reason" maxlength="500" value="${force.reason}"
      /></label>
      ${force.error ? html`<p class="note note-error" role="alert" data-force-error>${force.error}</p>` : ''}
      <div class="aud-pop-actions">
        <button type="button" class="btn btn-primary btn-sm" data-s="force-yes" ${force.busy ? 'disabled' : ''}>
          ${force.busy ? 'Submitting…' : 'Force submit'}
        </button>
        <button type="button" class="btn btn-ghost btn-sm" data-s="force-cancel" ${force.busy ? 'disabled' : ''}>Cancel</button>
      </div>
    </div>`;
  }

  function itemRow(i) {
    const counted = i.counted
      ? html`Counted <strong>${qtyText(i.qty)}</strong> · System ${qtyText(i.systemQty)} ·
          <span class="${i.hasDifference ? 'aud-pop-diff' : ''}" data-diff
            >Difference
            ${diffText(i.difference)}${i.hasDifference && i.value !== null ? ` (${money(i.value, { decimals: true })})` : ''}</span
          >`
      : html`<span data-not-counted>Not counted</span>`;
    return html`<li data-item class="${i.counted ? '' : 'aud-pop-left'}">
      <strong>${i.name}</strong>
      <span class="muted small">${i.code} · ${i.company}${i.person && model.people.length > 1 ? ` · ${i.person}` : ''}</span>
      <span class="small">${counted}${i.assumed ? ' · assumed to match' : ''}${i.note ? ` · note: ${i.note}` : ''}</span>
    </li>`;
  }

  function draw() {
    const m = model;
    const finished = finishedNow();
    const canActOn = canForce && m && m.state === 'counting';
    const counts = m ? liveCounts(m.items) : null;
    const rows = m ? filterLive(m.items, filter) : [];
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
                    <div class="aud-pop-percent" data-percent>${m.totals.percent}<span>%</span></div>
                    <div>
                      <strong data-counted>${m.totals.counted.toLocaleString()} of ${m.totals.items.toLocaleString()} counted</strong>
                      <p class="muted small" data-remaining>${m.totals.remaining.toLocaleString()} remaining</p>
                      <p class="small" data-differences>
                        ${m.totals.differences.toLocaleString()}
                        ${m.totals.differences === 1 ? 'difference' : 'differences'}${
                          m.totals.differences ? ` (${money(m.totals.value, { decimals: true })})` : ''
                        }
                      </p>
                    </div>
                  </div>
                  ${progressBar(m.totals.percent)}
                  ${
                    finished
                      ? html`<p class="aud-pop-state" data-finished>${STATE[m.state] ?? m.state}: counting has finished.</p>`
                      : html`<p class="aud-pop-state aud-live" data-live-state>
                          <span class="aud-dot" aria-hidden="true"></span> Counting now
                        </p>`
                  }
                  ${notice ? html`<p class="note" role="status" data-notice>${notice}</p>` : ''}
                  <ul class="aud-pop-people">
                    ${m.people.map(
                      (p) =>
                        html`<li data-person>
                          <span
                            ><strong>${p.name}</strong>
                            <span class="muted small">${p.done.toLocaleString()} of ${p.total.toLocaleString()}</span></span
                          >
                          <span class="aud-pop-badge ${p.submitted ? 'is-submitted' : ''}"
                            >${p.submitted ? (p.forced ? 'Submitted by owner' : 'Submitted') : `${p.percent}%`}</span
                          >
                          ${progressBar(p.percent)}
                          ${
                            canActOn && !p.submitted
                              ? force?.id === p.id
                                ? forceForm()
                                : html`<button
                                    type="button"
                                    class="btn btn-sm aud-pop-force"
                                    data-s="force"
                                    data-id="${p.id}"
                                    data-name="${p.name}"
                                  >
                                    Force submit
                                  </button>`
                              : ''
                          }
                        </li>`,
                    )}
                  </ul>
                  <div class="aud-pop-filters" role="group" aria-label="Show products">
                    ${LIVE_FILTERS.map(
                      (f) =>
                        html`<button
                          type="button"
                          class="btn btn-sm ${filter === f.key ? 'btn-primary' : 'btn-ghost'}"
                          data-f="${f.key}"
                          aria-pressed="${filter === f.key}"
                        >
                          ${f.label} (${counts[f.key]})
                        </button>`,
                    )}
                  </div>
                  <p class="muted small">Products A to Z</p>
                  ${
                    rows.length === 0
                      ? html`<p class="muted small" data-empty>No products in this view.</p>`
                      : html`<ul class="aud-pop-items" data-items>
                          ${rows.slice(0, SHOWN).map(itemRow)}
                        </ul>`
                  }
                  ${rows.length > SHOWN ? html`<p class="muted small" data-more>Showing the first ${SHOWN} of ${rows.length}. Use a filter to narrow it.</p>` : ''}`
        }
        <div class="aud-pop-foot">
          <span class="muted small" data-updated>${at ? `Updated ${clock(at)}${finished ? '' : ' · refreshes by itself'}` : ''}</span>
          <button type="button" class="btn btn-sm" data-s="refresh" ${busy ? 'disabled' : ''}>${busy ? 'Reading…' : 'Refresh now'}</button>
        </div>
      </div>`,
    );
    applyProgressBars(host);
  }

  // `quiet` is the timer: it updates the numbers but does not redraw over a form someone is typing in
  async function refresh({ quiet = false } = {}) {
    if (closed || busy) return;
    busy = true;
    try {
      model = liveFrom(await read(roundId));
      error = '';
      at = new Date();
    } catch (e) {
      // keep the last numbers on screen; say that the read failed only when there is nothing to show
      error = model ? '' : friendlyError(e).message;
    }
    busy = false;
    if (closed) return;
    if (!(quiet && force)) draw();
    if (finishedNow()) stop();
  }

  async function doForce() {
    if (!force || force.busy) return;
    const reason = force.reason.trim();
    if (reason.length < 3) {
      force.error = 'Please give a reason (at least 3 letters).';
      return draw();
    }
    force.busy = true;
    force.error = '';
    draw();
    const { id, name, mode } = force;
    try {
      await submit({ assignmentId: id, mode, reason });
    } catch (e) {
      if (closed) return;
      force.busy = false;
      force.error = friendlyError(e).message;
      return draw();
    }
    if (closed) return;
    force = null;
    notice = `Submitted for ${name}.`;
    await refresh();
    onChange?.();
    // a forced submit can finish the round (an Individual round compiles itself); the timer stops then
    if (!finishedNow() && !timer) startTimer();
  }

  let timer = null;
  const stop = () => {
    if (timer) (deps.clear ?? clearInterval)(timer);
    timer = null;
  };
  const startTimer = () => {
    timer = (deps.timer ?? setInterval)(() => void refresh({ quiet: true }), every);
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
    const btn = e.target.closest('button');
    const action = btn?.dataset.s;
    if (action === 'close') close();
    else if (action === 'refresh') void refresh();
    else if (action === 'force') {
      force = { id: btn.dataset.id, name: btn.dataset.name, mode: 'as_counted', reason: '', busy: false, error: '' };
      notice = '';
      draw();
      host.querySelector('[data-force-form] input[type="text"]')?.focus();
    } else if (action === 'force-cancel') {
      force = null;
      draw();
    } else if (action === 'force-yes') void doForce();
    else if (btn?.dataset.f) {
      filter = btn.dataset.f;
      draw();
    } else if (e.target === host) close(); // a tap on the dimmed area
  };
  host.oninput = (e) => {
    if (force && e.target.matches('input[type="text"][data-field="reason"]')) force.reason = e.target.value;
  };
  host.onchange = (e) => {
    if (force && e.target.matches('input[type="radio"][data-field="mode"]')) force.mode = e.target.value;
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
    if (!closed && !finishedNow()) startTimer();
  });
  return { close, refresh };
}
