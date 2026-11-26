// What the Overview shows. Pure: database rows in, plain objects out. Nothing here decides who may do what; the routes' own
// permission lists decide which links appear, and the database decides what is allowed.
import { attentionBadges } from './progress.js';
import { latestRound, nextStep, recompileNeeded } from './pipeline.js';
import { overviewGroups, stateLabel } from './history.js';

const canOpen = (route, perms) => {
  if (!route) return false;
  if (route.permission) return perms.has(route.permission);
  return (route.anyOf ?? []).some((key) => perms.has(key));
};

// The three main actions, in this order. Everything else is reached from the tab bar and the Tools tab.
const QUICK = [
  ['individual', 'Individual audit', '/audit/individual', 'Start or pick up your count'],
  ['count', 'Continue counting', '/audit/count', 'Back to your open round'],
  ['expiry', 'Expiry', '/audit/expiry', 'Log and check expiry dates'],
];

/** The main actions, only those the person may open. */
export function quickActions(routes, permissions) {
  const perms = permissions instanceof Set ? permissions : new Set(permissions ?? []);
  return QUICK.flatMap(([key, label, path, hint]) =>
    canOpen(
      routes.find((r) => r.path === path),
      perms,
    )
      ? [{ key, label, path, hint }]
      : [],
  );
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Where an item about a round opens: Individual rounds have their own review screen. */
const reviewPath = (scopeType, team) => (scopeType === 'individual' ? '/audit/individual-review' : team);

/**
 * Things someone has to do, one row per round, each with the screen that does it.
 *   attention  the result of audit_attention_summary (ready to compile, open conflicts, corrections waiting)
 *   rounds     [{ engagementId, engagementName, scopeType, label, overview }] for compiled rounds whose compile overview was read
 *   scopeOf    engagement id -> scope_type, to send an Individual round to its own screen
 */
export function pendingActions({ attention, rounds = [], scopeOf = () => null, permissions = [] }) {
  const perms = permissions instanceof Set ? permissions : new Set(permissions);
  const can = (k) => perms.has(k) || perms.has('audit.manage');
  const items = [];
  for (const badge of attentionBadges(attention)) {
    for (const r of badge.rows) {
      const scope = scopeOf(r.engagementId);
      if (badge.key === 'ready') {
        items.push({ kind: 'ready', order: 0, ...target(r), text: 'Ready to compile', path: '/audit/compile' });
      } else if (badge.key === 'conflicts') {
        items.push({
          kind: 'conflicts',
          order: 2,
          ...target(r),
          text: plural(r.n, 'open conflict'),
          path: reviewPath(scope, '/audit/compile'),
        });
      } else {
        items.push({
          kind: 'corrections',
          order: 3,
          ...target(r),
          text: `${plural(r.n, 'correction')} waiting`,
          path: reviewPath(scope, '/audit/corrections'),
        });
      }
    }
  }
  for (const r of rounds) {
    const o = r.overview;
    if (!o) continue;
    const need = recompileNeeded(o);
    const base = { engagementId: r.engagementId, engagementName: r.engagementName, roundId: o.round.id, label: r.label };
    if (need && can('audit.compile')) {
      items.push({
        kind: 'recompile',
        order: 1,
        ...base,
        text: `Needs a recompile: ${need.text}`,
        path: reviewPath(r.scopeType, '/audit/corrections'),
      });
      continue;
    }
    // a team round that is compiled, with nothing left to decide, is ready for its final snapshot
    const open = (o.conflicts ?? []).filter((k) => !k.resolved_side).length;
    const waiting = (o.corrections ?? []).filter((c) => c.status === 'proposed').length;
    if (r.scopeType !== 'individual' && o.round.state === 'compiled' && !need && open === 0 && waiting === 0 && can('audit.finalize')) {
      items.push({ kind: 'finalize', order: 4, ...base, text: 'Ready to finalize', path: '/audit/final' });
    }
  }
  return items.sort((a, b) => a.order - b.order);
}

function target(r) {
  return { engagementId: r.engagementId, engagementName: r.engagementName, roundId: r.roundId, label: r.label };
}

/** This month's Individual audits as the Overview card shows them. */
export function individualCard(rows, { month, myOpen = null, canView = false, canStart = false } = {}) {
  const groups = overviewGroups(rows);
  const rounds = groups.flatMap((g) => g.rounds);
  const finished = rounds.filter((r) => r.done).length;
  const waiting = groups.filter((g) => g.waiting > 0).map((g) => ({ name: g.name, waiting: g.waiting }));
  let action = null;
  if (myOpen) action = { label: 'Continue counting', path: '/audit/individual', primary: true };
  else if (canView) action = { label: 'Open this month', path: '/audit/individuals', primary: false };
  else if (canStart) action = { label: 'Start an individual audit', path: '/audit/individual', primary: true };
  return {
    month,
    people: groups.length,
    rounds: rounds.length,
    finished,
    notFinished: rounds.length - finished,
    waiting,
    myOpen: Boolean(myOpen),
    action,
  };
}

/**
 * The audit that is under way: the newest open team audit, its latest round, how many of its people have submitted, and the one
 * thing to do next. `roundOverviewData` is audit_round_overview of that round (or null when it could not be read).
 */
export function activeTeamAudit({
  engagements = [],
  overviews = new Map(),
  roundOverviewData = null,
  permissions = [],
  attentionRows = [],
}) {
  const engagement = engagements.find((e) => e.status === 'open' && e.scope_type !== 'individual');
  if (!engagement) return null;
  const rounds = overviews.get(engagement.id)?.rounds ?? [];
  const round = latestRound(rounds);
  const label = round ? `${round.round_number}${round.round_suffix ?? ''}` : '';
  const assignments =
    roundOverviewData?.round?.id === round?.id ? (roundOverviewData?.assignments ?? []).filter((a) => a.status !== 'revoked') : null;
  const total = assignments ? assignments.length : Number(round?.assignments ?? 0);
  const submitted = assignments ? assignments.filter((a) => a.status === 'submitted').length : null;
  const mine = attentionRows.filter((r) => r.engagementId === engagement.id);
  const next = round ? nextStep(round.state, [...permissions]) : null;
  const pages = { round: '/audit/round', compile: '/audit/compile', final: '/audit/final' };
  return {
    engagementId: engagement.id,
    name: engagement.name,
    roundId: round?.id ?? null,
    roundLabel: label,
    state: round?.state ?? null,
    stateLabel: round ? stateLabel(round.state) : 'No round yet',
    rounds: rounds.length,
    items: Number(round?.items ?? 0),
    total,
    submitted,
    percent: submitted !== null && total > 0 ? Math.round((submitted / total) * 100) : null,
    pending: mine.map((r) => r.text),
    action: round
      ? { label: next ? 'Continue' : 'Open', path: next ? (pages[next.page] ?? '/audit/engagement') : '/audit/engagement' }
      : { label: 'Open', path: '/audit/engagement' },
  };
}
