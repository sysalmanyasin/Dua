// Cash to be Deposited: Cash Sale − Cash Returns + FDPP POS + FDPP Consumer, for every day.
// Tick days to see a combined total, a breakdown, and a 72 mm receipt.
import { html, render } from '../../../shared/html.js';
import { hero } from '../../../shared/ui.js';
import { longDate, money, shortDate, todayPkt, weekday } from '../../../shared/format.js';
import * as api from '../data/api.js';
import { depositRows, summarizeSelection } from '../domain/deposit.js';
import { errorCard, loadingCard, openDialog } from './parts.js';
import { printThermal, receiptLine } from './print.js';

const STEP = 90;

export async function mount(el) {
  render(el, loadingCard());
  let rows;
  try {
    rows = depositRows(await api.listDailyReport());
  } catch {
    return render(el, errorCard('the deposit report'));
  }
  const selected = new Set();
  let shown = STEP;

  const summaryHtml = () => {
    const s = summarizeSelection(rows, selected);
    return html`<div><span class="label">SELECTED</span><strong>${s.count} day${s.count === 1 ? '' : 's'}</strong></div>
      <div><span class="label">TOTAL</span><strong>${money(s.total)}</strong></div>
      <div class="actions">
        <button class="btn btn-primary" data-act="view" ${s.count ? '' : 'disabled'}>Breakdown</button>
        <button class="btn btn-ghost" data-act="clear" ${s.count ? '' : 'disabled'}>Clear</button>
      </div>`;
  };
  const updateSummary = () => render(el.querySelector('.sticky-sum'), summaryHtml());

  function draw() {
    render(
      el,
      html`${hero({ label: 'Sales', title: 'Cash to be Deposited', sub: 'Cash Sale − Cash Returns + FDPP POS + FDPP Consumer. Worked out fresh for every day; separate from the figure typed on the entry page.' })}
        <section class="card sticky-sum">${summaryHtml()}</section>
        <section class="card">
          <table class="table">
            <thead>
              <tr>
                <th></th>
                <th>Date</th>
                <th class="num">Deposit</th>
              </tr>
            </thead>
            <tbody>
              ${rows.slice(0, shown).map(
                (r) =>
                  html`<tr>
                    <td>
                      <input
                        type="checkbox"
                        data-day="${r.business_date}"
                        aria-label="Select ${longDate(r.business_date)}"
                        ${selected.has(r.business_date) ? 'checked' : ''}
                      />
                    </td>
                    <td>${weekday(r.business_date)} ${shortDate(r.business_date)}</td>
                    <td class="num">${money(r.deposit)}</td>
                  </tr>`,
              )}
            </tbody>
          </table>
          ${shown < rows.length ? html`<button class="btn btn-ghost" data-act="more">Show more (${rows.length - shown} older days)</button>` : ''}
        </section>`,
    );
  }

  function breakdown() {
    const s = summarizeSelection(rows, selected);
    const dlg = openDialog(
      html`<h2>Cash to be Deposited</h2>
        <table class="table">
          <thead>
            <tr>
              <th>Date</th>
              <th class="num">Cash</th>
              <th class="num">Returns</th>
              <th class="num">FDPP</th>
              <th class="num">Deposit</th>
            </tr>
          </thead>
          <tbody>
            ${s.rows.map(
              (r) =>
                html`<tr>
                  <td>${shortDate(r.business_date).slice(0, 6)}</td>
                  <td class="num">${money(r.cash_sale)}</td>
                  <td class="num">${money(-Math.abs(Number(r.cash_returns) || 0))}</td>
                  <td class="num">${money((Number(r.fdpp_pos) || 0) + (Number(r.fdpp_consumer) || 0))}</td>
                  <td class="num">${money(r.deposit)}</td>
                </tr>`,
            )}
            <tr class="sum">
              <td colspan="4">Total (${s.count} day${s.count === 1 ? '' : 's'})</td>
              <td class="num">${money(s.total)}</td>
            </tr>
          </tbody>
        </table>
        <div class="actions-bar">
          <button class="btn btn-primary" data-print>Print receipt</button><button class="btn" data-close>Close</button>
        </div>`,
      { label: 'Deposit breakdown' },
    );
    dlg.addEventListener('click', (e) => {
      if (!e.target.closest('[data-print]')) return;
      printThermal(
        html`<div class="rc">
          <div class="rc-title">CASH TO BE DEPOSITED</div>
          <div class="rc-sub">${shortDate(todayPkt())}</div>
          <hr />
          ${s.rows.map((r) => receiptLine(shortDate(r.business_date), money(r.deposit)))}
          <hr />
          ${receiptLine('TOTAL', money(s.total))}
        </div>`,
      );
    });
  }

  el.addEventListener('change', (e) => {
    const c = e.target.closest('input[data-day]');
    if (!c) return;
    if (c.checked) selected.add(c.dataset.day);
    else selected.delete(c.dataset.day);
    updateSummary();
  });
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    if (b.dataset.act === 'more') {
      shown += STEP;
      draw();
    } else if (b.dataset.act === 'clear') {
      selected.clear();
      draw();
    } else if (b.dataset.act === 'view') breakdown();
  });
  draw();
}
