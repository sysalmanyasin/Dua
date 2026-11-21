// Grouped permission list with checkboxes. One component for Users & Access and for Audit team access.
// The page gives it the permissions, the role preset and the personal settings; it draws the list, and each tick is saved on
// its own (set_user_permission, so each one is logged). The list updates at once and the page is not reloaded, so the
// scroll position and the open groups stay where they are. If a save fails, that row goes back and a message says so.
import { html, render } from './html.js';
import { applyOverride, bulkPlan, buildGroups, effectForToggle, filterGroups } from './permissionGroups.js';

const FILTERS = [
  ['all', 'All'],
  ['allowed', 'Allowed'],
  ['custom', 'Custom'],
];

/**
 * @param {HTMLElement} el  an empty element the panel fills
 * @param {object} o
 * @param {{key:string, description?:string, label?:string}[]} o.permissions
 * @param {string} o.role                    the role preset the person has
 * @param {{role:string, perm_key:string}[]} o.rolePerms
 * @param {{perm_key:string, effect:string}[]} o.overrides   personal Allow / Deny settings now
 * @param {(key:string, effect:'grant'|'deny'|null) => Promise<void>} o.save   must throw when the save fails
 * @param {(overrides:object[]) => void} [o.onChange]       called after the list changes
 * @param {(e:unknown) => string} [o.formatError]
 * @param {import('./html.js').SafeHtml} [o.bar]            shown at the top of the sticky bar (name, role choice)
 * @param {boolean} [o.disabled]
 */
