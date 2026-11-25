// Individual Audit reports for one month: each round's variance report, each person's rounds, and the combined monthly report.
// Everything is round by round; nothing is added across rounds (see combinedReport.js). Reads are the existing ones, so the
// database decides who sees what.
import { html, render } from '../../../shared/html.js';
import { hero } from '../../../shared/ui.js';
import { monthLabel, money } from '../../../shared/format.js';
import * as api from '../data/api.js';
import { friendlyError } from '../domain/errors.js';
import { currentMonth, flatRounds, monthChoices, overviewGroups } from '../domain/history.js';
import { getGroup, getMonth, setGroup, setMonth, setView } from '../domain/nav.js';
import { mountCombinedReport } from './combinedReport.js';
import { exportAllRounds, exportRound } from './exports.js';
import { crumbs, errorCard, loadingCard } from './parts.js';

const monthName = (m) => monthLabel(`${m}-01`);

export async function mount(el) {
  const months = monthChoices();
  const start = getMonth();
  const s = {
    month: start && months.some((m) => m.value === start) ? start : currentMonth(),
    groups: null,
    error: '',
    busy: '',
    note: '',
    grouped: getGroup(), // one list, newest first (default), or grouped by person; shared with Rounds & Progress
    combined: null,
  };
  const auditName = () => `Individual audits ${monthName(s.month)}`;
  const asRound = (r) => ({ id: r.roundId, label: r.label, state: r.state, items: r.items ?? 0 });

  const roundLine = (r) =>
    r.done
      ? `${r.items} items · ${r.differences} ${r.differences === 1 ? 'difference' : 'differences'} (${money(r.value, { decimals: true })})`
      : 'Not compiled yet';

  // one round's row: its label (and person when the list is not grouped), what it was started from, how it came out, its files
  const roundRow = (r, showPerson) =>
    html`<li data-round>
      <span>
        <strong>Round ${r.label}</strong>${showPerson ? html` <span data-round-person>· ${r.personName}</span>` : ''}
        <span class="muted small">${r.stateLabel}${r.day ? ` · ${r.day}` : ''}</span><br />
        ${r.scope ? html`<span class="small" data-round-scope>${r.scope}</span><br />` : ''}
        <span class="small">${roundLine(r)}</span>
      </span>
      ${
        r.done
          ? html`<span class="aud-actions">
              <button type="button" class="btn btn-sm" data-round-file="${r.roundId}" ${s.busy ? 'disabled' : ''}>CSV</button>
              <button type="button" class="btn btn-sm" data-open data-e="${r.engagementId}" data-r="${r.roundId}" data-state="${r.state}">
                Review
              </button>
            </span>`
          : ''
      }
    </li>`;

  const staffSection = (p) =>
    html`<section class="card aud-card" aria-label="${p.name}" data-person>
      <div class="aud-section-head">
        <h2>${p.name}</h2>
        ${
          p.rounds.some((r) => r.done)
            ? html`<button type="button" class="btn btn-sm" data-person-file="${p.id}" ${s.busy ? 'disabled' : ''}>
                Download rounds (CSV)
              </button>`
            : ''
        }
      </div>
      <ul class="aud-list">
        ${flatRounds([p]).map((r) => roundRow(r, false))}
      </ul>
    </section>`;

  const flatSection = () =>
    html`<section class="card aud-card" aria-label="Rounds" data-sec="rounds-flat">
      <h2>Rounds</h2>
      <p class="muted small">${s.groups.reduce((n, g) => n + g.total, 0)} in this month, newest first</p>
      <ul class="aud-list">
        ${flatRounds(s.groups).map((r) => roundRow(r, true))}
      </ul>
    </section>`;

  // The combined report is built once per month and put back after every redraw, so what was picked or shown is not lost
  // when a file is being prepared.
  const buildCombined = () => {
    s.combined = document.createElement('div');
    const rounds = flatRounds(s.groups).map((r) => ({ ...asRound(r), who: [r.personName, r.scope].filter(Boolean).join(' · ') }));
    mountCombinedReport(s.combined, { auditName: auditName(), rounds });
  };

  const draw = () => {
    let body;
    if (s.error) body = errorCard('this month', s.error);
    else if (s.groups === null) body = loadingCard();
    else if (s.groups.length === 0)
      body = html`<div class="card aud-card"><p class="muted" data-empty>Nobody has counted an Individual audit in this month.</p></div>`;
    else
      body = html`<div data-combined-host></div>
        ${s.grouped ? s.groups.map(staffSection) : flatSection()}`;
    render(
      el,
      html`<div class="aud">
        ${crumbs([{ label: 'Individual audits', href: '#/audit/individuals' }, { label: 'Reports' }])}
        ${hero({ label: 'Audit', title: 'Individual audit reports', sub: 'Each round, each person, and the whole month, round by round.' })}
        <section class="card aud-card" aria-label="Month">
          <label
            ><span>Month</span>
            <select data-s="month">
              ${months.map((m) => html`<option value="${m.value}" ${m.value === s.month ? 'selected' : ''}>${m.label}</option>`)}
            </select>
          </label>
          <label class="aud-check"
            ><input type="checkbox" role="switch" data-group ${s.grouped ? 'checked' : ''} /> <span>Group by people</span></label
          >
          <p class="muted small" aria-live="polite" data-status>${s.busy}</p>
          ${s.note ? html`<p class="note note-error" role="alert">${s.note}</p>` : ''}
        </section>
        ${body}
      </div>`,
    );
    const host = el.querySelector('[data-combined-host]');
    if (host && s.combined) host.replaceWith(s.combined);
  };

  const load = async () => {
    s.groups = null;
    s.error = '';
    s.note = '';
    draw();
    const asked = s.month;
    try {
      const rows = await api.individualOverview(asked);
      if (asked !== s.month) return;
      s.groups = overviewGroups(rows);
      buildCombined();
    } catch (e) {
      if (asked !== s.month) return;
      s.error = friendlyError(e).message;
    }
    draw();
  };

  const run = async (text, job) => {
    if (s.busy) return;
    s.busy = text;
    s.note = '';
    draw();
    try {
      await job();
    } catch (e) {
      s.note = friendlyError(e).message;
    }
    s.busy = '';
    draw();
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
    const open = e.target.closest('button[data-open]');
    if (open) {
      setView({ engagement: open.dataset.e, round: open.dataset.r });
      location.hash = open.dataset.state === 'final' ? '#/audit/final' : '#/audit/individual-review';
      return;
    }
    const roundBtn = e.target.closest('button[data-round-file]');
    if (roundBtn) {
      const round = s.groups.flatMap((g) => g.rounds).find((r) => r.roundId === roundBtn.dataset.roundFile);
      if (round) run('Preparing the file…', () => exportRound(auditName(), asRound(round), 'variance'));
      return;
    }
    const personBtn = e.target.closest('button[data-person-file]');
    if (personBtn) {
      const person = s.groups.find((g) => g.id === personBtn.dataset.personFile);
      if (person)
        run('Preparing the file…', () =>
          exportAllRounds(`${auditName()} ${person.name}`, person.rounds.map(asRound), 'combined', (t) => (s.busy = t)),
        );
    }
  };
  await load();
}
