// Credit sales per customer. One customer = one name (ignoring case and spaces). Not an outstanding balance.
import { html, render } from '../../../shared/html.js';
import { hero } from '../../../shared/ui.js';
import { monthLabel, shortDate, todayPkt } from '../../../shared/format.js';
import * as api from '../data/api.js';
import { groupCreditByCustomer, monthStart, summarizeCredit } from '../domain/summary.js';
import { emptyCard, errorCard, loadingCard, m, notIncome } from './parts.js';

export async function mount(el) {
  const state = { from: monthStart(todayPkt()), to: todayPkt(), search: '', rows: null, error: false, open: null };

  async function load() {
    state.rows = null;
    paint();
    try {
      state.rows = await api.creditRows(state.from || null, state.to || null, state.search);
      state.error = false;
    } catch {
      state.error = true;
    }
    paint();
  }

  function paint() {
    const people = state.rows ? groupCreditByCustomer(state.rows) : [];
    const total = state.rows ? summarizeCredit(state.rows) : null;
    const body = state.error
      ? errorCard()
      : !state.rows
        ? loadingCard()
        : !people.length
          ? emptyCard('No credit sales in this range.')
          : html`<div class="card">
              <table class="table">
                <thead>
                  <tr>
                    <th>Customer</th>
                    <th class="num">Days</th>
                    <th class="num">Receipts</th>
                    <th class="num">Credit</th>
                  </tr>
                </thead>
                <tbody>
                  ${people.map((p) => {
                    const days = state.open === p.customer_key ? state.rows.filter((r) => r.customer_key === p.customer_key) : [];
                    return html`<tr data-day="${p.customer_key}">
                        <td>${p.customer_name}</td>
                        <td class="num">${p.days}</td>
                        <td class="num">${p.receipt_count}</td>
                        <td class="num">${m(p.credit_amount)}</td>
                      </tr>
                      ${days.map(
                        (d) =>
                          html`<tr>
                            <td class="muted small">${shortDate(d.sale_day)}</td>
                            <td></td>
                            <td class="num small">${d.receipt_count}</td>
                            <td class="num small">${m(d.credit_amount)}</td>
                          </tr>`,
                      )}`;
                  })}
                  <tr class="sum">
                    <td>${people.length} customer${people.length === 1 ? '' : 's'}</td>
                    <td></td>
                    <td class="num">${total.receipt_count}</td>
                    <td class="num">${m(total.credit_amount)}</td>
                  </tr>
                </tbody>
              </table>
              <p class="muted small">
                Tap a customer to see their days.
                ${state.from ? `From ${shortDate(state.from)}` : ''}${state.to ? ` to ${shortDate(state.to)}` : ''}
                (${monthLabel(state.to || todayPkt())}).
              </p>
            </div>`;
    render(
      el,
      html`${hero({ label: 'Candela Sales', title: 'Credit by Customer' })}
        <div class="card">
          <div class="fields">
            <label class="field"><span>From</span><input type="date" data-f="from" value="${state.from}" /></label>
            <label class="field"><span>To</span><input type="date" data-f="to" value="${state.to}" /></label>
            <label class="field span-all"
              ><span>Customer</span
              ><input type="search" data-f="search" value="${state.search}" placeholder="Search by name" maxlength="60"
            /></label>
          </div>
          ${notIncome}
        </div>
        ${body}`,
    );
    el.querySelectorAll('input[type="date"]').forEach((i) =>
      i.addEventListener('change', () => {
        state[i.dataset.f] = i.value;
        load();
      }),
    );
    el.querySelector('input[type="search"]')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        state.search = e.target.value;
        load();
      }
    });
    el.querySelector('input[type="search"]')?.addEventListener('change', (e) => {
      state.search = e.target.value;
      load();
    });
    el.querySelectorAll('tr[data-day]').forEach((tr) =>
      tr.addEventListener('click', () => {
        state.open = state.open === tr.dataset.day ? null : tr.dataset.day;
        paint();
      }),
    );
    el.querySelector('[data-act="retry"]')?.addEventListener('click', load);
  }

  await load();
}
