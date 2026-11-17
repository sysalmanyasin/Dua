// Incentive: the month's branch-wide incentive and the owner's share. Owner only (it contains the owner's own figures).
// Every typed figure is rounded to a whole rupee. Saving adds a revision (only when something changed); a closed month needs a reason;
// a month keeps the rates it started with. Print gives a statement to keep.
import { html, render } from '../../../shared/html.js';
import { hero } from '../../../shared/ui.js';
import { money, monthLabel, parseAmount, todayPkt } from '../../../shared/format.js';
import { BRAND } from '../../../core/config.js';
import * as api from '../data/api.js';
import { monthStart, shiftMonth } from '../domain/credit.js';
import { INCENTIVE_FIELDS, incentiveCalc } from '../domain/incentive.js';
import { percent } from '../domain/salary.js';
import {
  askReason,
  confirmDialog,
  errorCard,
  isBadNumber,
  loadingCard,
  monthButtons,
  newKey,
  openDialog,
  toast,
  typedNumber,
} from './parts.js';
import { openRateDialog } from './rates.js';

const m = (v) => money(v, { decimals: Math.round(Number(v) * 100) % 100 !== 0 });
const RATES = [
  { key: 'sale_commission', field: 'rate_sale_commission', label: 'Sale commission' },
  { key: 'generic_pool', field: 'rate_generic_pool', label: 'Generic incentive' },
  { key: 'owner_share', field: 'rate_owner_share', label: 'Owner’s share' },
];

