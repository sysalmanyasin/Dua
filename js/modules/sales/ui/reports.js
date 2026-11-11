// Reports: the monthly report (summary plus day-by-day table) and the Sale Book (a year, or all time).
// Printed on landscape A4; "Save as PDF" in the print window gives a PDF.
import { html, render } from '../../../shared/html.js';
import { money, monthLabel, shortDate, signed, weekday } from '../../../shared/format.js';
import { BRAND } from '../../../core/config.js';
import { hero } from '../../../shared/ui.js';
import * as api from '../data/api.js';
import { monthlyReport, paginate, saleBook } from '../domain/bookReports.js';
import { errorCard, loadingCard, toast } from './parts.js';

const cell = (v) => (Number(v) === 0 ? '–' : money(v));
const PER_PAGE = 26;

function monthTable(rep) {
  const head = html`<tr>
    <th>Date</th>
    ${rep.columns.map((c) => html`<th class="num">${c.label}</th>`)}
    <th class="num">Total</th>
    <th class="num">COMP</th>
    <th class="num">Diff</th>
    <th class="num">Cust.</th>
  </tr>`;
  const pages = paginate(rep.rows, PER_PAGE);
  return pages.map(
    (page, i) =>
      html`<section class="bk-page">
        <table class="bk-table">
          <thead>
            ${head}
          </thead>
          <tbody>
            ${page.map(
              (r) =>
                html`<tr>
                  <td>${weekday(r.date)} ${shortDate(r.date).slice(0, 6)}</td>
                  ${rep.columns.map((c) => html`<td class="num">${cell(r.cells[c.code])}</td>`)}
                  <td class="num b">${money(r.total)}</td>
                  <td class="num">${r.comp === null ? '–' : money(r.comp)}</td>
                  <td class="num">${r.diff === null ? '–' : signed(r.diff)}</td>
                  <td class="num">${money(r.customers)}</td>
                </tr>`,
            )}
            ${
              i === pages.length - 1
                ? html`<tr class="bk-sum">
                    <td>Total (${rep.rows.length} days)</td>
                    ${rep.columns.map((c) => html`<td class="num">${money(rep.totals.cells[c.code])}</td>`)}
                    <td class="num">${money(rep.totals.total)}</td>
                    <td class="num">${money(rep.totals.comp)}</td>
                    <td class="num">${rep.totals.diff === null ? '–' : signed(rep.totals.diff)}</td>
                    <td class="num">${money(rep.totals.customers)}</td>
                  </tr>`
                : ''
            }
          </tbody>
        </table>
        <div class="bk-foot">${BRAND.title} · ${BRAND.branch} · page ${i + 1} of ${pages.length}</div>
      </section>`,
  );
}

function monthSummary(s, key) {
  const row = (l, v) => html`<div class="bk-kv"><span>${l}</span><b>${v}</b></div>`;
  return html`<section class="bk-page bk-first">
    <div class="bk-title">${BRAND.title}</div>
    <div class="bk-sub">${BRAND.branch} · Monthly report · ${monthLabel(`${key}-01`)}</div>
    <div class="bk-kvs">
      ${row('Total sale', `₨ ${money(s.total)}`)}${row('Days recorded', s.days)}${row('Average per day', `₨ ${money(s.avgPerDay)}`)}
      ${row('Cash', `₨ ${money(s.cash)}`)}${row('Banks', `₨ ${money(s.banks)}`)}${row('Credit clients', `₨ ${money(s.credit)}`)}
      ${row('COMP SALE', s.comp ? `₨ ${money(s.comp)}` : '–')}${row('Difference', s.diff === null ? '–' : signed(s.diff))}${row('Customers', money(s.customers))}
      ${row('Average bill', `₨ ${money(s.avgBill)}`)}${row('Best day', s.best ? `${shortDate(s.best.date)} · ₨ ${money(s.best.total)}` : '–')}${row('Target', s.target ? `₨ ${money(s.target)} (${s.targetPct}%)` : 'not set')}
    </div>
  </section>`;
}

function bookTable(book, title) {
  const head = html`<tr>
    <th>Month</th>
    ${book.columns.map((c) => html`<th class="num">${c.label}</th>`)}
    <th class="num">Total</th>
    <th class="num">COMP</th>
    <th class="num">Diff</th>
    <th class="num">Cust.</th>
  </tr>`;
  const body = [];
  for (const y of book.years) {
    for (const r of book.rows.filter((x) => x.year === y.year)) {
      body.push(
        html`<tr>
          <td>${monthLabel(`${r.key}-01`)}${r.monthlyOnly ? html` <small class="muted">monthly</small>` : ''}</td>
          ${book.columns.map((c) => html`<td class="num">${cell(r.cells[c.code])}</td>`)}
          <td class="num b">${money(r.total)}</td>
          <td class="num">${r.comp === null ? '–' : money(r.comp)}</td>
          <td class="num">${r.diff === null ? '–' : signed(r.diff)}</td>
          <td class="num">${money(r.customers)}</td>
        </tr>`,
      );
    }
    body.push(
      html`<tr class="bk-sum">
        <td>${y.year}</td>
        ${book.columns.map((c) => html`<td class="num">${money(y.cells[c.code])}</td>`)}
        <td class="num">${money(y.total)}</td>
        <td class="num">${money(y.comp)}</td>
        <td class="num"></td>
        <td class="num">${money(y.customers)}</td>
      </tr>`,
    );
  }
  const pages = paginate(body, PER_PAGE);
  return html`<section class="bk-page bk-first">
      <div class="bk-title">${BRAND.title}</div>
      <div class="bk-sub">${BRAND.branch} · ${title}</div>
      <div class="bk-kvs">
        <div class="bk-kv"><span>Total sale</span><b>₨ ${money(book.totals.total)}</b></div>
        <div class="bk-kv"><span>Months</span><b>${book.rows.length}</b></div>
        <div class="bk-kv"><span>Customers</span><b>${money(book.totals.customers)}</b></div>
      </div>
    </section>
    ${pages.map(
      (page, i) =>
        html`<section class="bk-page">
          <table class="bk-table">
            <thead>
              ${head}
            </thead>
            <tbody>
              ${page}${
                i === pages.length - 1
                  ? html`<tr class="bk-sum bk-grand">
                      <td>All</td>
                      ${book.columns.map((c) => html`<td class="num">${money(book.totals.cells[c.code])}</td>`)}
                      <td class="num">${money(book.totals.total)}</td>
                      <td class="num">${money(book.totals.comp)}</td>
                      <td class="num"></td>
                      <td class="num">${money(book.totals.customers)}</td>
                    </tr>`
                  : ''
              }
            </tbody>
          </table>
          <div class="bk-foot">${BRAND.title} · ${BRAND.branch} · page ${i + 1} of ${pages.length}</div>
        </section>`,
    )}`;
}

