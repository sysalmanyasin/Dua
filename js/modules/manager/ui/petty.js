// Petty Detail: the month's petty cash vouchers. Each voucher has a title and lines (description + amount); totals only, no balance.
// Saving adds a revision of each changed voucher; removing a voucher keeps it in the record; a closed month needs a reason.
// "Copy from last month" clones the previous month's vouchers with their amounts.
import { html, render } from '../../../shared/html.js';
import { hero } from '../../../shared/ui.js';
import { money, monthLabel, todayPkt } from '../../../shared/format.js';
import { BRAND } from '../../../core/config.js';
import * as api from '../data/api.js';
import { monthStart, shiftMonth } from '../domain/credit.js';
import { blankLine, groupTotal, monthTotal, newGroup, toPayload, validateGroups } from '../domain/petty.js';
import { askReason, confirmDialog, errorCard, loadingCard, monthButtons, newKey, openDialog, toast } from './parts.js';

const m = (v) => money(v, { decimals: Math.round(Number(v) * 100) % 100 !== 0 });
const asText = (n) => (Number(n) ? String(n) : '');

export async function mount(el, { ctx }) {
  const perms = new Set(ctx.permissions);
  const canEdit = perms.has('mgmt.petty_cash');
  const canClose = perms.has('mgmt.close_month');
  const thisMonth = monthStart(todayPkt());
  const state = { month: thisMonth, groups: null, snapshot: '', closed: false, removed: [], key: null, error: false };

  const snap = () => JSON.stringify([state.groups, state.removed]);
  const isDirty = () => state.groups !== null && snap() !== state.snapshot;

  async function load() {
    state.groups = null;
    paint();
    try {
      const rows = await api.pettyMonth(state.month);
      state.groups = rows.map((r) => ({
        group_key: r.group_key,
        title: r.title,
        lines: r.lines.map((l) => ({ description: l.description, amount: asText(l.amount) })),
      }));
      state.closed = rows[0]?.closed ?? false;
      state.removed = [];
      state.snapshot = snap();
      state.error = false;
    } catch {
      state.error = true;
    }
    paint();
  }

  function groupCard(g, gi) {
    return html`<section class="card mg-credit">
      <div class="fields">
        <label class="field"
          ><span>Voucher title</span>
          <input data-t="${gi}" value="${g.title}" maxlength="60" placeholder="e.g. 1–10 November" ${canEdit ? '' : 'disabled'}
        /></label>
      </div>
      ${g.lines.map(
        (l, li) =>
          html`<div class="mg-line">
            <input data-d="${gi}:${li}" value="${l.description}" maxlength="120" placeholder="Description" ${canEdit ? '' : 'disabled'} />
            <input data-a="${gi}:${li}" value="${l.amount}" inputmode="decimal" placeholder="Amount" ${canEdit ? '' : 'disabled'} />
            ${canEdit ? html`<button type="button" class="btn btn-ghost btn-sm" data-act="delline" data-g="${gi}" data-l="${li}" aria-label="Remove line">×</button>` : ''}
          </div>`,
      )}
      <p class="small">
        <strong>Total <span data-gtotal="${gi}">${m(groupTotal(g))}</span></strong>
      </p>
      <div class="actions">
        ${canEdit ? html`<button type="button" class="btn btn-ghost btn-sm" data-act="addline" data-g="${gi}">+ Add line</button>` : ''}
        <button type="button" class="btn btn-ghost btn-sm" data-act="print" data-g="${gi}">Print</button>
        ${canEdit ? html`<button type="button" class="btn btn-ghost btn-sm" data-act="delgroup" data-g="${gi}">Remove voucher</button>` : ''}
      </div>
    </section>`;
  }

  function paint() {
    if (state.error) return render(el, errorCard('petty cash'));
    const head = hero({
      label: 'Manager',
      title: 'Petty Cash',
      sub: monthLabel(state.month),
      actions: monthButtons(state.month, thisMonth),
    });
    if (!state.groups) return render(el, html`${head}${loadingCard()}`);
    const prev = shiftMonth(state.month, -1);
    render(
      el,
      html`${head}
        ${state.closed ? html`<div class="card"><p class="small">This month is closed. Changes are saved as revisions and need a reason.</p></div>` : ''}
        ${
          state.groups.length
            ? state.groups.map(groupCard)
            : html`<div class="card">
                <p class="muted">No vouchers this month.</p>
                ${canEdit ? html`<p><button type="button" class="link" data-act="copy">Copy last month’s vouchers (${monthLabel(prev)})</button></p>` : ''}
              </div>`
        }
        ${
          state.groups.length
            ? html`<div class="card total-card">
                <div><span class="label">TOTAL PETTY CASH</span><strong data-mtotal>${m(monthTotal(state.groups))}</strong></div>
              </div>`
            : ''
        }
        <div class="actions">
          ${canEdit ? html`<button type="button" class="btn btn-ghost" data-act="addgroup">+ Add voucher</button><button type="button" class="btn btn-primary" data-act="save">${state.closed ? 'Save a revision' : 'Save month'}</button>` : ''}
          ${canClose && state.groups.length && !state.closed && !isDirty() ? html`<button type="button" class="btn btn-ghost" data-act="close">Close month</button>` : ''}
        </div>`,
    );
  }

  const refreshTotals = () => {
    state.groups.forEach((g, i) => {
      const c = el.querySelector(`[data-gtotal="${i}"]`);
      if (c) c.textContent = m(groupTotal(g));
    });
    const t = el.querySelector('[data-mtotal]');
    if (t) t.textContent = m(monthTotal(state.groups));
  };

  el.addEventListener('input', (e) => {
    const t = e.target;
    state.key = null; // an edited month is a new save, so it needs a new idempotency key
    if (t.dataset.t !== undefined) state.groups[Number(t.dataset.t)].title = t.value;
    if (t.dataset.d !== undefined) {
      const [g, l] = t.dataset.d.split(':').map(Number);
      state.groups[g].lines[l].description = t.value;
    }
    if (t.dataset.a !== undefined) {
      const [g, l] = t.dataset.a.split(':').map(Number);
      state.groups[g].lines[l].amount = t.value;
      refreshTotals();
    }
  });

  async function save() {
    const bad = validateGroups(state.groups);
    if (bad) return toast(bad, 'error');
    let reason = '';
    if (state.closed) {
      reason = await askReason({
        title: 'Revise a closed month',
        hint: 'The earlier figures stay in the record.',
        confirm: 'Save revision',
      });
      if (reason === null) return;
    }
    state.key ??= newKey();
    const { data, error } = await api.pettySave(state.month, toPayload(state.groups, state.removed), reason, state.key);
    if (error) return toast(error.message || 'Could not save the month.', 'error');
    toast(data.changed ? `Saved (${data.changed} changed)` : 'Nothing changed');
    state.key = null;
    load();
  }

  function printVoucher(g) {
    const dlg = openDialog(
      html`<div class="payslip">
          <header class="payslip-head">
            <strong>${BRAND.title}</strong><span>${BRAND.branch}</span>
            <h2>Petty cash · ${g.title || 'Voucher'}</h2>
            <span>${monthLabel(state.month)}</span>
          </header>
          <table class="table">
            <tbody>
              ${g.lines
                .filter((l) => l.description.trim() !== '')
                .map(
                  (l) =>
                    html`<tr>
                      <td>${l.description}</td>
                      <td class="num">${m(Number(String(l.amount).replace(/,/g, '')) || 0)}</td>
                    </tr>`,
                )}
              <tr class="payslip-net">
                <td><strong>Total</strong></td>
                <td class="num"><strong>${m(groupTotal(g))}</strong></td>
              </tr>
            </tbody>
          </table>
          <div class="payslip-sign"><span>Prepared by</span><span>Approved by</span></div>
        </div>
        <div class="actions">
          <button type="button" class="btn btn-ghost" data-close>Close</button
          ><button type="button" class="btn btn-primary" data-print>Print or save as PDF</button>
        </div>`,
      { label: 'Petty cash voucher' },
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
    const gi = Number(t.dataset.g);
    if (act === 'prev' || act === 'next') {
      if (
        isDirty() &&
        !(await confirmDialog({ title: 'Leave without saving?', body: 'You have changes that are not saved.', confirm: 'Leave' }))
      )
        return;
      state.month = shiftMonth(state.month, act === 'prev' ? -1 : 1);
      return load();
    }
    if (act === 'addgroup') {
      state.groups.push(newGroup(crypto.randomUUID()));
      state.key = null;
      return paint();
    }
    if (act === 'addline') {
      state.groups[gi].lines.push(blankLine());
      return paint();
    }
    if (act === 'delline') {
      const g = state.groups[gi];
      g.lines.splice(Number(t.dataset.l), 1);
      if (g.lines.length === 0) g.lines.push(blankLine());
      state.key = null;
      return paint();
    }
    if (act === 'delgroup') {
      const g = state.groups[gi];
      if (
        !g.isNew &&
        !(await confirmDialog({ title: `Remove “${g.title}”?`, body: 'It leaves this month but stays in the record.', confirm: 'Remove' }))
      )
        return;
      if (!g.isNew) state.removed.push(g.group_key);
      state.groups.splice(gi, 1);
      state.key = null;
      return paint();
    }
    if (act === 'print') return printVoucher(state.groups[gi]);
    if (act === 'save') return save();
    if (act === 'copy') {
      const prev = shiftMonth(state.month, -1);
      const { data, error } = await api.pettyCopy(prev, state.month, newKey());
      if (error) return toast(error.message || 'Could not copy.', 'error');
      toast(`Copied ${data.groups} voucher${data.groups === 1 ? '' : 's'}. Check the amounts, then save.`);
      return load();
    }
    if (act === 'close') {
      const ok = await confirmDialog({
        title: `Close ${monthLabel(state.month)}?`,
        body: 'After closing, any change is a revision that needs a reason.',
        confirm: 'Close month',
      });
      if (!ok) return;
      const { error } = await api.sheetClose(state.month, 'petty', newKey());
      if (error) return toast(error.message || 'Could not close the month.', 'error');
      toast('Month closed');
      load();
    }
  });

  render(el, loadingCard());
  await load();
}
