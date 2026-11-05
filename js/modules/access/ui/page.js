import { html, render } from '../../../shared/html.js';
import * as api from '../data/api.js';
import { effectiveAccess } from '../domain/permissions.js';

export async function mount(el, { ctx }) {
  const state = { editing: null, notice: null, error: null };

  async function draw() {
    const [pending, people, catalog] = await Promise.all([api.listPending(), api.listPeople(), api.listPermissionCatalog()]);
    const editing = state.editing ? people.find((p) => p.user_id === state.editing) : null;
    const overrides = editing ? await api.listUserPermissions(editing.user_id) : [];

    render(
      el,
      html` ${state.error ? html`<p class="note note-error" role="alert">${state.error}</p>` : ''}
        ${
          state.notice
            ? html`<div class="card note-box" role="status">
                <strong>${state.notice.title}</strong>
                <p>Username <code>${state.notice.username}</code></p>
                <p class="code">${state.notice.code}</p>
                <p class="muted small">
                  Give this one-time code to the staff member in person. It works once, expires in 24 hours, and cannot be shown again.
                </p>
                <button class="btn" data-act="dismiss">Done</button>
              </div>`
            : ''
        }
        <section class="card">
          <h2>Access requests</h2>
          ${
            pending.length === 0
              ? html`<p class="muted">No pending requests.</p>`
              : pending.map(
                  (r) =>
                    html`<div class="row">
                      <div><strong>${r.full_name}</strong><br /><span class="muted small">${r.username}</span></div>
                      <div class="actions">
                        <button class="btn btn-primary" data-act="approve" data-id="${r.id}" data-role="junior">Approve as Junior</button>
                        <button class="btn" data-act="approve" data-id="${r.id}" data-role="senior">As Senior</button>
                        <button class="btn btn-ghost" data-act="reject" data-id="${r.id}">Reject</button>
                      </div>
                    </div>`,
                )
          }
        </section>
        <section class="card">
          <h2>People</h2>
          ${people.map(
            (p) =>
              html`<div class="row">
                <div>
                  <strong>${p.staff?.full_name ?? p.username}</strong> <br /><span class="muted small"
                    >${p.username} · ${p.role_template}${p.disabled_at ? ' · disabled' : ''}</span
                  >
                </div>
                <div class="actions">
                  ${
                    p.role_template === 'admin'
                      ? html`<span class="muted small">Owner account</span>`
                      : html` <button class="btn" data-act="perms" data-id="${p.user_id}">Permissions</button>
                          <button class="btn" data-act="reset" data-id="${p.user_id}">Reset PIN</button>
                          <button class="btn btn-ghost" data-act="${p.disabled_at ? 'enable' : 'disable'}" data-id="${p.user_id}">
                            ${p.disabled_at ? 'Enable' : 'Disable'}
                          </button>`
                  }
                </div>
              </div>`,
          )}
        </section>
        ${
          editing
            ? html`<section class="card">
                <h2>Permissions: ${editing.staff?.full_name ?? editing.username}</h2>
                <label class="field"
                  ><span>Role preset</span
                  ><select data-act="role" data-id="${editing.user_id}">
                    ${['junior', 'senior'].map((r) => html`<option value="${r}" ${editing.role_template === r ? 'selected' : ''}>${r}</option>`)}
                  </select></label
                >
                ${catalog.permissions.map((perm) => {
                  const e = effectiveAccess(editing.role_template, catalog.rolePerms, overrides, perm.key);
                  return html`<div class="row">
                    <div><strong>${perm.key}</strong><br /><span class="muted small">${perm.description}</span></div>
                    <select data-act="perm" data-id="${editing.user_id}" data-key="${perm.key}" aria-label="${perm.key}">
                      <option value="" ${e.override === null ? 'selected' : ''}>
                        Role default (${e.fromRole ? 'allowed' : 'not allowed'})
                      </option>
                      <option value="grant" ${e.override === 'grant' ? 'selected' : ''}>Allow</option>
                      <option value="deny" ${e.override === 'deny' ? 'selected' : ''}>Deny</option>
                    </select>
                  </div>`;
                })}
              </section>`
            : ''
        }`,
    );
  }

  async function run(fn) {
    state.error = null;
    try {
      await fn();
    } catch {
      state.notice = null;
      state.error = 'That did not work. Please try again.';
    }
    await draw();
  }
  const issued = (title, r) => {
    if (!r.ok) throw new Error(r.body.message ?? r.body.error);
    state.notice = { title, username: r.body.username, code: r.body.code };
  };

  el.onclick = (e) => {
    const b = e.target.closest('[data-act]');
    if (!b || b.tagName === 'SELECT') return;
    const { act, id, role } = b.dataset;
    if (act === 'dismiss') return run(async () => (state.notice = null));
    if (act === 'perms') return run(async () => (state.editing = state.editing === id ? null : id));
    if (act === 'approve') return run(async () => issued('Approved', await api.approve(id, role)));
    if (act === 'reject') return run(() => api.reject(id));
    if (act === 'reset') return run(async () => issued('PIN reset', await api.resetPin(id)));
    if (act === 'disable' || act === 'enable') return run(() => api.setDisabled(id, act === 'disable'));
  };
  el.onchange = (e) => {
    const s = e.target.closest('select[data-act]');
    if (!s) return;
    const { act, id, key } = s.dataset;
    if (act === 'role') return run(async () => check(await api.setRole(id, s.value)));
    if (act === 'perm') return run(async () => check(await api.setPermission(id, key, s.value || null)));
  };
  const check = (r) => {
    if (r.error) throw r.error;
  };

  void ctx;
  await draw();
}
