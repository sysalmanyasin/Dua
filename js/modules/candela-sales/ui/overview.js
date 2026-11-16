// Owner overview: today, month so far, change against yesterday, and when Candela last sent figures.
import { html, render } from '../../../shared/html.js';
import { hero } from '../../../shared/ui.js';
import { longDate, todayPkt } from '../../../shared/format.js';
import * as api from '../data/api.js';
import { addDays, compareTotals, monthStart, percentOf, summarizePayments } from '../domain/summary.js';
import { emptyCard, errorCard, loadingCard, m, stamp } from './parts.js';

export async function mount(el) {
  const today = todayPkt();

  async function load() {
    render(el, html`${hero({ label: 'Candela Sales', title: 'Overview' })}${loadingCard()}`);
    let rows;
    try {
      rows = await api.paymentDays(addDays(today, -62), today);
    } catch {
      render(el, html`${hero({ label: 'Candela Sales', title: 'Overview' })}${errorCard()}`);
      el.querySelector('[data-act="retry"]')?.addEventListener('click', load);
      return;
    }
    const day = (d) => rows.find((r) => r.sale_day === d) ?? null;
    const t = day(today);
    const y = day(addDays(today, -1));
    const month = rows.filter((r) => r.sale_day >= monthStart(today));
    const prevMonthEnd = addDays(monthStart(today), -1);
    const prevMonth = rows.filter((r) => r.sale_day >= monthStart(prevMonthEnd) && r.sale_day <= prevMonthEnd);
    const mtd = summarizePayments(month);
    const last = rows.reduce((a, r) => (r.last_seen_at > a ? r.last_seen_at : a), '');
    const cmp = t && y ? compareTotals(t.total_sale, y.total_sale) : null;

    render(
      el,
      html`${hero({ label: 'Candela Sales', title: 'Overview', sub: longDate(today) })}
        <section class="kpis">
          <div class="kpi">
            <span class="kl">Today</span>
            <span class="kv">${t ? `₨ ${m(t.total_sale)}` : '—'}</span>
            <span class="ks">${t ? 'Latest figure from Candela' : 'No figure for today yet'}</span>
            ${cmp ? html`<span class="kchip ${cmp.change >= 0 ? 'pos' : 'neg'}">${cmp.change >= 0 ? '▲' : '▼'} ₨ ${m(Math.abs(cmp.change))} vs yesterday${cmp.percent === null ? '' : ` (${cmp.percent}%)`}</span>` : ''}
          </div>
          <div class="kpi">
            <span class="kl">Month so far</span>
            <span class="kv">₨ ${m(mtd.total_sale)}</span>
            <span class="ks"
              >${month.length} day${month.length === 1 ? '' : 's'}
              recorded${prevMonth.length ? ` · last month ₨ ${m(summarizePayments(prevMonth).total_sale)} (${prevMonth.length} days)` : ''}</span
            >
          </div>
          <div class="kpi">
            <span class="kl">Last update from Candela</span>
            <span class="kv">${last ? stamp(last) : '—'}</span>
            <span class="ks">Pakistan time</span>
          </div>
        </section>
        ${
          t
            ? html`<div class="card">
                <h2>Today by payment type</h2>
                <table class="table">
                  <tbody>
                    ${[
                      ['Cash', t.cash_sale],
                      ['Card', t.card_sale],
                      ['Credit', t.credit_sale],
                    ].map(
                      ([label, v]) =>
                        html`<tr>
                          <td>${label}</td>
                          <td class="num">₨ ${m(v)}</td>
                          <td class="num">${percentOf(v, t.total_sale)}%</td>
                        </tr>`,
                    )}
                    <tr class="sum">
                      <td>Total</td>
                      <td class="num">₨ ${m(t.total_sale)}</td>
                      <td></td>
                    </tr>
                  </tbody>
                </table>
              </div>`
            : emptyCard('Nothing has arrived for today yet. Candela sends figures about every hour.')
        }`,
    );
  }
  await load();
}
