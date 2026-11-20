// Audit Command Centre (Audit 2.0).
// The dashboard is a permission-filtered presentation of existing Audit APIs; database/RLS rules remain authoritative.
import { html, render } from '../../../shared/html.js';
import { shortDate } from '../../../shared/format.js';
import { hero } from '../../../shared/ui.js';
import * as api from '../data/api.js';
import { friendlyError } from '../domain/errors.js';
import { setView } from '../domain/nav.js';
import manifest from '../manifest.js';
import { loadingCard } from './parts.js';
import { installSignOutGuard } from './signoutGuard.js';

const SCOPE = {
  full: 'Full stock',
  selected: 'Selected companies',
  single: 'One company',
  template: 'Template',
  individual: 'Individual',
};
const STATUS = {
  open: 'Open',
  archived: 'Archived',
  closed: 'Closed',
  draft: 'Draft',
  locked: 'Locked',
  counting: 'Counting',
  compiled: 'Compiled',
  final: 'Finalized',
  assigned: 'Assigned',
  submitted: 'Submitted',
  revoked: 'Revoked',
};
const GROUPS = [
  {
    title: 'Stock audits',
    description: 'Engagements, rounds, counting teams and reconciliation.',
    routes: [
      ['/audit/engagements', 'All audits', 'Create and browse audit engagements.'],
      ['/audit/engagement', 'Engagement details', 'Manage members and rounds within an audit.'],
      ['/audit/round', 'Rounds & assignments', 'Split work, assign counters, lock and start rounds.'],
      ['/audit/compile', 'Review & reconciliation', 'Inspect submissions, differences, corrections and conflicts.'],
      ['/audit/final', 'Final snapshots', 'Finalize and inspect immutable round results.'],
    ],
  },
  {
    title: 'My counting',
    description: 'Your assigned work and personal stock checks.',
    routes: [
      ['/audit/count', 'Counting', 'Continue assigned stock counts, including saved offline work.'],
      ['/audit/individual', 'Individual audit', 'Start a personal stock count.'],
      ['/audit/templates', 'Audit templates', 'Use or maintain saved product-code lists.'],
    ],
  },
  {
    title: 'Reports & history',
    description: 'Results, submissions and accountability.',
    routes: [['/audit/reports', 'Audit reports & trail', 'Review round results, people and the activity trail.']],
  },
  {
    title: 'Expiry management',
    description: 'Shared expiry register and monthly rack checks.',
    routes: [
      ['/audit/expiry', 'Expiry register', 'Log and search expiry entries.'],
      ['/audit/expiry/racks', 'Rack management', 'Manage racks and monthly staff assignments.'],
    ],
  },
  {
    title: 'Barcode centre',
    description: 'Product barcode register, verification and scanning.',
    routes: [['/audit/barcode', 'Barcode centre', 'Register, verify and resolve barcode records.']],
  },
  {
    title: 'Administration',
    description: 'People and access to Audit functions.',
    routes: [['/audit/team', 'Team & permissions', 'Manage Deputy, Sub-Auditor and individual audit permissions.']],
  },
];

function canOpen(route, perms) {
  if (route.permission) return perms.has(route.permission);
  return (route.anyOf ?? []).some((key) => perms.has(key));
}

function navigationGroups(perms) {
  const routes = new Map(manifest.routes.map((route) => [route.path, route]));
  return GROUPS.map((group) => {
    const items = group.routes.flatMap(([path, label, description]) => {
      const route = routes.get(path);
      if (!route || !canOpen(route, perms)) return [];
      return [{ path, label, description }];
    });
    return { ...group, items };
  }).filter((group) => group.items.length > 0);
}

function statusLabel(status) {
  return STATUS[status] ?? String(status ?? 'Unknown').replaceAll('_', ' ');
}

