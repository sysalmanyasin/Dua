import { html as markup, render } from '../../../shared/html.js';
import { hero } from '../../../shared/ui.js';
import { money, monthLabel, todayPkt } from '../../../shared/format.js';
import * as api from '../data/api.js';
import { monthStart } from '../domain/credit.js';
import { loadingCard } from './parts.js';

const moneyValue = (value) => money(Number(value) || 0);
const total = (rows, key) => (rows || []).reduce((sum, row) => sum + (Number(row[key]) || 0), 0);
const safe = async (request) => {
  try {
    return await request();
  } catch {
    return null;
  }
};
const signedMoney = (value) => `${Number(value) < 0 ? '−' : ''}₨${moneyValue(Math.abs(Number(value) || 0))}`;

export async function mount(el, { ctx }) {
  const permissions = new Set(ctx.permissions);
  const currentMonth = monthStart(todayPkt());
  const can = {
    credit: permissions.has('credit.view') || permissions.has('mgmt.credit_manage'),
    salary: permissions.has('mgmt.salary') || permissions.has('mgmt.salary_view'),
    incentive: permissions.has('mgmt.incentive'),
    petty: permissions.has('mgmt.petty_cash'),
    ledgers: permissions.has('mgmt.ledgers'),
    inbox: permissions.has('mgmt.inbox_file') && permissions.has('credit.view'),
    staff: permissions.has('mgmt.staff_view') || permissions.has('mgmt.staff_edit'),
  };
  const state = { month: currentMonth, data: {}, loading: true };

  async function load() {
    state.loading = true;
    state.data = {};
    paint();

    const jobs = {};
    if (can.credit) jobs.credit = safe(() => api.creditMonth(state.month));
    if (can.salary) {
      jobs.salary = safe(() => api.salaryMonth(state.month));
      jobs.generic = safe(() => api.genericMonth(state.month));
    }
    if (can.incentive) jobs.incentive = safe(() => api.incentiveMonth(state.month));
    if (can.petty) jobs.petty = safe(() => api.pettyMonth(state.month));
    if (can.ledgers) jobs.ledgers = safe(() => api.ledgersList());
    if (can.inbox) jobs.inbox = safe(() => api.inboxCount());

    const entries = await Promise.all(Object.entries(jobs).map(async ([key, request]) => [key, await request]));
    state.data = Object.fromEntries(entries);
    state.loading = false;
    paint();
  }

  const sectionTitle = (label, note = '') => markup`
    <div class="md-section-title">
      <h2>${label}</h2>
      ${note ? markup`<small>${note}</small>` : ''}
    </div>`;
  const detailRow = (label, value, extra = '') => markup`
    <div class="md-detail-row">
      <span>${label}${extra ? markup`<small>${extra}</small>` : ''}</span>
      <strong>${value}</strong>
    </div>`;
  const ledgerCard = ({ title, value, rows, href, tone, empty = 'No activity yet' }) => markup`
    <section class="md-ledger-card md-${tone}">
      <header class="md-ledger-head">
        <div><span class="md-ledger-mark"></span><h3>${title}</h3></div>
        <a href="${href}">OPEN ↗</a>
      </header>
      <div class="md-ledger-total">${value}</div>
      <div class="md-ledger-rows">${rows.length ? rows : markup`<p class="md-empty">${empty}</p>`}</div>
    </section>`;

  function paint() {
    const actions = markup`
      <label class="md-month">
        <span>Credit details</span>
        <input type="month" data-month value="${state.month.slice(0, 7)}" max="${currentMonth.slice(0, 7)}" />
      </label>
      <button class="btn btn-ghost" data-print>Print</button>`;
    const heading = hero({
      label: 'MANAGER WORKSPACE',
      title: 'Manager Dashboard',
      sub: 'Staff Credit · Jazz Cash · Patty/Expenses · Other ledgers · Working Summary',
      actions,
    });

    if (state.loading) return render(el, markup`${heading}${loadingCard()}`);

    const data = state.data;
    const creditRows = Array.isArray(data.credit) ? data.credit : [];
    const ledgers = Array.isArray(data.ledgers) ? data.ledgers : [];
    const staffRows = creditRows
      .filter((person) => Number(person.net) !== 0)
      .map((person) => detailRow(person.full_name, signedMoney(person.net)));
    const staffTotal = total(creditRows, 'net');
    const jazz = ledgers.find((ledger) => ledger.code === 'jazzcash');
    const expense = ledgers.find((ledger) => ledger.code === 'expense');
    const miscLedgers = ledgers.filter((ledger) => !['jazzcash', 'expense'].includes(ledger.code));
    const jazzBalance = Number(jazz?.balance) || 0;
    const expenseBalance = Number(expense?.balance) || 0;
    const miscTotal = miscLedgers.reduce((sum, ledger) => sum + (Number(ledger.balance) || 0), 0);
    const grandTotal = staffTotal + jazzBalance + expenseBalance + miscTotal;

    const jazzRows = jazz
      ? [detailRow(jazz.name, signedMoney(jazzBalance), `${Number(jazz.entry_count) || 0} entries`)]
      : [];
    const expenseRows = expense
      ? [detailRow(expense.name, signedMoney(expenseBalance), `${Number(expense.entry_count) || 0} entries`)]
      : [];
    const miscCards = miscLedgers.map((ledger) =>
      ledgerCard({
        title: ledger.name,
        value: signedMoney(ledger.balance),
        rows: [detailRow('Entries', Number(ledger.entry_count) || 0)],
        href: '#/manager/misc',
        tone: 'misc',
      }),
    );

    const topCards = markup`
      ${can.credit ? ledgerCard({
        title: `Staff Credit — ${monthLabel(state.month)}`,
        value: signedMoney(staffTotal),
        rows: staffRows,
        href: '#/manager/credit',
        tone: 'staff',
      }) : ''}
      ${can.ledgers && jazz ? ledgerCard({
        title: 'Jazz Cash (all-time)',
        value: signedMoney(jazzBalance),
        rows: jazzRows,
        href: '#/manager/jazzcash',
        tone: 'jazz',
      }) : ''}
      ${can.ledgers && expense ? ledgerCard({
        title: 'Patty / Expenses (all-time)',
        value: signedMoney(expenseBalance),
        rows: expenseRows,
        href: '#/manager/expenses',
        tone: 'expense',
      }) : ''}
    `;

    const working = [];
    if (can.salary) working.push({ label: 'Salary', value: moneyValue(total(data.salary, 'net')), href: '#/manager/salary' });
    if (can.salary) working.push({ label: 'Generic', value: moneyValue(total(data.generic, 'final')), href: '#/manager/generic' });
    if (can.petty) working.push({ label: 'Petty Detail', value: moneyValue(pettyAmountFor(data.petty)), href: '#/manager/petty' });
    if (can.incentive) working.push({ label: 'Incentives', value: moneyValue(data.incentive?.net_inc), href: '#/manager/incentive' });

    const quick = [
      can.staff ? ['Staff Registry', '#/manager/staff'] : null,
      can.credit ? ['Staff Credit', '#/manager/credit'] : null,
      can.salary ? ['Reports', '#/manager/reports'] : null,
      can.petty ? ['Petty Cash', '#/manager/petty'] : null,
      can.ledgers ? ['Misc Sections', '#/manager/misc'] : null,
      can.inbox ? ['Credit Inbox', '#/manager/inbox'] : null,
    ].filter(Boolean);

    render(
      el,
      markup`${heading}
        <div class="md-toolbar">
          <span class="md-eyebrow">CREDIT DETAILS</span>
          <span class="md-month-label">${monthLabel(state.month)}</span>
        </div>
        <div class="md-ledger-grid md-ledger-primary">${topCards}</div>
        ${can.ledgers && miscCards.length ? markup`
          ${sectionTitle('MISC SECTIONS', 'All-time balances')}
          <div class="md-ledger-grid md-ledger-misc">${miscCards}</div>` : ''}
        ${(can.credit || can.ledgers) ? markup`
          <section class="md-total-band">
            <div>
              <strong>TOTAL OUTSTANDING CREDITS</strong>
              <small>Staff (${monthLabel(state.month)}) + Jazz Cash + Patty/Expenses + Misc Sections, all-time</small>
            </div>
            <b>${signedMoney(grandTotal)}</b>
          </section>` : ''}
        ${working.length ? markup`
          ${sectionTitle('WORKING SUMMARY')}
          <div class="md-working-grid">
            ${working.map((item) => markup`
              <a class="md-working-item" href="${item.href}">
                <strong>${item.value}</strong><span>${item.label}</span>
              </a>`)}
          </div>` : ''}
        ${can.inbox ? markup`
          <a class="md-inbox-link" href="#/manager/inbox">
            <span>Credit Inbox</span><strong>${Number(data.inbox) || 0} pending</strong><span>Review →</span>
          </a>` : ''}
        ${quick.length ? markup`
          ${sectionTitle('QUICK ACCESS')}
          <nav class="md-quick-links">${quick.map(([label, href]) => markup`<a href="${href}">${label}</a>`)}</nav>` : ''}`,
    );
  }

  el.addEventListener('change', (event) => {
    if (!event.target.matches('[data-month]') || !/^\\d{4}-\\d{2}$/.test(event.target.value)) return;
    state.month = `${event.target.value}-01`;
    load();
  });
  el.addEventListener('click', (event) => {
    if (!event.target.closest('[data-print]')) return;
    document.body.classList.add('printing-manager-dashboard');
    window.addEventListener('afterprint', () => document.body.classList.remove('printing-manager-dashboard'), { once: true });
    window.print();
  });

  await load();
}

function pettyAmountFor(groups) {
  return (groups || []).reduce((sum, group) => sum + (group.lines || []).reduce((sub, line) => sub + (Number(line.amount) || 0), 0), 0);
}
