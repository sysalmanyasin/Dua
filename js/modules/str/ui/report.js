// Report: every STR in the live feed, by dispatching branch, then STR, then supplier. Per-person column choices and
// "Hide 0-Dispatch" are kept in user_prefs. Hide 0-Dispatch uses the same rule as the Zero Dispatch page (STR-5).
import { html, render } from '../../../shared/html.js';
import { shortDate } from '../../../shared/format.js';
import { getPref, setPref } from '../../../core/prefs.js';
import { numberRows } from '../domain/mapping.js';
import { STAGES, STAGE_LABEL } from '../domain/filter.js';
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
    const wanted = stage === 'all' ? data.entries : data.entries.filter((e) => e.h.stage === stage);
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

  function paint() {
    const entries = shown();
    render(
      el,
      html`<div class="str">
        <section class="card">
          <h2>Report</h2>
          <p class="muted">Transfers in the current feed, by dispatching branch.</p>
          <div class="str-stages" role="group" aria-label="Stage">
            ${['all', ...STAGES].map(
              (s) =>
                html`<button type="button" class="str-stage" data-stage="${s}" aria-pressed="${stage === s}">
                  ${s === 'all' ? 'All' : STAGE_LABEL[s]}
                </button>`,
            )}
          </div>
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
            <button type="button" class="btn btn-primary" id="str-print" ${entries.length ? '' : 'disabled'}>Print</button>
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
    if (ev.target.closest('#str-print')) {
      const entries = shown();
      if (entries.length)
        printPage(
          html`${printHead('STOCK TRANSFER REPORT', html`${entries.length} transfer${entries.length === 1 ? '' : 's'}`)}${body(entries)}`,
        );
    }
  });
  el.addEventListener('change', (ev) => {
    const t = ev.target;
    if (t.id === 'str-hide0') {
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
