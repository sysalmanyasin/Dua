// Manage Fields: add your own bank or client column, rename, hide, reorder, or switch one off.
import { html, render } from '../../../shared/html.js';
import { hero } from '../../../shared/ui.js';
import * as api from '../data/api.js';
import { SIGN_LABEL, friendlyFieldError, moveCode, sectionsOf } from '../domain/fields.js';
import { errorCard, loadingCard, openDialog, toast } from './parts.js';

export async function mount(el) {
  render(el, loadingCard());
  let methods;
  try {
    methods = await api.listAllMethods();
  } catch {
    return render(el, errorCard('the fields'));
  }

  const draw = () =>
    render(
      el,
      html` ${hero({ label: 'Settings', title: 'Manage Fields', sub: 'Add a bank or client column, rename one, hide it from the entry page, or switch it off. Saved figures are never changed.' })}
        <div class="actions-bar"><button class="btn btn-primary" data-act="add">+ Add a field</button></div>
        ${sectionsOf(methods).map(
          (g) =>
            html`<section class="card">
              <h2>${g.section}</h2>
              ${g.items.map(
                (m) =>
                  html`<div class="row ${m.active ? '' : 'off'}">
                    <div>
                      <strong>${m.label}</strong> ${m.active ? '' : html`<span class="chip">switched off</span>`}<br /><span
                        class="muted small"
                        >${SIGN_LABEL[m.sign]} · ${m.code.startsWith('c_') ? 'your own field' : 'built in'}</span
                      >
                    </div>
                    <div class="actions">
                      <label class="rm-row inline"
                        ><span>On entry page</span
                        ><input type="checkbox" data-show="${m.code}" ${m.show_in_entry ? 'checked' : ''} ${m.active ? '' : 'disabled'}
                      /></label>
                      <button class="btn btn-sm" data-act="up" data-code="${m.code}" aria-label="Move ${m.label} up">↑</button
                      ><button class="btn btn-sm" data-act="down" data-code="${m.code}" aria-label="Move ${m.label} down">↓</button>
                      <button class="btn btn-sm" data-act="edit" data-code="${m.code}">Edit</button>
                      <button class="btn btn-sm btn-ghost" data-act="${m.active ? 'off' : 'on'}" data-code="${m.code}">
                        ${m.active ? 'Switch off' : 'Switch on'}
                      </button>
                    </div>
                  </div>`,
              )}
            </section>`,
        )}`,
    );

  async function reload() {
    methods = await api.listAllMethods();
    draw();
  }
  async function run(promise, okMessage) {
    const { error } = await promise;
    if (error) return toast(friendlyFieldError(error.message), 'error');
    if (okMessage) toast(okMessage);
    await reload();
  }

  function form(existing) {
    const dlg = openDialog(
      html`<h2>${existing ? 'Edit field' : 'Add a field'}</h2>
        <label class="field"><span>Name</span><input id="f-name" maxlength="60" value="${existing?.label ?? ''}" /></label>
        <label class="field"
          ><span>Section</span
          ><select id="f-section">
            ${['Cash', 'Banks', 'Credit Clients'].map((s) => html`<option ${existing?.section === s ? 'selected' : ''}>${s}</option>`)}
          </select></label
        >
        <label class="field"
          ><span>Type</span
          ><select id="f-sign">
            ${Object.entries(SIGN_LABEL).map(([k, l]) => html`<option value="${k}" ${existing?.sign === k ? 'selected' : ''}>${l}</option>`)}
          </select></label
        >
        <p class="muted small">
          ${existing ? 'Type and section cannot change once a field has saved figures.' : 'A returns column should be "Deducts from the sale". A client or bank column normally "Adds to the sale".'}
        </p>
        <div class="actions-bar">
          <button class="btn btn-primary" data-save>Save</button><button class="btn" data-close>Cancel</button>
        </div>`,
      { label: 'Field' },
    );
    dlg.addEventListener('click', async (e) => {
      if (!e.target.closest('[data-save]')) return;
      const label = dlg.querySelector('#f-name').value.trim();
      if (!label) return toast('Give the field a name.', 'error');
      dlg.close();
      await run(
        api.saveField(
          existing?.code ?? null,
          label,
          dlg.querySelector('#f-section').value,
          dlg.querySelector('#f-sign').value,
          existing ? existing.show_in_entry : true,
          existing ? existing.active : true,
        ),
        existing ? 'Field saved' : 'Field added',
      );
    });
  }

  el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const m = methods.find((x) => x.code === b.dataset.code);
    switch (b.dataset.act) {
      case 'add':
        return form(null);
      case 'edit':
        return form(m);
      case 'off':
      case 'on':
        return run(
          api.saveField(m.code, m.label, m.section, m.sign, m.show_in_entry, b.dataset.act === 'on'),
          b.dataset.act === 'on' ? 'Field switched on' : 'Field switched off',
        );
      case 'up':
      case 'down':
        return run(
          api.reorderFields(
            moveCode(
              methods.map((x) => x.code),
              m.code,
              b.dataset.act,
            ),
          ),
        );
      default:
    }
  });
  el.addEventListener('change', (e) => {
    const c = e.target.closest('input[data-show]');
    if (!c) return;
    const m = methods.find((x) => x.code === c.dataset.show);
    run(api.saveField(m.code, m.label, m.section, m.sign, c.checked, m.active));
  });
  draw();
}
