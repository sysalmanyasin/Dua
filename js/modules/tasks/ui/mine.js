// My Tasks (staff): the person's own work in the agreed order, with accept, start, hand in, change requests and comments.
// Mobile first: one column, large tap targets, plain words. Everything shown comes from the database for this person only.
import { html } from '../../../shared/html.js';
import { hero } from '../../../shared/ui.js';
import { todayPkt } from '../../../shared/format.js';
import * as api from '../data/api.js';
import { groupMine, normaliseSnapshot, normaliseTasks } from '../domain/tasks.js';
import { detailView, taskCard } from './detail.js';
import { loadDetail, taskAct } from './actions.js';
import { mountScreen } from './kit.js';

const count = (label, n, tone = '') =>
  html`<div class="tk-count ${n && tone ? `tk-${tone}` : ''}"><strong>${n}</strong><span>${label}</span></div>`;

export async function mount(el) {
  mountScreen(el, {
    head: hero({ label: 'Tasks', title: 'My tasks', sub: 'Your work, in the order to do it.' }),
    async load(ui) {
      ui.scope ??= 'open';
      const [list, snap, detail] = await Promise.all([api.listMine(ui.scope), api.snapshotMine(), loadDetail(ui)]);
      ui.currentTask = detail?.task ?? null;
      return { tasks: normaliseTasks(list), snap: normaliseSnapshot(snap), detail };
    },
    act: (name, p, ui) => {
      if (name === 'scope') {
        ui.scope = p.scope === 'done' ? 'done' : 'open';
        ui.open = null;
        return null;
      }
      return taskAct(name, p, ui);
    },
    view(data, ui) {
      const today = todayPkt();
      if (data.tasks === null) return html`<p class="home-empty">Tasks are not set up for your login.</p>`;
      const s = data.snap;
      const card = (t) =>
        taskCard(t, {
          today,
          open: ui.open === t.id,
          quick: true,
          detailHtml:
            data.detail?.task.id === t.id ? detailView(data.detail, { today, taskId: t.id }) : html`<p class="muted">Loading…</p>`,
        });
      return html`${
          s
            ? html`<div class="tk-counts" role="group" aria-label="Your task numbers">
                ${count('Overdue', s.overdue, 'bad')}${count('Due soon', s.upcoming, 'warn')}${count('To do', s.pending)}${count('Returned', s.returned, 'bad')}${count('Being checked', s.awaiting_verification)}${count(`Done (${s.days} days)`, s.completed, 'ok')}
              </div>`
            : ''
        }
        <div class="tk-tabs" role="group" aria-label="Which tasks">
          <button
            class="btn ${ui.scope === 'open' ? 'btn-primary' : ''}"
            type="button"
            data-act="scope"
            data-scope="open"
            aria-pressed="${ui.scope === 'open'}"
          >
            To do
          </button>
          <button
            class="btn ${ui.scope === 'done' ? 'btn-primary' : ''}"
            type="button"
            data-act="scope"
            data-scope="done"
            aria-pressed="${ui.scope === 'done'}"
          >
            Done
          </button>
        </div>
        ${
          ui.scope === 'done'
            ? data.tasks.length
              ? html`<ul class="tk-cards">
                  ${data.tasks.map(card)}
                </ul>`
              : html`<p class="home-empty">Nothing finished in the last 30 days.</p>`
            : data.tasks.length
              ? groupMine(data.tasks).map(
                  (g) =>
                    html`<section class="tk-group" aria-label="${g.title}">
                      <h2 class="tk-h tk-${g.tone}">${g.title} <span>${g.tasks.length}</span></h2>
                      <ul class="tk-cards">
                        ${g.tasks.map(card)}
                      </ul>
                    </section>`,
                )
              : html`<p class="home-empty">You have no tasks right now.</p>`
        }`;
    },
  });
}