function navCard(group) {
  const links = group.items.map(
    (item) => html`<a class="aud-nav-link" href="#${item.path}">
      <span class="aud-nav-link-copy">
        <strong>${item.label}</strong>
        <span class="muted small">${item.description}</span>
      </span>
      <span class="aud-nav-arrow" aria-hidden="true">›</span>
    </a>`,
  );

  return html`<section class="card aud-card aud-nav-group" aria-label="${group.title}">
    <div class="aud-group-heading">
      <h2>${group.title}</h2>
      <span class="aud-group-count">${group.items.length}</span>
    </div>
    <p class="muted small">${group.description}</p>
    <div class="aud-group-links">${links}</div>
  </section>`;
}

function assignmentCard(assignment) {
  const items = Number(assignment.items) || 0;
  const counted = Math.min(items, Number(assignment.counted) || 0);
  const remaining = Math.max(0, items - counted);
  const percent = items ? Math.round((counted / items) * 100) : 0;
  const round = `${assignment.round_number ?? ''}${assignment.round_suffix ?? ''}`;
  const active = assignment.round_state === 'counting' && assignment.status !== 'submitted';
  const buttonClass = active ? 'btn-primary' : '';
  const buttonLabel = active ? 'Continue counting' : 'Open my work';

  return html`<article class="aud-work-item">
    <div class="aud-work-main">
      <div class="aud-work-title">
        <strong>${assignment.engagement_name || 'Audit assignment'}</strong>
        <span class="aud-badge aud-badge-${assignment.status}">${statusLabel(assignment.status)}</span>
      </div>
      <p class="muted small">
        ${round ? `Round ${round} · ` : ''}${statusLabel(assignment.round_state)} ·
        ${counted.toLocaleString()} of ${items.toLocaleString()} counted
      </p>
      <div
        class="aud-progress"
        role="progressbar"
        aria-label="Counting progress"
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow="${percent}"
      >
        <span data-progress="${percent}"></span>
      </div>
      <p class="muted small">${remaining.toLocaleString()} remaining · ${percent}% complete</p>
    </div>
    <a class="btn btn-sm ${buttonClass}" href="#/audit/count">${buttonLabel}</a>
  </article>`;
}

function engagementCard(engagement, overview) {
  const rounds = overview?.rounds ?? [];
  const latest = rounds.length ? rounds[rounds.length - 1] : null;
  const date = engagement.created_at ? shortDate(String(engagement.created_at).slice(0, 10)) : '';
  const scope = SCOPE[engagement.scope_type] ?? engagement.scope_type;
  const month = engagement.scope_month ? ` · ${engagement.scope_month}` : '';
  const created = date ? ` · ${date}` : '';
  const roundCount = `${rounds.length} round${rounds.length === 1 ? '' : 's'}`;
  let latestLabel = '';
  if (latest) {
    latestLabel = ` · Latest: Round ${latest.round_number}${latest.round_suffix ?? ''} — ${statusLabel(latest.state)}`;
  }

  return html`<article class="aud-engagement-item">
    <div class="aud-engagement-copy">
      <strong>${engagement.name}</strong>
      <span class="muted small">${scope}${month}${created}</span>
      <span class="muted small">${roundCount}${latestLabel}</span>
    </div>
    <span class="aud-badge aud-badge-${engagement.status}">${statusLabel(engagement.status)}</span>
    <a class="btn btn-sm" href="#/audit/engagement" data-open-engagement="${engagement.id}">Open</a>
  </article>`;
}

function metric(label, value, detail) {
  return html`<div class="aud-metric">
    <span class="muted small">${label}</span>
    <strong>${value}</strong>
    <span class="muted small">${detail}</span>
  </div>`;
}

