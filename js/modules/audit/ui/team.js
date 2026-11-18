// Team access: the owner gives a person the Deputy Auditor or Sub-Auditor set of audit permissions, or switches single keys.
// Every change is one core set_user_permission call, so each grant is logged with who, what, old and new.
import { html, render } from '../../../shared/html.js';
import { hero } from '../../../shared/ui.js';
import * as api from '../data/api.js';
import { AUDIT_KEYS, BUNDLES, bundleStatus, keyAccess, planApply, planClear } from '../domain/bundles.js';
import { friendlyError } from '../domain/errors.js';
import { errorCard, loadingCard, toast } from './parts.js';

const STATUS_WORD = { full: '✓ has all', partial: '◐ has some', none: '— none' };

export async function mount(el) {
  const state = { open: null, confirmLead: null, busy: false };
  let data = null;

  async function load() {
    const [people, catalog, overrides] = await Promise.all([api.listPeople(), api.listAuditCatalog(), api.listAuditOverrides()]);
    data = { people: people.filter((p) => p.role_template !== 'admin'), rolePerms: catalog.rolePerms, overrides };
  }
  const mine = (userId) => data.overrides.filter((o) => o.user_id === userId);

  function draw() {
    render(
      el,
      html`<div class="aud">
        ${hero({
          label: 'Audit',
          title: 'Team access',
          sub: 'Only you are the Main Auditor. Give trusted people a set of audit permissions, or switch single ones.',
        })}
        <section class="card aud-card">
          <h2>The sets</h2>
          ${['deputy', 'sub', 'lead'].map(
            (id) => html`<p><strong>${BUNDLES[id].label}</strong><br /><span class="muted small">${BUNDLES[id].blurb}</span></p>`,
          )}
        </section>
        ${
          data.people.length === 0
            ? html`<section class="card aud-card">
                <p class="muted">No staff accounts yet. Approve access requests in Users &amp; Access first.</p>
              </section>`
            : data.people.map((p) => person(p))
        }
      </div>`,
    );
  }

  function person(p) {
    const ov = mine(p.user_id);
    const off = !!p.disabled_at || state.busy;
    const name = p.staff?.full_name ?? p.username;
    return html`<section class="card aud-card" aria-label="${name}">
      <div class="aud-person">
        <div>
          <strong>${name}</strong>
          <span class="muted small">${p.username} · ${p.role_template}${p.disabled_at ? ' · disabled' : ''}</span>
        </div>
      </div>
      <p class="small">
        ${['deputy', 'sub', 'lead'].map(
          (id) =>
            html`<span class="aud-chip aud-chip-${bundleStatus(id, p.role_template, data.rolePerms, ov)}"
              >${BUNDLES[id].label.split(' (')[0]}: ${STATUS_WORD[bundleStatus(id, p.role_template, data.rolePerms, ov)]}</span
            >`,
        )}
      </p>
      <div class="aud-actions">
        <button
          type="button"
          class="btn btn-primary btn-sm"
          data-act="apply"
          data-bundle="deputy"
          data-user="${p.user_id}"
          ${off ? 'disabled' : ''}
        >
          Make Deputy Auditor
        </button>
        <button type="button" class="btn btn-sm" data-act="apply" data-bundle="sub" data-user="${p.user_id}" ${off ? 'disabled' : ''}>
          Make Sub-Auditor
        </button>
        <button type="button" class="btn btn-sm" data-act="apply" data-bundle="lead" data-user="${p.user_id}" ${off ? 'disabled' : ''}>
          ${state.confirmLead === p.user_id ? 'Tap again: give every audit key' : 'Make Lead'}
        </button>
        <button
          type="button"
          class="btn btn-ghost btn-sm"
          data-act="clear"
          data-user="${p.user_id}"
          ${off || planClear(ov).length === 0 ? 'disabled' : ''}
        >
          Clear personal audit settings
        </button>
        <button
          type="button"
          class="btn btn-ghost btn-sm"
          data-act="toggle"
          data-user="${p.user_id}"
          aria-expanded="${state.open === p.user_id}"
        >
          ${state.open === p.user_id ? 'Hide single keys' : 'Single keys'}
        </button>
      </div>
      ${
        state.open === p.user_id
          ? html`<div class="aud-keys">
              ${AUDIT_KEYS.map((k) => {
                const a = keyAccess(p.role_template, data.rolePerms, ov, k.key);
                return html`<div class="row">
                  <div><strong>${k.label}</strong> <code class="small">${k.key}</code><br /><span class="muted small">${k.help}</span></div>
                  <select data-act="key" data-user="${p.user_id}" data-key="${k.key}" aria-label="${k.label}" ${off ? 'disabled' : ''}>
                    <option value="" ${a.override === null ? 'selected' : ''}>
                      Role default (${a.fromRole ? 'allowed' : 'not allowed'})
                    </option>
                    <option value="grant" ${a.override === 'grant' ? 'selected' : ''}>Allow</option>
                    <option value="deny" ${a.override === 'deny' ? 'selected' : ''}>Deny</option>
                  </select>
                </div>`;
              })}
            </div>`
          : ''
      }
    </section>`;
  }

  // Runs the calls one by one so every grant is its own logged change. Stops at the first refusal and says how far it got.
  async function runPlan(userId, ops, doneText) {
    state.busy = true;
    draw();
    let done = 0;
    try {
      for (const op of ops) {
        await api.setPermission(userId, op.key, op.effect);
        done += 1;
      }
      toast(ops.length ? doneText : 'Nothing to change. They already have it.');
    } catch (e) {
      toast(`${friendlyError(e).message}${ops.length > 1 ? ` (${done} of ${ops.length} changes were saved.)` : ''}`, 'error');
    }
    state.busy = false;
    try {
      await load();
    } catch (e) {
      return render(el, errorCard('the team', friendlyError(e).message));
    }
    draw();
  }

  el.onclick = (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b || b.disabled || state.busy) return;
    const { act, user, bundle } = b.dataset;
    const p = data.people.find((x) => x.user_id === user);
    if (!p) return;
    if (act === 'toggle') {
      state.open = state.open === user ? null : user;
      return draw();
    }
    if (act === 'clear') return runPlan(user, planClear(mine(user)), 'Personal audit settings cleared.');
    if (act === 'apply') {
      if (bundle === 'lead' && state.confirmLead !== user) {
        state.confirmLead = user; // a second tap confirms: Lead hands over every audit key
        return draw();
      }
      state.confirmLead = null;
      return runPlan(user, planApply(bundle, p.role_template, data.rolePerms, mine(user)), `${BUNDLES[bundle].label} applied.`);
    }
  };
  el.onchange = (e) => {
    const s = e.target.closest('select[data-act="key"]');
    if (!s || state.busy) return;
    runPlan(s.dataset.user, [{ key: s.dataset.key, effect: s.value || null }], 'Saved.');
  };

  render(el, loadingCard());
  try {
    await load();
  } catch (e) {
    return render(el, errorCard('the team', friendlyError(e).message));
  }
  draw();
}
