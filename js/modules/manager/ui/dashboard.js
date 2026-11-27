import { html as markup, render } from '../../../shared/html.js';
import { hero } from '../../../shared/ui.js';
import { money, monthLabel, shortDate, todayPkt } from '../../../shared/format.js';
import * as api from '../data/api.js';
import { fromPaisa, monthStart, toPaisa } from '../domain/credit.js';
import { RANGE_PRESETS, groupByCategory, presetRange } from '../domain/ledger.js';
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
  const today = todayPkt();
  const currentMonth = monthStart(today);
  const can = {
    credit: permissions.has('credit.view') || permissions.has('mgmt.credit_manage'),
    salary: permissions.has('mgmt.salary') || permissions.has('mgmt.salary_view'),
    incentive: permissions.has('mgmt.incentive'),
    petty: permissions.has('mgmt.petty_cash'),
    ledgers: permissions.has('mgmt.ledgers'),
    inbox: permissions.has('mgmt.inbox_file') && permissions.has('credit.view'),
    staff: permissions.has('mgmt.staff_view') || permissions.has('mgmt.staff_edit'),
  };
  // The Patty / Expenses card has its own date range and its own list of entries (only the entries in the range are fetched).
  const state = {
    month: currentMonth,
    data: {},
    loading: true,
    exp: { from: '', to: '', rows: null, busy: false, failed: false, open: new Set() },
  };
  let expenseToken = 0;

  const expenseLedger = () => (Array.isArray(state.data.ledgers) ? state.data.ledgers : []).find((ledger) => ledger.code === 'expense');

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
    if (can.ledgers) await loadExpense();
  }

  // Fetch the Expense ledger's entries for the chosen dates (no dates = all-time). A newer request wins over an older one.
  async function loadExpense() {
    const ledger = expenseLedger();
    if (!ledger) {
      state.exp.busy = false;
      return;
    }
    const mine = ++expenseToken;
    state.exp.busy = true;
    paint();
    const rows = await safe(() => api.ledgerView(ledger.ledger_id, state.exp.from || null, state.exp.to || null));
    if (mine !== expenseToken) return;
    state.exp.rows = Array.isArray(rows) ? rows : null;
    state.exp.failed = !Array.isArray(rows);
    state.exp.busy = false;
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

  // Patty / Expenses: date range + quick ranges, then one row per category (count and net); a row opens to show its entries.
  function expenseCard(expense, allTimeBalance) {
    const ex = state.exp;
    const filtered = Boolean(ex.from || ex.to);
    const rows = ex.rows;
    const order = new Map((expense.categories || []).map((category, index) => [category.id, index]));
    const groups = rows ? groupByCategory(rows).sort((a, b) => (order.get(a.category_id) ?? 99) - (order.get(b.category_id) ?? 99)) : [];
    const net = filtered && rows ? fromPaisa(groups.reduce((sum, group) => sum + toPaisa(group.net), 0)) : allTimeBalance;
    const presetOn = (kind) => {
      const range = presetRange(kind, state.month, today);
      return Boolean(range) && range.from === ex.from && range.to === ex.to;
    };
    const tone = (value) => (Number(value) < 0 ? 'md-neg' : 'md-pos');

    const entryRow = (entry) => {
      const struck = Boolean(entry.reverses_id || entry.reversed_by);
      const amount = (Number(entry.effect) < 0 ? -1 : 1) * Number(entry.amount);
      return markup`
        <div class="md-entry ${struck ? 'is-struck' : ''}">
          <span>${shortDate(entry.entry_date)}${entry.shift ? ` · ${entry.shift}` : ''}${entry.description ? markup`<small>${entry.description}</small>` : ''}</span>
          <b class="${tone(amount)}">${signedMoney(amount)}</b>
        </div>`;
    };
    const categoryRow = (group) => {
      const open = ex.open.has(group.category_id);
      const entries = open ? rows.filter((entry) => entry.category_id === group.category_id).reverse() : [];
      return markup`
        <div class="md-cat">
          <button type="button" class="md-cat-head" data-exp-cat="${group.category_id}" aria-expanded="${open}">
            <span class="md-chev" aria-hidden="true">${open ? '▾' : '▸'}</span>
            <span class="md-cat-name">${group.name} <small>(${group.count})</small></span>
            <strong class="${tone(group.net)}">${signedMoney(group.net)}</strong>
          </button>
          ${open ? markup`<div class="md-entries">${entries.map(entryRow)}</div>` : ''}
        </div>`;
    };

    let body;
    if (ex.failed) body = markup`<p class="md-empty">Could not load the entries. Try again in a moment.</p>`;
    else if (!rows) body = markup`<p class="md-empty">Loading…</p>`;
    else if (!groups.length) body = markup`<p class="md-empty">No entries${filtered ? ' in this range' : ' yet'}.</p>`;
    else body = groups.map(categoryRow);

    return markup`
      <section class="md-ledger-card md-expense">
        <header class="md-ledger-head">
          <div><span class="md-ledger-mark"></span><h3>Patty / Expenses (${filtered ? 'date range' : 'all-time'})</h3></div>
          <a href="#/manager/expenses">OPEN ↗</a>
        </header>
        <div class="md-ledger-total">${signedMoney(net)}</div>
        <div class="md-exp-filter">
          <div class="md-exp-dates">
            <input type="date" data-exp-from value="${ex.from}" max="${today}" aria-label="From date" />
            <span>to</span>
            <input type="date" data-exp-to value="${ex.to}" max="${today}" aria-label="To date" />
          </div>
          <div class="md-exp-presets">
            ${RANGE_PRESETS.map(
              ([kind, label]) =>
                markup`<button type="button" class="md-chip ${presetOn(kind) ? 'is-on' : ''}" data-exp-preset="${kind}">${label}</button>`,
            )}
            <button type="button" class="md-chip md-chip-reset" data-exp-reset ${filtered ? '' : 'disabled'}>↺ Reset</button>
          </div>
        </div>
        <div class="md-ledger-rows md-cats ${ex.busy ? 'md-busy' : ''}">${body}</div>
      </section>`;
  }

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

    const jazzRows = jazz ? [detailRow(jazz.name, signedMoney(jazzBalance), `${Number(jazz.entry_count) || 0} entries`)] : [];
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
      ${
        can.credit
          ? ledgerCard({
              title: `Staff Credit — ${monthLabel(state.month)}`,
              value: signedMoney(staffTotal),
              rows: staffRows,
              href: '#/manager/credit',
              tone: 'staff',
            })
          : ''
      }
      ${
        can.ledgers && jazz
          ? ledgerCard({
              title: 'Jazz Cash (all-time)',
              value: signedMoney(jazzBalance),
              rows: jazzRows,
              href: '#/manager/jazzcash',
              tone: 'jazz',
            })
          : ''
      }
      ${can.ledgers && expense ? expenseCard(expense, expenseBalance) : ''}
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
        ${
          can.ledgers && miscCards.length
            ? markup`
          ${sectionTitle('MISC SECTIONS', 'All-time balances')}
          <div class="md-ledger-grid md-ledger-misc">${miscCards}</div>`
            : ''
        }
        ${
          can.credit || can.ledgers
            ? markup`
          <section class="md-total-band">
            <div>
              <strong>TOTAL OUTSTANDING CREDITS</strong>
              <small>Staff (${monthLabel(state.month)}) + Jazz Cash + Patty/Expenses + Misc Sections, all-time</small>
            </div>
            <b>${signedMoney(grandTotal)}</b>
          </section>`
            : ''
        }
        ${
          working.length
            ? markup`
          ${sectionTitle('WORKING SUMMARY')}
          <div class="md-working-grid">
            ${working.map(
              (item) => markup`
              <a class="md-working-item" href="${item.href}">
                <strong>${item.value}</strong><span>${item.label}</span>
              </a>`,
            )}
          </div>`
            : ''
        }
        ${
          can.inbox
            ? markup`
          <a class="md-inbox-link" href="#/manager/inbox">
            <span>Credit Inbox</span><strong>${Number(data.inbox) || 0} pending</strong><span>Review →</span>
          </a>`
            : ''
        }
        ${
          quick.length
            ? markup`
          ${sectionTitle('QUICK ACCESS')}
          <nav class="md-quick-links">${quick.map(([label, href]) => markup`<a href="${href}">${label}</a>`)}</nav>`
            : ''
        }`,
    );
  }

  el.addEventListener('change', (event) => {
    const target = event.target;
    if (target.matches('[data-month]')) {
      if (!/^\d{4}-\d{2}$/.test(target.value)) return;
      state.month = `${target.value}-01`;
      return load();
    }
    if (target.matches('[data-exp-from], [data-exp-to]')) {
      if (target.matches('[data-exp-from]')) state.exp.from = target.value;
      else state.exp.to = target.value;
      const { from, to } = state.exp;
      if (from && to && from > to) [state.exp.from, state.exp.to] = [to, from]; // dates typed the wrong way round: swap them
      return loadExpense();
    }
  });
  el.addEventListener('click', (event) => {
    if (event.target.closest('[data-print]')) {
      document.body.classList.add('printing-manager-dashboard');
      window.addEventListener('afterprint', () => document.body.classList.remove('printing-manager-dashboard'), { once: true });
      window.print();
      return;
    }
    const category = event.target.closest('[data-exp-cat]');
    if (category) {
      const id = category.dataset.expCat;
      if (state.exp.open.has(id)) state.exp.open.delete(id);
      else state.exp.open.add(id);
      return paint();
    }
    const preset = event.target.closest('[data-exp-preset]');
    if (preset) {
      const range = presetRange(preset.dataset.expPreset, state.month, today);
      if (!range) return;
      state.exp.from = range.from;
      state.exp.to = range.to;
      return loadExpense();
    }
    if (event.target.closest('[data-exp-reset]')) {
      state.exp.from = '';
      state.exp.to = '';
      return loadExpense();
    }
  });

  await load();
}

function pettyAmountFor(groups) {
  return (groups || []).reduce((sum, group) => sum + (group.lines || []).reduce((sub, line) => sub + (Number(line.amount) || 0), 0), 0);
}
