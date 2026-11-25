// The Final Snapshot of one round. A compiled round is finalized here (owner only); a final round shows its totals, companies,
// conflict choices and lines, and can be printed or saved as CSV. The numbers are the database's; this screen only shows them.
import { html, render } from '../../../shared/html.js';
import { hero } from '../../../shared/ui.js';
import * as api from '../data/api.js';
import { rupees, toPaisa } from '../domain/count.js';
import { friendlyError } from '../domain/errors.js';
import { finalBlocked, finalChecks } from '../domain/finalChecks.js';
import { getView } from '../domain/nav.js';
import { finalCsv, safeFileName } from '../domain/report.js';
import { roundLabel } from './engagement.js';
import { crumbs, errorCard, loadingCard, toast } from './parts.js';
import { downloadText, printDocument } from './print.js';

const PAGE = 50;
const money = (v) => rupees(toPaisa(v));
const q = (n) => String(Number(n));
const when = (iso) => (iso ? new Date(iso).toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short' }) : '');
const lbl = (r) => (r.label ? `Round ${r.label}` : roundLabel(r));
const SIDE = { a: 'kept this round', b: 'kept the earlier round' };

const companyTable = (companies) =>
  html`<div class="aud-scroll">
    <table class="aud-table">
      <thead>
        <tr>
          <th>Company</th>
          <th class="num">Items</th>
          <th class="num">Differ</th>
          <th class="num">Short</th>
          <th class="num">Extra</th>
          <th class="num">Net</th>
        </tr>
      </thead>
      <tbody>
        ${companies.map(
          (c) =>
            html`<tr>
              <td>${c.company}</td>
              <td class="num">${c.items}</td>
              <td class="num">${c.variance_count}</td>
              <td class="num">${money(c.shortage_value)}</td>
              <td class="num">${money(c.excess_value)}</td>
              <td class="num">${money(c.variance_value)}</td>
            </tr>`,
        )}
      </tbody>
    </table>
  </div>`;

const lineTable = (rows) =>
  html`<div class="aud-scroll">
    <table class="aud-table">
      <thead>
        <tr>
          <th>Product</th>
          <th class="num">System</th>
          <th class="num">Counted</th>
          <th class="num">Final</th>
          <th class="num">Difference</th>
          <th class="num">Value</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(
          (l) =>
            html`<tr>
              <td>
                <strong>${l.name}</strong><br /><span class="muted small"
                  >${l.company} ·
                  ${l.code}${l.missing ? (l.auto_matched ? ' · assumed matching' : ' · not counted') : ''}${l.conflict_side ? ` · ${SIDE[l.conflict_side]}` : ''}</span
                >
              </td>
              <td class="num">${q(l.system_qty)}</td>
              <td class="num">${q(l.counted_qty)}</td>
              <td class="num">${q(l.final_qty)}</td>
              <td class="num">${Number(l.variance) > 0 ? '+' : ''}${q(l.variance)}</td>
              <td class="num">${money(l.variance_value)}</td>
            </tr>`,
        )}
      </tbody>
    </table>
  </div>`;

/** The printed page: summary, companies, conflict choices and every row that differs. */
export function printable(o, rows) {
  const f = o.final;
  return html`<div class="aud-print">
    <h1>${o.engagement.name} · ${lbl(o.round)} · Final</h1>
    <p>
      Finalized ${when(f.finalized_at)} by ${f.finalized_by}. ${f.item_count} items, ${f.variance_count} differ, net
      ${money(f.variance_value)}. ${f.with_missing ? 'Incomplete: some people had not submitted when it was compiled.' : ''}
      ${f.note ? `Note: ${f.note}` : ''}
    </p>
    <h2>By company</h2>
    ${companyTable(o.companies)}
    ${
      o.conflicts.length
        ? html`<h2>Conflicts settled</h2>
            <ul>
              ${o.conflicts.map(
                (c) => html`<li>${c.company} ${c.code} ${c.name}: ${SIDE[c.side] ?? ''} (${q(c.final_qty)}). ${c.reason ?? ''}</li>`,
              )}
            </ul>`
        : ''
    }
    <h2>Items that differ</h2>
    ${rows.length ? lineTable(rows) : html`<p>None.</p>`}
  </div>`;
}

export async function mount(el, { ctx } = {}) {
  const perms = ctx?.permissions ?? [];
  const can = (k) => perms.includes(k) || perms.includes('audit.manage');
  const canFinalize = can('audit.finalize');
  const canExport = can('audit.report') || can('audit.review');
  const view = getView();
  if (!view?.round) {
    return render(
      el,
      html`<div class="aud">
        <div class="card aud-card">
          <p>No round chosen. <a href="#/audit/engagements">Back to audits</a></p>
        </div>
      </div>`,
    );
  }
  const s = { r: null, final: null, rows: [], total: 0, page: 0, onlyDiff: true, note: '', confirm: false, busy: false, error: null };

  async function loadRows() {
    const page = await api.finalLines({ roundId: view.round, onlyVariance: s.onlyDiff, limit: PAGE, offset: s.page * PAGE });
    s.rows = page;
    s.total = page.length ? Number(page[0].total) : 0;
  }
  async function load() {
    s.r = await api.compileOverview(view.round);
    s.final = null;
    if (s.r.round.state === 'final') {
      s.final = await api.finalOverview(view.round);
      await loadRows();
    }
  }

  function finalizeCard() {
    const { round, compilation: c } = s.r;
    const checks = finalChecks(s.r);
    const blocked = finalBlocked(checks);
    if (round.state !== 'compiled' || !c) {
      return html`<section class="card aud-card">
        <h2>Not final yet</h2>
        <p class="muted">A round is made final after it has been compiled and its conflicts are settled.</p>
        <p><a class="btn btn-ghost btn-sm" href="#/audit/compile">Go to the review</a></p>
      </section>`;
    }
    return html`<section class="card aud-card" aria-label="Create the final">
      <h2>Create the Final Snapshot</h2>
      <p>
        Revision ${c.revision}: <strong>${c.variance_count}</strong> of ${c.item_count} items differ, net
        <strong>${money(c.variance_value)}</strong>.
      </p>
      <ul class="aud-checks" data-checks aria-label="Checks before the final">
        ${checks.map(
          (k) =>
            html`<li
              data-check="${k.key}"
              data-ok="${k.ok}"
              class="${k.ok ? 'aud-check-ok' : k.blocking ? 'aud-check-blocked' : 'aud-check-warn'}"
            >
              <span aria-hidden="true">${k.ok ? '✓' : k.blocking ? '✗' : '!'}</span>
              <span role="${k.ok ? 'presentation' : k.blocking ? 'alert' : 'status'}">${k.text}</span>
              ${k.fix ? html`<a class="btn btn-sm" href="${'#' + k.fix.path}">${k.fix.label}</a>` : ''}
            </li>`,
        )}
      </ul>
      <p class="muted small">The snapshot is kept as it is. The round cannot be counted, compiled or corrected afterwards.</p>
      ${
        canFinalize
          ? html`<label class="field"
                ><span>Note (optional)</span><input type="text" data-field="note" maxlength="500" value="${s.note}"
              /></label>
              ${
                s.confirm
                  ? html`<p class="note" role="alert">This cannot be undone.</p>
                      <div class="aud-actions">
                        <button type="button" class="btn btn-primary" data-act="finalize-yes" ${s.busy ? 'disabled' : ''}>
                          Yes, make it final
                        </button>
                        <button type="button" class="btn btn-ghost" data-act="cancel">Cancel</button>
                      </div>`
                  : html`<button type="button" class="btn btn-primary" data-act="finalize" ${blocked ? 'disabled' : ''}>
                      Make it final
                    </button>`
              }`
          : html`<p class="muted small">Only the owner can make a round final.</p>`
      }
    </section>`;
  }

  function finalView() {
    const o = s.final;
    const f = o.final;
    const short = o.companies.reduce((t, c) => t + toPaisa(c.shortage_value), 0);
    const extra = o.companies.reduce((t, c) => t + toPaisa(c.excess_value), 0);
    const pages = Math.max(1, Math.ceil(s.total / PAGE));
    return html` <section class="card aud-card" aria-label="Summary">
        <h2>Final · ${lbl(o.round)}</h2>
        <p>
          <strong>${f.variance_count}</strong> of ${f.item_count} items differ · net <strong>${money(f.variance_value)}</strong><br />
          <span class="muted small"
            >Short ${rupees(short)} · extra ${rupees(extra)} · ${f.missing_count} not counted or assumed matching</span
          >
        </p>
        <p class="muted small">Made final ${when(f.finalized_at)} by ${f.finalized_by} from compile revision ${f.compilation_revision}.</p>
        ${f.with_missing ? html`<p class="note" role="status">Incomplete: some people had not submitted when it was compiled.</p>` : ''}
        ${f.note ? html`<p>Note: ${f.note}</p>` : ''}
        ${
          canExport
            ? html`<div class="aud-actions no-print">
                <button type="button" class="btn btn-sm" data-act="print" ${s.busy ? 'disabled' : ''}>Print / Save as PDF</button>
                <button type="button" class="btn btn-sm btn-ghost" data-act="csv" ${s.busy ? 'disabled' : ''}>Download CSV</button>
              </div>`
            : ''
        }
      </section>
      <section class="card aud-card" aria-label="By company">
        <h2>By company</h2>
        ${companyTable(o.companies)}
      </section>
      ${
        o.conflicts.length
          ? html`<section class="card aud-card" aria-label="Conflicts settled">
              <h2>Conflicts settled (${f.conflict_changed} changed)</h2>
              <ul class="aud-list">
                ${o.conflicts.map(
                  (c) =>
                    html`<li>
                      <span
                        ><strong>${c.name}</strong><br /><span class="muted small"
                          >${c.company} · ${c.code} · ${SIDE[c.side] ?? ''}, final
                          ${q(c.final_qty)}${c.reason ? ` · ${c.reason}` : ''}</span
                        ></span
                      >
                    </li>`,
                )}
              </ul>
            </section>`
          : ''
      }
      <section class="card aud-card" aria-label="Lines">
        <h2>Items</h2>
        <label class="aud-radio"
          ><input type="checkbox" data-field="onlyDiff" ${s.onlyDiff ? 'checked' : ''} /> Only items that differ</label
        >
        <p class="muted small">${s.total} item${s.total === 1 ? '' : 's'}</p>
        ${s.rows.length ? lineTable(s.rows) : html`<p class="muted">Nothing to show.</p>`}
        <div class="aud-actions">
          <button type="button" class="btn btn-sm btn-ghost" data-act="prev" ${s.page === 0 ? 'disabled' : ''}>Previous</button>
          <span class="muted small">Page ${s.page + 1} of ${pages}</span>
          <button type="button" class="btn btn-sm btn-ghost" data-act="next" ${s.page + 1 >= pages ? 'disabled' : ''}>Next</button>
        </div>
      </section>`;
  }

  function draw() {
    const round = s.r.round;
    render(
      el,
      html`<div class="aud">
        ${crumbs([
          { label: 'Audits', href: '#/audit/engagements' },
          { label: 'This audit', href: '#/audit/engagement' },
          { label: roundLabel(round), href: '#/audit/round' },
          { label: 'Review', href: '#/audit/compile' },
          { label: s.final ? 'Final' : 'Final snapshot' },
        ])}
        ${hero({
          label: 'Audit',
          title: `${roundLabel(round)} · ${s.final ? 'final' : 'final snapshot'}`,
          sub: s.final ? 'Kept as it was on the day it was made final' : 'Make a compiled round final',
          actions: html`<a class="btn btn-ghost btn-sm" href="#/audit/compile">Review</a>`,
        })}
        ${s.error ? html`<p class="note note-error" role="alert">${s.error}</p>` : ''} ${s.final ? finalView() : finalizeCard()}
      </div>`,
    );
  }

  async function run(fn, done) {
    s.busy = true;
    s.error = null;
    draw();
    try {
      await fn();
      s.confirm = false;
      await load();
      if (done) toast(done);
    } catch (e) {
      const f = friendlyError(e);
      s.error = f.message;
      s.confirm = false;
      if (f.kind === 'conflict') {
        try {
          await load();
        } catch {
          /* the message above is enough */
        }
      }
    }
    s.busy = false;
    draw();
  }

  el.oninput = (e) => {
    if (e.target.dataset?.field === 'note') s.note = e.target.value;
  };
  el.onchange = async (e) => {
    if (e.target.dataset?.field !== 'onlyDiff') return;
    s.onlyDiff = e.target.checked;
    s.page = 0;
    await run(loadRows);
  };
  el.onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    switch (b.dataset.act) {
      case 'finalize':
        s.confirm = true;
        return draw();
      case 'cancel':
        s.confirm = false;
        return draw();
      case 'finalize-yes':
        return run(
          () => api.finalizeRound({ roundId: view.round, version: s.r.round.version, note: s.note.trim() }),
          'Final snapshot created.',
        );
      case 'prev':
      case 'next':
        s.page += b.dataset.act === 'next' ? 1 : -1;
        return run(loadRows);
      case 'print':
        return run(async () => printDocument(printable(s.final, await api.finalLinesAll(view.round, true))));
      case 'csv':
        return run(async () => {
          const lines = await api.finalLinesAll(view.round, false);
          downloadText(safeFileName(`${s.final.engagement.name}-${lbl(s.final.round)}-final`, 'csv'), finalCsv(lines));
        });
      default:
    }
  };

  render(el, loadingCard());
  try {
    await load();
  } catch (e) {
    return render(el, errorCard('the final snapshot', friendlyError(e).message));
  }
  draw();
}
