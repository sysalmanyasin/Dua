// The combined variance report: any or all of an audit's variance reports on one page, round by round.
// Each round keeps its own label and its own totals. Nothing is added across rounds, because a repeated round counts the same item
// again and a total across rounds would overstate the difference. Reads are the ones the Review and Final pages already make.
import { html, render } from '../../../shared/html.js';
import { money } from '../../../shared/format.js';
import { friendlyError } from '../domain/errors.js';
import { roundTotals } from '../domain/export.js';
import { exportAllRounds, exportable, loadRound } from './exports.js';

const SHOWN = 100; // lines shown on screen per round; the downloads hold every line
const signed = (n) => (n > 0 ? `+${n}` : String(n));

/** rounds: [{ id, label, state, items, who? }] */
export function mountCombinedReport(host, { auditName, rounds, who = (r) => r.who ?? '' }) {
  const ready = exportable(rounds);
  const s = { picked: new Set(ready.map((r) => r.id)), shown: null, busy: '', error: '' };
  const chosen = () => ready.filter((r) => s.picked.has(r.id));

  const section = (d) => {
    const t = roundTotals(d.lines);
    const lines = d.lines.slice(0, SHOWN);
    return html`<section class="aud-block" data-round-report="${d.label}">
      <h3>Round ${d.label}${d.who ? html` <span class="muted small">· ${d.who}</span>` : ''}</h3>
      <p class="small" data-round-totals>
        ${t.lines} ${t.lines === 1 ? 'line differs' : 'lines differ'} · net quantity ${signed(t.quantity)} · net value
        ${money(t.value, { decimals: true })}
      </p>
      ${
        d.lines.length === 0
          ? html`<p class="muted small">No differences in this round.</p>`
          : html`<div class="aud-table-wrap">
              <table class="aud-table">
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Product</th>
                    <th>System</th>
                    <th>Counted</th>
                    <th>Variance</th>
                    <th>Value</th>
                  </tr>
                </thead>
                <tbody>
                  ${lines.map(
                    (l) =>
                      html`<tr>
                        <td>${l.code}</td>
                        <td>${l.name}</td>
                        <td>${l.system}</td>
                        <td>${l.counted}${l.notCounted ? ' (not counted)' : l.assumed ? ' (assumed)' : ''}</td>
                        <td>${signed(l.variance)}</td>
                        <td>${money(l.value, { decimals: true })}</td>
                      </tr>`,
                  )}
                </tbody>
              </table>
            </div>`
      }
      ${d.lines.length > SHOWN ? html`<p class="muted small">Showing the first ${SHOWN} of ${d.lines.length}. The downloads hold every line.</p>` : ''}
    </section>`;
  };

  const draw = () =>
    render(
      host,
      html`<section class="card aud-card" aria-label="Combined variance report" data-sec="combined">
        <h2>Combined variance report</h2>
        <p class="muted small" data-no-sum>
          Rounds are shown one after another, each with its own totals. They are not added together: an item counted again in a later round
          would be counted twice.
        </p>
        ${
          rounds.length === 0
            ? html`<p class="muted" data-empty>There are no rounds to report on yet.</p>`
            : ready.length === 0
              ? html`<p class="muted" data-empty>No round has been compiled yet.</p>`
              : html`<fieldset class="aud-fieldset">
                    <legend>Rounds to include</legend>
                    ${rounds.map((r) => {
                      const ok = ready.includes(r);
                      return html`<label class="aud-check">
                        <input type="checkbox" data-pick="${r.id}" ${s.picked.has(r.id) ? 'checked' : ''} ${ok ? '' : 'disabled'} />
                        <span>Round ${r.label}${who(r) ? ` · ${who(r)}` : ''}${ok ? '' : ' · not compiled yet'}</span>
                      </label>`;
                    })}
                    <p class="aud-actions">
                      <button type="button" class="btn btn-sm btn-ghost" data-all>All</button>
                      <button type="button" class="btn btn-sm btn-ghost" data-none>None</button>
                    </p>
                  </fieldset>
                  <p class="aud-actions">
                    <button type="button" class="btn btn-primary" data-show ${s.busy || s.picked.size === 0 ? 'disabled' : ''}>
                      Show report
                    </button>
                    <button type="button" class="btn" data-download="combined" ${s.busy || s.picked.size === 0 ? 'disabled' : ''}>
                      CSV
                    </button>
                    <button type="button" class="btn" data-download="xlsx" ${s.busy || s.picked.size === 0 ? 'disabled' : ''}>Excel</button>
                    <button type="button" class="btn" data-download="summary" ${s.busy || s.picked.size === 0 ? 'disabled' : ''}>
                      Summary CSV
                    </button>
                  </p>
                  <p class="muted small" aria-live="polite" data-status>${s.busy}</p>`
        }
        ${s.error ? html`<p class="note note-error" role="alert">${s.error}</p>` : ''} ${s.shown ? s.shown.map(section) : ''}
      </section>`,
    );

  host.onchange = (e) => {
    const box = e.target.closest('input[data-pick]');
    if (!box) return;
    if (box.checked) s.picked.add(box.dataset.pick);
    else s.picked.delete(box.dataset.pick);
    s.shown = null;
    draw();
  };

  host.onclick = async (e) => {
    if (e.target.closest('[data-all]')) {
      s.picked = new Set(ready.map((r) => r.id));
      s.shown = null;
      return draw();
    }
    if (e.target.closest('[data-none]')) {
      s.picked = new Set();
      s.shown = null;
      return draw();
    }
    const show = e.target.closest('[data-show]');
    const download = e.target.closest('[data-download]');
    if (!show && !download) return;
    const picked = chosen();
    if (picked.length === 0 || s.busy) return;
    s.error = '';
    try {
      if (show) {
        const loaded = [];
        for (const [i, r] of picked.entries()) {
          s.busy = `Reading round ${i + 1} of ${picked.length}…`;
          draw();
          const data = await loadRound(r);
          if (data) loaded.push({ ...data, who: who(r) });
        }
        s.shown = loaded;
      } else {
        s.busy = 'Preparing the file…';
        draw();
        await exportAllRounds(auditName, picked, download.dataset.download, (text) => {
          s.busy = text;
          draw();
        });
      }
    } catch (err) {
      s.error = friendlyError(err).message;
    }
    s.busy = '';
    draw();
  };

  draw();
}
