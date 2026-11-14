// Zero Dispatch: lines where the STR asked for stock and none was sent (rule STR-5), by dispatching branch.
// Each STR has a tick box (unticked at first); only ticked STRs are printed. Column choices are kept per person.
import { html, render } from '../../../shared/html.js';
import { shortDate } from '../../../shared/format.js';
import { getPref, setPref } from '../../../core/prefs.js';
import { numberRows } from '../domain/mapping.js';
import { ZERO_COLUMNS, groupByBranch, normalizeColumns } from '../domain/report.js';
import { itemCount, printableSelection, pruneSelection, zeroDispatchEntries } from '../domain/zero.js';
import { loadEntries } from './bundle.js';
import { linesTable } from './lines-table.js';
import { errorCard, loadingCard, printHead, stageBadge } from './parts.js';
import { printPage } from './print.js';

export const COLS_KEY = 'str.zero_cols';
const date = (v) => (v ? shortDate(v) : '');

export async function mount(el) {
  render(el, html`<div class="str">${loadingCard()}</div>`);
  let data;
  let cols = normalizeColumns(ZERO_COLUMNS, null);
  try {
    const [loaded, saved] = await Promise.all([loadEntries(), getPref(COLS_KEY).catch(() => null)]);
    data = loaded;
    cols = normalizeColumns(ZERO_COLUMNS, saved);
  } catch {
    render(el, html`<div class="str">${errorCard('Zero Dispatch')}</div>`);
    return;
  }
  const entries = zeroDispatchEntries(data.entries).map((e) => ({ h: e.h, groups: numberRows(e.groups) }));
  let selected = pruneSelection(entries, new Set());

  const body = (list, withBoxes) =>
    groupByBranch(list).map(
      (b) =>
        html`<section class="str-branch">
          <h3>${b.branch}</h3>
          ${b.entries.map(
            (e) =>
              html`<div class="str-entry">
                <div class="str-title">
                  ${
                    withBoxes
                      ? html`<label class="str-check"
                          ><input type="checkbox" data-pick="${e.h.strId}" ${selected.has(e.h.strId) ? 'checked' : ''} />
                          <strong>STR #${e.h.strNumber || e.h.strId}</strong></label
                        >`
                      : html`<h4>STR #${e.h.strNumber || e.h.strId}</h4>`
                  }
                  ${stageBadge(e.h.stage)}
                </div>
                <p class="muted">
                  ${e.h.dispatchBranch || '—'} → ${e.h.receiveBranch || '—'} · ${date(e.h.strDate)} · ${itemCount(e.groups)}
                  line${itemCount(e.groups) === 1 ? '' : 's'}
                </p>
                ${linesTable(e.groups, ZERO_COLUMNS, cols)}
              </div>`,
          )}
        </section>`,
    );

  function paint() {
    render(
      el,
      html`<div class="str">
        <section class="card">
          <h2>Zero Dispatch</h2>
          <p class="muted">Lines asked for but not sent, on dispatched or received transfers.</p>
          <details class="str-cols">
            <summary>Columns</summary>
            ${ZERO_COLUMNS.map(
              (c) =>
                html`<label class="str-check"
                  ><input type="checkbox" data-col="${c.key}" ${cols[c.key] ? 'checked' : ''} /> ${c.label}</label
                >`,
            )}
          </details>
          ${data.metaMissing ? html`<p class="str-note">Supplier names and pack sizes come from Inventory and are not available yet, so quantities are in loose units.</p>` : ''}
          <div class="actions str-actions">
            <button type="button" class="btn" id="str-all" ${entries.length ? '' : 'disabled'}>Select all</button>
            <button type="button" class="btn" id="str-none" ${selected.size ? '' : 'disabled'}>Select none</button>
            <button type="button" class="btn btn-primary" id="str-print" ${selected.size ? '' : 'disabled'}>
              Print selected (${selected.size})
            </button>
          </div>
        </section>
        <section class="card">
          ${entries.length ? body(entries, true) : html`<p class="muted">No zero-dispatch lines right now.</p>`}
        </section>
      </div>`,
    );
  }

  el.addEventListener('click', (ev) => {
    if (ev.target.closest('#str-all')) selected = new Set(entries.map((e) => e.h.strId));
    else if (ev.target.closest('#str-none')) selected = new Set();
    else if (ev.target.closest('#str-print')) {
      const list = printableSelection(entries, selected);
      if (list.length)
        printPage(html`${printHead('ZERO DISPATCH', html`${list.length} transfer${list.length === 1 ? '' : 's'}`)}${body(list, false)}`);
      return;
    } else return;
    paint();
  });
  el.addEventListener('change', (ev) => {
    const t = ev.target;
    if (t.dataset?.pick) {
      const id = Number(t.dataset.pick);
      selected = new Set(selected);
      if (t.checked) selected.add(id);
      else selected.delete(id);
    } else if (t.dataset?.col) {
      cols = { ...cols, [t.dataset.col]: t.checked };
      setPref(COLS_KEY, cols).catch(() => {});
    } else return;
    paint();
  });
  paint();
}
