import { html, render } from '../../../shared/html.js';
import { hero } from '../../../shared/ui.js';
import { mountPermissionPanel } from '../../../shared/permissionPanel.js';
import * as api from '../data/api.js';

export async function mount(el, { ctx }) {
  const state = { editing: null, notice: null, error: null, pinFor: null };
  let panel = null;

  async function draw() {
    const [people, catalog, locked] = await Promise.all([
      api.listPeople(),
      api.listPermissionCatalog(),
      api.lockedUsernames().catch(() => []), // a convenience: the page still works without it
    ]);
    const isLocked = (p) => locked.includes(p.username);
    const pinTarget = state.pinFor ? people.find((p) => p.user_id === state.pinFor) : null;
    const editing = state.editing ? people.find((p) => p.user_id === state.editing) : null;
    const overrides = editing ? await api.listUserPermissions(editing.user_id) : [];

    render(
      el,
      html`${hero({ label: 'Admin', title: 'Users & Access', sub: 'Set PINs, unlock and disable logins, and set what each person may do. Create a login from the Staff Registry.' })}
        ${state.error ? html`<p class="note note-error" role="alert">${state.error}</p>` : ''}
        ${
          state.notice
            ? html`<div class="card note-box" role="status">
                <strong>${state.notice}</strong>
                <button class="btn" data-act="dismiss">Done</button>
              </div>`
            : ''
        }
        <section class="card">
          <h2>People</h2>
          ${people.map(
            (p) =>
              html`<div class="row">
                <div>
                  <strong>${p.staff?.full_name ?? p.username}</strong> <br /><span class="muted small"
                    >${p.username} · ${p.role_template}${p.disabled_at ? ' · disabled' : ''}${isLocked(p) ? ' · locked' : ''}</span
                  >
                </div>
                <div class="actions">
                  ${
                    p.role_template === 'admin'
                      ? html`<span class="muted small">Owner account</span>`
                      : html` <button class="btn" data-act="perms" data-id="${p.user_id}">Permissions</button>
                          <button class="btn" data-act="setpin" data-id="${p.user_id}">Set PIN</button>
                          ${isLocked(p) ? html`<button class="btn btn-primary" data-act="unlock" data-id="${p.user_id}">Unlock</button>` : ''}
                          <button class="btn btn-ghost" data-act="${p.disabled_at ? 'enable' : 'disable'}" data-id="${p.user_id}">
                            ${p.disabled_at ? 'Enable' : 'Disable'}
                          </button>`
                  }
                </div>
              </div>`,
          )}
        </section>
        ${
          pinTarget
            ? html`<section class="card">
                <h2>Set PIN: ${pinTarget.staff?.full_name ?? pinTarget.username}</h2>
                <form data-form="setpin" data-id="${pinTarget.user_id}">
                  <label class="field"
                    ><span>New 4-digit PIN</span
                    ><input
                      name="pin"
                      type="password"
                      inputmode="numeric"
                      pattern="[0-9]{4}"
                      maxlength="4"
                      autocomplete="new-password"
                      required
                  /></label>
                  <label class="field"
                    ><span>Repeat PIN</span
                    ><input
                      name="pin2"
                      type="password"
                      inputmode="numeric"
                      pattern="[0-9]{4}"
                      maxlength="4"
                      autocomplete="new-password"
                      required
                  /></label>
                  <p class="muted small">The old PIN stops working now. Tell the new PIN to the person; it cannot be shown again.</p>
                  <button class="btn btn-primary" type="submit">Save PIN</button>
                  <button class="btn btn-ghost" type="button" data-act="cancelpin">Cancel</button>
                </form>
              </section>`
            : ''
        }
        ${
          editing
            ? html`<section class="card">
                <h2>Permissions: ${editing.staff?.full_name ?? editing.username}</h2>
                <div data-pg-mount></div>
              </section>`
            : ''
        }`,
    );
    panel?.destroy();
    panel = null;
    const mountEl = el.querySelector('[data-pg-mount]');
    if (editing && mountEl) {
      panel = mountPermissionPanel(mountEl, {
        permissions: catalog.permissions,
        role: editing.role_template,
        rolePerms: catalog.rolePerms,
        overrides,
        // One logged change per tick. The list updates at once and the page is not reloaded.
        save: async (key, effect) => check(await api.setPermission(editing.user_id, key, effect)),
        bar: html`<div class="pg-top">
          <span class="muted small">Role preset</span>
          <select data-act="role" data-id="${editing.user_id}" aria-label="Role preset">
            ${['junior', 'senior'].map((r) => html`<option value="${r}" ${editing.role_template === r ? 'selected' : ''}>${r}</option>`)}
          </select>
        </div>`,
      });
    }
  }

  async function run(fn) {
    state.error = null;
    try {
      await fn();
    } catch (e) {
      state.notice = null;
      state.error = e?.userMessage ?? 'That did not work. Please try again.';
    }
    await draw();
  }
  // Server answers carry a plain message (for example "choose a PIN that is not a year"): show it as it is.
  const must = (r) => {
    if (r.ok) return r;
    throw Object.assign(new Error(r.body?.error ?? 'failed'), { userMessage: r.body?.message });
  };

  el.onclick = (e) => {
    const b = e.target.closest('[data-act]');
    if (!b || b.tagName === 'SELECT') return;
    const { act, id } = b.dataset;
    if (act === 'dismiss') return run(async () => (state.notice = null));
    if (act === 'perms') return run(async () => (state.editing = state.editing === id ? null : id));
    if (act === 'setpin') return run(async () => (state.pinFor = state.pinFor === id ? null : id));
    if (act === 'cancelpin') return run(async () => (state.pinFor = null));
    if (act === 'unlock')
      return run(async () => {
        must(await api.unlock(id));
        state.notice = 'Unlocked. They can try their PIN again now.';
      });
    if (act === 'disable' || act === 'enable') return run(async () => must(await api.setDisabled(id, act === 'disable')));
  };
  el.onsubmit = (e) => {
    const form = e.target.closest('form[data-form="setpin"]');
    if (!form) return;
    e.preventDefault();
    const { pin, pin2 } = Object.fromEntries(new FormData(form));
    const id = form.dataset.id;
    return run(async () => {
      if (!/^\d{4}$/.test(pin)) throw Object.assign(new Error('pin'), { userMessage: 'The PIN must be exactly 4 digits.' });
      if (pin !== pin2) throw Object.assign(new Error('pin'), { userMessage: 'The two PINs do not match.' });
      must(await api.setPin(id, pin));
      state.pinFor = null;
      state.notice = 'New PIN saved. The old one no longer works.';
    });
  };
  el.onchange = (e) => {
    const s = e.target.closest('select[data-act]');
    if (!s) return;
    const { act, id } = s.dataset;
    if (act === 'role') return run(async () => check(await api.setRole(id, s.value)));
  };
  const check = (r) => {
    if (r.error) throw r.error;
  };

  void ctx;
  await draw();
}
