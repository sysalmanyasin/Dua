// Staff sections on Home, in the agreed work-first order: My Payroll, then My Recent Activity. Each section appears only if
// the person holds the permission for it, reads only the caller's own records through the database, and is read only.
// (My Work Snapshot, My Tasks, My Attendance and My Reminders arrive with Task Master and the Android app.)
import { html, render } from '../../../shared/html.js';
import { createRefresher } from '../../../shared/refresh.js';
import { money } from '../../../shared/format.js';
import { myPayslips, myRecentClosings } from '../data/api.js';
import { clockTime, freshness, timeAgo } from '../domain/ops.js';
import { normaliseMyClosings, normalisePayslips } from '../domain/staff.js';

const REFRESH_MS = 5 * 60_000;
const canSeeClosings = (perms) => ['closing.enter_own', 'closing.correct', 'closing.settings'].some((p) => perms.includes(p));

export function startStaffSections({ payrollHost, activityHost, perms }) {
  const wantsPay = perms.includes('payroll.view_own');
  const wantsActivity = canSeeClosings(perms);
  if (!wantsPay && !wantsActivity) return null;
  let refresher = null;

  // One part failing keeps its last good content, marked stale; both failing fails the whole refresh.
  let last = null;
  async function load() {
    const [p, a] = await Promise.allSettled([
      wantsPay ? myPayslips(3) : Promise.resolve(null),
      wantsActivity ? myRecentClosings(10) : Promise.resolve(null),
    ]);
    if (p.status === 'rejected' && a.status === 'rejected') throw p.reason;
    const part = (res, old, make) => (res.status === 'fulfilled' ? make(res.value) : old?.ok ? { ...old, stale: true } : { ok: false });
    last = {
      pay: part(p, last?.pay, (v) => ({ ok: true, allowed: v !== null, rows: normalisePayslips(v) })),
      activity: part(a, last?.activity, (v) => ({ ok: true, allowed: v !== null, rows: normaliseMyClosings(v) })),
    };
    return last;
  }

  const status = (state) => {
    const partlyStale = state.status === 'ok' && state.data && Object.values(state.data).some((x) => x?.stale);
    const f = partlyStale
      ? { tone: 'warn', text: `Updated ${clockTime(state.lastSuccess)}. Some figures could not be refreshed and may be out of date.` }
      : freshness(state);
    return html`<div class="ops-status ops-${f.tone}" role="status" aria-live="polite">
      <span>${f.text}</span>
      <button
        class="btn btn-sm"
        type="button"
        data-staff-refresh
        ${state.status === 'loading' || state.status === 'refreshing' ? 'disabled' : ''}
      >
        Refresh
      </button>
    </div>`;
  };

  const slipLine = (label, value, sign = '') =>
    html`<tr>
      <th scope="row">${label}</th>
      <td>${sign}Rs ${money(Math.abs(value))}</td>
    </tr>`;
  const slip = (s) =>
    html`<table class="staff-slip">
      <caption>
        ${s.label}
      </caption>
      <tbody>
        ${slipLine('Salary', s.base)} ${s.advance ? slipLine('Advance deducted', s.advance, '−') : ''}
        ${s.incentive ? slipLine('Incentive', s.incentive, '+') : ''}
        ${s.other.map((o) => slipLine(o.name, o.amount, o.sign < 0 ? '−' : '+'))}
        <tr class="staff-slip-net">
          <th scope="row">Take-home</th>
          <td>Rs ${money(s.net)}</td>
        </tr>
      </tbody>
    </table>`;

  function draw(state) {
    if (!payrollHost.isConnected) return refresher?.stop();
    const pay = state.data?.pay;
    if (wantsPay && !(pay?.ok && !pay.allowed)) {
      const rows = pay?.ok ? pay.rows : [];
      render(
        payrollHost,
        html`<section class="home-section ops-section" aria-label="My payroll">
          <div class="home-section-head">
            <div>
              <span class="home-kicker">PRIVATE</span>
              <h2>My payroll</h2>
            </div>
          </div>
          ${status(state)} ${pay && !pay.ok ? html`<p class="note note-error" role="status">Your payslip could not be loaded.</p>` : ''}
          ${
            rows.length
              ? html`${slip(rows[0])}
                ${
                  rows.length > 1
                    ? html`<details class="staff-earlier">
                        <summary>Earlier months</summary>
                        ${rows.slice(1).map(slip)}
                      </details>`
                    : ''
                }`
              : pay?.ok
                ? html`<p class="home-empty">No payslip yet. A month appears here after the owner closes it.</p>`
                : ''
          }
          <p class="bi-small">Only you can see this. It cannot be changed here.</p>
        </section>`,
      );
    } else render(payrollHost, html``);

    const act = state.data?.activity;
    if (wantsActivity && !(act?.ok && !act.allowed)) {
      const rows = act?.ok ? act.rows : [];
      render(
        activityHost,
        html`<section class="home-section ops-section" aria-label="My recent activity">
          <div class="home-section-head">
            <div>
              <span class="home-kicker">YOUR WORK</span>
              <h2>My recent activity</h2>
            </div>
          </div>
          ${act && !act.ok ? html`<p class="note note-error" role="status">Your recent activity could not be loaded.</p>` : ''}
          ${
            rows.length
              ? html`<ul class="ops-activity">
                  ${rows.map(
                    (r) =>
                      html`<li>
                        <span class="ops-when">${r.at ? timeAgo(r.at, Date.now()) : ''}</span>
                        <span
                          ><strong>${r.title}</strong><small>${r.status}${r.revision > 1 ? ` · correction ${r.revision}` : ''}</small></span
                        >
                        <a class="home-text-link" href="#/closing">Open</a>
                      </li>`,
                  )}
                </ul>`
              : act?.ok
                ? html`<p class="home-empty">Nothing yet. Your saved and submitted closings will show here.</p>`
                : ''
          }
        </section>`,
      );
    } else render(activityHost, html``);
  }

  refresher = createRefresher({
    load,
    onChange: draw,
    intervalMs: REFRESH_MS,
    staleAfterMs: 2 * REFRESH_MS + 60_000,
    isAlive: () => payrollHost.isConnected,
  });
  const onClick = (ev) => {
    if (ev.target.closest('[data-staff-refresh]')) refresher.refresh();
  };
  payrollHost.addEventListener('click', onClick);
  activityHost.addEventListener('click', onClick);
  draw(refresher.getState());
  refresher.start();
  return refresher;
}