function myWorkSection(assignments, pendingAssignments, error, perms) {
  let content;
  if (error) {
    content = html`<p class="note note-error" role="alert">Could not load your assignments: ${error}</p>`;
  } else if (assignments.length) {
    const rows = assignments.slice(0, 5).map(assignmentCard);
    content = html`<div class="aud-work-list">${rows}</div>`;
  } else {
    content = html`<p class="aud-empty">No counting assignments are currently assigned to you.</p>`;
  }

  let actions = '';
  if (perms.has('audit.individual')) {
    actions = html`<div class="aud-inline-action">
      <a class="btn btn-sm" href="#/audit/individual">Start an individual audit</a>
      <a class="btn btn-sm" href="#/audit/templates">Browse templates</a>
    </div>`;
  }

  return html`<section class="card aud-card" aria-label="My work">
    <div class="aud-section-head">
      <div>
        <h2>My work</h2>
        <p class="muted small">
          ${pendingAssignments.length} assignment${pendingAssignments.length === 1 ? '' : 's'} currently in counting ·
          your own progress only.
        </p>
      </div>
      <a href="#/audit/count">View all</a>
    </div>
    ${content}
    ${actions}
  </section>`;
}

function individualSection() {
  return html`<section class="card aud-card">
    <h2>Individual audit</h2>
    <p class="muted small">Start a personal stock count or use one of your saved templates.</p>
    <div class="aud-inline-action">
      <a class="btn btn-primary" href="#/audit/individual">Start individual audit</a>
      <a class="btn" href="#/audit/templates">Browse templates</a>
    </div>
  </section>`;
}

function engagementSection(engagements, details, error, activeRounds, compiledRounds) {
  let metrics = '';
  if (!error) {
    metrics = html`<div class="aud-metrics">
      ${metric('Recent engagements', engagements.length.toLocaleString(), 'Up to 20 most recent')}
      ${metric('Active rounds', activeRounds.toLocaleString(), 'In the six most recent open audits')}
      ${metric('Compiled rounds', compiledRounds.toLocaleString(), 'In that same group of open audits')}
    </div>`;
  }

  let errorMessage = '';
  if (error) {
    errorMessage = html`<p class="note note-error" role="alert">Could not load audits: ${error}</p>`;
  }

  let list = '';
  if (engagements.length) {
    let rows;
    if (details.length) {
      rows = details.map((item) => engagementCard(item.engagement, item.overview));
    } else {
      rows = engagements.slice(0, 6).map((item) => engagementCard(item, null));
    }
    list = html`<div class="aud-engagement-list">${rows}</div>`;
  } else if (!error) {
    list = html`<p class="aud-empty">No audits are currently visible to you.</p>`;
  }

  let limitNote = '';
  if (engagements.length >= 20) {
    limitNote = html`<p class="muted small">Showing the 20 most recent engagements.</p>`;
  }

  return html`<section class="card aud-card" aria-label="Stock audit overview">
    <div class="aud-section-head">
      <div>
        <h2>Stock audit overview</h2>
        <p class="muted small">Engagements visible to your account, according to Audit access.</p>
      </div>
      <a href="#/audit/engagements">All audits</a>
    </div>
    ${errorMessage}
    ${metrics}
    ${list}
    ${limitNote}
  </section>`;
}

