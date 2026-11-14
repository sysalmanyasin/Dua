// Generic Sheet: each person's generic sale for the month and the incentive on it. The rate comes from the rates table and each
// month keeps the rate it started with. Saving adds a new revision (and only when something changed). A closed month needs a reason.
import { html, render } from '../../../shared/html.js';
import { hero } from '../../../shared/ui.js';
import { money, monthLabel, parseAmount, todayPkt } from '../../../shared/format.js';
import * as api from '../data/api.js';
import { monthStart, shiftMonth } from '../domain/credit.js';
import { genericRow, percent, rateFromPercent } from '../domain/salary.js';
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

const m = (v) => money(v, { decimals: Math.round(Number(v) * 100) % 100 !== 0 });

export async function mount(el, { ctx }) {
  const perms = new Set(ctx.permissions);
  const canEdit = perms.has('mgmt.salary');
  const canClose = perms.has('mgmt.close_month');
  const canRates = perms.has('mgmt.rates');
  const thisMonth = monthStart(todayPkt());
  const state = { month: thisMonth, rows: null, rate: null, error: false, edits: {}, key: null };

  const orig = (p) => ({ sale: p.generic_sale ? String(p.generic_sale) : '', extra: p.extra ? String(p.extra) : '' });
  const cur = (p) => ({ ...orig(p), ...(state.edits[p.staff_id] ?? {}) });
  const calc = (p) => {
    const e = cur(p);
    return genericRow({ sale: typedNumber(parseAmount, e.sale), extra: typedNumber(parseAmount, e.extra), rate: state.rate });
  };
  const isDirty = () => state.rows?.some((p) => JSON.stringify(cur(p)) !== JSON.stringify(orig(p)));
  const closed = () => Boolean(state.rows?.[0]?.closed);
  const hasSheet = () => state.rows?.some((p) => p.has_row);

  async function load() {
    state.rows = null;
    paint();
    try {
      const [rows, rates] = await Promise.all([api.genericMonth(state.month), api.ratesList()]);
      state.rows = rows;
      state.rate = Number(rows[0]?.rate ?? rates.find((r) => r.rate_key === 'generic_staff')?.rate ?? 0);
      state.error = false;
    } catch {
      state.error = true;
    }
    paint();
  }

  function paint() {
    if (state.error) return render(el, errorCard('the generic sheet'));
    const head = hero({
      label: 'Manager',
      title: 'Generic Sheet',
      sub: monthLabel(state.month),
      actions: monthButtons(state.month, thisMonth),
    });
    if (!state.rows) return render(el, html`${head}${loadingCard()}`);
    const total = state.rows.reduce((s, p) => s + calc(p).final, 0);
    render(
      el,
      html`${head}
        <div class="card">
          <p class="small">
            Incentive rate this month:
            <strong>${percent(state.rate)}</strong>
            ${canRates ? html` · <button type="button" class="link" data-act="rate">Change rate</button>` : ''}
          </p>
          <p class="small muted">
            ${closed() ? 'This month is closed. Changes are saved as revisions and need a reason.' : 'A month keeps the rate it started with, even if the rate changes later.'}
          </p>
        </div>
        ${
          state.rows.length
            ? state.rows.map((p) => {
                const e = cur(p);
                const c = calc(p);
                return html`<section class="card mg-credit">
                  <div class="mg-head-static">
                    <span class="mg-name"
                      ><strong>${p.full_name}</strong
                      ><small class="muted">${p.staff_code || ''}${p.active ? '' : ' · inactive'}</small></span
                    >
                    <span class="mg-net"><small class="muted">Final</small><strong data-final="${p.staff_id}">${m(c.final)}</strong></span>
                  </div>
                  <div class="fields">
                    <label class="field"
                      ><span>Generic sale</span
                      ><input
                        data-g="sale"
                        data-id="${p.staff_id}"
                        value="${e.sale}"
                        inputmode="decimal"
                        placeholder="0"
                        ${canEdit ? '' : 'disabled'}
                    /></label>
                    <label class="field"
                      ><span>Extra</span
                      ><input
                        data-g="extra"
                        data-id="${p.staff_id}"
                        value="${e.extra}"
                        inputmode="decimal"
                        placeholder="0"
                        ${canEdit ? '' : 'disabled'}
                    /></label>
                  </div>
                  <p class="small muted">Incentive at ${percent(state.rate)}: <span data-inc="${p.staff_id}">${m(c.incentive)}</span></p>
                </section>`;
              })
            : html`<div class="card"><p class="muted">Nobody to show.</p></div>`
        }
        ${
          state.rows.length
            ? html`<div class="card total-card">
                <div><span class="label">TOTAL FINAL</span><strong data-total>${m(total)}</strong></div>
              </div>`
            : ''
        }
        <div class="actions">
          ${canEdit ? html`<button type="button" class="btn btn-primary" data-act="save">${closed() ? 'Save a revision' : 'Save sheet'}</button>` : ''}
          ${canClose && hasSheet() && !closed() ? html`<button type="button" class="btn btn-ghost" data-act="close">Close month</button>` : ''}
        </div>`,
    );
  }

  el.addEventListener('input', (e) => {
    const t = e.target;
    if (!t.dataset.g) return;
    (state.edits[t.dataset.id] ??= {})[t.dataset.g] = t.value;
    state.key = null; // an edited sheet is a new save, so it needs a new idempotency key
    const p = state.rows.find((r) => r.staff_id === t.dataset.id);
    const c = calc(p);
    el.querySelector(`[data-final="${p.staff_id}"]`).textContent = m(c.final);
    el.querySelector(`[data-inc="${p.staff_id}"]`).textContent = m(c.incentive);
    el.querySelector('[data-total]').textContent = m(state.rows.reduce((s, r) => s + calc(r).final, 0));
  });

  async function save() {
    const bad = state.rows.filter((p) => isBadNumber(parseAmount, cur(p).sale) || isBadNumber(parseAmount, cur(p).extra));
    if (bad.length) return toast(`Check the numbers for ${bad[0].full_name}.`, 'error');
    let reason = '';
    if (closed()) {
      reason = await askReason({
        title: 'Revise a closed month',
        hint: 'The earlier figures stay in the record.',
        confirm: 'Save revision',
      });
      if (reason === null) return;
    }
    state.key ??= newKey();
    const rows = state.rows.map((p) => ({
      staff_id: p.staff_id,
      generic_sale: typedNumber(parseAmount, cur(p).sale),
      extra: typedNumber(parseAmount, cur(p).extra),
    }));
    const { data, error } = await api.genericSave(state.month, rows, reason, state.key);
    if (error) return toast(error.message || 'Could not save the sheet.', 'error');
    toast(data.changed ? `Saved (${data.changed} changed)` : 'Nothing changed');
    state.edits = {};
    state.key = null;
    load();
  }

  async function changeRate() {
    const dlg = openDialog(
      html`<h2>Change the generic rate</h2>
        <p class="muted small">
          Applies to months that have not started saving yet. A month already started keeps its own rate. The change is logged with your
          reason.
        </p>
        <label class="field"
          ><span>New rate (%)</span><input id="r-pct" inputmode="decimal" value="${Number((state.rate * 100).toFixed(3))}"
        /></label>
        <label class="field"><span>Reason</span><input id="r-reason" maxlength="200" /></label>
        <small class="err" id="r-err" hidden></small>
        <div class="actions">
          <button type="button" class="btn btn-ghost" data-close>Cancel</button
          ><button type="button" class="btn btn-primary" data-ok>Save rate</button>
        </div>`,
      { label: 'Change the generic rate' },
    );
    dlg.addEventListener('click', async (e) => {
      if (!e.target.closest('[data-ok]')) return;
      const err = (t) => {
        const box = dlg.querySelector('#r-err');
        box.textContent = t;
        box.hidden = false;
      };
      const pct = Number(dlg.querySelector('#r-pct').value.replace(/[%\s]/g, ''));
      const reason = dlg.querySelector('#r-reason').value.trim();
      if (!Number.isFinite(pct) || pct < 0 || pct > 100 || dlg.querySelector('#r-pct').value.trim() === '')
        return err('Enter a percentage from 0 to 100.');
      if (reason.length < 3) return err('Please give a short reason.');
      const { error } = await api.rateSet('generic_staff', rateFromPercent(pct), reason, newKey());
      if (error) return err(error.message || 'Could not save.');
      dlg.close();
      toast('Rate saved');
      load();
    });
  }

  el.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-act]');
    if (!t) return;
    if (t.dataset.act === 'prev' || t.dataset.act === 'next') {
      if (
        isDirty() &&
        !(await confirmDialog({ title: 'Leave without saving?', body: 'You have changes that are not saved.', confirm: 'Leave' }))
      )
        return;
      state.month = shiftMonth(state.month, t.dataset.act === 'prev' ? -1 : 1);
      state.edits = {};
      return load();
    }
    if (t.dataset.act === 'save') return save();
    if (t.dataset.act === 'rate') return changeRate();
    if (t.dataset.act === 'close') {
      if (isDirty()) return toast('Save your changes first, then close the month.', 'error');
      const ok = await confirmDialog({
        title: `Close ${monthLabel(state.month)}?`,
        body: 'After closing, any change is a revision that needs a reason. Close the Generic sheet before the Salary sheet.',
        confirm: 'Close month',
      });
      if (!ok) return;
      const { error } = await api.sheetClose(state.month, 'generic', newKey());
      if (error) return toast(error.message || 'Could not close the month.', 'error');
      toast('Month closed');
      load();
    }
  });

  render(el, loadingCard());
  await load();
}
