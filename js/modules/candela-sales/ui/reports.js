// Monthly summaries (print or Save as PDF from the browser) and the list of corrections Candela made.
import { html, render } from '../../../shared/html.js';
import { hero } from '../../../shared/ui.js';
import { monthLabel, shortDate } from '../../../shared/format.js';
import * as api from '../data/api.js';
import { groupPaymentsByMonth, percentOf } from '../domain/summary.js';
import { errorCard, loadingCard, m, stamp } from './parts.js';

export async function mount(el) {
  async function load() {
    render(el, html`${hero({ label: 'Candela Sales', title: 'Reports' })}${loadingCard()}`);
    let rows;
    let changes;
    try {
      [rows, changes] = await Promise.all([api.paymentDays(), api.recentChanges(30)]);
    } catch {
      render(el, html`${hero({ label: 'Candela Sales', title: 'Reports' })}${errorCard()}`);
      el.querySelector('[data-act="retry"]')?.addEventListener('click', load);
      return;
    }
    const months = groupPaymentsByMonth(rows);
    render(
      el,
      html`${hero({
          label: 'Candela Sales',
          title: 'Reports',
          sub: 'Monthly summaries',
          actions: html`<button type="button" class="btn" data-act="print">Print / Save as PDF</button>`,
        })}
        <div class="card candela-print">
          <h2>Monthly summary</h2>
          ${
            months.length
              ? html`<table class="table">
                  <thead>
                    <tr>
                      <th>Month</th>
                      <th class="num">Days</th>
                      <th class="num">Cash</th>
                      <th class="num">Card</th>
                      <th class="num">Credit</th>
                      <th class="num">Total</th>
                      <th class="num">Credit %</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${months.map(
                      (r) =>
                        html`<tr>
                          <td>${monthLabel(`${r.month}-01`)}</td>
                          <td class="num">${r.days}</td>
                          <td class="num">${m(r.cash_sale)}</td>
                          <td class="num">${m(r.card_sale)}</td>
                          <td class="num">${m(r.credit_sale)}</td>
                          <td class="num">${m(r.total_sale)}</td>
                          <td class="num">${percentOf(r.credit_sale, r.total_sale)}%</td>
                        </tr>`,
                    )}
                  </tbody>
                </table>`
              : html`<p class="muted">No days kept yet.</p>`
          }
          <p class="muted small">
            Totals are Candela's own daily figures. Months with fewer days than the calendar only cover days Dua has received.
          </p>
        </div>
        <div class="card">
          <h2>Corrections from Candela</h2>
          ${
            changes.length
              ? html`<table class="table">
                  <thead>
                    <tr>
                      <th>Day</th>
                      <th>What</th>
                      <th class="num">Was</th>
                      <th class="num">Now</th>
                      <th>When</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${changes.map(
                      (c) =>
                        html`<tr>
                          <td>${shortDate(c.sale_day)}</td>
                          <td>${c.kind === 'payment' ? 'Day total' : `Credit · ${c.customer_key || '(no name)'}`}</td>
                          <td class="num">${m(c.kind === 'payment' ? c.old_values.total_sale : c.old_values.credit_amount)}</td>
                          <td class="num">${m(c.kind === 'payment' ? c.new_values.total_sale : c.new_values.credit_amount)}</td>
                          <td>${stamp(c.changed_at)}</td>
                        </tr>`,
                    )}
                  </tbody>
                </table>`
              : html`<p class="muted">Candela has not changed any figure it sent earlier.</p>`
          }
        </div>`,
    );
    el.querySelector('[data-act="print"]')?.addEventListener('click', () => window.print());
  }
  await load();
}
