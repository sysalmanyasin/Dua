// Credit Inbox: credit that staff recorded in Closing, filed BY HAND into Staff Credit or a ledger (or dismissed, with a reason).
// The amount and the date are locked to what Closing recorded; only the description can be edited. Nothing moves by itself:
// if Closing changes a line after it was filed, the line only shows "changed after filing" and the owner decides (Reopen).
import { html, render } from '../../../shared/html.js';
import { hero } from '../../../shared/ui.js';
import { money, monthLabel, shortDate } from '../../../shared/format.js';
import * as api from '../data/api.js';
import { monthStart } from '../domain/credit.js';
import { SHIFTS, directionWord } from '../domain/ledger.js';
import {
  INBOX_TABS,
  allowedTargets,
  changeNote,
  filingSummary,
  kindLabel,
  linesFor,
  slotLabel,
  validateFiling,
  waitingCount,
} from '../domain/inbox.js';
import { askReason, errorCard, loadingCard, newKey, openDialog, toast } from './parts.js';

const m = (v) => money(v, { decimals: Math.round(Number(v) * 100) % 100 !== 0 });

export async function mount(el, { ctx }) {
  const perms = new Set(ctx.permissions);
  const can = allowedTargets(perms);
  const state = { tab: 'unfiled', lines: null, error: false };

  async function load() {
    try {
      state.lines = await api.inboxLines();
      state.error = false;
    } catch {
      state.error = true;
    }
    paint();
  }
  const afterChange = async (message) => {
    toast(message);
    await load();
  };

  function lineCard(l) {
    const note = changeNote(l);
    return html`<section class="card mg-inbox-line">
      <div class="mg-entry-top">
        <span>${shortDate(l.business_date)} · ${slotLabel(l.slot_kind, l.slot_seq)}</span>
        <strong>${m(l.amount)}</strong>
      </div>
      <div class="small">
        <span class="chip">${kindLabel(l.kind)}</span>
        ${l.label ? html` ${l.label}` : ''} ${l.removed ? html` <span class="chip chip-warn">Removed in Closing</span>` : ''}
        ${l.changed_after_first && !l.removed ? html` <span class="chip">Corrected in Closing</span>` : ''}
      </div>
      ${l.state === 'filed' ? html`<div class="small">Filed to ${l.target_label} · ${shortDate(l.filed_at.slice(0, 10))}</div>` : ''}
      ${l.state === 'dismissed' ? html`<div class="small muted">Dismissed: ${l.reason}</div>` : ''}
      ${l.state === 'unfiled' && l.entry_reversed ? html`<div class="small muted">The entry filed earlier was reversed. File it again or dismiss it.</div>` : ''}
      ${note ? html`<div class="small mg-changed" role="status"><span class="chip chip-warn">Changed after filing</span> ${note}</div>` : ''}
      <div class="mg-entry-bottom">
        <span></span>
        <span>
          ${
            l.state === 'unfiled'
              ? html`${can.credit || can.ledger ? html`<button type="button" class="btn btn-primary btn-sm" data-act="file" data-id="${l.line_id}" ${l.removed ? 'disabled' : ''}>File</button>` : ''}
                  <button type="button" class="btn btn-ghost btn-sm" data-act="dismiss" data-id="${l.line_id}">Dismiss</button>`
              : html`<button type="button" class="btn btn-ghost btn-sm" data-act="reopen" data-id="${l.line_id}">Reopen</button>`
          }
        </span>
      </div>
    </section>`;
  }

  function paint() {
    if (state.error) return render(el, errorCard('the credit inbox'));
    const waiting = state.lines ? waitingCount(state.lines) : 0;
    const head = hero({
      label: 'Manager',
      title: 'Credit Inbox',
      sub: state.lines ? (waiting ? `${waiting} to file` : 'Everything is filed') : '',
    });
    if (!state.lines) return render(el, html`${head}${loadingCard()}`);
    const shown = linesFor(state.lines, state.tab);
    render(
      el,
      html`${head}
        <div class="tabs-seg" role="tablist">
          ${INBOX_TABS.map(
            (t) =>
              html`<button type="button" role="tab" class="tab" aria-selected="${state.tab === t.id}" data-tab="${t.id}">
                ${t.label} (${linesFor(state.lines, t.id).length})
              </button>`,
          )}
        </div>
        ${
          shown.length
            ? shown.map(lineCard)
            : html`<div class="card">
                <p class="muted">
                  ${state.tab === 'unfiled' ? 'Nothing waiting. New credit from Closing will appear here.' : 'Nothing here yet.'}
                </p>
              </div>`
        }`,
    );
  }

  // ── File one line: pick the place, the amount and date stay as Closing recorded them ──
  async function fileDialog(line) {
    let people = [];
    let ledgers = [];
    try {
      if (can.credit) people = await api.creditMonth(monthStart(line.business_date));
      if (can.ledger) ledgers = await api.ledgersList();
    } catch {
      return toast('Could not load the people and ledgers. Try again.', 'error');
    }
    const form = {
      target: can.credit ? 'credit' : 'ledger',
      staffId: '',
      ledgerId: ledgers[0]?.ledger_id ?? '',
      categoryId: ledgers[0]?.categories[0]?.id ?? '',
      shift: SHIFTS[0],
      description: line.label ?? '',
    };
    let key = null;
    let errors = {};
    const ledgerOf = () => ledgers.find((l) => l.ledger_id === form.ledgerId);
    const dlg = openDialog(html`<div id="fd"></div>`, { label: 'File this line' });
    const body = () => dlg.querySelector('#fd');
    const paintDlg = () => {
      const ledger = ledgerOf();
      const category = ledger?.categories.find((c) => c.id === form.categoryId);
      const person = people.find((p) => p.staff_id === form.staffId);
      const summary = filingSummary(line, { target: form.target, person, ledger, category });
      render(
        body(),
        html`<h2>File this line</h2>
          <p class="small">
            <strong>${m(line.amount)}</strong> · ${shortDate(line.business_date)} · ${slotLabel(line.slot_kind, line.slot_seq)}<br />
            <span class="muted">The amount and the date stay exactly as Closing recorded them.</span>
          </p>
          ${errors.line ? html`<small class="err">${errors.line}</small>` : ''}
          ${
            can.credit && can.ledger
              ? html`<div class="tabs-seg" role="tablist">
                  <button type="button" role="tab" class="tab" aria-selected="${form.target === 'credit'}" data-target="credit">
                    Staff credit
                  </button>
                  <button type="button" role="tab" class="tab" aria-selected="${form.target === 'ledger'}" data-target="ledger">
                    A ledger
                  </button>
                </div>`
              : ''
          }
          ${
            form.target === 'credit'
              ? html`<label class="field ${errors.staff ? 'bad' : ''}"
                  ><span>Person (${monthLabel(monthStart(line.business_date))})</span>
                  <select data-f="staffId">
                    <option value="">Choose…</option>
                    ${people.map((p) => html`<option value="${p.staff_id}" ${form.staffId === p.staff_id ? 'selected' : ''}>${p.full_name}</option>`)}
                  </select>
                  ${errors.staff ? html`<small class="err">${errors.staff}</small>` : ''}</label
                >`
              : html`<label class="field ${errors.ledger ? 'bad' : ''}"
                    ><span>Ledger</span>
                    <select data-f="ledgerId">
                      ${ledgers.map((l) => html`<option value="${l.ledger_id}" ${form.ledgerId === l.ledger_id ? 'selected' : ''}>${l.name}</option>`)}
                    </select></label
                  >
                  <label class="field ${errors.category ? 'bad' : ''}"
                    ><span>Category</span>
                    <select data-f="categoryId">
                      ${(ledger?.categories ?? []).map((c) => html`<option value="${c.id}" ${form.categoryId === c.id ? 'selected' : ''}>${c.name} (${directionWord(c.direction)})</option>`)}
                    </select>
                    ${errors.category ? html`<small class="err">${errors.category}</small>` : ''}</label
                  >
                  ${
                    ledger?.has_shift
                      ? html`<label class="field ${errors.shift ? 'bad' : ''}"
                          ><span>Shift</span>
                          <select data-f="shift">
                            ${SHIFTS.map((s) => html`<option value="${s}" ${form.shift === s ? 'selected' : ''}>${s}</option>`)}
                          </select></label
                        >`
                      : ''
                  }`
          }
          <label class="field"
            ><span>Description</span><input data-f="description" value="${form.description}" maxlength="200" autocomplete="off"
          /></label>
          ${summary ? html`<p class="small muted">It will be filed as: ${summary}</p>` : ''}
          <div class="actions">
            <button type="button" class="btn btn-ghost" data-close>Cancel</button
            ><button type="button" class="btn btn-primary" data-ok>File it</button>
          </div>`,
      );
    };
    paintDlg();
    dlg.addEventListener('input', (e) => {
      const f = e.target.dataset?.f;
      if (!f) return;
      form[f] = e.target.value;
      key = null; // an edited form is a new filing, so it needs a new idempotency key
      if (f === 'ledgerId') {
        form.categoryId = ledgerOf()?.categories[0]?.id ?? '';
        paintDlg();
      }
    });
    dlg.addEventListener('click', async (e) => {
      const tg = e.target.closest('[data-target]');
      if (tg) {
        form.target = tg.dataset.target;
        errors = {};
        key = null;
        return paintDlg();
      }
      if (!e.target.closest('[data-ok]')) return;
      errors = validateFiling(line, form, { ledgers, people });
      if (Object.keys(errors).length) return paintDlg();
      key ??= newKey();
      const { error } = await api.inboxFile(
        line.line_id,
        form.target,
        {
          staffId: form.target === 'credit' ? form.staffId : null,
          ledgerId: form.target === 'ledger' ? form.ledgerId : null,
          categoryId: form.target === 'ledger' ? form.categoryId : null,
          shift: form.target === 'ledger' && ledgerOf()?.has_shift ? form.shift : null,
          description: form.description.trim() || null,
        },
        key,
      );
      if (error) {
        toast(error.message || 'Could not file this line.', 'error');
        return;
      }
      dlg.close();
      afterChange('Line filed');
    });
  }

  el.addEventListener('click', async (e) => {
    const tab = e.target.closest('[data-tab]');
    if (tab) {
      state.tab = tab.dataset.tab;
      return paint();
    }
    const t = e.target.closest('[data-act]');
    if (!t) return;
    const line = state.lines?.find((l) => l.line_id === t.dataset.id);
    if (!line) return;
    if (t.dataset.act === 'file') return fileDialog(line);
    if (t.dataset.act === 'dismiss') {
      const reason = await askReason({
        title: 'Dismiss this line?',
        hint: 'No entry is made anywhere. The line moves to Dismissed and you can reopen it later.',
        confirm: 'Dismiss',
      });
      if (reason === null) return;
      const { error } = await api.inboxDismiss(line.line_id, reason, newKey());
      if (error) return toast(error.message || 'Could not dismiss the line.', 'error');
      return afterChange('Line dismissed');
    }
    if (t.dataset.act === 'reopen') {
      const reason = await askReason({
        title: 'Reopen this line?',
        hint:
          line.state === 'filed'
            ? 'The entry made for it is reversed (both lines stay visible) and the line goes back to Unfiled.'
            : 'The line goes back to Unfiled.',
        confirm: 'Reopen',
      });
      if (reason === null) return;
      const { error } = await api.inboxReopen(line.line_id, reason, newKey());
      if (error) return toast(error.message || 'Could not reopen the line.', 'error');
      return afterChange('Line reopened');
    }
  });

  render(el, loadingCard());
  await load();
}
