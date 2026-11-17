// Manager reports: pick a month and a report, tick anyone to leave off the page (only for this print), then Print or save as PDF.
// The figures come from the same database functions as the Credit, Salary and Generic pages; nothing is calculated differently here.
import { html, render } from '../../../shared/html.js';
import { hero } from '../../../shared/ui.js';
import { money, monthLabel, shortDate, todayPkt } from '../../../shared/format.js';
import { BRAND } from '../../../core/config.js';
import * as api from '../data/api.js';
import { monthStart, shiftMonth } from '../domain/credit.js';
import { creditDetail, creditSummary, genericReport, reportsFor, salaryReport } from '../domain/reports.js';
import { percent } from '../domain/salary.js';
import { errorCard, monthButtons, openDialog, toast } from './parts.js';

const m = (v) => money(v, { decimals: Math.round(Number(v) * 100) % 100 !== 0 });
const cell = (v) => html`<td class="num">${m(v)}</td>`;

const tables = {
  'credit-summary': (people, hidden) => {
    const { rows, totals } = creditSummary(people, hidden);
    return html`<table class="table rpt-table">
      <thead>
        <tr>
          <th>Person</th>
          <th class="num">Previous</th>
          <th class="num">Entries</th>
          <th class="num">Salary deducted</th>
          <th class="num">Less generic</th>
          <th class="num">Net</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(
          (r) =>
            html`<tr>
              <td>${r.name}${r.code ? html` <small class="muted">${r.code}</small>` : ''}</td>
              ${cell(r.prev)}${cell(r.entries)}${cell(r.salary)}${cell(r.generic)}${cell(r.net)}
            </tr>`,
        )}
        <tr class="payslip-net">
          <td><strong>Total</strong></td>
          ${cell(totals.prev)}${cell(totals.entries)}${cell(totals.salary)}${cell(totals.generic)}${cell(totals.net)}
        </tr>
      </tbody>
    </table>`;
  },
  'credit-detail': (people, hidden) => {
    const { rows, totals } = creditDetail(people, hidden);
    return html`${rows.map(
        (r) =>
          html`<h3 class="sec-label">${r.name}${r.code ? html` · ${r.code}` : ''}</h3>
            <table class="table rpt-table">
              <tbody>
                <tr>
                  <td>Previous balance</td>
                  <td></td>
                  ${cell(r.prev)}
                </tr>
                ${r.entries.map(
                  (e) =>
                    html`<tr>
                      <td>${shortDate(e.date)}</td>
                      <td>
                        ${e.note || '—'}${e.reversal ? ' (reversal)' : ''}${e.reversed ? ' (reversed)' : ''}${e.reason ? html`<br /><small class="muted">${e.reason}</small>` : ''}
                      </td>
                      ${cell(e.amount)}
                    </tr>`,
                )}
                ${
                  r.salary
                    ? html`<tr>
                        <td>Salary deducted</td>
                        <td></td>
                        ${cell(-r.salary)}
                      </tr>`
                    : ''
                }
                ${
                  r.generic
                    ? html`<tr>
                        <td>Less generic</td>
                        <td></td>
                        ${cell(-r.generic)}
                      </tr>`
                    : ''
                }
                <tr class="payslip-net">
                  <td><strong>Net</strong></td>
                  <td></td>
                  ${cell(r.net)}
                </tr>
              </tbody>
            </table>`,
      )}
      <p class="payslip-net"><strong>Total net: ${m(totals.net)}</strong></p>`;
  },
  salary: (data, hidden) => {
    const { rows, cols } = data;
    const r = salaryReport(rows, cols, hidden);
    return html`<table class="table rpt-table">
      <thead>
        <tr>
          <th>Person</th>
          <th class="num">HO salary</th>
          <th class="num">Advance</th>
          <th class="num">Generic</th>
          ${r.columns.map((c) => html`<th class="num">${c.name} (${c.sign > 0 ? '+' : '−'})</th>`)}
          <th class="num">Net</th>
        </tr>
      </thead>
      <tbody>
        ${r.rows.map(
          (x) =>
            html`<tr>
              <td>${x.name}${x.designation ? html` <small class="muted">${x.designation}</small>` : ''}</td>
              ${cell(x.ho)}${cell(x.advance)}${cell(x.generic)}${x.extras.map(cell)}${cell(x.net)}
            </tr>`,
        )}
        <tr class="payslip-net">
          <td><strong>Total</strong></td>
          ${cell(r.totals.ho)}${cell(r.totals.advance)}${cell(r.totals.generic)}${r.totals.extras.map(cell)}${cell(r.totals.net)}
        </tr>
      </tbody>
    </table>`;
  },
  generic: (rows, hidden) => {
    const r = genericReport(rows, hidden);
    return html`<table class="table rpt-table">
      <thead>
        <tr>
          <th>Person</th>
          <th class="num">Generic sale</th>
          <th class="num">Rate</th>
          <th class="num">Incentive</th>
          <th class="num">Extra</th>
          <th class="num">Final</th>
        </tr>
      </thead>
      <tbody>
        ${r.rows.map(
          (x) =>
            html`<tr>
              <td>${x.name}</td>
              ${cell(x.sale)}
              <td class="num">${percent(x.rate)}</td>
              ${cell(x.incentive)}${cell(x.extra)}${cell(x.final)}
            </tr>`,
        )}
        <tr class="payslip-net">
          <td><strong>Total</strong></td>
          ${cell(r.totals.sale)}
          <td></td>
          ${cell(r.totals.incentive)}${cell(r.totals.extra)}${cell(r.totals.final)}
        </tr>
      </tbody>
    </table>`;
  },
};

