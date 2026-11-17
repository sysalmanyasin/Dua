// A printable payslip for one person and month, built from their Salary row, Generic row and (if the viewer may see credit)
// Staff Credit. Print or save as PDF from the browser. There is no WhatsApp sending (MGR-6): you print it and hand it over.
import { html } from '../../../shared/html.js';
import { money, monthLabel } from '../../../shared/format.js';
import { BRAND } from '../../../core/config.js';
import { percent, rup } from '../domain/salary.js';
import { openDialog } from './parts.js';

const m = (v) => money(v, { decimals: Math.round(Number(v) * 100) % 100 !== 0 });

export function openPayslip({ month, person, columns, netValue, extrasAmounts, generic = null, credit = null }) {
  const line = (label, value, sign = '') =>
    html`<tr>
      <td>${label}</td>
      <td class="num">${sign}${m(Math.abs(value))}</td>
    </tr>`;
  const customs = columns.filter((c) => rup(extrasAmounts[c.column_id] ?? 0) !== 0);
  const dlg = openDialog(
    html`<div class="payslip" id="payslip">
        <header class="payslip-head">
          <strong>${BRAND.title}</strong><span>${BRAND.branch}</span>
          <h2>Payslip · ${monthLabel(month)}</h2>
        </header>
        <p class="payslip-who">
          <strong>${person.full_name}</strong>
          ${person.staff_code ? html`<span> · ${person.staff_code}</span>` : ''}${person.designation ? html`<span> · ${person.designation}</span>` : ''}
        </p>
        <table class="table">
          <tbody>
            ${line('Salary', person.ho_salary_now)} ${rup(person.advance) !== 0 ? line('Less: advance taken', person.advance, '− ') : ''}
            ${
              rup(person.generic) !== 0
                ? html`<tr>
                    <td>
                      Generic
                      incentive${generic && generic.generic_sale ? html`<br /><small class="muted">Sale ${m(generic.generic_sale)} at ${percent(generic.rate)}${generic.extra ? html`, extra ${m(generic.extra)}` : ''}</small>` : ''}
                    </td>
                    <td class="num">+ ${m(person.generic)}</td>
                  </tr>`
                : ''
            }
            ${customs.map((c) => line(c.name, extrasAmounts[c.column_id], c.sign > 0 ? '+ ' : '− '))}
            <tr class="payslip-net">
              <td><strong>Net salary</strong></td>
              <td class="num"><strong>${m(netValue)}</strong></td>
            </tr>
          </tbody>
        </table>
        ${
          credit
            ? html`<h3 class="sec-label">Staff credit</h3>
                <table class="table">
                  <tbody>
                    ${line('Previous balance', credit.prev_balance)} ${line('Entries this month', credit.entries_total)}
                    ${line('Salary deducted', credit.salary_deduction, '− ')} ${line('Less generic', credit.generic_deduction, '− ')}
                    <tr class="payslip-net">
                      <td><strong>Credit balance carried forward</strong></td>
                      <td class="num"><strong>${m(credit.net)}</strong></td>
                    </tr>
                  </tbody>
                </table>`
            : ''
        }
        <div class="payslip-sign"><span>Prepared by</span><span>Received by</span></div>
      </div>
      <div class="actions">
        <button type="button" class="btn btn-ghost" data-close>Close</button
        ><button type="button" class="btn btn-primary" data-print>Print or save as PDF</button>
      </div>`,
    { label: 'Payslip' },
  );
  dlg.classList.add('payslip-dlg');
  dlg.addEventListener('click', (e) => {
    if (!e.target.closest('[data-print]')) return;
    document.body.classList.add('printing-payslip');
    window.addEventListener('afterprint', () => document.body.classList.remove('printing-payslip'), { once: true });
    window.print();
  });
  return dlg;
}
