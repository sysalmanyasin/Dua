// Audit Overview. Exactly five sections: Main actions (three cards), Product Search, Pending Actions, Individual Audit, Active Team Audit.
// A permission-filtered presentation of existing Audit reads; the database and its row-level security remain authoritative.
import { html, render } from '../../../shared/html.js';
import { monthLabel } from '../../../shared/format.js';
import * as api from '../data/api.js';
import { friendlyError } from '../domain/errors.js';
import { currentMonth } from '../domain/history.js';
import { activeTeamAudit, individualCard, pendingActions, quickActions } from '../domain/overview.js';
import { setView } from '../domain/nav.js';
import manifest from '../manifest.js';
import { applyProgressBars, loadingCard, progressBar } from './parts.js';
import { mountProductSearch } from './productSearch.js';
import { installSignOutGuard } from './signoutGuard.js';

const MAX_OPEN_AUDITS = 6; // open audits whose rounds are read
const MAX_COMPILED_ROUNDS = 12; // compiled rounds checked for corrections not yet recompiled

const STATUS = {
  open: 'Open',
  archived: 'Archived',
  closed: 'Closed',
  draft: 'Draft',
  locked: 'Locked',
  counting: 'Counting',
  compiled: 'Compiled',
  final: 'Finalized',
  assigned: 'Not started',
  submitted: 'Submitted',
  revoked: 'Revoked',
};
const statusLabel = (status) => STATUS[status] ?? String(status ?? 'Unknown').replaceAll('_', ' ');
const monthName = (m) => monthLabel(`${m}-01`);
const bar = progressBar;

// glyphs are drawn here so the three cards read at a glance; they are decoration, the label carries the meaning
const GLYPH = {
  individual: html`<svg viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" />
  </svg>`,
  count: html`<svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M5 12l4.5 4.5L19 7" />
    <rect x="3" y="3" width="18" height="18" rx="5" />
  </svg>`,
  expiry: html`<svg viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="13" r="8" />
    <path d="M12 9v4.5l3 2M9 2h6" />
  </svg>`,
};

/** The three main actions as cards. "Continue counting" shows how far the open round has got, when there is one. */
function quickSection(chips, open) {
  if (!chips.length) return '';
  return html`<section class="aud-quick" aria-label="Main actions" data-section="quick">
    ${chips.map((c) => {
      const live = c.key === 'count' && open;
      const percent = live && open.items ? Math.round((open.counted / open.items) * 100) : null;
      return html`<a class="aud-action aud-action-${c.key}" href="#${c.path}" data-chip="${c.key}" ${live ? 'data-live' : ''}>
        <span class="aud-action-icon">${GLYPH[c.key]}</span>
        <span class="aud-action-text">
          <strong>${c.label}</strong>
          <span class="aud-action-hint" ${live ? 'data-live-hint' : ''}
            >${live ? `${open.counted.toLocaleString()} of ${open.items.toLocaleString()} counted${percent !== null ? ` · ${percent}%` : ''}` : c.hint}</span
          >
        </span>
        <span class="aud-action-go" aria-hidden="true">›</span>
      </a>`;
    })}
  </section>`;
}

function pendingList(items) {
  return html`<ul class="aud-list aud-pending">
    ${items.map(
      (i) =>
        html`<li data-pending="${i.kind}">
          <span>
            <strong>${i.engagementName}</strong>${i.label ? html` <span class="muted small">Round ${i.label}</span>` : ''}<br />
            <span class="small">${i.text}</span>
          </span>
          <a class="btn btn-sm" href="#${i.path}" data-e="${i.engagementId}" data-r="${i.roundId}" data-open-item>Open</a>
        </li>`,
    )}
  </ul>`;
}

function pendingSection(items, error) {
  return html`<section class="card aud-card" aria-label="Pending actions" data-section="pending">
    <h2>Pending actions ${items.length ? html`<span class="aud-badge" data-pending-count>${items.length}</span>` : ''}</h2>
    ${error ? html`<p class="note note-error" role="alert">Could not load everything: ${error}</p>` : ''}
    ${items.length ? pendingList(items) : error ? '' : html`<p class="aud-empty" data-empty>Nothing is waiting for you.</p>`}
  </section>`;
}

