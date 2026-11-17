// One ledger on screen: balance in words, quick add, date filter, group by category, the entries with their running balance, and
// the categories. Nothing is edited or deleted: a mistake is reversed (with a reason) and both lines stay. Direction is always shown
// in words ("adds" / "reduces"). Used by Expense, Jazz Cash and every Misc Section.
import { html, render } from '../../../shared/html.js';
import { money, parseAmount, shortDate, todayPkt } from '../../../shared/format.js';
import * as api from '../data/api.js';
import { SHIFTS, balanceMessage, directionWord, groupByCategory, validateLedgerEntry } from '../domain/ledger.js';
import { askReason, confirmDialog, errorCard, loadingCard, newKey, toast } from './parts.js';

const m = (v) => money(v, { decimals: Math.round(Number(v) * 100) % 100 !== 0 });

export async function mountLedgerPanel(host, { code = null, id = null, onLoaded = null }) {
  const today = todayPkt();
  const state = {
    ledger: null,
    rows: null,
    error: false,
    from: '',
    to: '',
    group: false,
    manage: false,
    key: null,
    errors: {},
    form: { date: today, shift: 'Morning', category: '', amount: '', description: '' },
  };

  async function load() {
    try {
      const list = await api.ledgersList();
      state.ledger = list.find((l) => (id ? l.ledger_id === id : l.code === code));
      if (!state.ledger) throw new Error('unknown ledger');
      state.rows = await api.ledgerView(state.ledger.ledger_id, state.from || null, state.to || null);
      if (!state.form.category || !state.ledger.categories.some((c) => c.id === state.form.category))
        state.form.category = state.ledger.categories[0]?.id ?? '';
      state.error = false;
      onLoaded?.(state.ledger);
    } catch {
      state.error = true;
    }
    paint();
  }

  function entryRow(e) {
    const isRev = Boolean(e.reverses_id);
    const struck = isRev || e.reversed_by;
    return html`<div class="mg-entry ${struck ? 'mg-struck' : ''}">
      <div class="mg-entry-top">
        <span>${shortDate(e.entry_date)}${e.shift ? ` · ${e.shift}` : ''}</span>
        <strong>${m(e.amount)} <small class="muted">${directionWord(e.effect)}</small></strong>
      </div>
      <div class="small">
        ${e.category_name}${e.description ? html` · ${e.description}` : ''}
        ${e.source === 'closing_inbox' ? html` <span class="chip">Closing</span>` : ''}${isRev ? html` <span class="chip">Reversal</span>` : ''}${e.reversed_by ? html` <span class="chip chip-warn">Reversed</span>` : ''}
      </div>
      ${e.reason ? html`<div class="small muted">${e.reason}</div>` : ''}
      <div class="mg-entry-bottom">
        <span class="small muted">Balance ${m(e.balance_after)}</span>
        ${!isRev && !e.reversed_by ? html`<button type="button" class="btn btn-ghost btn-sm" data-act="reverse" data-id="${e.entry_id}">Reverse</button>` : ''}
      </div>
    </div>`;
  }

  function paint() {
    if (state.error) return render(host, errorCard('this ledger'));
    if (!state.ledger || !state.rows) return render(host, loadingCard());
    const l = state.ledger;
    const bm = balanceMessage(l, l.balance);
    const f = state.form;
    const groups = state.group ? groupByCategory(state.rows) : [];
    render(
      host,
      html`<div class="card total-card">
          <div>
            <span class="label">${l.name.toUpperCase()}</span>
            <strong data-balance>${bm.amount ? html`${bm.text}: ${m(bm.amount)}` : bm.text}</strong>
          </div>
        </div>
        <div class="card">
          <h3 class="sec-label">Add entry</h3>
          <div class="fields">
            <label class="field ${state.errors.date ? 'bad' : ''}"
              ><span>Date</span><input type="date" data-form="date" value="${f.date}" max="${today}"
            /></label>
            ${
              l.has_shift
                ? html`<label class="field"
                    ><span>Shift</span
                    ><select data-form="shift">
                      ${SHIFTS.map((s) => html`<option value="${s}" ${f.shift === s ? 'selected' : ''}>${s}</option>`)}
                    </select></label
                  >`
                : ''
            }
            <label class="field"
              ><span>Category</span
              ><select data-form="category">
                ${l.categories.map((c) => html`<option value="${c.id}" ${f.category === c.id ? 'selected' : ''}>${c.name} (${directionWord(c.direction)})</option>`)}
              </select></label
            >
            <label class="field ${state.errors.amount ? 'bad' : ''}"
              ><span>Amount</span
              ><input data-form="amount" value="${f.amount}" inputmode="decimal" placeholder="0" />
              ${state.errors.amount ? html`<small class="err">${state.errors.amount}</small>` : ''}</label
            >
            <label class="field"><span>Description</span><input data-form="description" value="${f.description}" maxlength="200" /></label>
          </div>
          <div class="actions"><button type="button" class="btn btn-primary" data-act="add">Add entry</button></div>
        </div>
        <div class="card">
          <div class="fields">
            <label class="field"><span>From</span><input type="date" data-filter="from" value="${state.from}" max="${today}" /></label>
            <label class="field"><span>To</span><input type="date" data-filter="to" value="${state.to}" max="${today}" /></label>
            <label class="field"
              ><span>Group by category</span><input type="checkbox" data-act="group" ${state.group ? 'checked' : ''}
            /></label>
          </div>
        </div>
        ${
          state.group
            ? html`<div class="card">
                <table class="table">
                  <thead>
                    <tr>
                      <th>Category</th>
                      <th class="num">Adds</th>
                      <th class="num">Reduces</th>
                      <th class="num">Net</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${groups.map(
                      (g) =>
                        html`<tr>
                          <td>${g.name}</td>
                          <td class="num">${m(g.added)}</td>
                          <td class="num">${m(g.reduced)}</td>
                          <td class="num">${m(g.net)}</td>
                        </tr>`,
                    )}
                  </tbody>
                </table>
              </div>`
            : ''
        }
        ${state.rows.length ? [...state.rows].reverse().map((e) => html`<div class="card">${entryRow(e)}</div>`) : html`<div class="card"><p class="muted">No entries${state.from || state.to ? ' in this range' : ' yet'}.</p></div>`}
        <div class="card">
          <p class="small">
            <button type="button" class="link" data-act="manage">${state.manage ? 'Hide categories' : 'Manage categories'}</button>
          </p>
          ${
            state.manage
              ? html`${l.categories.map(
                    (c) =>
                      html`<p class="small">
                        ${c.name}
                        <span class="chip">${directionWord(c.direction)}</span>
                        ${l.categories.length > 1 ? html` <button type="button" class="link" data-act="retire" data-id="${c.id}">stop using</button>` : ''}
                      </p>`,
                  )}
                  <div class="fields">
                    <label class="field"><span>New category</span><input id="cat-name" maxlength="40" /></label>
                    <label class="field"
                      ><span>It</span
                      ><select id="cat-dir">
                        <option value="1">Adds to the balance</option>
                        <option value="-1">Reduces the balance</option>
                      </select></label
                    >
                  </div>
                  <p class="small muted">A category's direction can never be changed. Stop using it and add a new one instead.</p>
                  <div class="actions"><button type="button" class="btn btn-ghost btn-sm" data-act="addcat">Add category</button></div>`
              : ''
          }
        </div>`,
    );
  }

  host.addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.form) {
      state.form[t.dataset.form] = t.value;
      state.key = null; // an edited form is a new entry, so it needs a new idempotency key
    }
  });
  host.addEventListener('change', async (e) => {
    const t = e.target;
    if (t.dataset.filter) {
      state.from = t.dataset.filter === 'from' ? t.value : state.from;
      state.to = t.dataset.filter === 'to' ? t.value : state.to;
      await load();
    }
    if (t.dataset.act === 'group') {
      state.group = t.checked;
      paint();
    }
  });
  host.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-act]');
    if (!t || t.type === 'checkbox') return;
    const act = t.dataset.act;
    if (act === 'manage') {
      state.manage = !state.manage;
      return paint();
    }
    if (act === 'add') {
      const f = state.form;
      const amount = parseAmount(f.amount);
      const msg = validateLedgerEntry({
        date: f.date,
        amount,
        today,
        categoryId: f.category,
        shift: f.shift,
        needsShift: state.ledger.has_shift,
      });
      state.errors = msg ? { amount: msg } : {};
      if (msg) return paint();
      state.key ??= newKey();
      const { error } = await api.ledgerAdd(
        state.ledger.ledger_id,
        f.category,
        f.date,
        state.ledger.has_shift ? f.shift : null,
        f.description.trim(),
        amount,
        state.key,
      );
      if (error) return toast(error.message || 'Could not add the entry.', 'error');
      toast('Entry added');
      state.form = { ...f, amount: '', description: '' };
      state.key = null;
      state.errors = {};
      return load();
    }
    if (act === 'reverse') {
      const reason = await askReason({
        title: 'Reverse this entry?',
        hint: 'An opposite line is added on the same date. Nothing is erased.',
        confirm: 'Reverse',
      });
      if (reason === null) return;
      const { error } = await api.ledgerReverse(t.dataset.id, reason, newKey());
      if (error) return toast(error.message || 'Could not reverse the entry.', 'error');
      toast('Entry reversed');
      return load();
    }
    if (act === 'retire') {
      const c = state.ledger.categories.find((x) => x.id === t.dataset.id);
      const ok = await confirmDialog({
        title: `Stop using “${c.name}”?`,
        body: 'Its past entries stay. It can no longer be chosen for new entries.',
        confirm: 'Stop using',
      });
      if (!ok) return;
      const { error } = await api.categoryRetire(c.id, newKey());
      if (error) return toast(error.message || 'Could not stop the category.', 'error');
      toast('Category stopped');
      return load();
    }
    if (act === 'addcat') {
      const name = host.querySelector('#cat-name').value.trim();
      if (!name) return toast('Give the category a name.', 'error');
      const { error } = await api.categoryAdd(state.ledger.ledger_id, name, Number(host.querySelector('#cat-dir').value), newKey());
      if (error) return toast(error.message || 'Could not add the category.', 'error');
      toast('Category added');
      return load();
    }
  });

  render(host, loadingCard());
  await load();
}