// The people a report is about (for the "leave off this print" ticks).
const peopleOf = (id, data) => (id === 'salary' ? data.rows : data);

async function fetchReport(id, month) {
  if (id === 'credit-summary' || id === 'credit-detail') return api.creditMonth(month);
  if (id === 'salary') {
    const [rows, cols] = await Promise.all([api.salaryMonth(month), api.salaryColumns(month)]);
    return { rows, cols };
  }
  return api.genericMonth(month);
}

export async function mount(el, { ctx }) {
  const available = reportsFor(ctx.permissions);
  const thisMonth = monthStart(todayPkt());
  const state = { month: thisMonth, error: false };

  function paint() {
    if (state.error) return render(el, errorCard('the reports'));
    render(
      el,
      html`${hero({ label: 'Manager', title: 'Reports', sub: monthLabel(state.month), actions: monthButtons(state.month, thisMonth) })}
      ${
        available.length
          ? available.map(
              (r) =>
                html`<section class="card">
                  <h2>${r.title}</h2>
                  <p class="muted small">${r.desc}</p>
                  <div class="actions">
                    <button type="button" class="btn btn-primary btn-sm" data-act="open" data-id="${r.id}">Open</button>
                  </div>
                </section>`,
            )
          : html`<div class="card"><p class="muted">No reports are open to you.</p></div>`
      }`,
    );
  }

  async function openReport(id) {
    const def = available.find((r) => r.id === id);
    let data;
    try {
      data = await fetchReport(id, state.month);
    } catch {
      return toast('Could not load that report. Try again.', 'error');
    }
    const hidden = new Set();
    const dlg = openDialog(html`<div id="rp"></div>`, { label: def.title });
    dlg.classList.add('payslip-dlg');
    const paintDlg = () => {
      const people = peopleOf(id, data);
      render(
        dlg.querySelector('#rp'),
        html`<div class="payslip" id="payslip">
            <header class="payslip-head">
              <strong>${BRAND.title}</strong><span>${BRAND.branch}</span>
              <h2>${def.title} · ${monthLabel(state.month)}</h2>
            </header>
            <div class="rpt-scroll">${tables[id](data, hidden)}</div>
          </div>
          <details class="no-print">
            <summary class="small">Leave people off this print (${hidden.size} left off)</summary>
            ${people.map((p) => html`<label class="field mg-hide small"><input type="checkbox" data-hide="${p.staff_id}" ${hidden.has(p.staff_id) ? 'checked' : ''} /> ${p.full_name}</label>`)}
          </details>
          <div class="actions">
            <button type="button" class="btn btn-ghost" data-close>Close</button
            ><button type="button" class="btn btn-primary" data-print>Print or save as PDF</button>
          </div>`,
      );
    };
    paintDlg();
    dlg.addEventListener('change', (e) => {
      const id2 = e.target.dataset?.hide;
      if (!id2) return;
      if (e.target.checked) hidden.add(id2);
      else hidden.delete(id2);
      paintDlg();
      dlg.querySelector('details')?.setAttribute('open', '');
    });
    dlg.addEventListener('click', (e) => {
      if (!e.target.closest('[data-print]')) return;
      document.body.classList.add('printing-payslip');
      window.addEventListener('afterprint', () => document.body.classList.remove('printing-payslip'), { once: true });
      window.print();
    });
  }

  el.addEventListener('click', (e) => {
    const t = e.target.closest('[data-act]');
    if (!t) return;
    if (t.dataset.act === 'prev' || t.dataset.act === 'next') {
      state.month = shiftMonth(state.month, t.dataset.act === 'prev' ? -1 : 1);
      return paint();
    }
    if (t.dataset.act === 'open') return openReport(t.dataset.id);
  });
  paint();
}
