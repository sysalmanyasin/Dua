// Diff Report: Total Sale minus COMP SALE, by month with a running total. Tap a month for its days.
import { html, render } from '../../../shared/html.js';
import { hero } from '../../../shared/ui.js';
import { longDate, money, monthLabel, signed } from '../../../shared/format.js';
import * as api from '../data/api.js';
import { buildDiffReport } from '../domain/diff.js';
import { diffClass, errorCard, loadingCard } from './parts.js';

export async function mount(el) {
  render(el, loadingCard());
  let days;
  try {
    days = await api.listDays();
  } catch {
    return render(el, errorCard('the diff report'));
  }
  const months = buildDiffReport(days);
  const byMonth = new Map(months.map((m) => [m.month, m]));

  render(
    el,
    html`${hero({ label: 'Sales', title: 'Diff Report', sub: 'DIFF = Total Sale − COMP SALE. The running total adds up month by month; inside a month it starts again at 0.' })}
      <section class="card">
        <div class="total-card">
          <div>
            <span class="label">CUMULATIVE DIFF</span
            ><strong class="${diffClass(months[0]?.cumulative)}">${signed(months[0]?.cumulative ?? 0)}</strong>
          </div>
          <div><span class="label">MONTHS</span><strong>${months.length}</strong></div>
        </div>
      </section>
      ${months.map(
        (m) =>
          html`<details class="month" data-month="${m.month}">
            <summary>
              <span class="m-name">${monthLabel(`${m.month}-01`)}</span><span class="m-total ${diffClass(m.diff)}">${signed(m.diff)}</span>
              <span class="m-sub">run ${signed(m.cumulative)}</span>
            </summary>
            <div class="month-body" data-filled="0"></div>
          </details>`,
      )}`,
  );

  el.addEventListener(
    'toggle',
    (e) => {
      const d = e.target;
      if (!d.matches?.('details.month') || !d.open) return;
      const body = d.querySelector('.month-body');
      if (body.dataset.filled === '1') return;
      const m = byMonth.get(d.dataset.month);
      render(
        body,
        html`<table class="table">
          <thead>
            <tr>
              <th>Date</th>
              <th class="num">Total</th>
              <th class="num">Comp</th>
              <th class="num">Diff</th>
              <th class="num">Running</th>
            </tr>
          </thead>
          <tbody>
            ${m.days.map(
              (x) =>
                html`<tr>
                  <td>${longDate(x.date).slice(0, -5)}</td>
                  <td class="num">${money(x.total)}</td>
                  <td class="num">${money(x.comp_sale)}</td>
                  <td class="num ${diffClass(x.diff)}">${signed(x.diff)}</td>
                  <td class="num ${diffClass(x.running)}">${signed(x.running)}</td>
                </tr>`,
            )}
            <tr class="sum">
              <td>Month</td>
              <td class="num">${money(m.total)}</td>
              <td class="num">${money(m.comp_sale)}</td>
              <td class="num ${diffClass(m.diff)}">${signed(m.diff)}</td>
              <td></td>
            </tr>
          </tbody>
        </table>`,
      );
      body.dataset.filled = '1';
    },
    true,
  );
}
