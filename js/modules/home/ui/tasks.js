// Task Master on Home. Staff (tasks.view_own): My Work Snapshot and My Tasks. Owner (tasks.manage): Staff & Team.
// Read only: every figure is worked out by the database and each section links to the Tasks pages where work is done.
import { html, render } from '../../../shared/html.js';
import { createRefresher } from '../../../shared/refresh.js';
import { todayPkt } from '../../../shared/format.js';
import { myTaskList, myTaskSnapshot, taskPendingRequests, taskTeamOverview, taskVerificationQueue } from '../data/api.js';
import { freshness } from '../domain/ops.js';
import {
  dueText,
  groupMine,
  normaliseRequests,
  normaliseSnapshot,
  normaliseTasks,
  normaliseTeam,
  rateText,
  STATUS,
} from '../../tasks/domain/tasks.js';

const REFRESH_MS = 60_000;
const SHOWN = 5;

const statusLine = (state) => {
  const f = freshness(state);
  return html`<div class="ops-status ops-${f.tone}" role="status" aria-live="polite">
    <span>${f.text}</span>
    <button
      class="btn btn-sm"
      type="button"
      data-task-refresh
      ${state.status === 'loading' || state.status === 'refreshing' ? 'disabled' : ''}
    >
      Refresh
    </button>
  </div>`;
};
const stat = (label, n, tone = '') =>
  html`<div class="tk-count ${n && tone ? `tk-${tone}` : ''}"><strong>${n}</strong><span>${label}</span></div>`;

