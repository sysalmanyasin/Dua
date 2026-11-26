// Report: every STR in the live feed, by dispatching branch, then STR, then supplier. Per-person column choices and
// "Hide 0-Dispatch" are kept in user_prefs. Hide 0-Dispatch uses the same rule as the Zero Dispatch page (STR-5).
import { html, render } from '../../../shared/html.js';
import { shortDate } from '../../../shared/format.js';
import { getPref, setPref } from '../../../core/prefs.js';
import { numberRows } from '../domain/mapping.js';
import { STAGES, STAGE_LABEL, branchCounts, filterHeaders } from '../domain/filter.js';
import { REPORT_COLUMNS, groupByBranch, normalizeColumns } from '../domain/report.js';
import { visibleReportEntries } from '../domain/zero.js';
import { loadEntries } from './bundle.js';
import { linesTable } from './lines-table.js';
import { errorCard, loadingCard, printHead, stageBadge } from './parts.js';
import { printPage } from './print.js';

export const COLS_KEY = 'str.report_cols';
export const HIDE_KEY = 'str.report_hide0';

const date = (v) => (v ? shortDate(v) : '');

export async function mount(el) {
  render(el, html`<div class="str">${loadingCard()}</div>`);
  let data;
  let cols = normalizeColumns(REPORT_COLUMNS, null);
  let hide = false;
  let stage = 'all';
  let branch = 'all'; // 'all' | 'dispatched' (from BT) | 'received' (at BT), same chips as the Transfers page
  let dateFrom = '';
  let dateTo = '';
  let busy = false;
  let failed = false;
  let ticket = 0;
  try {
    const [loaded, savedCols, savedHide] = await Promise.all([
      loadEntries(),
      getPref(COLS_KEY).catch(() => null),
      getPref(HIDE_KEY).catch(() => null),
    ]);
    data = loaded;
    cols = normalizeColumns(REPORT_COLUMNS, savedCols);
    hide = savedHide === true;
  } catch {
    render(el, html`<div class="str">${errorCard('the report')}</div>`);
    return;
  }

  const shown = () => {
    const ids = new Set(
      filterHeaders(
        data.entries.map((e) => e.h),
        { stage, branch },
      ).map((h) => h.strId),
    );
    const wanted = data.entries.filter((e) => ids.has(e.h.strId));
    return visibleReportEntries(wanted, hide).map((e) => ({ h: e.h, groups: numberRows(e.groups) }));
  };
  const body = (entries) =>
    groupByBranch(entries).map(
      (b) =>
        html`<section class="str-branch">
          <h3>${b.branch}</h3>
          ${b.entries.map(
            (e) =>
              html`<div class="str-entry">
                <div class="str-title">
                  <h4>STR #${e.h.strNumber || e.h.strId}</h4>
                  ${stageBadge(e.h.stage)}
                </div>
                <p class="muted">${e.h.dispatchBranch || '—'} → ${e.h.receiveBranch || '—'} · ${date(e.h.strDate)}</p>
                ${linesTable(e.groups, REPORT_COLUMNS, cols)}
              </div>`,
          )}
        </section>`,
    );

  // A date range asks the server (it reaches the one-month history); clearing it returns to the live feed.
  async function reload() {
    const mine = ++ticket;
    busy = true;
    failed = false;
    paint();
    try {
      const loaded = await loadEntries({ from: dateFrom, to: dateTo });
      if (mine !== ticket) return;
      data = loaded;
    } catch {
      if (mine !== ticket) return;
      failed = true;
    }
    busy = false;
    paint();
  }

  function paint() {
    const entries = shown();
    const counts = branchCounts(data.entries.map((e) => e.h));
    const ranged = Boolean(dateFrom || dateTo);
    const chip = (key, label, n) =>
      html`<button type="button" class="str-chip" data-branch="${key}" aria-pressed="${branch === key}">
        ${label}${n !== null ? html` <b>${n}</b>` : ''}
      </button>`;
    render(
      el,
      html`<div class="str">
        <section class="card">
          <h2>Report</h2>
          <p class="muted">
            ${ranged ? 'Transfers dated in this range, including recent history, by dispatching branch.' : 'Transfers in the current feed, by dispatching branch.'}
          </p>
          <div class="str-stages" role="group" aria-label="Stage">
            ${['all', ...STAGES].map(
              (s) =>
                html`<button type="button" class="str-stage" data-stage="${s}" aria-pressed="${stage === s}">
                  ${s === 'all' ? 'All' : STAGE_LABEL[s]}
                </button>`,
            )}
          </div>
          <div class="str-chips" role="group" aria-label="Branch">
            ${chip('all', 'All transfers', null)}${chip('dispatched', 'Dispatched from BT', counts.dispatched)}${chip('received', 'Received at BT', counts.received)}
          </div>
          <div class="str-dates">
            <div class="field"><label for="str-from">From</label><input id="str-from" type="date" value="${dateFrom}" /></div>
            <div class="field"><label for="str-to">To</label><input id="str-to" type="date" value="${dateTo}" /></div>
            <div class="actions"><button type="button" class="btn btn-ghost" id="str-clear">Clear</button></div>
          </div>
          ${busy ? html`<p class="str-status" role="status">Loading…</p>` : ''}
          ${failed ? html`<p class="str-note" role="status">Could not load that date range. Check your connection and try again.</p>` : ''}
          <label class="str-check"><input type="checkbox" id="str-hide0" ${hide ? 'checked' : ''} /> Hide 0-Dispatch lines</label>
          <details class="str-cols">
            <summary>Columns</summary>
            ${REPORT_COLUMNS.map(
              (c) =>
                html`<label class="str-check"
                  ><input type="checkbox" data-col="${c.key}" ${cols[c.key] ? 'checked' : ''} /> ${c.label}</label
                >`,
            )}
          </details>
          ${data.metaMissing ? html`<p class="str-note">Supplier names and pack sizes come from Inventory and are not available yet, so quantities are in loose units.</p>` : ''}
          <div class="actions str-actions">
            <button type="button" class="btn btn-primary" id="str-print" ${entries.length && !busy ? '' : 'disabled'}>Print</button>
          </div>
        </section>
        ${
          entries.length
            ? html`<section class="card">${body(entries)}</section>`
            : html`<section class="card"><p class="muted">Nothing to show for this choice.</p></section>`
        }
      </div>`,
    );
  }

  el.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-stage]');
    if (b) {
      stage = b.dataset.stage;
      paint();
    }
    const c = ev.target.closest('[data-branch]');
    if (c) {
      branch = c.dataset.branch;
      paint();
    }
    if (ev.target.closest('#str-clear') && (dateFrom || dateTo)) {
      dateFrom = '';
      dateTo = '';
      reload();
    }
    if (ev.target.closest('#str-print')) {
      const entries = shown();
      if (entries.length)
        printPage(
          html`${printHead('STOCK TRANSFER REPORT', html`${entries.length} transfer${entries.length === 1 ? '' : 's'}${dateFrom || dateTo ? html` · ${dateFrom ? shortDate(dateFrom) : '…'} to ${dateTo ? shortDate(dateTo) : '…'}` : ''}`)}${body(entries)}`,
        );
    }
  });
  el.addEventListener('change', (ev) => {
    const t = ev.target;
    if (t.id === 'str-from' || t.id === 'str-to') {
      if (t.id === 'str-from') dateFrom = t.value;
      else dateTo = t.value;
      reload();
    } else if (t.id === 'str-hide0') {
      hide = t.checked;
      setPref(HIDE_KEY, hide).catch(() => {});
      paint();
    } else if (t.dataset?.col) {
      cols = { ...cols, [t.dataset.col]: t.checked };
      setPref(COLS_KEY, cols).catch(() => {});
      paint();
    }
  });
  paint();
}
