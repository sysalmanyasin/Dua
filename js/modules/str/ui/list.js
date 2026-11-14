// STR list: search, stage buttons, branch chips, date range. The feed's few days are filtered on the phone; a typed search
// or a date range asks the server, which also reaches the one-month history. Nothing here is written anywhere.
import { html, render } from '../../../shared/html.js';
import { hero } from '../../../shared/ui.js';
import { shortDate } from '../../../shared/format.js';
import * as api from '../data/api.js';
import { branchCounts, filterHeaders, STAGES, STAGE_LABEL } from '../domain/filter.js';
import { titleOf, toHeader } from '../domain/mapping.js';
import { errorCard, loadingCard, stageBadge } from './parts.js';
import { resetFilters, state } from './state.js';

const PAGE = 50;
const DIRECTION = { dispatched: 'out', received: 'in' };

const row = (h) =>
  html`<li>
    <button type="button" class="str-row" data-id="${h.strId}">
      <span class="str-row-top"><strong>${titleOf(h)}</strong>${stageBadge(h.stage)}</span>
      <span class="str-row-route">${h.dispatchBranch || '—'} → ${h.receiveBranch || '—'}</span>
      <span class="str-row-meta"
        >${h.strDate ? shortDate(h.strDate) : 'No date'} · ${h.lineCount}
        item${h.lineCount === 1 ? '' : 's'}${h.masterStrId ? html` · Master ${h.masterStrId}` : ''}</span
      >
      ${h.comments ? html`<span class="str-row-note">${h.comments}</span>` : ''}
    </button>
  </li>`;

export async function mount(el) {
  let feed = [];
  let rows = [];
  let more = false;
  let busy = false;
  let failed = false;
  let asOf = null;
  let timer = null;
  let ticket = 0;

  const useServer = () => Boolean(state.search.trim() || state.dateFrom || state.dateTo);

  const serverArgs = (offset) => ({
    text: state.search,
    from: state.dateFrom,
    to: state.dateTo,
    stage: state.stage === 'all' ? null : state.stage,
    direction: DIRECTION[state.branch] ?? null,
    limit: PAGE,
    offset,
  });

  async function refresh({ append = false } = {}) {
    const mine = ++ticket;
    failed = false;
    if (useServer()) {
      busy = true;
      drawResults();
      try {
        const got = (await api.searchHeaders(serverArgs(append ? rows.length : 0))).map(toHeader);
        if (mine !== ticket) return;
        rows = append ? rows.concat(got) : got;
        more = got.length === PAGE;
      } catch {
        if (mine !== ticket) return;
        failed = true;
        rows = [];
        more = false;
      }
      busy = false;
    } else {
      rows = filterHeaders(feed, { stage: state.stage, branch: state.branch });
      more = false;
    }
    state.orderedIds = rows.map((h) => h.strId);
    drawResults();
  }

  const counts = () => branchCounts(feed);

  function drawControls() {
    const c = counts();
    const chip = (key, label, n) =>
      html`<button type="button" class="str-chip" data-branch="${key}" aria-pressed="${state.branch === key}">
        ${label}${!useServer() && n !== null ? html` <b>${n}</b>` : ''}
      </button>`;
    render(
      el.querySelector('#str-controls'),
      html`<div class="field">
          <label for="str-search">Search</label>
          <input
            id="str-search"
            type="search"
            autocomplete="off"
            placeholder="STR number, product code or name, ref, comments…"
            value="${state.search}"
          />
        </div>
        <div class="str-stages" role="group" aria-label="Stage">
          ${[['all', 'All'], ...STAGES.map((s) => [s, STAGE_LABEL[s]])].map(
            ([k, label]) =>
              html`<button type="button" class="str-stage" data-stage="${k}" aria-pressed="${state.stage === k}">${label}</button>`,
          )}
        </div>
        <div class="str-chips" role="group" aria-label="Branch">
          ${chip('all', 'All transfers', null)}${chip('dispatched', 'Dispatched from BT', c.dispatched)}${chip('received', 'Received at BT', c.received)}
        </div>
        <div class="str-dates">
          <div class="field"><label for="str-from">From</label><input id="str-from" type="date" value="${state.dateFrom}" /></div>
          <div class="field"><label for="str-to">To</label><input id="str-to" type="date" value="${state.dateTo}" /></div>
          <div class="actions"><button type="button" class="btn btn-ghost" id="str-clear">Clear</button></div>
        </div>`,
    );
  }

  function drawResults() {
    const where = useServer() ? 'matching your search, including recent history' : 'in the current feed';
    const stamp = asOf
      ? ` · data as of ${new Date(asOf).toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Karachi' })}`
      : '';
    render(
      el.querySelector('#str-results'),
      html`<p class="str-status" role="status">
          ${busy ? 'Searching…' : failed ? 'Search failed.' : `${rows.length}${more ? '+' : ''} STR${rows.length === 1 ? '' : 's'} ${where}${stamp}`}
        </p>
        ${failed ? html`<p class="muted">Check your connection and try again.</p>` : ''}
        ${
          rows.length
            ? html`<ul class="str-list">
                ${rows.map(row)}
              </ul>`
            : busy || failed
              ? ''
              : html`<p class="muted str-empty">
                  ${useServer() ? 'No transfers match. Try fewer words or a wider date range.' : 'No transfers in the current feed.'}
                </p>`
        }
        ${more ? html`<div class="actions"><button type="button" class="btn" id="str-more" ${busy ? 'disabled' : ''}>Load more</button></div>` : ''}`,
    );
  }

  render(
    el,
    html`<div class="str">
      ${hero({ label: 'STR', title: 'Stock Transfers', sub: 'Awaited, dispatched and received transfers between branches.' })}
      <section class="card"><div id="str-controls"></div></section>
      <section class="card" id="str-results">${loadingCard()}</section>
    </div>`,
  );

  el.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.id) {
      state.selectedId = Number(t.dataset.id);
      location.hash = '#/str/detail';
    } else if (t.dataset.stage) {
      state.stage = t.dataset.stage;
      drawControls();
      refresh();
    } else if (t.dataset.branch) {
      state.branch = t.dataset.branch;
      drawControls();
      refresh();
    } else if (t.id === 'str-clear') {
      resetFilters();
      drawControls();
      refresh();
    } else if (t.id === 'str-more') {
      refresh({ append: true });
    }
  });
  el.addEventListener('input', (e) => {
    if (e.target.id === 'str-search') {
      state.search = e.target.value;
      clearTimeout(timer);
      timer = setTimeout(() => {
        drawControls(); // chip counts hide while searching
        el.querySelector('#str-search')?.focus();
        refresh();
      }, 350);
    }
  });
  el.addEventListener('change', (e) => {
    if (e.target.id === 'str-from' || e.target.id === 'str-to') {
      state[e.target.id === 'str-from' ? 'dateFrom' : 'dateTo'] = e.target.value;
      drawControls();
      refresh();
    }
  });

  drawControls();
  try {
    const [headers, stamp] = await Promise.all([api.feedHeaders(), api.dataAsOf().catch(() => null)]);
    feed = headers.map(toHeader);
    asOf = stamp;
  } catch {
    render(el.querySelector('#str-results'), errorCard('transfers'));
    return;
  }
  drawControls();
  await refresh();
}