export function mountPermissionPanel(el, o) {
  const formatError = o.formatError ?? ((e) => e?.userMessage ?? 'That did not save. Please try again.');
  let overrides = o.overrides.map((x) => ({ ...x }));
  const state = { query: '', filter: 'all', open: new Set(), confirm: null, status: '', error: '' };
  let queue = Promise.resolve();
  let pending = 0;
  let alive = true;

  const groups = () => buildGroups(o.permissions, o.role, o.rolePerms, overrides);
  const all = groups();
  // First look: groups where the person already has personal settings are open, and a single group is open.
  for (const g of all) if (g.customCount > 0 || all.length === 1) state.open.add(g.id);

  render(
    el,
    html`<div class="pg">
      <div class="pg-bar">
        ${o.bar ?? ''}
        <input class="pg-search" type="search" placeholder="Search permissions" aria-label="Search permissions" autocomplete="off" />
        <div data-pg-meta></div>
        <p class="note note-error" role="alert" data-pg-msg hidden></p>
      </div>
      <div data-pg-list></div>
    </div>`,
  );
  const metaEl = el.querySelector('[data-pg-meta]');
  const listEl = el.querySelector('[data-pg-list]');
  const msgEl = el.querySelector('[data-pg-msg]');
  const searchEl = el.querySelector('.pg-search');

  function drawMeta(gs) {
    const total = gs.reduce((n, g) => n + g.total, 0);
    const allowed = gs.reduce((n, g) => n + g.allowedCount, 0);
    const custom = gs.reduce((n, g) => n + g.customCount, 0);
    const counts = { all: total, allowed, custom };
    const resetting = state.confirm === 'reset-all';
    render(
      metaEl,
      html`<div class="pg-meta">
        <div class="pg-chips" role="group" aria-label="Show">
          ${FILTERS.map(
            ([id, label]) =>
              html`<button type="button" class="pg-chip" data-pg="filter" data-filter="${id}" aria-pressed="${state.filter === id}">
                ${label} <span class="pg-chip-n">${counts[id]}</span>
              </button>`,
          )}
        </div>
        <button type="button" class="btn btn-ghost btn-sm pg-reset" data-pg="reset-all" ${custom === 0 || o.disabled ? 'disabled' : ''}>
          ${resetting ? `Tap again: reset ${custom}` : 'Reset to role'}
        </button>
        <span class="pg-status muted small" role="status">${state.status}</span>
      </div>`,
    );
  }

  function drawList(gs) {
    const searching = state.query.trim() !== '' || state.filter !== 'all';
    const shown = filterGroups(gs, { query: state.query, filter: state.filter });
    if (shown.length === 0) {
      return render(listEl, html`<p class="muted pg-empty">No permissions match.</p>`);
    }
    render(
      listEl,
      html`<div class="pg-colhead" aria-hidden="true"><span>Permission</span><span>Role default</span><span>Access</span></div>
        ${shown.map((g) => {
          const open = searching || state.open.has(g.id);
          const toAllow = bulkPlan(g.items, 'allow').length;
          const toDeny = bulkPlan(g.items, 'clear').length;
          const toReset = bulkPlan(g.items, 'reset').length;
          const confirm = (a) => state.confirm === `${g.id}:${a}`;
          const full = gs.find((x) => x.id === g.id);
          return html`<section class="pg-group" data-group="${g.id}">
            <div class="pg-ghead">
              <button
                type="button"
                class="pg-toggle"
                data-pg="group"
                data-group="${g.id}"
                aria-expanded="${open}"
                aria-controls="pg-rows-${g.id}"
              >
                <span class="pg-caret" aria-hidden="true">${open ? '▾' : '▸'}</span>
                <span class="pg-gname">${g.label}</span>
                <span class="pg-count">${full.allowedCount} of ${full.total} allowed</span>
                ${full.customCount > 0 ? html`<span class="pg-custom-n">${full.customCount} custom</span>` : ''}
              </button>
            </div>
            ${
              open
                ? html`<div class="pg-gactions">
                      <button
                        type="button"
                        class="btn btn-sm"
                        data-pg="bulk"
                        data-action="allow"
                        data-group="${g.id}"
                        ${toAllow === 0 || o.disabled ? 'disabled' : ''}
                      >
                        ${confirm('allow') ? `Tap again: allow ${toAllow}` : 'Allow all'}
                      </button>
                      <button
                        type="button"
                        class="btn btn-sm"
                        data-pg="bulk"
                        data-action="clear"
                        data-group="${g.id}"
                        ${toDeny === 0 || o.disabled ? 'disabled' : ''}
                      >
                        ${confirm('clear') ? `Tap again: remove ${toDeny}` : 'Allow none'}
                      </button>
                      <button
                        type="button"
                        class="btn btn-sm btn-ghost"
                        data-pg="bulk"
                        data-action="reset"
                        data-group="${g.id}"
                        ${toReset === 0 || o.disabled ? 'disabled' : ''}
                      >
                        Reset to role
                      </button>
                    </div>
                    <ul class="pg-rows" id="pg-rows-${g.id}">
                      ${g.items.map(
                        (i) =>
                          html`<li class="pg-row${i.override ? ` pg-row-${i.override}` : ''}">
                            <label class="pg-item">
                              <span class="pg-text">
                                <span class="pg-name"
                                  >${i.name}${
                                    i.override
                                      ? html` <span class="pg-tag pg-tag-${i.override}" title="Different from the role preset"
                                          >${i.override === 'grant' ? 'Custom: allowed' : 'Custom: blocked'}</span
                                        >`
                                      : ''
                                  }</span
                                >
                                <span class="pg-desc">${i.description}</span>
                              </span>
                              <span class="pg-role">${i.fromRole ? 'Allowed' : 'Not allowed'}</span>
                              <input
                                type="checkbox"
                                data-pg="perm"
                                data-key="${i.key}"
                                ${i.allowed ? 'checked' : ''}
                                ${o.disabled ? 'disabled' : ''}
                              />
                            </label>
                          </li>`,
                      )}
                    </ul>`
                : ''
            }
          </section>`;
        })}`,
    );
  }

  const attr = (v) => String(v).replace(/["\\]/g, '\\$&');
  function draw() {
    if (!alive) return;
    // Keep the keyboard focus on the same control after the list is drawn again.
    const a = document.activeElement;
    const keep =
      a && listEl.contains(a) && a.dataset
        ? ['pg', 'key', 'group', 'action'].filter((k) => a.dataset[k] !== undefined).map((k) => `[data-${k}="${attr(a.dataset[k])}"]`)
        : null;
    const gs = groups();
    drawMeta(gs);
    drawList(gs);
    if (keep?.length) listEl.querySelector(keep.join(''))?.focus({ preventScroll: true });
  }

  const showError = (text) => {
    msgEl.textContent = text;
    msgEl.hidden = !text;
  };

  // Applies the changes on screen first, then saves one by one. Stops at the first failure and puts back what was not saved.
  function commit(ops) {
    if (ops.length === 0) return;
    showError('');
    const before = ops.map((op) => ({ ...op, prev: overrides.find((x) => x.perm_key === op.key)?.effect ?? null }));
    for (const op of ops) overrides = applyOverride(overrides, op.key, op.effect);
    pending += 1;
    state.status = 'Saving…';
    draw();
    o.onChange?.(overrides);
    queue = queue.then(async () => {
      let done = 0;
      try {
        for (const op of ops) {
          await o.save(op.key, op.effect);
          done += 1;
        }
        state.status = 'Saved';
      } catch (e) {
        for (const b of before.slice(done)) overrides = applyOverride(overrides, b.key, b.prev);
        state.status = '';
        showError(`${formatError(e)}${ops.length > 1 ? ` (${done} of ${ops.length} changes were saved.)` : ''}`);
        o.onChange?.(overrides);
      }
      pending -= 1;
      if (pending > 0) state.status = 'Saving…';
      draw();
    });
  }

  const visibleItems = (id) => filterGroups(groups(), { query: state.query, filter: state.filter }).find((g) => g.id === id)?.items ?? [];

  el.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-pg]');
    if (!b || !el.contains(b) || b.disabled) return;
    const { pg, group, action, filter } = b.dataset;
    if (pg === 'filter') {
      state.filter = filter;
      state.confirm = null;
      return draw();
    }
    if (pg === 'group') {
      if (state.open.has(group)) state.open.delete(group);
      else state.open.add(group);
      state.confirm = null;
      return draw();
    }
    if (pg === 'reset-all') {
      if (state.confirm !== 'reset-all') {
        state.confirm = 'reset-all';
        return draw();
      }
      state.confirm = null;
      return commit(
        bulkPlan(
          groups().flatMap((g) => g.items),
          'reset',
        ),
      );
    }
    if (pg === 'bulk') {
      const ops = bulkPlan(visibleItems(group), action);
      // Allowing or removing several at once needs a second tap; undoing back to the role preset does not.
      if (action !== 'reset' && ops.length > 1 && state.confirm !== `${group}:${action}`) {
        state.confirm = `${group}:${action}`;
        return draw();
      }
      state.confirm = null;
      return commit(ops);
    }
  });
  el.addEventListener('change', (e) => {
    const box = e.target.closest('input[data-pg="perm"]');
    if (!box || o.disabled) return;
    const item = groups()
      .flatMap((g) => g.items)
      .find((i) => i.key === box.dataset.key);
    if (!item) return;
    state.confirm = null;
    commit([{ key: item.key, effect: effectForToggle(item.fromRole, box.checked) }]);
  });
  searchEl.addEventListener('input', () => {
    state.query = searchEl.value;
    state.confirm = null;
    draw();
  });

  draw();
  return {
    getOverrides: () => overrides,
    destroy() {
      alive = false;
    },
  };
}
