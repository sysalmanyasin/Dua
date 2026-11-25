import { html, render } from '../../../shared/html.js';
import { hero } from '../../../shared/ui.js';
import { mountPermissionPanel } from '../../../shared/permissionPanel.js';
import { buildPermissionRows, filterPermissionRows } from '../../../shared/permissionGroups.js';
import * as api from '../data/api.js';

export async function mount(el, { ctx }) {
  const state = {
    editing: null,
    notice: null,
    error: null,
    pinFor: null,
    view: 'person', // 'person' = people with their permissions, 'permission' = permissions with their people
    pq: '', // search in the By permission view
    pfilter: 'all',
    popen: new Set(), // open groups
    pexp: new Set(), // permissions showing their full people list
  };
  let panel = null;
  let matrix = []; // By permission data, rebuilt on every full draw

  async function draw() {
    const [people, catalog, locked] = await Promise.all([
      api.listPeople(),
      api.listPermissionCatalog(),
      api.lockedUsernames().catch(() => []), // a convenience: the page still works without it
    ]);
    const isLocked = (p) => locked.includes(p.username);
    const pinTarget = state.pinFor ? people.find((p) => p.user_id === state.pinFor) : null;
    const editing = state.editing && state.view === 'person' ? people.find((p) => p.user_id === state.editing) : null;
    const overrides = editing && state.view === 'person' ? await api.listUserPermissions(editing.user_id) : [];
    matrix =
      state.view === 'permission'
        ? buildPermissionRows(catalog.permissions, people, catalog.rolePerms, await api.listAllUserPermissions())
        : [];

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
          <h2>${state.view === 'person' ? 'People' : 'Permissions'}</h2>
          <div class="tabs-seg" role="tablist" aria-label="View">
            ${[
              ['person', 'By person'],
              ['permission', 'By permission'],
            ].map(
              ([id, label]) =>
                html`<button type="button" class="tab" role="tab" data-pm="view" data-view="${id}" aria-selected="${state.view === id}">
                  ${label}
                </button>`,
            )}
          </div>
          ${
            state.view === 'permission'
              ? html`<div class="pm">
                  <input
                    class="pg-search"
                    type="search"
                    placeholder="Search permissions"
                    aria-label="Search permissions"
                    autocomplete="off"
                    data-pm="search"
                    value="${state.pq}"
                  />
                  <div class="pm-chips" data-pm-chips></div>
                  <div data-pm-list></div>
                </div>`
              : people.map(
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
                )
          }
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
    drawMatrix();
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

  // The By permission list. Redraws only itself from the data already loaded, so typing in the search box keeps focus.
  function drawMatrix() {
    const chipsEl = el.querySelector('[data-pm-chips]');
    const listEl = el.querySelector('[data-pm-list]');
    if (!chipsEl || !listEl) return;
    const items = matrix.flatMap((g) => g.items);
    const counts = {
      all: items.length,
      allowed: items.filter((i) => i.allowedCount > 0).length,
      nobody: items.filter((i) => i.allowedCount === 0).length,
      custom: items.filter((i) => i.customCount > 0).length,
    };
    render(
      chipsEl,
      html`<div class="pg-chips" role="group" aria-label="Show">
        ${[
          ['all', 'All'],
          ['allowed', 'Someone has it'],
          ['nobody', 'Nobody'],
          ['custom', 'Custom'],
        ].map(
          ([id, label]) =>
            html`<button type="button" class="pg-chip" data-pm="filter" data-filter="${id}" aria-pressed="${state.pfilter === id}">
              ${label} <span class="pg-chip-n">${counts[id]}</span>
            </button>`,
        )}
      </div>`,
    );
    const searching = state.pq.trim() !== '' || state.pfilter !== 'all';
    const shown = filterPermissionRows(matrix, { query: state.pq, filter: state.pfilter });
    if (shown.length === 0) return render(listEl, html`<p class="muted pg-empty">No permissions match.</p>`);
    render(
      listEl,
      html`${shown.map((g) => {
        const open = searching || state.popen.has(g.id);
        return html`<section class="pg-group">
          <div class="pg-ghead">
            <button type="button" class="pg-toggle" data-pm="group" data-group="${g.id}" aria-expanded="${open}">
              <span class="pg-caret" aria-hidden="true">${open ? '▾' : '▸'}</span>
              <span class="pg-gname">${g.label}</span>
              <span class="pg-count">${g.total} permissions</span>
            </button>
          </div>
          ${
            open
              ? html`<ul class="pg-rows">
                  ${g.items.map((i) => {
                    const expanded = state.pexp.has(i.key);
                    const names = i.people.filter((w) => w.allowed).map((w) => w.name);
                    return html`<li class="pg-row">
                      <button type="button" class="pm-item" data-pm="perm" data-key="${i.key}" aria-expanded="${expanded}">
                        <span class="pg-text">
                          <span class="pg-name"
                            >${i.name}${i.customCount > 0 ? html` <span class="pg-tag" title="Someone's access differs from their role preset">${i.customCount} custom</span>` : ''}</span
                          >
                          <span class="pg-desc">${i.description}</span>
                          <span class="pm-who${names.length === 0 ? ' pm-none' : ''}">${names.length ? names.join(', ') : 'Nobody'}</span>
                        </span>
                        <span class="pm-count" aria-label="${i.allowedCount} of ${i.total} allowed">${i.allowedCount}/${i.total}</span>
                      </button>
                      ${
                        expanded
                          ? html`<ul class="pm-people">
                              ${i.people.map(
                                (w) =>
                                  html`<li class="pm-person${w.allowed ? ' pm-yes' : ''}">
                                    <span class="pm-pname"
                                      >${w.name} <span class="muted small">${w.role}${w.disabled ? ' · disabled' : ''}</span></span
                                    >
                                    ${w.override ? html`<span class="pg-tag pg-tag-${w.override}">${w.override === 'grant' ? 'Custom: allowed' : 'Custom: blocked'}</span>` : ''}
                                    <span class="pm-state">${w.allowed ? '✓ Allowed' : 'Not allowed'}</span>
                                  </li>`,
                              )}
                            </ul>`
                          : ''
                      }
                    </li>`;
                  })}
                </ul>`
              : ''
          }
        </section>`;
      })}`,
    );
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
    const m = e.target.closest('[data-pm]');
    if (m && el.contains(m) && m.dataset.pm !== 'search') {
      const { pm, view, filter, group, key } = m.dataset;
      if (pm === 'view') {
        if (state.view === view) return;
        return run(async () => (state.view = view));
      }
      const flip = (set, v) => (set.has(v) ? set.delete(v) : set.add(v));
      if (pm === 'filter') state.pfilter = filter;
      if (pm === 'group') flip(state.popen, group);
      if (pm === 'perm') flip(state.pexp, key);
      return drawMatrix();
    }
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
  el.oninput = (e) => {
    if (e.target.closest('[data-pm="search"]')) {
      state.pq = e.target.value;
      drawMatrix();
    }
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
