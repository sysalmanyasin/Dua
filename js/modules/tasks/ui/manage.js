// All Tasks (Owner): create, assign, re-date and cancel. The Owner is the only manager (D-52); the database refuses anyone else.
import { html } from '../../../shared/html.js';
import { hero } from '../../../shared/ui.js';
import { todayPkt } from '../../../shared/format.js';
import * as api from '../data/api.js';
import { EVIDENCE, STATUS, normaliseTasks, normaliseTeam } from '../domain/tasks.js';
import { detailView, taskCard } from './detail.js';
import { loadDetail, taskAct } from './actions.js';
import { mountScreen } from './kit.js';

export async function mount(el) {
  mountScreen(el, {
    head: hero({ label: 'Tasks', title: 'All tasks', sub: 'Create work, give it to someone, and keep an eye on the deadlines.' }),
    async load(ui) {
      ui.status ??= '';
      ui.person ??= '';
      const [list, team, detail] = await Promise.all([
        api.listAll(ui.status || null, ui.person || null, 200),
        api.teamOverview(30),
        loadDetail(ui),
      ]);
      return { tasks: normaliseTasks(list), team: normaliseTeam(team), detail };
    },
    act(name, p, ui) {
      if (name === 'filter') {
        ui.status = p.status ?? '';
        ui.person = p.person ?? '';
        ui.open = null;
        return null;
      }
      return taskAct(name, p, ui);
    },
    view(data, ui) {
      const today = todayPkt();
      if (data.tasks === null) return html`<p class="home-empty">Only the owner can manage tasks.</p>`;
      const staff = data.team?.staff ?? [];
      return html`<p class="muted"><a href="#/tasks/guide">Owner guide: how Task Master works</a></p>
        <details class="tk-more tk-new" data-keep="new-task">
          <summary>Create a task</summary>
          <form class="tk-form" data-act="create">
            <label class="field"
              ><span>Title (needed)</span><input type="text" name="title" maxlength="120" required data-keep="n-title"
            /></label>
            <label class="field"
              ><span>Instructions</span><textarea name="instructions" rows="3" maxlength="2000" data-keep="n-instr"></textarea>
            </label>
            <label class="field"
              ><span>What should the person hand in?</span>
              <select name="evidence" data-keep="n-evidence">
                ${Object.entries(EVIDENCE).map(([v, l]) => html`<option value="${v}">${l}</option>`)}
              </select></label
            >
            <label class="field"
              ><span>Priority</span>
              <select name="priority" data-keep="n-priority">
                <option value="normal">Normal</option>
                <option value="urgent">Urgent</option>
              </select></label
            >
            <label class="field"
              ><span>Give to</span>
              <select name="assignee" data-keep="n-assignee">
                <option value="">Nobody yet</option>
                ${staff.map((s) => html`<option value="${s.id}">${s.name}</option>`)}
              </select></label
            >
            <label class="field"><span>Deadline</span><input type="date" name="due" min="${today}" data-keep="n-due" /></label>
            <button class="btn btn-primary" type="submit">Create task</button>
          </form>
        </details>

        <form class="tk-filters" data-act="filter" aria-label="Filter tasks">
          <label class="field"
            ><span>Status</span>
            <select name="status" data-keep="f-status">
              <option value="">All</option>
              ${Object.entries(STATUS).map(([v, s]) => html`<option value="${v}" ${ui.status === v ? 'selected' : ''}>${s.label}</option>`)}
            </select></label
          >
          <label class="field"
            ><span>Person</span>
            <select name="person" data-keep="f-person">
              <option value="">Everyone</option>
              ${staff.map((s) => html`<option value="${s.id}" ${ui.person === s.id ? 'selected' : ''}>${s.name}</option>`)}
            </select></label
          >
          <button class="btn" type="submit">Show</button>
        </form>

        ${
          data.tasks.length
            ? html`<ul class="tk-cards">
                ${data.tasks.map((t) =>
                  taskCard(t, {
                    today,
                    open: ui.open === t.id,
                    showPerson: true,
                    detailHtml:
                      data.detail?.task.id === t.id
                        ? detailView(data.detail, { today, staff, taskId: t.id })
                        : html`<p class="muted">Loading…</p>`,
                  }),
                )}
              </ul>`
            : html`<p class="home-empty">No tasks match.</p>`
        }`;
    },
  });
}