export async function mount(el, { ctx } = {}) {
  const perms = new Set(ctx?.permissions ?? []);
  const canCount = perms.has('audit.count');
  const canIndividual = perms.has('audit.individual');
  const canSeeEngagements = perms.has('audit.view') || perms.has('audit.manage');
  installSignOutGuard(); // unsent count events must remain protected (AUD-9)
  render(el, loadingCard());

  let assignments = [];
  let engagements = [];
  let engagementDetails = [];
  let assignmentError = null;
  let engagementError = null;

  const tasks = [];
  if (canCount) {
    tasks.push(
      api
        .myAssignments()
        .then((rows) => {
          assignments = rows ?? [];
        })
        .catch((error) => {
          assignmentError = friendlyError(error).message;
        }),
    );
  }
  if (canSeeEngagements) {
    tasks.push(
      api
        .listEngagements(20)
        .then(async (rows) => {
          engagements = rows ?? [];
          const recentOpen = engagements.filter((item) => item.status === 'open').slice(0, 6);
          const details = await Promise.allSettled(recentOpen.map((item) => api.engagementOverview(item.id)));
          engagementDetails = recentOpen.map((item, index) => ({
            engagement: item,
            overview: details[index].status === 'fulfilled' ? details[index].value : null,
          }));
        })
        .catch((error) => {
          engagementError = friendlyError(error).message;
        }),
    );
  }
  await Promise.all(tasks);

  const groups = navigationGroups(perms);
  const openAssignments = assignments.filter((item) => item.status !== 'revoked');
  const pendingAssignments = openAssignments.filter(
    (item) => item.round_state === 'counting' && item.status !== 'submitted',
  );
  const activeRounds = engagementDetails.reduce(
    (sum, item) => sum + (item.overview?.rounds ?? []).filter((round) => round.state === 'counting').length,
    0,
  );
  const compiledRounds = engagementDetails.reduce(
    (sum, item) => sum + (item.overview?.rounds ?? []).filter((round) => round.state === 'compiled').length,
    0,
  );

  let primaryAction = '';
  if (perms.has('audit.manage')) {
    primaryAction = html`<a class="btn btn-primary" href="#/audit/engagements">+ New stock audit</a>`;
  } else if (canCount) {
    primaryAction = html`<a class="btn btn-primary" href="#/audit/count">Open my counting</a>`;
  } else if (canIndividual) {
    primaryAction = html`<a class="btn btn-primary" href="#/audit/individual">Start individual audit</a>`;
  }

  let personalContent = '';
  if (canCount) {
    personalContent = myWorkSection(openAssignments, pendingAssignments, assignmentError, perms);
  } else if (canIndividual) {
    personalContent = individualSection();
  }

  let managementContent = '';
  if (canSeeEngagements) {
    managementContent = engagementSection(engagements, engagementDetails, engagementError, activeRounds, compiledRounds);
  }

  let accessNotice = '';
  if (!canCount && !canSeeEngagements && !canIndividual) {
    accessNotice = html`<section class="card aud-card">
      <h2>Audit tools</h2>
      <p class="muted">Your account has access to the sections below. Choose a section to continue.</p>
    </section>`;
  }

  let navigationContent;
  if (groups.length) {
    navigationContent = groups.map(navCard);
  } else {
    navigationContent = html`<section class="card aud-card">
      <p class="aud-empty">No Audit pages are available for your current permissions.</p>
    </section>`;
  }

  render(
    el,
    html`<div class="aud aud-dashboard">
      ${hero({
        label: 'AUDIT WORKSPACE',
        title: 'Audit Command Centre',
        sub: 'A clear view of your audit work, active stock checks and the tools you are allowed to use.',
        actions: primaryAction,
      })}
      <section class="aud-welcome" aria-label="Dashboard introduction">
        <div>
          <strong>${ctx?.full_name ? `Welcome, ${ctx.full_name}` : 'Welcome to Audit'}</strong>
          <p class="muted small">Your dashboard is tailored to your Audit permissions.</p>
        </div>
        <button type="button" class="aud-refresh" data-refresh aria-label="Refresh dashboard">Refresh ↻</button>
      </section>
      ${personalContent}
      ${managementContent}
      ${accessNotice}
      <section class="aud-navigation" aria-label="Audit navigation">
        <div class="aud-section-title">
          <h2>Audit sections</h2>
          <p class="muted small">Grouped by the work each section supports.</p>
        </div>
        ${navigationContent}
      </section>
    </div>`,
  );

  // CSP forbids inline style attributes; widths are applied as DOM properties after escaped rendering.
  el.querySelectorAll('[data-progress]').forEach((bar) => {
    bar.style.width = `${Math.max(0, Math.min(100, Number(bar.dataset.progress) || 0))}%`;
  });

  // Preserve the current route hand-off convention for pages that need an engagement/round id.
  el.onclick = (event) => {
    if (event.target.closest('[data-refresh]')) {
      mount(el, { ctx });
      return;
    }
    const engagementLink = event.target.closest('[data-open-engagement]');
    if (engagementLink) setView({ engagement: engagementLink.dataset.openEngagement });
  };
}