function individualSection(card, error, ownOnly) {
  let body;
  if (error) body = html`<p class="note note-error" role="alert">Could not load this month: ${error}</p>`;
  else if (ownOnly) body = html`<p class="muted small">Start an individual audit, or pick up the one you have open.</p>`;
  else if (card.rounds === 0) body = html`<p class="aud-empty">Nobody has counted an individual audit in ${monthName(card.month)} yet.</p>`;
  else {
    body = html`<p class="small" data-individual-summary>
        ${monthName(card.month)}: ${card.people} ${card.people === 1 ? 'person' : 'people'} · ${card.rounds}
        ${card.rounds === 1 ? 'round' : 'rounds'} · ${card.finished} done · ${card.notFinished} still counting
      </p>
      ${bar(Math.round((card.finished / card.rounds) * 100))}
      ${
        card.waiting.length
          ? html`<p class="muted small" data-individual-waiting>
              Still counting: ${card.waiting.map((w) => `${w.name}${w.waiting > 1 ? ` (${w.waiting})` : ''}`).join(', ')}
            </p>`
          : ''
      }`;
  }
  const action = card.action;
  return html`<section class="card aud-card" aria-label="Individual audit" data-section="individual">
    <div class="aud-section-head">
      <h2>Individual audit</h2>
      ${action ? html`<a class="btn btn-sm ${action.primary ? 'btn-primary' : ''}" href="#${action.path}" data-individual-action>${action.label}</a>` : ''}
    </div>
    ${body}
  </section>`;
}

function assignmentCard(a) {
  const items = Number(a.items) || 0;
  const counted = Math.min(items, Number(a.counted) || 0);
  const percent = items ? Math.round((counted / items) * 100) : 0;
  const round = `${a.round_number ?? ''}${a.round_suffix ?? ''}`;
  const active = a.round_state === 'counting' && a.status !== 'submitted';
  return html`<article class="aud-work-item">
    <div class="aud-work-main">
      <div class="aud-work-title">
        <strong>${a.engagement_name || 'Audit assignment'}</strong>
        <span class="aud-badge aud-badge-${a.status}">${statusLabel(a.status)}</span>
      </div>
      <p class="muted small">
        ${round ? `Round ${round} · ` : ''}${statusLabel(a.round_state)} · ${counted.toLocaleString()} of ${items.toLocaleString()} counted
      </p>
      ${bar(percent)}
      <p class="muted small">${Math.max(0, items - counted).toLocaleString()} remaining · ${percent}% complete</p>
    </div>
    <a class="btn btn-sm ${active ? 'btn-primary' : ''}" href="#/audit/count" data-open-assignment="${a.assignment_id}"
      >${active ? 'Continue counting' : 'Open my work'}</a
    >
  </article>`;
}

function teamBody({ audit, error }) {
  if (error) return html`<p class="note note-error" role="alert">Could not load audits: ${error}</p>`;
  if (!audit) return html`<p class="aud-empty">There is no active team audit.</p>`;
  let progress = '';
  if (audit.percent !== null) {
    progress = html`${bar(audit.percent)}
      <p class="muted small" data-team-progress>${audit.submitted} of ${audit.total} submitted</p>`;
  } else if (audit.total) {
    progress = html`<p class="muted small">${audit.total} ${audit.total === 1 ? 'person' : 'people'} assigned</p>`;
  }
  return html`<p><strong>${audit.name}</strong></p>
    <p class="muted small" data-team-summary>
      ${audit.roundLabel ? `Round ${audit.roundLabel} · ` : ''}${audit.stateLabel}${audit.rounds > 1 ? ` · ${audit.rounds} rounds so far` : ''}
    </p>
    ${progress} ${audit.pending.length ? html`<p class="small" data-team-pending>Needs attention: ${audit.pending.join(' · ')}</p>` : ''}`;
}

function teamSection({ audit, mine, error, mineError, canView }) {
  let body;
  if (canView) body = teamBody({ audit, error });
  else if (mineError) body = html`<p class="note note-error" role="alert">Could not load your assignments: ${mineError}</p>`;
  else if (mine.length) body = html`<div class="aud-work-list">${mine.slice(0, 5).map(assignmentCard)}</div>`;
  else body = html`<p class="aud-empty">No counting assignments are currently assigned to you.</p>`;
  const action = canView && audit?.action;
  return html`<section class="card aud-card" aria-label="Active team audit" data-section="team">
    <div class="aud-section-head">
      <h2>${canView ? 'Active team audit' : 'My team audit work'}</h2>
      ${
        action
          ? html`<a
              class="btn btn-sm btn-primary"
              href="#${action.path}"
              data-e="${audit.engagementId}"
              data-r="${audit.roundId ?? ''}"
              data-open-item
              >${action.label}</a
            >`
          : ''
      }
    </div>
    ${body}
  </section>`;
}

// The compile overview of each compiled round (newest audits first, bounded), to find corrections approved but not yet compiled in.
async function checkCompiled(open, overviews) {
  const rounds = open.flatMap((e) =>
    (overviews.get(e.id)?.rounds ?? [])
      .filter((r) => r.state === 'compiled')
      .map((r) => ({
        engagementId: e.id,
        engagementName: e.name,
        scopeType: e.scope_type,
        label: `${r.round_number}${r.round_suffix ?? ''}`,
        roundId: r.id,
      })),
  );
  const slice = rounds.slice(0, MAX_COMPILED_ROUNDS);
  const results = await Promise.allSettled(slice.map((r) => api.compileOverview(r.roundId)));
  return slice.map((r, i) => ({ ...r, overview: results[i].status === 'fulfilled' ? results[i].value : null }));
}

