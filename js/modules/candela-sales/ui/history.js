// Every kept day, with date filter and totals. Rows come from the permanent history table.
import { html, render } from '../../../shared/html.js';
import { hero } from '../../../shared/ui.js';
import { shortDate, todayPkt, weekday } from '../../../shared/format.js';
import * as api from '../data/api.js';
import { addDays, summarizePayments } from '../domain/summary.js';
import { emptyCard, errorCard, loadingCard, m } from './parts.js';

export async function mount(el) {
  const state = { from: addDays(todayPkt(), -29), to: todayPkt(), rows: null, error: false };

  async function load() {
    state.rows = null;
    paint();
    try {
      state.rows = await api.paymentDays(state.from || null, state.to || null);
      state.error = false;
    } catch {
      state.error = true;
    }
    paint();
  }

  function paint() {
    const body = state.error
      ? errorCard()
      : !state.rows
        ? loadingCard()
        : !state.rows.length
          ? emptyCard('No days in this range.')
          : table(state.rows);
    render(
      el,
      html`${hero({ label: 'Candela Sales', title: 'Daily History', sub: 'Every day Candela has sent, kept permanently' })}
        <div class="card">
          <div class="fields">
            <label class="field"><span>From</span><input type="date" data-f="from" value="${state.from}" /></label>
            <label class="field"><span>To</span><input type="date" data-f="to" value="${state.to}" /></label>
          </div>
        </div>
        ${body}`,
    );
    el.querySelectorAll('[data-f]').forEach((i) =>
      i.addEventListener('change', () => {
        state[i.dataset.f] = i.value;
        load();
      }),
    );
    el.querySelector('[data-act="retry"]')?.addEventListener('click', load);
  }

  const table = (rows) => {
    const sum = summarizePayments(rows);
    return html`<div class="card">
      <table class="table">
        <thead>
          <tr>
            <th>Day</th>
            <th class="num">Cash</th>
            <th class="num">Card</th>
            <th class="num">Credit</th>
            <th class="num">Total</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(
            (r) =>
              html`<tr>
                <td>
                  ${weekday(r.sale_day).slice(0, 3)}
                  ${shortDate(r.sale_day)}${r.revision > 1 ? html` <span class="chip chip-warn">Corrected</span>` : ''}
                </td>
                <td class="num">${m(r.cash_sale)}</td>
                <td class="num">${m(r.card_sale)}</td>
                <td class="num">${m(r.credit_sale)}</td>
                <td class="num">${m(r.total_sale)}</td>
              </tr>`,
          )}
          <tr class="sum">
            <td>${rows.length} day${rows.length === 1 ? '' : 's'}</td>
            <td class="num">${m(sum.cash_sale)}</td>
            <td class="num">${m(sum.card_sale)}</td>
            <td class="num">${m(sum.credit_sale)}</td>
            <td class="num">${m(sum.total_sale)}</td>
          </tr>
        </tbody>
      </table>
    </div>`;
  };

  await load();
}
