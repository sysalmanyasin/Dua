// Requests (Owner): staff ask to hand a task to someone else or to move its deadline. The Owner approves or refuses.
// A refusal needs a reason (the database checks it too).
import { html } from '../../../shared/html.js';
import { hero } from '../../../shared/ui.js';
import { shortDate } from '../../../shared/format.js';
import * as api from '../data/api.js';
import { REQUEST_KINDS, normaliseRequests, normaliseTeam } from '../domain/tasks.js';
import { mountScreen } from './kit.js';

export async function mount(el) {
  mountScreen(el, {
    head: hero({ label: 'Tasks', title: 'Change requests', sub: 'The team asks here. Only you decide.' }),
    async load() {
      const [reqs, team] = await Promise.all([api.pendingRequests(), api.teamOverview(7)]);
      return { requests: normaliseRequests(reqs), staff: normaliseTeam(team)?.staff ?? [] };
    },
    async act(name, p, ui) {
      if (name === 'approve') {
        await api.decideChange(p.id, true, p.note, p.kind === 'reassign' ? p.assignee || null : null);
        ui.forget = ['rq-'];
        return 'Request approved.';
      }
      if (name === 'refuse') {
        if (!(p.note ?? '').trim()) throw Object.assign(new Error('Say why the request is refused'), { code: '22023' });
        await api.decideChange(p.id, false, p.note.trim(), null);
        ui.forget = ['rq-'];
        return 'Request refused.';
      }
      return null;
    },
    view(data) {
      if (data.requests === null) return html`<p class="home-empty">Only the owner can review requests.</p>`;
      if (!data.requests.length) return html`<p class="home-empty">No requests are waiting.</p>`;
      return html`<ul class="tk-cards">
        ${data.requests.map(
          (r) =>
            html`<li class="tk-card">
              <div class="tk-row">
                <div class="tk-main">
                  <strong class="tk-title">${r.taskTitle}</strong>
                  <span class="tk-sub"
                    >${r.by} asks:
                    ${REQUEST_KINDS[r.kind]}${r.proposedDue ? ` to ${shortDate(r.proposedDue)}` : ''}${r.currentDue ? ` (now ${shortDate(r.currentDue)})` : ''}</span
                  >
                </div>
              </div>
              <p class="tk-quote">Reason: ${r.reason}</p>
              <form class="tk-form" data-act="approve" data-id="${r.id}" data-kind="${r.kind}">
                ${
                  r.kind === 'reassign'
                    ? html`<label class="field"
                        ><span>Give the task to</span>
                        <select name="assignee" data-keep="rq-a-${r.id}">
                          <option value="">No one yet (back to not assigned)</option>
                          ${data.staff.map((s) => html`<option value="${s.id}">${s.name}</option>`)}
                        </select></label
                      >`
                    : ''
                }
                <label class="field"
                  ><span>Note (needed only if you refuse)</span><input type="text" name="note" maxlength="500" data-keep="rq-n-${r.id}"
                /></label>
                <div class="tk-buttons">
                  <button class="btn btn-primary" type="submit">Approve</button>
                  <button class="btn" type="button" data-act="refuse" data-id="${r.id}" data-from-form="1">Refuse</button>
                </div>
              </form>
            </li>`,
        )}
      </ul>`;
    },
    extra({ run }) {
      // The Refuse button needs the note typed in its own form, so it reads it here before acting.
      el.addEventListener(
        'click',
        (ev) => {
          const b = ev.target.closest('[data-from-form]');
          if (!b) return;
          ev.stopImmediatePropagation();
          ev.preventDefault();
          run('refuse', { id: b.dataset.id, note: b.closest('form').elements.note?.value ?? '' });
        },
        true,
      );
    },
  });
}
