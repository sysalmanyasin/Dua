// Staff Registry: the list of everyone, and the staff card (Details · Credit · Payslip · Notes).
import { html, render } from '../../../shared/html.js';
import { hero } from '../../../shared/ui.js';
import { money, shortDate, todayPkt } from '../../../shared/format.js';
import * as api from '../data/api.js';
import { BLOOD_GROUPS, staffPayload, validateStaffForm } from '../domain/staff.js';
import { monthStart } from '../domain/credit.js';
import { askReason, errorCard, loadingCard, newKey, openDialog, toast } from './parts.js';

const blankForm = (canPrivate) => ({
  staff_id: null,
  full_name: '',
  phone: '',
  joined_on: '',
  active: true,
  designation: '',
  staff_code: '',
  sort_order: '',
  private: canPrivate ? { father_name: '', address: '', blood_group: '' } : null,
});

export async function mount(el, { ctx }) {
  const perms = new Set(ctx.permissions);
  const canEdit = perms.has('mgmt.staff_edit');
  const state = { list: null, error: false, showInactive: false };

  async function load() {
    try {
      state.list = await api.listStaff();
      state.error = false;
    } catch {
      state.error = true;
    }
    paint();
  }

  function paint() {
    if (state.error) return render(el, errorCard('the staff registry'));
    if (!state.list) return render(el, loadingCard());
    const shown = state.list.filter((p) => p.active || state.showInactive);
    const inactive = state.list.length - state.list.filter((p) => p.active).length;
    render(
      el,
      html`${hero({
        label: 'Manager',
        title: 'Staff Registry',
        sub: `${state.list.length - inactive} on the payroll list${inactive ? ` · ${inactive} inactive` : ''}`,
        actions: canEdit ? html`<button class="btn btn-primary" data-act="add">+ Add person</button>` : '',
      })}
      ${
        inactive
          ? html`<label class="field"
              ><span>Show inactive</span><input type="checkbox" data-act="inactive" ${state.showInactive ? 'checked' : ''}
            /></label>`
          : ''
      }
      ${
        shown.length
          ? shown.map(
              (p) =>
                html`<button type="button" class="card mg-person" data-act="open" data-id="${p.staff_id}">
                  <span class="chip">${p.staff_code || '—'}</span>
                  <span class="mg-name"
                    ><strong>${p.full_name}</strong><small class="muted">${p.designation || 'No designation yet'}</small></span
                  >
                  ${p.active ? '' : html`<span class="chip chip-warn">Inactive</span>`}
                </button>`,
            )
          : html`<div class="card"><p class="muted">No one to show.</p></div>`
      }`,
    );
  }

  el.addEventListener('click', (e) => {
    const t = e.target.closest('[data-act]');
    if (!t) return;
    if (t.dataset.act === 'add') openCard(null);
    if (t.dataset.act === 'open') openCard(t.dataset.id);
  });
  el.addEventListener('change', (e) => {
    if (e.target.dataset.act === 'inactive') {
      state.showInactive = e.target.checked;
      paint();
    }
  });

  // ── the staff card ──
  async function openCard(id) {
    const canPrivate = perms.has('mgmt.staff_private');
    const tabs = [{ id: 'details', label: 'Details' }];
    if (id && (perms.has('credit.view') || perms.has('mgmt.credit_manage'))) tabs.push({ id: 'credit', label: 'Credit' });
    if (id && (perms.has('mgmt.salary') || perms.has('mgmt.salary_view'))) tabs.push({ id: 'payslip', label: 'Payslip' });
    if (id && perms.has('mgmt.notes')) tabs.push({ id: 'notes', label: 'Notes' });

    let card = {
      f: blankForm(canPrivate && canEdit),
      privateVisible: canPrivate,
      errors: {},
      tab: 'details',
      key: null,
      busy: false,
      notes: null,
      credit: null,
    };
    if (id) {
      try {
        const s = await api.getStaff(id);
        card.privateVisible = s.private_visible;
        card.f = {
          staff_id: s.staff_id,
          full_name: s.full_name,
          phone: s.phone ?? '',
          joined_on: s.joined_on ?? '',
          active: s.active,
          designation: s.designation ?? '',
          staff_code: s.staff_code ?? '',
          sort_order: s.sort_order === 999 ? '' : String(s.sort_order),
          private: s.private_visible
            ? { father_name: s.private?.father_name ?? '', address: s.private?.address ?? '', blood_group: s.private?.blood_group ?? '' }
            : null,
        };
      } catch {
        toast('Could not open this person. Try again.', 'error');
        return;
      }
    }
    const today = todayPkt();
    const dlg = openDialog(html`<div id="card"></div>`, { label: 'Staff card' });
    const host = dlg.querySelector('#card');

    const field = (label, key, { type = 'text', max = 0, hint = '', ph = '', attrs = '' } = {}) =>
      html`<label class="field ${card.errors[key] ? 'bad' : ''}"
        ><span>${label}</span>
        <input
          data-f="${key}"
          type="${type}"
          value="${card.f[key] ?? ''}"
          ${max ? html`maxlength="${max}"` : ''}
          placeholder="${ph}"
          ${canEdit ? '' : 'disabled'}
          ${attrs}
        />
        ${hint ? html`<small class="muted">${hint}</small>` : ''}${card.errors[key] ? html`<small class="err">${card.errors[key]}</small>` : ''}</label
      >`;
    const pfield = (label, key, max, multiline = false) =>
      html`<label class="field ${card.errors[key] ? 'bad' : ''}"
        ><span>${label}</span> ${
          multiline
            ? html`<textarea data-p="${key}" rows="2" maxlength="${max}" ${canEdit ? '' : 'disabled'}>
${card.f.private[key] ?? ''}</textarea>`
            : html`<input data-p="${key}" value="${card.f.private[key] ?? ''}" maxlength="${max}" ${canEdit ? '' : 'disabled'} />`
        }
        ${card.errors[key] ? html`<small class="err">${card.errors[key]}</small>` : ''}</label
      >`;

    const detailsView = () =>
      html` <div class="fields">
          ${field('Name', 'full_name', { max: 80 })} ${field('Designation', 'designation', { max: 60 })}
          ${field('Staff code', 'staff_code', { max: 16, ph: 'Automatic', hint: card.f.staff_id ? '' : 'Leave empty for the next number.' })}
          ${field('Order on sheets', 'sort_order', { type: 'number', ph: '999', attrs: 'min="1" max="999" inputmode="numeric"' })}
          ${field('Phone', 'phone', { max: 20 })} ${field('Joining date', 'joined_on', { type: 'date', attrs: `max="${today}"` })}
          <label class="field"
            ><span>On the payroll list</span
            ><input type="checkbox" data-f="active" ${card.f.active ? 'checked' : ''} ${canEdit ? '' : 'disabled'} />
            <small class="muted">Does not stop their login. Use Users &amp; Access for that.</small></label
          >
        </div>
        ${
          card.f.private
            ? html`<h3 class="sec-label">Private</h3>
                <div class="fields">
                  ${pfield('Father’s name', 'father_name', 80)}
                  <label class="field ${card.errors.blood_group ? 'bad' : ''}"
                    ><span>Blood group</span>
                    <select data-p="blood_group" ${canEdit ? '' : 'disabled'}>
                      <option value="">—</option>
                      ${BLOOD_GROUPS.map((g) => html`<option value="${g}" ${card.f.private.blood_group === g ? 'selected' : ''}>${g}</option>`)}
                    </select></label
                  >
                  ${pfield('Address', 'address', 200, true)}
                </div>`
            : ''
        }
        ${canEdit ? html`<div class="actions"><button type="button" class="btn btn-primary" data-do="save" ${card.busy ? 'disabled' : ''}>${card.f.staff_id ? 'Save changes' : 'Add person'}</button></div>` : ''}`;

    const creditView = () => {
      if (!card.credit) return html`<p class="muted">Loading…</p>`;
      if (card.credit === 'none') return html`<p class="muted">No credit this month.</p>`;
      const c = card.credit;
      return html`<table class="table">
          <tbody>
            <tr>
              <td>Previous balance</td>
              <td class="num">${money(c.prev_balance)}</td>
            </tr>
            <tr>
              <td>Entries this month</td>
              <td class="num">${money(c.entries_total)}</td>
            </tr>
            <tr>
              <td>Salary deduction</td>
              <td class="num">${money(c.salary_deduction)}</td>
            </tr>
            <tr>
              <td>Less generic</td>
              <td class="num">${money(c.generic_deduction)}</td>
            </tr>
            <tr>
              <td><strong>Net</strong></td>
              <td class="num"><strong>${money(c.net)}</strong></td>
            </tr>
          </tbody>
        </table>
        <p><a class="link" href="#/manager/credit">Open Staff Credit</a></p>`;
    };
    const notesView = () => {
      if (!card.notes) return html`<p class="muted">Loading…</p>`;
      return html`<label class="field"><span>New note</span><textarea id="note-body" rows="3" maxlength="2000"></textarea></label>
        <div class="actions"><button type="button" class="btn btn-primary" data-do="note-add">Add note</button></div>
        ${
          card.notes.length
            ? card.notes.map(
                (n) =>
                  html`<div class="card mg-note">
                    <p>${n.body}</p>
                    <small class="muted">${shortDate(n.created_at.slice(0, 10))}</small>
                    <button type="button" class="btn btn-ghost btn-sm" data-do="note-remove" data-id="${n.id}">Remove</button>
                  </div>`,
              )
            : html`<p class="muted">No notes yet.</p>`
        }`;
    };

    function view() {
      const body = {
        details: detailsView,
        credit: creditView,
        notes: notesView,
        payslip: () => html`<p class="muted">Payslips arrive with the Salary pages.</p>`,
      }[card.tab]();
      return html`<h2>${card.f.full_name || 'New person'}</h2>
        ${
          tabs.length > 1
            ? html`<div class="tabs-seg" role="tablist">
                ${tabs.map((t) => html`<button type="button" role="tab" class="tab" aria-selected="${card.tab === t.id}" data-tab="${t.id}">${t.label}</button>`)}
              </div>`
            : ''
        }
        ${body}
        <div class="actions"><button type="button" class="btn btn-ghost" data-close>Close</button></div>`;
    }
    const paintCard = () => render(host, view());
    paintCard();

    async function loadTab(tab) {
      if (tab === 'credit' && !card.credit) {
        try {
          const rows = await api.creditMonth(monthStart(today));
          card.credit = rows.find((r) => r.staff_id === id) ?? 'none';
        } catch {
          card.credit = 'none';
        }
      }
      if (tab === 'notes' && !card.notes) {
        try {
          card.notes = await api.listNotes(id);
        } catch {
          card.notes = [];
          toast('Could not load notes.', 'error');
        }
      }
      paintCard();
    }

    dlg.addEventListener('input', (e) => {
      const t = e.target;
      card.key = null; // an edited form is a new save, so it needs a new idempotency key
      if (t.dataset.f) card.f[t.dataset.f] = t.type === 'checkbox' ? t.checked : t.value;
      if (t.dataset.p && card.f.private) card.f.private[t.dataset.p] = t.value;
    });
    dlg.addEventListener('click', async (e) => {
      const tabBtn = e.target.closest('[data-tab]');
      if (tabBtn) {
        card.tab = tabBtn.dataset.tab;
        paintCard();
        return loadTab(card.tab);
      }
      const act = e.target.closest('[data-do]');
      if (!act) return;
      if (act.dataset.do === 'save') {
        card.errors = validateStaffForm(card.f, today);
        if (Object.keys(card.errors).length) return paintCard();
        card.key ??= newKey();
        card.busy = true;
        paintCard();
        const { error } = await api.saveStaff(staffPayload(card.f, card.key));
        card.busy = false;
        if (error) {
          toast(error.message || 'Could not save. Try again.', 'error');
          return paintCard();
        }
        toast(card.f.staff_id ? 'Saved' : 'Person added');
        dlg.close();
        load();
      }
      if (act.dataset.do === 'note-add') {
        const body = dlg.querySelector('#note-body').value.trim();
        if (!body) return;
        const { error } = await api.addNote(id, body, newKey());
        if (error) return toast(error.message || 'Could not add the note.', 'error');
        card.notes = await api.listNotes(id);
        paintCard();
      }
      if (act.dataset.do === 'note-remove') {
        const reason = await askReason({
          title: 'Remove this note?',
          hint: 'The note is hidden, not erased. It stays in the record.',
          confirm: 'Remove',
          optional: true,
        });
        if (reason === null) return;
        const { error } = await api.removeNote(act.dataset.id, reason);
        if (error) return toast(error.message || 'Could not remove the note.', 'error');
        card.notes = await api.listNotes(id);
        paintCard();
      }
    });
  }

  render(el, loadingCard());
  await load();
}
