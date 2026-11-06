// Daily Data: every day, grouped by month. Tap a day for its payment lines and correction history.
import { html, render } from '../../../shared/html.js';
import { longDate, money, monthLabel, shortDate, signed, weekday } from '../../../shared/format.js';
import * as api from '../data/api.js';
import { groupDaysByMonth } from '../domain/months.js';
import { diffClass, errorCard, loadingCard, openDialog, toast } from './parts.js';

const SECTION_ORDER = ['Cash', 'Banks', 'Credit Clients'];

export async function mount(el, { ctx }) {
  render(el, loadingCard());
  const perms = new Set(ctx.permissions);
  let days;
  let methods;
  try {
    [days, methods] = await Promise.all([api.listDays(), api.listMethods()]);
  } catch {
    return render(el, errorCard('the daily data'));
  }
  const groups = groupDaysByMonth(days);
  const byMonth = new Map(groups.map((g) => [g.month, g]));
  const focus = sessionStorage.getItem('sales.data.month');
  sessionStorage.removeItem('sales.data.month');

  const rowsFor = (g) =>
    html`<table class="table">
      <thead>
        <tr>
          <th>Date</th>
          <th class="num">Total</th>
          <th class="num">Comp sale</th>
          <th class="num">Diff</th>
          <th class="num">Cust.</th>
        </tr>
      </thead>
      <tbody>
        ${g.days.map(
          (d) =>
            html`<tr data-day="${d.business_date}" tabindex="0" role="button" aria-label="Open ${longDate(d.business_date)}">
              <td>
                ${weekday(d.business_date)}
                ${shortDate(d.business_date).slice(0, 6)}${d.low_sale_reason ? html` <span class="chip chip-warn" title="${d.low_sale_reason}">low</span>` : ''}
              </td>
              <td class="num">${money(d.total)}</td>
              <td class="num">${money(d.comp_sale)}</td>
              <td class="num ${diffClass(d.diff)}">${d.comp_sale === null ? '–' : signed(d.diff)}</td>
              <td class="num">${money(d.customers)}</td>
            </tr>`,
        )}
      </tbody>
    </table>`;

  render(
    el,
    html` <section class="card">
        <h2>Daily Data</h2>
        <p class="muted small">${days.length.toLocaleString('en-US')} days. Tap a month to open it, tap a day for details.</p>
      </section>
      ${groups.map(
        (g, i) =>
          html`<details class="month" data-month="${g.month}" ${g.month === focus || (!focus && i === 0) ? 'open' : ''}>
            <summary>
              <span class="m-name">${monthLabel(`${g.month}-01`)}</span><span class="m-total">${money(g.total)}</span>
              <span class="m-sub ${diffClass(g.diff)}">${g.comp_sale ? signed(g.diff) : ''}</span
              ><span class="m-days">${g.count} days</span>
            </summary>
            <div class="month-body" data-filled="0"></div>
          </details>`,
      )}`,
  );

  function fill(detail) {
    const body = detail.querySelector('.month-body');
    if (!detail.open || body.dataset.filled === '1') return;
    render(body, rowsFor(byMonth.get(detail.dataset.month)));
    body.dataset.filled = '1';
  }
  el.querySelectorAll('details.month[open]').forEach(fill);
  el.addEventListener('toggle', (e) => e.target.matches('details.month') && fill(e.target), true);
  if (focus) el.querySelector(`details[data-month="${focus}"]`)?.scrollIntoView({ block: 'start' });

  async function openDay(date) {
    let detail;
    let revisions = [];
    try {
      detail = await api.getDay(date);
      if (perms.has('sales.view_history')) revisions = await api.listRevisions(date);
    } catch {
      return toast('Could not open that day.', 'error');
    }
    const { day, lines } = detail;
    if (!day) return toast('That day was not found.', 'error');
    const lineBy = new Map(lines.map((l) => [l.method_code, Number(l.amount)]));
    const sections = SECTION_ORDER.map((s) => ({ s, items: methods.filter((m) => m.section === s && lineBy.has(m.code)) })).filter(
      (x) => x.items.length,
    );
    openDialog(
      html` <h2>${longDate(date)}</h2>
        <div class="total-card">
          <div><span class="label">TOTAL SALE</span><strong>${money(day.total)}</strong></div>
          <div>
            <span class="label">DIFF</span
            ><strong class="${diffClass(day.diff)}">${day.comp_sale === null ? '–' : signed(day.diff)}</strong>
          </div>
        </div>
        ${sections.map(
          (x) =>
            html`<h3>${x.s}</h3>
              <table class="table">
                <tbody>
                  ${x.items.map(
                    (m) =>
                      html`<tr>
                        <td>${m.label}${m.sign === 'sub' ? html` <em class="muted">(deducts)</em>` : ''}</td>
                        <td class="num">${money(lineBy.get(m.code))}</td>
                      </tr>`,
                  )}
                </tbody>
              </table>`,
        )}
        <h3>Summary</h3>
        <table class="table">
          <tbody>
            <tr>
              <td>COMP SALE</td>
              <td class="num">${money(day.comp_sale)}</td>
            </tr>
            <tr>
              <td>Customers</td>
              <td class="num">${money(day.customers)}</td>
            </tr>
            <tr>
              <td>FDPP POS</td>
              <td class="num">${money(day.fdpp_pos)}</td>
            </tr>
            <tr>
              <td>FDPP Consumer</td>
              <td class="num">${money(day.fdpp_consumer)}</td>
            </tr>
            <tr>
              <td>Amount Received</td>
              <td class="num">${money(day.amount_received)}</td>
            </tr>
            <tr>
              <td>Load Sale</td>
              <td class="num">${money(day.load_sale)}</td>
            </tr>
            <tr>
              <td>Cash to be Deposited</td>
              <td class="num">${money(day.cash_to_deposit)}</td>
            </tr>
          </tbody>
        </table>
        ${day.low_sale_reason ? html`<p><strong>Low sale reason:</strong> ${day.low_sale_reason}</p>` : ''}
        ${
          revisions.length
            ? html`<h3>Corrections</h3>
                ${revisions.map((r) => html`<p class="small"><strong>Version ${r.revision}</strong> replaced ${shortDate(String(r.replaced_at).slice(0, 10))}: ${r.reason}</p>`)}`
            : ''
        }
        <div class="actions-bar">
          ${perms.has('sales.edit') ? html`<button class="btn btn-primary" data-edit="${date}">Correct this day</button>` : ''}<button
            class="btn"
            data-close
          >
            Close
          </button>
        </div>`,
      { label: `Details for ${date}` },
    ).addEventListener('click', (e) => {
      const b = e.target.closest('[data-edit]');
      if (!b) return;
      sessionStorage.setItem('sales.entry.date', b.dataset.edit);
      e.currentTarget.close();
      location.hash = '#/sales/entry';
    });
  }

  el.addEventListener('click', (e) => {
    const r = e.target.closest('tr[data-day]');
    if (r) openDay(r.dataset.day);
  });
  el.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('tr[data-day]')) {
      e.preventDefault();
      openDay(e.target.dataset.day);
    }
  });
}
