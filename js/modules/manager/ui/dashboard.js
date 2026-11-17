import { html as markup, render } from '../../../shared/html.js';
import { hero } from '../../../shared/ui.js';
import { money, monthLabel, todayPkt } from '../../../shared/format.js';
import * as api from '../data/api.js';
import { monthStart } from '../domain/credit.js';
import { balanceMessage } from '../domain/ledger.js';
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

  const card = (label, value, href) => markup`
    <a class="md-kpi" href="${href}">
      <small>${label}</small>
      <strong>${value}</strong>
      <span>Open details ↗</span>
    </a>`;
  const line = (label, value) => markup`
    <div class="md-line"><span>${label}</span><strong>${value}</strong></div>`;
  const panel = (label, body, href) => markup`
    <section class="md-panel">
      <header><h2>${label}</h2><a href="${href}">View →</a></header>
      ${body}
    </section>`;

  function paint() {
    const actions = markup`
      <label class="md-month">
        Month
        <input type="month" data-month value="${state.month.slice(0, 7)}" max="${currentMonth.slice(0, 7)}" />
      </label>
      <button class="btn btn-ghost" data-print>Print / PDF</button>`;
    const heading = hero({
      label: 'MANAGER WORKSPACE',
      title: 'Manager Overview',
      sub: monthLabel(state.month),
      actions,
    });

    if (state.loading) return render(el, markup`${heading}${loadingCard()}`);

    const data = state.data;
    const cards = [];
    if (can.credit) {
      cards.push(card('Staff credit outstanding', data.credit ? moneyValue(total(data.credit, 'net')) : 'Unavailable', '#/manager/credit'));
    }
    if (can.salary) {
      cards.push(
        card('Net salary', data.salary ? moneyValue(total(data.salary, 'net')) : 'Unavailable', '#/manager/salary'),
        card('Generic final', data.generic ? moneyValue(total(data.generic, 'final')) : 'Unavailable', '#/manager/generic'),
      );
    }
    if (can.incentive) {
      cards.push(card('Net incentive', data.incentive ? moneyValue(data.incentive.net_inc) : 'Unavailable', '#/manager/incentive'));
    }
    if (can.petty) {
      const pettyAmount = (data.petty || []).reduce(
        (sum, group) => sum + (group.lines || []).reduce((sub, item) => sub + (Number(item.amount) || 0), 0),
        0,
      );
      cards.push(card('Petty cash', data.petty ? moneyValue(pettyAmount) : 'Unavailable', '#/manager/petty'));
    }

    const credit = can.credit
      ? panel(
          'Staff Credit',
          data.credit
            ? markup`${line('Previous balance', moneyValue(total(data.credit, 'prev_balance')))}${line(
                'Monthly entries',
                moneyValue(total(data.credit, 'entries_total')),
              )}${line('Net outstanding', moneyValue(total(data.credit, 'net')))}`
            : markup`<p>Could not load credit data.</p>`,
          '#/manager/credit',
        )
      : '';
    const payroll = can.salary
      ? panel(
          'Payroll & Generic',
          data.salary && data.generic
            ? markup`${line('HO salary', moneyValue(total(data.salary, 'ho_salary')))}${line(
                'Advances',
                moneyValue(total(data.salary, 'advance')),
              )}${line('Generic in payroll', moneyValue(total(data.salary, 'generic')))}${line(
                'Net salary',
                moneyValue(total(data.salary, 'net')),
              )}${line('Generic final', moneyValue(total(data.generic, 'final')))}`
            : markup`<p>Could not load sheets.</p>`,
          '#/manager/salary',
        )
      : '';
    const incentive = can.incentive
      ? panel(
          'Incentive',
          data.incentive
            ? markup`${line('Sale commission', moneyValue(data.incentive.sale_comm))}${line(
                'Generic incentive',
                moneyValue(data.incentive.gen_inc),
              )}${line('Net incentive', moneyValue(data.incentive.net_inc))}${line('Owner share', moneyValue(data.incentive.owner_net))}`
            : markup`<p>Could not load incentive.</p>`,
          '#/manager/incentive',
        )
      : '';
    const petty = can.petty
      ? panel(
          'Petty Cash',
          data.petty
            ? markup`${line('Voucher total', moneyValue(pettyAmountFor(data.petty)))}${line('Voucher groups', data.petty.length)}`
            : markup`<p>Could not load petty cash.</p>`,
          '#/manager/petty',
        )
      : '';
    const ledgers = can.ledgers
      ? panel(
          'Live Balances',
          data.ledgers
            ? markup`${data.ledgers.map((ledger) => {
                const balance = balanceMessage(ledger, ledger.balance);
                const href =
                  ledger.code === 'expense' ? '#/manager/expenses' : ledger.code === 'jazzcash' ? '#/manager/jazzcash' : '#/manager/misc';
                return markup`
                  <a class="md-balance" href="${href}">
                    <span>${ledger.name}</span>
                    <strong>${balance.amount ? moneyValue(balance.amount) : 'Settled'}</strong>
                    <small>${balance.text} · ${ledger.entry_count} entries</small>
                  </a>`;
              })}`
            : markup`<p>Could not load ledgers.</p>`,
          '#/manager/expenses',
        )
      : '';
    const inbox = can.inbox
      ? panel(
          'Credit Inbox',
          data.inbox === null
            ? markup`<p>Inbox count unavailable.</p>`
            : markup`
                <strong class="md-inbox">${Number(data.inbox ?? 0)}</strong>
                <a href="#/manager/inbox">Review inbox →</a>`,
          '#/manager/inbox',
        )
      : '';
    const links = markup`
      <nav class="md-links">
        ${can.staff ? markup`<a href="#/manager/staff">Staff Registry</a>` : ''}
        ${can.credit ? markup`<a href="#/manager/credit">Staff Credit</a>` : ''}
        ${can.salary ? markup`<a href="#/manager/reports">Reports</a>` : ''}
        ${can.petty ? markup`<a href="#/manager/petty">Petty Cash</a>` : ''}
        ${can.ledgers ? markup`<a href="#/manager/misc">Misc Sections</a>` : ''}
      </nav>`;

    render(
      el,
      markup`${heading}
        <div class="md-intro">
          <span>MONTHLY SNAPSHOT</span>
          <h2>Your branch, at a glance.</h2>
          <p>Live figures from existing Manager records.</p>
        </div>
        <div class="md-kpis">${cards}</div>
        <div class="md-columns">${credit}${payroll}${incentive}${petty}${ledgers}${inbox}</div>
        ${panel('Quick Access', links, '#/manager')}`,
    );
  }

  el.addEventListener('change', (event) => {
    if (!event.target.matches('[data-month]') || !/^\d{4}-\d{2}$/.test(event.target.value)) return;
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
