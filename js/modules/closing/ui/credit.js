// Credit Ledger: one snapshot per submitted closing, newest first, with a 3-inch receipt print (CLS-5).
// Shows only figures the database stored; nothing is added up or recomputed here.
import { html, render } from '../../../shared/html.js';
import { hero } from '../../../shared/ui.js';
import { money, shortDate } from '../../../shared/format.js';
import * as api from '../data/api.js';
import { friendlyError } from '../domain/errors.js';
import { groupByDate, receiptRows, snapshotTitle } from '../domain/ledgers.js';
import { errorCard, loadingCard, toast } from './parts.js';
import { printThermal } from './print.js';

const dot = (kind) => html`<span class="dot dot-${kind}"></span>`;
const amt = (v) => money(v, { decimals: true });

export async function mount(el) {
  let from = '';
  let to = '';
  let snapshots = [];

  const draw = () => {
    const groups = groupByDate(snapshots);
    render(
      el,
      html`<div class="cls">
        ${hero({ label: 'Closing', title: 'Credit Ledger', sub: 'The credit position stored with each submitted closing.' })}
        <div class="cls-grid">
          <section class="card">
            <div class="cls-pick">
              <div class="field"><label for="cl-from">From</label><input id="cl-from" type="date" value="${from}" /></div>
              <div class="field"><label for="cl-to">To</label><input id="cl-to" type="date" value="${to}" /></div>
              <div class="actions"><button type="button" class="btn btn-primary" id="cl-show">Show</button></div>
            </div>
            <p class="cls-meta"><a href="#/closing">Back to Closing</a></p>
          </section>
          ${
            groups.length
              ? groups.map(
                  (g) =>
                    html`<section class="card" data-date="${g.date}">
                      <h2>${shortDate(g.date)}</h2>
                      ${g.items.map(
                        (s) =>
                          html`<article class="cls-snap" data-closing="${s.closing_id}">
                            <header>
                              <span>${dot(s.kind)}<strong>${snapshotTitle(s)}</strong></span>
                              <span class="cls-meta">${s.mode === 'final' ? 'Final' : 'Shift'}</span>
                            </header>
                            <dl class="cls-kv">
                              <div>
                                <dt>Carried in</dt>
                                <dd>${amt(s.prev_credit)}</dd>
                              </div>
                              ${(s.lines ?? []).map(
                                (l) =>
                                  html`<div>
                                    <dt>${l.label || 'Credit'}</dt>
                                    <dd>${amt(l.amount)}</dd>
                                  </div>`,
                              )}
                              ${
                                Number(s.credit_adj) !== 0
                                  ? html`<div>
                                      <dt>Adjustment</dt>
                                      <dd>${amt(s.credit_adj)}</dd>
                                    </div>`
                                  : ''
                              }
                              <div class="cls-kv-total">
                                <dt>Total credit</dt>
                                <dd>${amt(s.debt_e)}</dd>
                              </div>
                            </dl>
                            <div class="actions">
                              <button type="button" class="btn btn-sm" data-act="print" data-id="${s.closing_id}">Print receipt</button>
                            </div>
                          </article>`,
                      )}
                    </section>`,
                )
              : html`<section class="card"><p class="muted">No submitted closings in this range.</p></section>`
          }
        </div>
      </div>`,
    );
    el.querySelector('#cl-show').addEventListener('click', () => {
      from = el.querySelector('#cl-from').value;
      to = el.querySelector('#cl-to').value;
      if (from && to && from > to) return toast('The start date is after the end date.', 'error');
      load();
    });
    el.querySelectorAll('[data-act="print"]').forEach((b) =>
      b.addEventListener('click', () => {
        const s = snapshots.find((x) => x.closing_id === b.dataset.id);
        if (s) printThermal(receiptRows(s));
      }),
    );
  };

  async function load() {
    render(el, loadingCard());
    try {
      snapshots = await api.creditLedger({ from: from || null, to: to || null });
    } catch (e) {
      return render(el, errorCard('the Credit Ledger', friendlyError(e).message));
    }
    draw();
  }
  await load();
}
