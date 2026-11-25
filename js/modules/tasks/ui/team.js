// Team (Owner): each person's workload and a fair completion rate. The period is always shown next to the figure (D-65 (7)).
// Attendance is not part of this yet; it waits for the Android app (D-51).
import { html } from '../../../shared/html.js';
import { hero } from '../../../shared/ui.js';
import { shortDate } from '../../../shared/format.js';
import * as api from '../data/api.js';
import { normaliseTeam, rateText } from '../domain/tasks.js';
import { mountScreen } from './kit.js';

export async function mount(el) {
  mountScreen(el, {
    head: hero({ label: 'Tasks', title: 'Team', sub: 'Workload and completion rate, per person.' }),
    async load(ui) {
      ui.days ??= 30;
      const raw = await api.teamOverview(ui.days);
      return { team: normaliseTeam(raw), from: raw?.from ?? null, to: raw?.to ?? null };
    },
    act(name, p, ui) {
      if (name === 'period') ui.days = [7, 30, 90].includes(Number(p.days)) ? Number(p.days) : 30;
      return null;
    },
    view({ team, from, to }, ui) {
      if (team === null) return html`<p class="home-empty">Only the owner can see the team overview.</p>`;
      return html`<div class="tk-tabs" role="group" aria-label="Period">
          ${[7, 30, 90].map((d) => html`<button class="btn ${ui.days === d ? 'btn-primary' : ''}" type="button" data-act="period" data-days="${d}" aria-pressed="${ui.days === d}">${d} days</button>`)}
        </div>
        <p class="muted">
          Completion rate is for the ${team.days} days ${from && to ? `from ${shortDate(from)} to ${shortDate(to)}` : 'before today'}: tasks
          approved on or before their deadline, out of tasks that were due.
        </p>
        ${
          team.staff.length
            ? html`<div class="tk-table-wrap">
                <table class="tk-table">
                  <thead>
                    <tr>
                      <th scope="col">Person</th>
                      <th scope="col">Open</th>
                      <th scope="col">Overdue</th>
                      <th scope="col">To verify</th>
                      <th scope="col">Returned</th>
                      <th scope="col">Done</th>
                      <th scope="col">Completion rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${team.staff.map(
                      (s) =>
                        html`<tr>
                          <th scope="row">${s.name}</th>
                          <td>${s.open}</td>
                          <td class="${s.overdue ? 'tk-bad' : ''}">${s.overdue}</td>
                          <td>${s.verification}</td>
                          <td>${s.returned}</td>
                          <td>${s.completed}</td>
                          <td>${rateText(s)}</td>
                        </tr>`,
                    )}
                  </tbody>
                </table>
              </div>`
            : html`<p class="home-empty">No one has a login that can be given tasks yet.</p>`
        }`;
    },
  });
}
