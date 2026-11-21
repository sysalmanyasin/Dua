// Salary sheet: Net = HO salary - advance + generic + custom columns, in whole rupees. The advance comes from that month's
// Staff Credit entries and the generic from the Generic sheet; both are read-only here (MGR-16). Saving adds a revision, and
// only when something changed. A closed month needs a reason and shows the figures saved when it was closed.
import { html, render } from '../../../shared/html.js';
import { hero } from '../../../shared/ui.js';
import { money, monthLabel, parseAmount, shortDate, todayPkt } from '../../../shared/format.js';
import * as api from '../data/api.js';
import { monthStart, shiftMonth } from '../domain/credit.js';
import { salaryFlags, salaryNet } from '../domain/salary.js';
import { openPayslip } from './payslip.js';
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
const asText = (v) => (Number(v) ? String(v) : '');

export async function mount(el, { ctx }) {
  const perms = new Set(ctx.permissions);
  const canEdit = perms.has('mgmt.salary');
  const canClose = perms.has('mgmt.close_month');
  const canSeeCredit = perms.has('credit.view') || perms.has('mgmt.credit_manage');
  const thisMonth = monthStart(todayPkt());
  const state = { month: thisMonth, rows: null, cols: [], error: false, edits: {}, key: null, openId: null };

  const orig = (p) => ({
    ho: asText(p.ho_salary),
    days: String(p.days),
    x: Object.fromEntries(state.cols.map((c) => [c.column_id, asText(p.extras?.[c.column_id])])),
  });
  const cur = (p) => {
    const o = orig(p);
    const e = state.edits[p.staff_id] ?? {};
    return { ho: e.ho ?? o.ho, days: e.days ?? o.days, x: { ...o.x, ...(e.x ?? {}) } };
  };
  const extrasOf = (p) => state.cols.map((c) => ({ sign: c.sign, amount: typedNumber(parseAmount, cur(p).x[c.column_id]) }));
  const netOf = (p) => salaryNet({ ho: typedNumber(parseAmount, cur(p).ho), advance: p.advance, generic: p.generic, extras: extrasOf(p) });
  const isDirty = () => state.rows?.some((p) => JSON.stringify(cur(p)) !== JSON.stringify(orig(p)));
  const closed = () => Boolean(state.rows?.[0]?.closed);
  const hasSheet = () => state.rows?.some((p) => p.has_row);

  async function load() {
    state.rows = null;
    paint();
    try {
      [state.rows, state.cols] = await Promise.all([api.salaryMonth(state.month), api.salaryColumns(state.month)]);
      state.error = false;
    } catch {
      state.error = true;
    }
    paint();
  }

  // One numbered row per person (plus a note row for the advance details and any warnings).
  function personRow(p, i) {
    const e = cur(p);
    const f = salaryFlags(p);
    const open = state.openId === p.staff_id;
    const span = 9 + state.cols.length;
    const notes = [
      f.advanceChanged ? `Staff Credit changed since closing: advance would now be ${m(p.advance_live)}` : '',
      f.genericChanged ? `Generic changed since closing: it would now be ${m(p.generic_live)}` : '',
      f.creditDiffers ? `Staff Credit deducts ${m(p.credit_deduction)} as salary; the advance is ${m(p.advance)}` : '',
    ].filter(Boolean);
    return html`<tr data-row="${p.staff_id}">
        <td class="idx">${i + 1}</td>
        <td class="name">
          <span class="chip">${p.staff_code || '—'}</span
          ><strong>${p.full_name}</strong>${p.active ? '' : html` <small class="muted">inactive</small>`}
        </td>
        <td>${p.designation || ''}</td>
        <td>
          <input
            class="mg-days"
            data-s="days"
            data-id="${p.staff_id}"
            value="${e.days}"
            inputmode="numeric"
            aria-label="Days, ${p.full_name}"
            ${canEdit ? '' : 'disabled'}
          />
        </td>
        <td>
          <input
            data-s="ho"
            data-id="${p.staff_id}"
            value="${e.ho}"
            inputmode="decimal"
            placeholder="0"
            aria-label="HO salary, ${p.full_name}"
            ${canEdit ? '' : 'disabled'}
          />
          ${p.ho_carried && !state.edits[p.staff_id] ? html`<span class="mg-cell-sub">(carried)</span>` : ''}
        </td>
        <td class="num">
          <button
            type="button"
            class="link"
            data-act="detail"
            data-id="${p.staff_id}"
            aria-expanded="${open}"
            title="${open ? 'Hide' : 'Show'} the credit entries"
          >
            ${m(p.advance)}
          </button>
        </td>
        <td class="num">${m(p.generic)}</td>
        ${state.cols.map(
          (c) =>
            html`<td>
              <input
                data-x="${c.column_id}"
                data-id="${p.staff_id}"
                value="${e.x[c.column_id] ?? ''}"
                inputmode="decimal"
                placeholder="0"
                aria-label="${c.name}, ${p.full_name}"
                ${canEdit ? '' : 'disabled'}
              />
            </td>`,
        )}
        <td class="num"><strong data-net="${p.staff_id}">${m(netOf(p))}</strong></td>
        <td><button type="button" class="btn btn-ghost btn-sm" data-act="payslip" data-id="${p.staff_id}">Payslip</button></td>
      </tr>
      ${
        open || notes.length
          ? html`<tr class="mg-note">
              <td></td>
              <td colspan="${span - 1}">
                ${open ? (p.entries.length ? p.entries.map((x) => html`<div>${shortDate(x.entry_date)} · ${x.description || '—'} · ${m(x.amount)}</div>`) : html`<div class="muted">No credit entries this month.</div>`) : ''}
                ${notes.map((n) => html`<div><span class="chip chip-warn">${n}</span></div>`)}
              </td>
            </tr>`
          : ''
      }`;
  }

  function salaryTable() {
    const sum = (fn) => state.rows.reduce((t, p) => t + fn(p), 0);
    return html`<div class="mg-grid-wrap">
      <table class="mg-grid">
        <thead>
          <tr>
            <th class="idx">#</th>
            <th class="name">Name</th>
            <th>Designation</th>
            <th>Days</th>
            <th class="num">HO salary</th>
            <th class="num">Advance (−)</th>
            <th class="num">Generic (+)</th>
            ${state.cols.map((c) => html`<th class="num">${c.name} (${c.sign > 0 ? '+' : '−'})</th>`)}
            <th class="num">Net salary</th>
            <th>Slip</th>
          </tr>
        </thead>
        <tbody>
          ${state.rows.map(personRow)}
        </tbody>
        <tfoot>
          <tr>
            <td></td>
            <td class="name">TOTALS</td>
            <td></td>
            <td></td>
            <td class="num" data-tot="ho">${m(sum((p) => typedNumber(parseAmount, cur(p).ho)))}</td>
            <td class="num">${m(sum((p) => p.advance))}</td>
            <td class="num">${m(sum((p) => p.generic))}</td>
            ${state.cols.map((c) => html`<td class="num" data-tot="x:${c.column_id}">${m(sum((p) => typedNumber(parseAmount, cur(p).x[c.column_id])))}</td>`)}
            <td class="num" data-total>${m(sum(netOf))}</td>
            <td></td>
          </tr>
        </tfoot>
      </table>
    </div>`;
  }

  // Live totals while typing (the net column and the footer).
  function refreshTotals() {
    const sum = (fn) => state.rows.reduce((t, p) => t + fn(p), 0);
    const set = (sel, v) => {
      const node = el.querySelector(sel);
      if (node) node.textContent = m(v);
    };
    for (const p of state.rows) set(`[data-net="${p.staff_id}"]`, netOf(p));
    set(
      '[data-tot="ho"]',
      sum((p) => typedNumber(parseAmount, cur(p).ho)),
    );
    for (const c of state.cols)
      set(
        `[data-tot="x:${c.column_id}"]`,
        sum((p) => typedNumber(parseAmount, cur(p).x[c.column_id])),
      );
    set('[data-total]', sum(netOf));
  }

  function paint() {
    if (state.error) return render(el, errorCard('the salary sheet'));
    const head = hero({ label: 'Manager', title: 'Salary', sub: monthLabel(state.month), actions: monthButtons(state.month, thisMonth) });
    if (!state.rows) return render(el, html`${head}${loadingCard()}`);
    render(
      el,
      html`${head}
        ${closed() ? html`<div class="card"><p class="small">This month is closed. It shows the figures saved at closing; changes are saved as revisions and need a reason.</p></div>` : ''}
        <div class="card">
          <p class="small">
            <strong>Extra columns:</strong>
            ${state.cols.length ? state.cols.map((c) => html`${c.name} (${c.sign > 0 ? '+' : '−'})${canEdit ? html` <button type="button" class="link" data-act="retire" data-col="${c.column_id}">stop</button>` : ''}; `) : 'none yet'}
            ${canEdit ? html` <button type="button" class="link" data-act="addcol">+ Add column</button>` : ''}
          </p>
        </div>
        ${state.rows.length ? salaryTable() : html`<div class="card"><p class="muted">Nobody to show.</p></div>`}
        <div class="actions">
          ${canEdit ? html`<button type="button" class="btn btn-primary" data-act="save">${closed() ? 'Save a revision' : 'Save sheet'}</button>` : ''}
          ${canClose && hasSheet() && !closed() ? html`<button type="button" class="btn btn-ghost" data-act="close">Close month</button>` : ''}
        </div>`,
    );
  }

  el.addEventListener('input', (e) => {
    const t = e.target;
    if (!t.dataset.id || !(t.dataset.s || t.dataset.x)) return;
    const slot = (state.edits[t.dataset.id] ??= {});
    if (t.dataset.s) slot[t.dataset.s] = t.value;
    else (slot.x ??= {})[t.dataset.x] = t.value;
    state.key = null; // an edited sheet is a new save, so it needs a new idempotency key
    refreshTotals();
  });

  async function save() {
    for (const p of state.rows) {
      const e = cur(p);
      const days = String(e.days).trim();
      if (isBadNumber(parseAmount, e.ho) || state.cols.some((c) => isBadNumber(parseAmount, e.x[c.column_id])))
        return toast(`Check the numbers for ${p.full_name}.`, 'error');
      if (!/^\d{1,2}$/.test(days) || Number(days) > 31) return toast(`Days for ${p.full_name} must be 0 to 31.`, 'error');
    }
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
    const rows = state.rows.map((p) => {
      const e = cur(p);
      return {
        staff_id: p.staff_id,
        ho_salary: typedNumber(parseAmount, e.ho),
        days: Number(String(e.days).trim()),
        extras: Object.fromEntries(state.cols.map((c) => [c.column_id, typedNumber(parseAmount, e.x[c.column_id])])),
      };
    });
    const { data, error } = await api.salarySave(state.month, rows, reason, state.key);
    if (error) return toast(error.message || 'Could not save the sheet.', 'error');
    toast(data.changed ? `Saved (${data.changed} changed)` : 'Nothing changed');
    state.edits = {};
    state.key = null;
    load();
  }

  function addColumn() {
    const dlg = openDialog(
      html`<h2>Add a salary column</h2>
        <p class="muted small">
          It applies to ${monthLabel(state.month)} and every later month. Its name and direction can never be changed: stop it and add a new
          one instead.
        </p>
        <label class="field"><span>Name</span><input id="c-name" maxlength="40" placeholder="e.g. Bonus, Fine" /></label>
        <label class="field"
          ><span>Effect on net salary</span
          ><select id="c-sign">
            <option value="1">Adds (+)</option>
            <option value="-1">Subtracts (−)</option>
          </select></label
        >
        <small class="err" id="c-err" hidden></small>
        <div class="actions">
          <button type="button" class="btn btn-ghost" data-close>Cancel</button
          ><button type="button" class="btn btn-primary" data-ok>Add column</button>
        </div>`,
      { label: 'Add a salary column' },
    );
    dlg.addEventListener('click', async (e) => {
      if (!e.target.closest('[data-ok]')) return;
      const name = dlg.querySelector('#c-name').value.trim();
      const box = dlg.querySelector('#c-err');
      if (!name) {
        box.textContent = 'Give the column a name.';
        box.hidden = false;
        return;
      }
      const { error } = await api.salaryColumnAdd(name, Number(dlg.querySelector('#c-sign').value), state.month, newKey());
      if (error) {
        box.textContent = error.message || 'Could not add the column.';
        box.hidden = false;
        return;
      }
      dlg.close();
      toast('Column added');
      load();
    });
  }

  async function payslip(p) {
    let generic = null;
    let credit = null;
    try {
      generic = (await api.genericMonth(state.month)).find((g) => g.staff_id === p.staff_id) ?? null;
    } catch {
      generic = null;
    }
    if (canSeeCredit) {
      try {
        credit = (await api.creditMonth(state.month)).find((c) => c.staff_id === p.staff_id) ?? null;
      } catch {
        credit = null;
      }
    }
    const e = cur(p);
    openPayslip({
      month: state.month,
      person: { ...p, ho_salary_now: typedNumber(parseAmount, e.ho) },
      columns: state.cols,
      netValue: netOf(p),
      extrasAmounts: Object.fromEntries(state.cols.map((c) => [c.column_id, typedNumber(parseAmount, e.x[c.column_id])])),
      generic,
      credit,
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
      state.openId = null;
      return load();
    }
    if (act === 'detail') {
      state.openId = state.openId === t.dataset.id ? null : t.dataset.id;
      return paint();
    }
    if (act === 'save') return save();
    if (act === 'addcol') return addColumn();
    if (act === 'payslip') return payslip(state.rows.find((r) => r.staff_id === t.dataset.id));
    if (act === 'retire') {
      const col = state.cols.find((c) => c.column_id === t.dataset.col);
      const from = shiftMonth(state.month, 1);
      const ok = await confirmDialog({
        title: `Stop using "${col.name}"?`,
        body: `It will no longer appear from ${monthLabel(from)}. Earlier months keep it. It cannot be stopped while amounts remain in it from that month on.`,
        confirm: 'Stop using',
      });
      if (!ok) return;
      const { error } = await api.salaryColumnRetire(col.column_id, from, newKey());
      if (error) return toast(error.message || 'Could not stop the column.', 'error');
      toast('Column stopped');
      load();
    }
    if (act === 'close') {
      if (isDirty()) return toast('Save your changes first, then close the month.', 'error');
      const ok = await confirmDialog({
        title: `Close ${monthLabel(state.month)}?`,
        body: 'The saved figures are fixed from now on. Any change is a revision that needs a reason. Close the Generic sheet first.',
        confirm: 'Close month',
      });
      if (!ok) return;
      const { error } = await api.sheetClose(state.month, 'salary', newKey());
      if (error) return toast(error.message || 'Could not close the month.', 'error');
      toast('Month closed');
      load();
    }
  });

  render(el, loadingCard());
  await load();
}
