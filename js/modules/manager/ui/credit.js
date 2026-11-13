// Staff Credit: advances and repayments, month by month. Net = previous + entries - salary deduction - less generic.
// Nothing is edited or deleted: a mistake is reversed (with a reason) and both lines stay visible.
import { html, render } from '../../../shared/html.js';
import { hero } from '../../../shared/ui.js';
import { money, monthLabel, parseAmount, shortDate, todayPkt } from '../../../shared/format.js';
import * as api from '../data/api.js';
import { deductionChange, monthStart, shiftMonth, sumNet, validateEntry } from '../domain/credit.js';
import { askReason, errorCard, loadingCard, newKey, openDialog, toast } from './parts.js';

const m = (v) => money(v, { decimals: Math.round(Number(v) * 100) % 100 !== 0 });

export async function mount(el, { ctx }) {
  const perms = new Set(ctx.permissions);
  const canManage = perms.has('mgmt.credit_manage');
  const canOpen = perms.has('mgmt.openings');
  const today = todayPkt();
  const thisMonth = monthStart(today);
  const state = {
    month: thisMonth,
    people: null,
    error: false,
    openId: null,
    form: { date: today, description: '', amount: '' },
    key: null,
    errors: {},
    ded: {},
  };

  async function load() {
    state.people = null;
    paint();
    try {
      state.people = await api.creditMonth(state.month);
      state.error = false;
    } catch {
      state.error = true;
    }
    paint();
  }

  const dedKey = (p, kind) => `${p.staff_id}:${kind}`;
  function personBody(p) {
    const minDate = p.opening_month ?? '';
    return html`<div class="mg-body">
      ${
        p.entries.length
          ? html`<table class="table">
              <tbody>
                ${p.entries.map(
                  (e) =>
                    html`<tr class="${e.reversed_by || e.reverses_id ? 'mg-struck' : ''}">
                      <td>${shortDate(e.entry_date)}</td>
                      <td>
                        ${e.description || '—'}${e.reverses_id ? html` <span class="chip">Reversal</span>` : ''}${e.reversed_by ? html` <span class="chip chip-warn">Reversed</span>` : ''}
                        ${e.reason ? html`<br /><small class="muted">${e.reason}</small>` : ''}
                      </td>
                      <td class="num">${m(e.amount)}</td>
                      <td>
                        ${canManage && !e.reversed_by && !e.reverses_id ? html`<button type="button" class="btn btn-ghost btn-sm" data-act="reverse" data-id="${e.id}">Reverse</button>` : ''}
                      </td>
                    </tr>`,
                )}
              </tbody>
            </table>`
          : html`<p class="muted small">No entries this month.</p>`
      }
      ${
        canManage
          ? html`<h3 class="sec-label">Add entry</h3>
              <div class="fields">
                <label class="field ${state.errors.date ? 'bad' : ''}"
                  ><span>Date</span
                  ><input type="date" data-form="date" value="${state.form.date}" max="${today}" ${minDate ? html`min="${minDate}"` : ''}
                /></label>
                <label class="field"
                  ><span>Note</span
                  ><input data-form="description" value="${state.form.description}" maxlength="200" placeholder="e.g. advance"
                /></label>
                <label class="field ${state.errors.amount ? 'bad' : ''}"
                  ><span>Amount</span><input data-form="amount" value="${state.form.amount}" inputmode="decimal" placeholder="2,000" />
                  <small class="muted">A plain number is an advance. A minus is a repayment.</small
                  >${state.errors.amount ? html`<small class="err">${state.errors.amount}</small>` : ''}</label
                >
              </div>
              <div class="actions">
                <button type="button" class="btn btn-primary" data-act="add" data-id="${p.staff_id}">Add entry</button>
              </div>
              <h3 class="sec-label">Deductions this month</h3>
              <div class="fields">
                ${['salary_deduction', 'generic_deduction'].map((kind) => {
                  const v = state.ded[dedKey(p, kind)] ?? String(p[kind] || '');
                  return html`<label class="field"
                    ><span>${kind === 'salary_deduction' ? 'Salary deducted' : 'Less generic'}</span>
                    <input data-ded="${kind}" data-id="${p.staff_id}" value="${v}" inputmode="decimal" placeholder="0" />
                    <button type="button" class="btn btn-ghost btn-sm" data-act="ded" data-kind="${kind}" data-id="${p.staff_id}">
                      Set
                    </button></label
                  >`;
                })}
              </div>`
          : ''
      }
      ${
        canOpen
          ? html`<p class="small muted">
              Opening balance: ${p.opening_month ? html`${m(p.opening_amount)} from ${monthLabel(p.opening_month)}` : 'not set'} ·
              <button type="button" class="link" data-act="opening" data-id="${p.staff_id}">
                ${p.opening_month ? 'Change' : 'Set opening balance'}
              </button>
            </p>`
          : ''
      }
    </div>`;
  }

  function paint() {
    if (state.error) return render(el, errorCard('staff credit'));
    const head = hero({
      label: 'Manager',
      title: 'Staff Credit',
      sub: monthLabel(state.month),
      actions: html`<button class="icon-btn" data-act="prev" aria-label="Previous month">‹</button
        ><button class="icon-btn" data-act="next" aria-label="Next month" ${state.month >= thisMonth ? 'disabled' : ''}>›</button>`,
    });
    if (!state.people) return render(el, html`${head}${loadingCard()}`);
    render(
      el,
      html`${head}
      ${
        state.people.length
          ? state.people.map(
              (p) =>
                html`<section class="card mg-credit">
                  <button
                    type="button"
                    class="mg-head"
                    data-act="toggle"
                    data-id="${p.staff_id}"
                    aria-expanded="${state.openId === p.staff_id}"
                  >
                    <span class="mg-name"
                      ><strong>${p.full_name}</strong
                      ><small class="muted">${p.staff_code || ''}${p.active ? '' : ' · inactive'}</small></span
                    >
                    <span class="mg-net"><small class="muted">Net</small><strong>${m(p.net)}</strong></span>
                  </button>
                  <p class="small muted mg-sum">
                    Previous ${m(p.prev_balance)} · Entries ${m(p.entries_total)} · Salary −${m(p.salary_deduction)} · Less generic
                    −${m(p.generic_deduction)}
                  </p>
                  ${state.openId === p.staff_id ? personBody(p) : ''}
                </section>`,
            )
          : html`<div class="card"><p class="muted">Nobody has credit this month.</p></div>`
      }
      ${
        state.people.length
          ? html`<div class="card total-card">
              <div><span class="label">TOTAL NET CREDIT</span><strong>${m(sumNet(state.people))}</strong></div>
            </div>`
          : ''
      }`,
    );
  }

  const person = (id) => state.people.find((p) => p.staff_id === id);

  async function afterChange(message) {
    toast(message);
    state.key = null;
    state.errors = {};
    await load();
  }

  async function openingDialog(p) {
    const dlg = openDialog(
      html`<h2>Opening balance: ${p.full_name}</h2>
        <p class="muted small">The balance this person owes at the start of the chosen month. Earlier rows must not exist.</p>
        <label class="field"
          ><span>From month</span
          ><input type="month" id="o-month" value="${(p.opening_month ?? state.month).slice(0, 7)}" max="${thisMonth.slice(0, 7)}"
        /></label>
        <label class="field"
          ><span>Amount</span><input id="o-amount" inputmode="decimal" value="${p.opening_month ? String(p.opening_amount) : ''}"
        /></label>
        <label class="field"
          ><span>Reason</span><input id="o-reason" maxlength="200" placeholder="e.g. balance carried from the old app"
        /></label>
        <small class="err" id="o-err" hidden></small>
        <div class="actions">
          <button type="button" class="btn btn-ghost" data-close>Cancel</button
          ><button type="button" class="btn btn-primary" data-ok>Save opening</button>
        </div>`,
      { label: 'Opening balance' },
    );
    dlg.addEventListener('click', async (e) => {
      if (!e.target.closest('[data-ok]')) return;
      const err = (t) => {
        const box = dlg.querySelector('#o-err');
        box.textContent = t;
        box.hidden = false;
      };
      const month = `${dlg.querySelector('#o-month').value}-01`;
      const amount = parseAmount(dlg.querySelector('#o-amount').value);
      const reason = dlg.querySelector('#o-reason').value.trim();
      if (!/^\d{4}-\d{2}-01$/.test(month) || month > thisMonth) return err('Pick a month that has started.');
      if (amount === null || Number.isNaN(amount)) return err('Enter the amount.');
      if (reason.length < 3) return err('Please give a short reason.');
      const { error } = await api.creditSetOpening(p.staff_id, month, amount, reason, newKey());
      if (error) return err(error.message || 'Could not save.');
      dlg.close();
      afterChange('Opening balance saved');
    });
  }

  el.addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.form) {
      state.form[t.dataset.form] = t.value;
      state.key = null; // an edited form is a new entry, so it needs a new idempotency key
    }
    if (t.dataset.ded) state.ded[`${t.dataset.id}:${t.dataset.ded}`] = t.value;
  });

  el.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-act]');
    if (!t) return;
    const act = t.dataset.act;
    if (act === 'prev' || act === 'next') {
      state.month = shiftMonth(state.month, act === 'prev' ? -1 : 1);
      state.openId = null;
      state.ded = {};
      return load();
    }
    if (act === 'toggle') {
      state.openId = state.openId === t.dataset.id ? null : t.dataset.id;
      state.errors = {};
      return paint();
    }
    const p = t.dataset.id && person(t.dataset.id);
    if (act === 'add' && p) {
      const amount = parseAmount(state.form.amount);
      const msg = validateEntry({ date: state.form.date, amount, today, openingMonth: p.opening_month });
      state.errors = msg ? { amount: msg } : {};
      if (msg) return paint();
      state.key ??= newKey();
      const { error } = await api.creditAdd(p.staff_id, state.form.date, state.form.description.trim(), amount, state.key);
      if (error) {
        toast(error.message || 'Could not add the entry.', 'error');
        return;
      }
      state.form = { date: today, description: '', amount: '' };
      return afterChange('Entry added');
    }
    if (act === 'reverse') {
      const reason = await askReason({
        title: 'Reverse this entry?',
        hint: 'A matching opposite line is added. Nothing is erased.',
        confirm: 'Reverse',
      });
      if (reason === null) return;
      const { error } = await api.creditReverse(t.dataset.id, reason, newKey());
      if (error) return toast(error.message || 'Could not reverse the entry.', 'error');
      return afterChange('Entry reversed');
    }
    if (act === 'ded' && p) {
      const kind = t.dataset.kind;
      const wanted = parseAmount(state.ded[dedKey(p, kind)] ?? String(p[kind] || '0')) ?? 0;
      if (Number.isNaN(wanted) || wanted < 0) return toast('Enter a number, 0 or more.', 'error');
      const change = deductionChange(p[kind], wanted);
      if (change.unchanged) return toast('No change');
      let reason = '';
      if (change.needsReason) {
        reason = await askReason({
          title: 'Change this deduction?',
          hint: `It was ${m(p[kind])}. The old figure stays in the record.`,
          confirm: 'Change',
        });
        if (reason === null) return;
      }
      const { error } = await api.creditSetDeduction(p.staff_id, state.month, kind, wanted, reason, newKey());
      if (error) return toast(error.message || 'Could not save the deduction.', 'error');
      delete state.ded[dedKey(p, kind)];
      return afterChange('Deduction saved');
    }
    if (act === 'opening' && p) return openingDialog(p);
  });

  render(el, loadingCard());
  await load();
}
