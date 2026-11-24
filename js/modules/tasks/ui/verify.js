// To Verify: the queue for the Owner and the Seniors the owner has named (D-53). Approve, or send back with a reason.
// Nobody sees their own work here; the database leaves it out and refuses to let anyone decide it.
import { html } from '../../../shared/html.js';
import { hero } from '../../../shared/ui.js';
import { todayPkt } from '../../../shared/format.js';
import * as api from '../data/api.js';
import { normaliseTasks } from '../domain/tasks.js';
import { detailView, taskCard } from './detail.js';
import { loadDetail, taskAct } from './actions.js';
import { mountScreen } from './kit.js';

export async function mount(el) {
  mountScreen(el, {
    head: hero({ label: 'Tasks', title: 'To verify', sub: 'Work handed in by others, waiting for you to check.' }),
    async load(ui) {
      const [queue, detail] = await Promise.all([api.verificationQueue(), loadDetail(ui)]);
      return { tasks: normaliseTasks(queue), detail };
    },
    act: taskAct,
    view(data, ui) {
      const today = todayPkt();
      if (data.tasks === null) return html`<p class="home-empty">You have not been named to verify tasks. The owner can name you.</p>`;
      if (!data.tasks.length) return html`<p class="home-empty">Nothing is waiting for you to check.</p>`;
      return html`<ul class="tk-cards">
        ${data.tasks.map((t) =>
          taskCard(t, {
            today,
            open: ui.open === t.id,
            showPerson: true,
            extra:
              t.submittedNote || t.submittedTick
                ? html`<p class="tk-quote">${t.submittedNote ? `“${t.submittedNote}”` : 'Ticked as done'}</p>`
                : '',
            detailHtml:
              data.detail?.task.id === t.id ? detailView(data.detail, { today, taskId: t.id }) : html`<p class="muted">Loading…</p>`,
          }),
        )}
      </ul>`;
    },
  });
}