export function startTaskSections({ workHost, teamHost, perms }) {
  const wantsMine = Boolean(workHost) && perms.includes('tasks.view_own');
  const wantsTeam = Boolean(teamHost) && perms.includes('tasks.manage');
  if (!wantsMine && !wantsTeam) return null;
  const wantsVerify = wantsMine && perms.includes('tasks.verify');
  let refresher = null;
  let last = null;

  // A part that fails keeps its last good content marked stale; every part failing fails the refresh.
  async function load() {
    const jobs = [
      wantsMine ? myTaskSnapshot() : null,
      wantsMine ? myTaskList() : null,
      wantsVerify ? taskVerificationQueue() : null,
      wantsTeam ? taskTeamOverview(30) : null,
      wantsTeam ? taskPendingRequests() : null,
    ];
    const res = await Promise.allSettled(jobs.map((j) => j ?? Promise.resolve(null)));
    const asked = res.filter((_, i) => jobs[i]);
    if (asked.length && asked.every((r) => r.status === 'rejected')) throw asked[0].reason;
    const part = (i, old, make) => (res[i].status === 'fulfilled' ? make(res[i].value) : old?.ok ? { ...old, stale: true } : { ok: false });
    last = {
      snap: part(0, last?.snap, (v) => ({ ok: true, v: normaliseSnapshot(v) })),
      list: part(1, last?.list, (v) => ({ ok: true, v: normaliseTasks(v) })),
      verify: part(2, last?.verify, (v) => ({ ok: true, v: normaliseTasks(v) })),
      team: part(3, last?.team, (v) => ({ ok: true, v: normaliseTeam(v) })),
      requests: part(4, last?.requests, (v) => ({ ok: true, v: normaliseRequests(v) })),
    };
    return last;
  }

  const warn = (parts) =>
    parts.some((p) => p?.stale) ? html`<p class="note">Some of this could not be refreshed and may be out of date.</p>` : '';

  function drawWork(state) {
    const d = state.data;
    const snap = d?.snap?.ok ? d.snap.v : null;
    const list = d?.list?.ok ? d.list.v : null;
    if (d && snap === null && list === null && d.snap.ok) return render(workHost, html``); // tasks are not set up for this login: show nothing
    const today = todayPkt();
    const open = (list ?? []).filter((t) => t.rank >= 1 && t.rank <= 6);
    const ordered = groupMine(open).flatMap((g) => g.tasks);
    const waiting = d?.verify?.ok ? (d.verify.v ?? []).length : 0;
    render(
      workHost,
      html`<section class="home-section ops-section" aria-label="My work">
        <div class="home-section-head">
          <div>
            <span class="home-kicker">YOUR WORK</span>
            <h2>My work snapshot</h2>
          </div>
          <a class="home-text-link" href="#/tasks">All my tasks</a>
        </div>
        ${statusLine(state)} ${warn([d?.snap, d?.list])}
        ${(!d && state.status === 'error') || (d && !d.snap.ok && !d.list.ok) ? html`<p class="note note-error" role="status">Your tasks could not be loaded.</p>` : ''}
        ${
          snap
            ? html`<div class="tk-counts" role="group" aria-label="Your task numbers">
                ${stat('Overdue', snap.overdue, 'bad')}${stat('Due soon', snap.upcoming, 'warn')}${stat('To do', snap.pending)}${stat('Returned', snap.returned, 'bad')}${stat('Being checked', snap.awaiting_verification)}${stat(`Done (${snap.days} days)`, snap.completed, 'ok')}
              </div>`
            : ''
        }
        ${wantsVerify && waiting ? html`<p class="note"><a href="#/tasks/verify">${waiting} task${waiting === 1 ? ' is' : 's are'} waiting for you to check</a></p>` : ''}
        <h3 class="tk-h2">My tasks</h3>
        ${
          ordered.length
            ? html`<ul class="tk-cards tk-compact">
                  ${ordered.slice(0, SHOWN).map(
                    (t) =>
                      html`<li class="tk-card ${t.overdue ? 'tk-overdue' : ''}">
                        <div class="tk-row">
                          <div class="tk-main">
                            <strong class="tk-title"
                              >${t.priority === 'urgent' ? html`<span class="tk-urgent">Urgent</span> ` : ''}${t.title}</strong
                            ><span class="tk-sub">${dueText(t, today)}</span>
                          </div>
                          <span class="tk-chip tk-${STATUS[t.status].tone}">${STATUS[t.status].label}</span>
                        </div>
                      </li>`,
                  )}
                </ul>
                ${ordered.length > SHOWN ? html`<p class="bi-small">${ordered.length - SHOWN} more. <a href="#/tasks">See all</a></p>` : ''}`
            : d?.list?.ok
              ? html`<p class="home-empty">You have no tasks right now.</p>`
              : ''
        }
      </section>`,
    );
  }

  function drawTeam(state) {
    const d = state.data;
    const team = d?.team?.ok ? d.team.v : null;
    if (d?.team?.ok && team === null) return render(teamHost, html``); // not allowed: show nothing
    const reqs = d?.requests?.ok ? (d.requests.v ?? []).length : 0;
    render(
      teamHost,
      html`<section class="home-section ops-section" aria-label="Staff and team">
        <div class="home-section-head">
          <div>
            <span class="home-kicker">TEAM</span>
            <h2>Staff &amp; team</h2>
          </div>
          <a class="home-text-link" href="#/tasks/team">Open Team</a>
        </div>
        ${statusLine(state)} ${warn([d?.team, d?.requests])}
        ${(!d && state.status === 'error') || (d && !d.team.ok) ? html`<p class="note note-error" role="status">The team overview could not be loaded.</p>` : ''}
        ${reqs ? html`<p class="note"><a href="#/tasks/requests">${reqs} change request${reqs === 1 ? ' is' : 's are'} waiting for your decision</a></p>` : ''}
        ${
          team?.staff.length
            ? html`<div class="tk-table-wrap">
                  <table class="tk-table">
                    <caption class="tk-caption">
                      Tasks and completion rate, last ${team.days} days
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">Person</th>
                        <th scope="col">Open</th>
                        <th scope="col">Overdue</th>
                        <th scope="col">To verify</th>
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
                            <td>${rateText(s)}</td>
                          </tr>`,
                      )}
                    </tbody>
                  </table>
                </div>
                <p class="bi-small">Attendance is not shown yet. It will appear when the Android app is ready.</p>`
            : team
              ? html`<p class="home-empty">No one has a login that can be given tasks yet.</p>`
              : ''
        }
      </section>`,
    );
  }

  function draw(state) {
    const host = workHost ?? teamHost;
    if (!host.isConnected) return refresher?.stop();
    if (wantsMine) drawWork(state);
    if (wantsTeam) drawTeam(state);
  }

  refresher = createRefresher({
    load,
    onChange: draw,
    intervalMs: REFRESH_MS,
    staleAfterMs: 2 * REFRESH_MS + 60_000,
    isAlive: () => (workHost ?? teamHost).isConnected,
  });
  const onClick = (ev) => {
    if (ev.target.closest('[data-task-refresh]')) refresher.refresh();
  };
  workHost?.addEventListener('click', onClick);
  teamHost?.addEventListener('click', onClick);
  draw(refresher.getState());
  refresher.start();
  return refresher;
}