export async function mount(el, { ctx } = {}) {
  const perms = new Set(ctx?.permissions ?? []);
  const has = (k) => perms.has(k) || perms.has('audit.manage');
  const canCount = perms.has('audit.count');
  const canIndividual = perms.has('audit.individual');
  const canView = perms.has('audit.view') || perms.has('audit.manage');
  const canSearch = perms.has('audit.view') || perms.has('audit.review') || perms.has('audit.report');
  const canAttention = perms.has('audit.compile') || perms.has('audit.review');
  const canRecheck = has('audit.compile') || has('audit.finalize');
  installSignOutGuard(); // unsent count events must remain protected (AUD-9)
  render(el, loadingCard());

  const month = currentMonth();
  const failed = {};
  const keep = (key) => (error) => {
    failed[key] = friendlyError(error).message;
    return null;
  };

  const [mineRows, engagementRows, attention, monthRows] = await Promise.all([
    canCount || canIndividual ? api.myAssignments().catch(keep('mine')) : null,
    canView ? api.listEngagements(20).catch(keep('engagements')) : null,
    canAttention ? api.attentionSummary().catch(keep('attention')) : null,
    canView ? api.individualOverview(month).catch(keep('month')) : null,
  ]);
  const mine = (mineRows ?? []).filter((a) => a.status !== 'revoked');
  const engagements = engagementRows ?? [];
  const scopeOf = (id) => engagements.find((e) => e.id === id)?.scope_type ?? null;

  // second step: the rounds of the open audits, then what is compiled in them and the people on the latest team round
  const open = engagements.filter((e) => e.status === 'open').slice(0, MAX_OPEN_AUDITS);
  const settled = await Promise.allSettled(open.map((e) => api.engagementOverview(e.id)));
  const overviews = new Map();
  open.forEach((e, i) => {
    if (settled[i].status === 'fulfilled') overviews.set(e.id, settled[i].value);
  });
  const first = activeTeamAudit({ engagements, overviews, permissions: perms });
  const [teamRound, checks] = await Promise.all([
    canView && first?.roundId ? api.roundOverview(first.roundId).catch(() => null) : null,
    canView && canRecheck ? checkCompiled(open, overviews) : [],
  ]);
  const pending = pendingActions({ attention, rounds: checks, scopeOf, permissions: perms });
  const teamModel = activeTeamAudit({
    engagements,
    overviews,
    roundOverviewData: teamRound,
    permissions: perms,
    attentionRows: pending.map((p) => ({ engagementId: p.engagementId, text: p.text })),
  });

  const myOpen = mine.find((a) => a.method === 'individual-self-pick' && a.status !== 'submitted');
  // the round the person is counting right now (team or individual), for the live line on "Continue counting"
  const activeMine = mine.find((a) => a.round_state === 'counting' && a.status !== 'submitted');
  const openRound = activeMine
    ? { items: Number(activeMine.items) || 0, counted: Math.min(Number(activeMine.items) || 0, Number(activeMine.counted) || 0) }
    : null;
  const card = individualCard(monthRows, { month, myOpen, canView, canStart: canIndividual });
  const teamMine = mine.filter((a) => a.method !== 'individual-self-pick');

  render(
    el,
    html`<div class="aud aud-dashboard">
      <div class="aud-overview-head">
        <div>
          <p class="aud-eyebrow">${monthName(month)}</p>
          <h1>Audit overview</h1>
        </div>
        <button type="button" class="aud-refresh" data-refresh aria-label="Refresh overview">Refresh ↻</button>
      </div>
      ${quickSection(quickActions(manifest.routes, perms), openRound)} ${canSearch ? html`<div data-search-host></div>` : ''}
      ${canAttention || (canView && canRecheck) ? pendingSection(pending, failed.attention) : ''}
      ${canView || canIndividual ? individualSection(card, failed.month, !canView) : ''}
      ${canView || canCount ? teamSection({ audit: teamModel, mine: teamMine, error: failed.engagements, mineError: failed.mine, canView }) : ''}
    </div>`,
  );
  if (canSearch) mountProductSearch(el.querySelector('[data-search-host]'));

  applyProgressBars(el);

  el.onclick = (event) => {
    if (event.target.closest('[data-refresh]')) return void mount(el, { ctx });
    // the counting page opens the assignment named here; with none named it shows the list (or the only open one)
    const assignment = event.target.closest('[data-open-assignment]');
    if (assignment) return void setView({ assignment: assignment.dataset.openAssignment });
    // the review pages work on the audit and round kept for the tab (the router has no query string)
    const item = event.target.closest('[data-open-item]');
    if (item) setView(item.dataset.r ? { engagement: item.dataset.e, round: item.dataset.r } : { engagement: item.dataset.e });
  };
}