export function printBook(content) {
  const root = document.createElement('div');
  root.id = 'print-root';
  root.className = 'book';
  render(root, content);
  document.body.append(root);
  document.body.classList.add('printing-report');
  const done = () => {
    document.body.classList.remove('printing-report');
    root.remove();
    window.removeEventListener('afterprint', done);
  };
  window.addEventListener('afterprint', done);
  window.print();
}

export async function mount(el) {
  render(el, loadingCard());
  let methods;
  let months;
  let latest;
  try {
    [methods, months, latest] = await Promise.all([api.listAllMethods(), api.listMonthlyFull(), api.latestDay()]);
  } catch {
    return render(el, errorCard('the reports'));
  }
  const keys = months.map((m) => String(m.month).slice(0, 7));
  const years = [...new Set(keys.map((k) => k.slice(0, 4)))];
  const state = {
    kind: 'month',
    month: (latest?.business_date ?? keys.at(-1) ?? '').slice(0, 7),
    year: years.at(-1),
    content: null,
    busy: false,
  };

  async function build() {
    state.busy = true;
    draw();
    try {
      if (state.kind === 'month') {
        const [y, m] = state.month.split('-').map(Number);
        const from = `${state.month}-01`;
        const to = `${state.month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
        const [days, lines, target] = await Promise.all([
          api.listDaysBetween(from, to),
          api.listLinesBetween(from, to),
          api.getTarget(from).catch(() => null),
        ]);
        state.content = days.length
          ? html`${monthSummary(monthlyReport({ days, lines, methods, target }).summary, state.month)}${monthTable(monthlyReport({ days, lines, methods, target }))}`
          : null;
      } else {
        const mm = await api.listMonthlyMethods();
        const book = saleBook({ months, monthMethods: mm, methods, year: state.kind === 'year' ? Number(state.year) : null });
        state.content = book.rows.length
          ? bookTable(book, state.kind === 'year' ? `Sale Book ${state.year}` : 'Sale Book — all time')
          : null;
      }
    } catch {
      state.content = null;
      toast('Could not build the report.', 'error');
    }
    state.busy = false;
    draw();
  }

  function draw() {
    render(
      el,
      html` ${hero({ label: 'Reports', title: 'Monthly Report and Sale Book', sub: 'Choose what to print. In the print window you can also save it as a PDF.' })}
        <section class="card">
          <div class="seg" role="group" aria-label="Report type">
            ${[
              ['month', 'Monthly report'],
              ['year', 'Sale Book — a year'],
              ['all', 'Sale Book — all time'],
            ].map(([k, l]) => html`<button class="seg-b" data-kind="${k}" aria-pressed="${state.kind === k}">${l}</button>`)}
          </div>
          <div class="rp-controls">
            ${state.kind === 'month' ? html`<label class="field"><span>Month</span><input type="month" id="rp-month" value="${state.month}" min="${keys[0]}" max="${keys.at(-1)}" /></label>` : ''}
            ${
              state.kind === 'year'
                ? html`<label class="field"
                    ><span>Year</span
                    ><select id="rp-year">
                      ${years.map((y) => html`<option ${y === state.year ? 'selected' : ''}>${y}</option>`)}
                    </select></label
                  >`
                : ''
            }
            <div class="actions">
              <button class="btn btn-primary" data-act="build" ${state.busy ? 'disabled' : ''}>Show report</button
              ><button class="btn" data-act="print" ${state.content ? '' : 'disabled'}>🖶 Print / Save as PDF</button>
            </div>
          </div>
        </section>
        <section class="card bk-preview" id="bk-preview">
          ${state.busy ? html`<p class="muted">Building…</p>` : (state.content ?? html`<p class="muted">Choose a report and press <b>Show report</b>. Nothing is recorded for that period yet if it stays empty.</p>`)}
        </section>`,
    );
  }

  el.addEventListener('click', (e) => {
    const k = e.target.closest('[data-kind]');
    if (k) {
      state.kind = k.dataset.kind;
      state.content = null;
      return draw();
    }
    const b = e.target.closest('[data-act]');
    if (b?.dataset.act === 'build') build();
    else if (b?.dataset.act === 'print' && state.content) printBook(state.content);
  });
  el.addEventListener('change', (e) => {
    if (e.target.id === 'rp-month') state.month = e.target.value;
    else if (e.target.id === 'rp-year') state.year = e.target.value;
  });
  draw();
}
