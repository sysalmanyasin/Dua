// The checklist as a printable report (green tables, as in the original) and the print action.
// Built with classes, not inline styles, so the strict page security policy stays in force.
import { html, render } from '../../../shared/html.js';
import { dateNice, timeNice } from '../domain/checklist.js';

export function reportView(m, meta) {
  let n = 0;
  return html`<div class="rpt">
    <div class="rpt-banner">
      <div class="rpt-brand">Fazal Din's Pharma Plus</div>
      <div class="rpt-kicker">Daily Operations Check List</div>
      <div class="rpt-line">
        Branch: <b>${meta.branch}</b> • Date: <b>${dateNice(meta.date)}</b> • Time: <b>${timeNice(meta.time)}</b> • Prepared by:
        <b>${meta.preparedBy}${meta.designation ? `, ${meta.designation}` : ''}</b>
      </div>
    </div>
    <div class="rpt-h1">${m.branch}</div>
    <div class="rpt-h1">Checklist</div>
    <table class="rpt-table">
      <thead>
        <tr>
          <th class="c w-no">No.</th>
          <th>Checklist item</th>
          <th class="w-rem">Remarks</th>
        </tr>
      </thead>
      <tbody>
        ${m.rows.map((r) => {
          if (r.type === 'group') {
            n = 0;
            return html`<tr class="grp">
              <td colspan="3">${r.no}&nbsp;&nbsp;${r.title}</td>
            </tr>`;
          }
          return html`<tr class="${n++ % 2 ? 'odd' : 'even'}">
            <td>${r.no}</td>
            <td>${r.label}</td>
            <td class="c b">${r.val}</td>
          </tr>`;
        })}
      </tbody>
    </table>
    <div class="rpt-h3">24 Stocks Report</div>
    <table class="rpt-table narrow">
      <thead>
        <tr>
          <th>Particulars</th>
          <th class="c">Response or value</th>
        </tr>
      </thead>
      <tbody>
        ${m.stock.map((r) =>
          r.type === 'group'
            ? html`<tr class="grp">
                <td colspan="2"><b>${r.title}</b></td>
              </tr>`
            : html`<tr class="${r.underline ? 'tint' : 'even'}">
                <td class="${r.bold ? 'b' : ''}">${r.label}</td>
                <td class="c ${r.bold ? 'b' : ''} ${r.underline ? 'ul' : ''}">${r.val}</td>
              </tr>`,
        )}
      </tbody>
    </table>
    <div class="rpt-neg"><b>Current Stocks negative value</b></div>
    <div class="rpt-neg"><b>${m.negStock}</b></div>
    ${m.extra.map(
      (x) =>
        html`<div class="rpt-h3">${x.title}</div>
          <table class="rpt-table light">
            <thead>
              <tr>
                <th class="c w-no">No.</th>
                <th>Checklist item</th>
                <th class="w-rem">Remarks</th>
              </tr>
            </thead>
            <tbody>
              ${x.rows.map(
                (r, i) =>
                  html`<tr class="${i % 2 ? 'odd' : 'even'}">
                    <td class="c">${r.no}</td>
                    <td>${r.label}</td>
                    <td class="c b">${r.val}</td>
                  </tr>`,
              )}
            </tbody>
          </table>`,
    )}
    <div class="rpt-h3">32 Less than 7 Days Stock Report</div>
    ${kv(m.lt7)}
    <div class="rpt-h3">33 Electricity Meter Reading</div>
    ${kv(m.meter)}
    <div class="rpt-h3">34 Competitor Sales</div>
    <table class="rpt-table">
      <thead>
        <tr>
          <th>Pharmacy or medical store</th>
          <th class="c">Stock value</th>
          <th class="c">Average per day</th>
          <th class="c">Total monthly sales</th>
        </tr>
      </thead>
      <tbody>
        ${m.comp.map(
          (r, i) =>
            html`<tr class="${i % 2 ? 'odd' : 'even'}">
              <td class="b">${r[0]}</td>
              <td class="c">${r[1]}</td>
              <td class="c">${r[2]}</td>
              <td class="c">${r[3]}</td>
            </tr>`,
        )}
      </tbody>
    </table>
    ${
      m.notes
        ? html`<div class="rpt-h3">Notes</div>
            <div class="rpt-notes">${m.notes}</div>`
        : ''
    }
  </div>`;
}

const kv = (pairs) =>
  html`<table class="rpt-table narrow">
    <thead>
      <tr>
        <th>Particulars</th>
        <th class="c">Response or value</th>
      </tr>
    </thead>
    <tbody>
      ${pairs.map(
        (p) =>
          html`<tr>
            <td class="even">${p[0]}</td>
            <td class="c b">${p[1]}</td>
          </tr>`,
      )}
    </tbody>
  </table>`;

export function printReport(m, meta) {
  const root = document.createElement('div');
  root.id = 'print-root';
  render(root, reportView(m, meta));
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
