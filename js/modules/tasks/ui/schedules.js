// Schedules (Owner): tasks that repeat by themselves (D-56). Creating a schedule approves it. Each cycle makes exactly one task;
// "Make today's tasks now" runs the same job the database runs every night, and cannot make a second copy.
import { html } from '../../../shared/html.js';
import { hero } from '../../../shared/ui.js';
import * as api from '../data/api.js';
import { EVIDENCE, WEEKDAYS, checkSchedule, describeSchedule, normaliseSchedules, normaliseTeam } from '../domain/tasks.js';
import { mountScreen } from './kit.js';

export async function mount(el) {
  mountScreen(el, {
    head: hero({ label: 'Tasks', title: 'Schedules', sub: 'Work that comes back on its own.' }),
    async load() {
      const [list, team] = await Promise.all([api.scheduleList(), api.teamOverview(7)]);
      return { schedules: normaliseSchedules(list), staff: normaliseTeam(team)?.staff ?? [] };
    },
    async act(name, p, ui) {
      if (name === 'toggle-schedule') {
        await api.setScheduleActive(p.id, p.active === 'true');
        return p.active === 'true' ? 'Schedule switched on.' : 'Schedule paused.';
      }
      if (name === 'generate') {
        const n = await api.generateNow();
        return n > 0 ? `${n} task${n === 1 ? '' : 's'} made.` : 'Nothing new was due, so no tasks were made.';
      }
      if (name === 'create-schedule') {
        const f = {
          title: p.title,
          instructions: p.instructions,
          evidence: p.evidence,
          priority: p.priority,
          assignee: p.assignee,
          kind: p.kind,
          weekdays: (p.weekdays ?? []).map(Number),
          monthDay: p.monthDay,
          week: p.week,
        };
        const bad = checkSchedule(f);
        if (bad) throw Object.assign(new Error(bad.replace(/\.$/, '')), { code: '22023' });
        await api.createSchedule({ ...f, title: f.title.trim() });
        ui.forget = ['s-'];
        return 'Schedule created.';
      }
      return null;
    },
    view(data) {
      if (data.schedules === null) return html`<p class="home-empty">Only the owner can manage schedules.</p>`;
      return html`<div class="tk-buttons"><button class="btn" type="button" data-act="generate">Make today’s tasks now</button></div>
        ${
          data.schedules.length
            ? html`<ul class="tk-cards">
                ${data.schedules.map(
                  (s) =>
                    html`<li class="tk-card ${s.active ? '' : 'tk-paused'}">
                      <div class="tk-row">
                        <div class="tk-main">
                          <strong class="tk-title">${s.title}</strong>
                          <span class="tk-sub">${describeSchedule(s)} · ${s.assigneeName || 'Not assigned'} · ${EVIDENCE[s.evidence]}</span>
                        </div>
                        <span class="tk-chip ${s.active ? 'tk-ok' : 'tk-muted'}">${s.active ? 'On' : 'Paused'}</span>
                      </div>
                      <button class="btn" type="button" data-act="toggle-schedule" data-id="${s.id}" data-active="${!s.active}">
                        ${s.active ? 'Pause' : 'Switch on'}
                      </button>
                    </li>`,
                )}
              </ul>`
            : html`<p class="home-empty">No schedules yet.</p>`
        }
        <details class="tk-more tk-new" data-keep="new-schedule">
          <summary>New schedule</summary>
          <form class="tk-form" data-act="create-schedule">
            <label class="field"
              ><span>Title (needed)</span><input type="text" name="title" maxlength="120" required data-keep="s-title"
            /></label>
            <label class="field"
              ><span>Instructions</span><textarea name="instructions" rows="3" maxlength="2000" data-keep="s-instr"></textarea>
            </label>
            <label class="field"
              ><span>Repeats</span>
              <select name="kind" data-keep="s-kind">
                <option value="daily">Every day</option>
                <option value="weekly">On chosen weekdays</option>
                <option value="monthly">On a day of the month</option>
                <option value="nth_week">In a week of the month</option>
              </select></label
            >
            <fieldset class="tk-weekdays">
              <legend>Weekdays (for “chosen weekdays”)</legend>
              ${WEEKDAYS.map(([n, d]) => html`<label class="tk-check"><input type="checkbox" name="weekdays[]" value="${n}" data-keep="s-wd-${n}" /> <span>${d}</span></label>`)}
            </fieldset>
            <label class="field"
              ><span>Day of the month, 1 to 31 (for “a day of the month”)</span
              ><input type="number" name="monthDay" min="1" max="31" inputmode="numeric" data-keep="s-md"
            /></label>
            <label class="field"
              ><span>Week of the month, 1 to 5 (for “a week of the month”)</span
              ><input type="number" name="week" min="1" max="5" inputmode="numeric" data-keep="s-wk"
            /></label>
            <p class="muted">
              Week 1 is days 1 to 7, week 2 is days 8 to 14, week 3 is days 15 to 21, week 4 is days 22 to 28 and week 5 is day 29 to the
              end of the month. The task is due on the last day of that week.
            </p>
            <label class="field"
              ><span>What should the person hand in?</span>
              <select name="evidence" data-keep="s-evidence">
                ${Object.entries(EVIDENCE).map(([v, l]) => html`<option value="${v}">${l}</option>`)}
              </select></label
            >
            <label class="field"
              ><span>Priority</span
              ><select name="priority" data-keep="s-priority">
                <option value="normal">Normal</option>
                <option value="urgent">Urgent</option>
              </select></label
            >
            <label class="field"
              ><span>Give to</span>
              <select name="assignee" data-keep="s-assignee">
                <option value="">Nobody yet</option>
                ${data.staff.map((s) => html`<option value="${s.id}">${s.name}</option>`)}
              </select></label
            >
            <button class="btn btn-primary" type="submit">Create schedule</button>
            <p class="muted">Creating a schedule approves it.</p>
          </form>
        </details>`;
    },
  });
}
