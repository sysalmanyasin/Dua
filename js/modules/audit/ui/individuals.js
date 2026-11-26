// Individual audits of one month. Two screens share this page: Monthly Overview (who took part, how far the month is, what is
// outstanding) and Rounds & Progress (each person's rounds, counting progress, and the way to review or keep counting).
// Variance figures are shown round by round and never added across rounds: the same item counted again would be counted twice.
import { html, render } from '../../../shared/html.js';
import { hero } from '../../../shared/ui.js';
import { money } from '../../../shared/format.js';
import * as api from '../data/api.js';
import { friendlyError } from '../domain/errors.js';
import { currentMonth, flatRounds, monthChoices, overviewGroups } from '../domain/history.js';
import { getGroup, getMonth, setGroup, setMonth, setView } from '../domain/nav.js';
import { applyProgressBars, crumbs, errorCard, loadingCard, progressBar } from './parts.js';
import { openRoundProgress } from './roundProgress.js';

const MAX_PROGRESS_READS = 20; // rounds still counting whose progress is read

export async function mount(el, { ctx, screen = 'rounds' } = {}) {
  const overview = screen === 'overview';
  const months = monthChoices();
  const start = getMonth();
  const s = {
    month: start && months.some((m) => m.value === start) ? start : currentMonth(),
    groups: null,
    error: '',
    progress: {}, // round id -> { counted, items } for rounds still counting
    mine: null, // the person's own open Individual round, if any
    grouped: getGroup(), // Rounds & Progress: one list, newest first (default), or grouped by person
  };
  const perms = new Set(ctx?.permissions ?? []);

  const summary = () => {
    const rounds = (s.groups ?? []).flatMap((g) => g.rounds);
    const done = rounds.filter((r) => r.done).length;
    return { people: s.groups.length, rounds: rounds.length, done, counting: rounds.length - done };
  };

  const overviewBody = () => {
    const t = summary();
    const percent = t.rounds ? Math.round((t.done / t.rounds) * 100) : 0;
    const outstanding = s.groups.filter((g) => g.waiting > 0);
    return html`<section class="card aud-card" aria-label="Month progress" data-sec="month-progress">
        <h2>Month progress</h2>
        <p data-month-summary>
          ${t.people} ${t.people === 1 ? 'person' : 'people'} · ${t.rounds} ${t.rounds === 1 ? 'round' : 'rounds'} · ${t.done} done ·
          ${t.counting} still counting
        </p>
        ${progressBar(percent)}
      </section>
      <section class="card aud-card" aria-label="Staff" data-sec="staff">
        <h2>Staff</h2>
        <ul class="aud-list">
          ${s.groups.map(
            (p) =>
              html`<li data-person>
                <span>
                  <strong>${p.name}</strong><br />
                  <span class="muted small">${p.total} ${p.total === 1 ? 'audit' : 'audits'} · ${p.total - p.waiting} done</span>
                </span>
                <span class="aud-badge ${p.waiting ? 'aud-badge-counting' : ''}"
                  >${p.waiting ? `${p.waiting} still counting` : 'All done'}</span
                >
              </li>`,
          )}
        </ul>
      </section>
      <section class="card aud-card" aria-label="Outstanding work" data-sec="outstanding">
        <h2>Outstanding work</h2>
        ${
          outstanding.length
            ? html`<ul class="aud-list">
                  ${outstanding.map(
                    (p) =>
                      html`<li data-outstanding>
                        <span>${p.name} <span class="muted small">${p.waiting} not finished</span></span>
                      </li>`,
                  )}
                </ul>
                <a class="btn btn-sm" href="#/audit/individual-rounds">See rounds &amp; progress</a>`
            : html`<p class="muted" data-nothing-outstanding>Every round this month is finished.</p>`
        }
      </section>`;
  };

  const roundRow = (r, showPerson = false) => {
    const p = s.progress[r.roundId];
    let line;
    if (r.done)
      line = `${r.items} items · ${r.differences} ${r.differences === 1 ? 'difference' : 'differences'} (${money(r.value, { decimals: true })})`;
    else if (p) line = `Counting: ${p.counted} of ${p.items} counted`;
    else line = 'Not compiled yet';
    const percent = !r.done && p && p.items > 0 ? Math.round((p.counted / p.items) * 100) : null;
    const isMine = s.mine && s.mine.roundId === r.roundId;
    return html`<li data-round>
      <span>
        <strong>Round ${r.label}</strong>${showPerson ? html` <span data-round-person>· ${r.personName}</span>` : ''}
        <span class="muted small">${r.stateLabel}${r.day ? ` · ${r.day}` : ''}</span>
        ${r.scope ? html`<span class="small" data-round-scope>${r.scope}</span>` : ''}
        <span class="small">${line}</span>
        ${percent !== null ? progressBar(percent) : ''}
      </span>
      ${
        r.done
          ? html`<button
              type="button"
              class="btn btn-sm"
              data-open
              data-e="${r.engagementId}"
              data-r="${r.roundId}"
              data-state="${r.state}"
            >
              Review
            </button>`
          : html`<span class="aud-row-actions">
              <button
                type="button"
                class="btn btn-sm"
                data-live-progress
                data-r="${r.roundId}"
                data-title="${`Round ${r.label}${showPerson ? ` · ${r.personName}` : ''}`}"
              >
                Live progress
              </button>
              ${isMine ? html`<a class="btn btn-sm btn-primary" href="#/audit/individual" data-continue>Continue counting</a>` : ''}
            </span>`
      }
    </li>`;
  };

  // the way to begin: first thing under the title on Monthly Overview, or the way back into the round already open
  const startCard = () => {
    if (s.mine)
      return html`<section class="aud-start" aria-label="Your open round" data-start-card="continue">
        <div>
          <strong>You have a round open</strong>
          <span class="aud-start-hint">Pick up where you stopped.</span>
        </div>
        <a class="btn btn-primary" href="#/audit/individual" data-continue>Continue counting</a>
      </section>`;
    if (!perms.has('audit.individual')) return '';
    return html`<section class="aud-start" aria-label="Start an individual audit" data-start-card="start">
      <div>
        <strong>Start an individual audit</strong>
        <span class="aud-start-hint">Choose a company or a template and count it yourself.</span>
      </div>
      <a class="btn btn-primary" href="#/audit/individual" data-start>Start</a>
    </section>`;
  };

  const roundsBody = () => (s.grouped ? groupedRounds() : flatList());

  // one list for the month, the newest round first, each row naming its person
  const flatList = () =>
    html`<section class="card aud-card" aria-label="Rounds" data-sec="rounds-flat">
      <h2>Rounds</h2>
      <p class="muted small">${s.groups.reduce((n, g) => n + g.total, 0)} in this month, newest first</p>
      <ul class="aud-list">
        ${flatRounds(s.groups).map((r) => roundRow(r, true))}
      </ul>
    </section>`;

  const groupedRounds = () =>
    s.groups.map(
      (p) =>
        html`<section class="card aud-card" aria-label="${p.name}" data-person>
          <h2>${p.name}</h2>
          <p class="muted small">${p.total} ${p.total === 1 ? 'audit' : 'audits'}${p.waiting ? ` · ${p.waiting} not finished` : ''}</p>
          <ul class="aud-list">
            ${flatRounds([p]).map((r) => roundRow(r))}
          </ul>
        </section>`,
    );

  const draw = () => {
    let body;
    if (s.error) body = errorCard('this month', s.error);
    else if (s.groups === null) body = loadingCard();
    else if (s.groups.length === 0)
      body = html`<div class="card aud-card"><p class="muted" data-empty>Nobody has counted an Individual audit in this month.</p></div>`;
    else body = overview ? overviewBody() : roundsBody();
    render(
      el,
      html`<div class="aud">
        ${crumbs([{ label: 'Individual audits', href: '#/audit/individuals' }, { label: overview ? 'Monthly overview' : 'Rounds & progress' }])}
        ${hero({
          label: 'Audit',
          title: overview ? 'Monthly overview' : 'Rounds & progress',
          sub: overview ? 'Who took part this month and what is still outstanding.' : 'Each person’s rounds, and how they are going.',
        })}
        ${overview ? startCard() : ''}
        <section class="card aud-card" aria-label="Month">
          <label
            ><span>Month</span>
            <select data-s="month">
              ${months.map((m) => html`<option value="${m.value}" ${m.value === s.month ? 'selected' : ''}>${m.label}</option>`)}
            </select>
          </label>
          ${
            overview
              ? ''
              : html`<label class="aud-check"
                  ><input type="checkbox" role="switch" data-group ${s.grouped ? 'checked' : ''} /> <span>Group by people</span></label
                >`
          }
          ${
            !overview && s.mine
              ? html`<p data-own-open>
                  You have a round open. <a class="btn btn-sm btn-primary" href="#/audit/individual">Continue counting</a>
                </p>`
              : ''
          }
        </section>
        ${body}
      </div>`,
    );
    applyProgressBars(el);
  };

  // counting progress of the rounds still counting, read one by one and tolerated if it fails (progress is a convenience)
  const loadProgress = async (asked) => {
    const counting = (s.groups ?? [])
      .flatMap((g) => g.rounds)
      .filter((r) => !r.done)
      .slice(0, MAX_PROGRESS_READS);
    const reads = await Promise.allSettled(counting.map((r) => api.compileOverview(r.roundId)));
    if (asked !== s.month) return;
    counting.forEach((r, i) => {
      if (reads[i].status !== 'fulfilled') return;
      const list = (reads[i].value?.assignments ?? []).filter((a) => a.status !== 'revoked');
      s.progress[r.roundId] = {
        counted: list.reduce((n, a) => n + Number(a.counted || 0), 0),
        items: list.reduce((n, a) => n + Number(a.items || 0), 0),
      };
    });
  };

  const findMine = async () => {
    if (!perms.has('audit.individual')) return null;
    try {
      const rows = await api.myAssignments();
      const open = rows.find((a) => a.method === 'individual-self-pick' && a.status !== 'submitted' && a.status !== 'revoked');
      return open ? { roundId: open.round_id ?? null } : null;
    } catch {
      return null;
    }
  };

  const load = async () => {
    s.groups = null;
    s.error = '';
    s.progress = {};
    draw();
    const asked = s.month;
    try {
      const rows = await api.individualOverview(asked);
      if (asked !== s.month) return;
      s.groups = overviewGroups(rows);
    } catch (e) {
      if (asked !== s.month) return;
      s.error = friendlyError(e).message;
    }
    draw();
    if (s.error || asked !== s.month) return;
    s.mine = await findMine();
    if (overview) return draw();
    await loadProgress(asked);
    if (asked === s.month) draw();
  };

  el.onchange = (e) => {
    const box = e.target.closest('input[data-group]');
    if (box) {
      s.grouped = box.checked;
      setGroup(s.grouped);
      return draw();
    }
    const sel = e.target.closest('select[data-s="month"]');
    if (!sel) return;
    s.month = sel.value;
    setMonth(s.month);
    load();
  };
  el.onclick = (e) => {
    const live = e.target.closest('button[data-live-progress]');
    if (live) return void openRoundProgress({ roundId: live.dataset.r, title: live.dataset.title });
    const b = e.target.closest('button[data-open]');
    if (!b) return;
    setView({ engagement: b.dataset.e, round: b.dataset.r });
    location.hash = b.dataset.state === 'final' ? '#/audit/final' : '#/audit/individual-review';
  };
  await load();
}
