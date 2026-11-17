// One audit: its members and its rounds, and the button that starts a new round.
import { html, render } from '../../../shared/html.js';
import { hero } from '../../../shared/ui.js';
import * as api from '../data/api.js';
import { friendlyError } from '../domain/errors.js';
import { getView, newKey, setView } from '../domain/nav.js';
import { errorCard, loadingCard, toast } from './parts.js';

const STATE = { draft: 'Being set up', locked: 'Locked', counting: 'Counting', compiled: 'Compiled', final: 'Final' };
const ROLES = { lead: 'Lead', deputy: 'Deputy', counter: 'Counter', observer: 'Observer' };
export const roundLabel = (r) => `Round ${r.round_number}${r.round_suffix ?? ''}`;

export async function mount(el, { ctx } = {}) {
  const perms = ctx?.permissions ?? [];
  const canManage = perms.includes('audit.manage');
  const id = getView()?.engagement;
  if (!id) {
    return render(
      el,
      html`<div class="aud">
        <div class="card aud-card">
          <p>No audit chosen. <a href="#/audit/engagements">Back to audits</a></p>
        </div>
      </div>`,
    );
  }
  const s = { data: null, people: [], unit: 'company', roundKey: newKey(), addUser: '', addRole: 'counter', busy: false, error: null };

  async function load() {
    s.data = await api.engagementOverview(id);
    s.people = canManage ? await api.listPeopleForAudit() : [];
  }

  function draw() {
    const g = s.data.engagement;
    const memberIds = new Set(s.data.members.map((m) => m.user_id));
    const candidates = s.people.filter((p) => !memberIds.has(p.user_id));
    render(
      el,
      html`<div class="aud">
        ${hero({
          label: 'Audit',
          title: g.name,
          sub: `${g.scope_type === 'full' ? 'Full stock' : g.scope_companies.join(', ')} · ${g.status === 'open' ? 'Open' : g.status}`,
        })}
        ${s.error ? html`<p class="note note-error" role="alert">${s.error}</p>` : ''}
        <section class="card aud-card" aria-label="Rounds">
          <h2>Rounds</h2>
          ${
            s.data.rounds.length === 0
              ? html`<p class="muted">No rounds yet.</p>`
              : html`<ul class="aud-list">
                  ${s.data.rounds.map(
                    (r) =>
                      html`<li>
                        <span
                          ><strong>${roundLabel(r)}</strong>
                          <span class="muted small">${r.items} items · ${r.assignments} people · by ${r.unit}</span></span
                        >
                        <span class="aud-actions">
                          <span class="aud-badge aud-badge-${r.state}">${STATE[r.state] ?? r.state}</span>
                          <button type="button" class="btn btn-sm" data-act="round" data-id="${r.id}">Open</button>
                        </span>
                      </li>`,
                  )}
                </ul>`
          }
          ${
            canManage && g.status === 'open'
              ? html`<div class="aud-actions">
                  <label class="field"
                    ><span>Split work by</span
                    ><select data-f="unit">
                      <option value="company" ${s.unit === 'company' ? 'selected' : ''}>Company (whole companies per person)</option>
                      <option value="item" ${s.unit === 'item' ? 'selected' : ''}>Item (items dealt one by one)</option>
                    </select></label
                  >
                  <button type="button" class="btn btn-primary" data-act="new-round" ${s.busy ? 'disabled' : ''}>Start a new round</button>
                </div>`
              : ''
          }
        </section>
        <section class="card aud-card" aria-label="Members">
          <h2>Team</h2>
          <p class="muted small">
            Deputies see an audit only when they are added here. Counters need no entry: they see the part given to them.
          </p>
          ${
            s.data.members.length === 0
              ? html`<p class="muted">No one added yet.</p>`
              : s.data.members.map(
                  (m) =>
                    html`<div class="row">
                      <div><strong>${m.name}</strong> <span class="aud-badge">${ROLES[m.role] ?? m.role}</span></div>
                      ${
                        canManage
                          ? html`<button
                              type="button"
                              class="btn btn-ghost btn-sm"
                              data-act="remove"
                              data-user="${m.user_id}"
                              ${s.busy ? 'disabled' : ''}
                            >
                              Remove
                            </button>`
                          : ''
                      }
                    </div>`,
                )
          }
          ${
            canManage && candidates.length
              ? html`<div class="aud-actions">
                  <label class="field"
                    ><span>Add a person</span
                    ><select data-f="addUser">
                      <option value="">Choose…</option>
                      ${candidates.map((p) => html`<option value="${p.user_id}" ${s.addUser === p.user_id ? 'selected' : ''}>${p.full_name}</option>`)}
                    </select></label
                  >
                  <label class="field"
                    ><span>As</span
                    ><select data-f="addRole">
                      ${Object.entries(ROLES).map(([k, v]) => html`<option value="${k}" ${s.addRole === k ? 'selected' : ''}>${v}</option>`)}
                    </select></label
                  >
                  <button type="button" class="btn btn-sm" data-act="add" ${s.busy || !s.addUser ? 'disabled' : ''}>Add</button>
                </div>`
              : ''
          }
        </section>
        <p><a href="#/audit/engagements">← All audits</a></p>
      </div>`,
    );
  }

  async function run(fn, doneText) {
    s.busy = true;
    s.error = null;
    draw();
    try {
      await fn();
      if (doneText) toast(doneText);
    } catch (e) {
      s.error = friendlyError(e).message;
    }
    s.busy = false;
    try {
      await load();
    } catch (e) {
      return render(el, errorCard('this audit', friendlyError(e).message));
    }
    draw();
  }

  el.onchange = (e) => {
    const f = e.target.dataset?.f;
    if (f === 'unit' || f === 'addUser' || f === 'addRole') {
      s[f] = e.target.value;
      draw();
    }
  };
  el.onclick = (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b || b.disabled) return;
    const { act, user } = b.dataset;
    if (act === 'round') {
      setView({ engagement: id, round: b.dataset.id });
      location.hash = '#/audit/round';
      return;
    }
    if (act === 'new-round') {
      s.busy = true;
      s.error = null;
      draw();
      return api
        .createRound({ key: s.roundKey, engagementId: id, unit: s.unit })
        .then((rid) => {
          s.roundKey = newKey();
          setView({ engagement: id, round: rid });
          location.hash = '#/audit/round';
        })
        .catch((err) => {
          s.error = friendlyError(err).message;
          s.busy = false;
          draw();
        });
    }
    if (act === 'add') {
      const u = s.addUser;
      s.addUser = '';
      return run(() => api.setMember(id, u, s.addRole), 'Added.');
    }
    if (act === 'remove') return run(() => api.setMember(id, user, null), 'Removed.');
  };

  render(el, loadingCard());
  try {
    await load();
  } catch (e) {
    return render(el, errorCard('this audit', friendlyError(e).message));
  }
  draw();
}
