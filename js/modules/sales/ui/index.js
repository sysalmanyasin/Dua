// Index: every month as a card, grouped by year, with growth against the same month a year earlier.
import { html, render } from '../../../shared/html.js';
import { hero } from '../../../shared/ui.js';
import { money, monthName, signed } from '../../../shared/format.js';
import * as api from '../data/api.js';
import { buildIndex, groupMonthsByYear } from '../domain/months.js';
import { diffClass, errorCard, loadingCard } from './parts.js';

const pct = (v) => (v === null ? '' : `${v > 0 ? '▲' : v < 0 ? '▼' : ''} ${Math.abs(v).toFixed(1)}%`);

export async function mount(el) {
  render(el, loadingCard());
  let monthly;
  let history;
  try {
    [monthly, history] = await Promise.all([api.listMonthly(), api.listMonthlyHistory()]);
  } catch {
    return render(el, errorCard('the index'));
  }
  const years = groupMonthsByYear(buildIndex(monthly, history));

  render(
    el,
    html`${hero({ label: 'Sales', title: 'Index', sub: `Monthly sales since ${years.at(-1)?.year ?? '–'}. Tap a month to see its days.` })}
    ${years.map(
      (y, i) =>
        html`<details class="year" ${i === 0 ? 'open' : ''}>
          <summary>
            <span class="m-name">${y.year}</span><span class="m-total">${money(y.total)}</span
            ><span class="m-days">${y.months.length} months</span>
          </summary>
          <div class="month-cards">${y.months.map(card)}</div>
        </details>`,
    )}`,
  );

  function card(m) {
    return html`<button class="month-card" data-month="${m.month}" ${m.monthlyOnly ? 'disabled' : ''}>
      <span class="mc-name">${monthName(Number(m.month.slice(5)))}</span>
      <strong class="mc-total">${money(m.total)}</strong>
      <span class="mc-line">${m.monthlyOnly ? 'Monthly figures only' : `${m.days} days · avg ${money(m.avgPerDay)}`}</span>
      ${m.diff === null ? '' : html`<span class="mc-line ${diffClass(m.diff)}">Diff ${signed(m.diff)}</span>`}
      ${m.vsLastYear === null ? '' : html`<span class="mc-line ${diffClass(m.vsLastYear)}">${pct(m.vsLastYear)} vs last year</span>`}
    </button>`;
  }

  el.addEventListener('click', (e) => {
    const c = e.target.closest('.month-card:not([disabled])');
    if (!c) return;
    sessionStorage.setItem('sales.data.month', c.dataset.month);
    location.hash = '#/sales/data';
  });
}