export async function mount(el, { ctx }) {
  const perms = new Set(ctx.permissions);
  const canEdit = perms.has('mgmt.incentive');
  const canClose = perms.has('mgmt.close_month');
  const canRates = perms.has('mgmt.rates');
  const thisMonth = monthStart(todayPkt());
  const state = { month: thisMonth, d: null, edits: {}, key: null, error: false };

  const orig = (k) => (state.d[k] ? String(state.d[k]) : '');
  const text = (k) => state.edits[k] ?? orig(k);
  const inputs = () => Object.fromEntries(INCENTIVE_FIELDS.map((f) => [f.key, typedNumber(parseAmount, text(f.key))]));
  const rates = () => ({
    sale_commission: Number(state.d.rate_sale_commission),
    generic_pool: Number(state.d.rate_generic_pool),
    owner_share: Number(state.d.rate_owner_share),
  });
  const calc = () => incentiveCalc(inputs(), rates());
  const isDirty = () => state.d && INCENTIVE_FIELDS.some((f) => text(f.key) !== orig(f.key));

  async function load() {
    state.d = null;
    paint();
    try {
      state.d = await api.incentiveMonth(state.month);
      state.error = false;
    } catch {
      state.error = true;
    }
    paint();
  }

  // The statement rows, in the old app's order.
  const lines = (o) => [
    { k: 'sale_comm', label: `Sale commission (${percent(state.d.rate_sale_commission)})`, v: o.sale_comm },
    { k: 'gen_inc', label: `Generic incentive (${percent(state.d.rate_generic_pool)})`, v: o.gen_inc },
    { k: 'total_comm', label: 'Commission after pilferage and till short', v: o.total_comm },
    { k: 'total_gen', label: 'Generic part after excess fine', v: o.total_gen },
    { k: 'grand_total', label: 'Grand total', v: o.grand_total, strong: true },
    { k: 'pre_panel', label: 'After plus fine and paper fine', v: o.pre_panel },
    { k: 'net_inc', label: 'Net incentive (after panel fine)', v: o.net_inc, strong: true },
    { k: 'owner_net', label: `Owner’s share (${percent(state.d.rate_owner_share)}) after tax`, v: o.owner_net, strong: true },
  ];

  function paint() {
    if (state.error) return render(el, errorCard('the incentive sheet'));
    const head = hero({
      label: 'Manager',
      title: 'Incentive',
      sub: monthLabel(state.month),
      actions: monthButtons(state.month, thisMonth),
    });
    if (!state.d) return render(el, html`${head}${loadingCard()}`);
    const o = calc();
    render(
      el,
      html`${head}
        <div class="card">
          <p class="small">
            Rates this month:
            ${RATES.map((r) => html`${r.label} <strong>${percent(state.d[r.field])}</strong>${canRates ? html` <button type="button" class="link" data-act="rate" data-rate="${r.key}">change</button>` : ''}; `)}
          </p>
          <p class="small muted">
            ${state.d.closed ? 'This month is closed. Changes are saved as revisions and need a reason.' : 'A month keeps the rates it started with, even if they change later.'}
          </p>
        </div>
        <div class="card">
          <div class="fields">
            ${INCENTIVE_FIELDS.map(
              (f) =>
                html`<label class="field"
                  ><span>${f.label}</span>
                  <input data-i="${f.key}" value="${text(f.key)}" inputmode="decimal" placeholder="0" ${canEdit ? '' : 'disabled'}
                /></label>`,
            )}
          </div>
        </div>
        <div class="card">
          <table class="table">
            <tbody>
              ${lines(o).map(
                (l) =>
                  html`<tr>
                    <td>${l.strong ? html`<strong>${l.label}</strong>` : l.label}</td>
                    <td class="num" data-out="${l.k}">${l.strong ? html`<strong>${m(l.v)}</strong>` : m(l.v)}</td>
                  </tr>`,
              )}
            </tbody>
          </table>
        </div>
        <div class="actions">
          ${canEdit ? html`<button type="button" class="btn btn-primary" data-act="save">${state.d.closed ? 'Save a revision' : 'Save month'}</button>` : ''}
          <button type="button" class="btn btn-ghost" data-act="print">Print statement</button>
          ${canClose && state.d.has_row && !state.d.closed ? html`<button type="button" class="btn btn-ghost" data-act="close">Close month</button>` : ''}
        </div>`,
    );
  }

  el.addEventListener('input', (e) => {
    const t = e.target;
    if (!t.dataset.i) return;
    state.edits[t.dataset.i] = t.value;
    state.key = null; // an edited month is a new save, so it needs a new idempotency key
    for (const l of lines(calc())) {
      const cell = el.querySelector(`[data-out="${l.k}"]`);
      if (cell) cell.textContent = m(l.v);
    }
  });

  async function save() {
    if (INCENTIVE_FIELDS.some((f) => isBadNumber(parseAmount, text(f.key))))
      return toast('Check the numbers: one is not a valid amount.', 'error');
    let reason = '';
    if (state.d.closed) {
      reason = await askReason({
        title: 'Revise a closed month',
        hint: 'The earlier figures stay in the record.',
        confirm: 'Save revision',
      });
      if (reason === null) return;
    }
    state.key ??= newKey();
    const { data, error } = await api.incentiveSave(state.month, inputs(), reason, state.key);
    if (error) return toast(error.message || 'Could not save the month.', 'error');
    toast(data.changed ? 'Saved' : 'Nothing changed');
    state.edits = {};
    state.key = null;
    load();
  }

  function printStatement() {
    const o = calc();
    const dlg = openDialog(
      html`<div class="payslip">
          <header class="payslip-head">
            <strong>${BRAND.title}</strong><span>${BRAND.branch}</span>
            <h2>Incentive statement · ${monthLabel(state.month)}</h2>
          </header>
          <table class="table">
            <tbody>
              ${INCENTIVE_FIELDS.map(
                (f) =>
                  html`<tr>
                    <td>${f.label}</td>
                    <td class="num">${m(typedNumber(parseAmount, text(f.key)))}</td>
                  </tr>`,
              )}
            </tbody>
          </table>
          <table class="table">
            <tbody>
              ${lines(o).map(
                (l) =>
                  html`<tr class="${l.strong ? 'payslip-net' : ''}">
                    <td>${l.strong ? html`<strong>${l.label}</strong>` : l.label}</td>
                    <td class="num">${l.strong ? html`<strong>${m(l.v)}</strong>` : m(l.v)}</td>
                  </tr>`,
              )}
            </tbody>
          </table>
          ${isDirty() ? html`<p class="small muted">Includes figures that are not saved yet.</p>` : ''}
        </div>
        <div class="actions">
          <button type="button" class="btn btn-ghost" data-close>Close</button
          ><button type="button" class="btn btn-primary" data-print>Print or save as PDF</button>
        </div>`,
      { label: 'Incentive statement' },
    );
    dlg.classList.add('payslip-dlg');
    dlg.addEventListener('click', (e) => {
      if (!e.target.closest('[data-print]')) return;
      document.body.classList.add('printing-payslip');
      window.addEventListener('afterprint', () => document.body.classList.remove('printing-payslip'), { once: true });
      window.print();
    });
  }

  el.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-act]');
    if (!t) return;
    const act = t.dataset.act;
    if (act === 'prev' || act === 'next') {
      if (
        isDirty() &&
        !(await confirmDialog({ title: 'Leave without saving?', body: 'You have changes that are not saved.', confirm: 'Leave' }))
      )
        return;
      state.month = shiftMonth(state.month, act === 'prev' ? -1 : 1);
      state.edits = {};
      return load();
    }
    if (act === 'save') return save();
    if (act === 'print') return printStatement();
    if (act === 'rate') {
      const r = RATES.find((x) => x.key === t.dataset.rate);
      return openRateDialog({ rateKey: r.key, label: r.label.toLowerCase(), current: state.d[r.field], onSaved: load });
    }
    if (act === 'close') {
      if (isDirty()) return toast('Save your changes first, then close the month.', 'error');
      const ok = await confirmDialog({
        title: `Close ${monthLabel(state.month)}?`,
        body: 'The saved figures are fixed from now on. Any change is a revision that needs a reason.',
        confirm: 'Close month',
      });
      if (!ok) return;
      const { error } = await api.sheetClose(state.month, 'incentive', newKey());
      if (error) return toast(error.message || 'Could not close the month.', 'error');
      toast('Month closed');
      load();
    }
  });

  render(el, loadingCard());
  await load();
}
