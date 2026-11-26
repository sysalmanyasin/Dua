// The Audit workspace: four primary tabs, and the focused screens inside Team Audit. Pure: routes and permissions in, plain objects out.
// What a person may open is still decided by the route's own permission list (manifest) and by the database; this only decides what to show.

export const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'team', label: 'Team Audit' },
  { key: 'individual', label: 'Individual Audit' },
  { key: 'tools', label: 'Tools' },
];

// Every Audit page belongs to one tab (and, inside Team Audit, to one screen). Pages that are not listed (counting) have no tab bar.
const PLACES = {
  '/audit': { tab: 'overview' },
  '/audit/engagements': { tab: 'team', screen: 'progress' },
  '/audit/engagement': { tab: 'team', screen: 'progress' },
  '/audit/round': { tab: 'team', screen: 'progress' },
  '/audit/compile': { tab: 'team', screen: 'compile' },
  '/audit/corrections': { tab: 'team', screen: 'corrections' },
  '/audit/reports': { tab: 'team', screen: 'reports' },
  '/audit/final': { tab: 'team', screen: 'final' },
  '/audit/individuals': { tab: 'individual', screen: 'overview' },
  '/audit/individual-rounds': { tab: 'individual', screen: 'rounds' },
  '/audit/individual': { tab: 'individual', screen: 'rounds' },
  '/audit/individual-review': { tab: 'individual', screen: 'review' },
  '/audit/individual-reports': { tab: 'individual', screen: 'reports' },
  '/audit/tools': { tab: 'tools' },
  '/audit/expiry': { tab: 'tools' },
  '/audit/expiry/racks': { tab: 'tools' },
  '/audit/barcode': { tab: 'tools' },
  '/audit/templates': { tab: 'tools' },
  '/audit/team': { tab: 'tools' },
};

/** The pages a tab opens, best landing first. */
const LANDING = {
  overview: ['/audit'],
  team: ['/audit/engagements', '/audit/compile', '/audit/reports', '/audit/final'],
  individual: ['/audit/individuals', '/audit/individual'],
  tools: ['/audit/tools'],
};

/** The five Team Audit screens, in order. `needsRound` screens work on one round, so they wait until a round is chosen. */
export const TEAM_SCREENS = [
  { key: 'progress', label: 'Progress & Assignments', needsRound: false },
  { key: 'compile', label: 'Compile & Review', needsRound: true },
  { key: 'corrections', label: 'Corrections', needsRound: true },
  { key: 'reports', label: 'Reports', needsRound: false },
  { key: 'final', label: 'Finalization', needsRound: true },
];

/** The four Individual Audit screens, in order. Counting itself is not a screen: it opens in its own focused page. */
export const INDIVIDUAL_SCREENS = [
  { key: 'overview', label: 'Monthly Overview', needsRound: false, path: '/audit/individuals' },
  { key: 'rounds', label: 'Rounds & Progress', needsRound: false, path: '/audit/individual-rounds' },
  { key: 'review', label: 'Review & Corrections', needsRound: true, path: '/audit/individual-review' },
  { key: 'reports', label: 'Reports', needsRound: false, path: '/audit/individual-reports' },
];

export const placeOf = (path) => PLACES[path] ?? null;

const allowed = (route, perms) => {
  if (!route) return false;
  if (route.permission) return perms.has(route.permission);
  return (route.anyOf ?? []).some((key) => perms.has(key));
};

const routeAt = (routes, path) => routes.find((r) => r.path === path);

/** The page a screen opens: Progress opens the audit when one is chosen, and the list of audits when not. */
export function screenPath(key, view) {
  switch (key) {
    case 'progress':
      return view?.engagement ? '/audit/engagement' : '/audit/engagements';
    case 'compile':
      return '/audit/compile';
    case 'corrections':
      return '/audit/corrections';
    case 'reports':
      return '/audit/reports';
    default:
      return '/audit/final';
  }
}

/** The tabs this person can open, each with the page it lands on. A tab with no page this person may open is left out. */
export function visibleTabs(routes, permissions) {
  const perms = permissions instanceof Set ? permissions : new Set(permissions ?? []);
  return TABS.flatMap((tab) => {
    const path = LANDING[tab.key].find((p) => allowed(routeAt(routes, p), perms));
    return path ? [{ ...tab, path }] : [];
  });
}

/** The Team Audit screens this person may open, with where each goes and whether it is waiting for a round to be chosen. */
export function teamScreens(routes, permissions, view) {
  const perms = permissions instanceof Set ? permissions : new Set(permissions ?? []);
  return TEAM_SCREENS.flatMap((screen) => {
    const path = screenPath(screen.key, view);
    if (!allowed(routeAt(routes, path), perms)) return [];
    return [{ ...screen, path, waiting: screen.needsRound && !view?.round }];
  });
}

/** The Individual Audit screens this person may open. A person who only counts their own audits has no screens, just their own page. */
export function individualScreens(routes, permissions, view) {
  const perms = permissions instanceof Set ? permissions : new Set(permissions ?? []);
  return INDIVIDUAL_SCREENS.flatMap((screen) =>
    allowed(routeAt(routes, screen.path), perms) ? [{ ...screen, waiting: screen.needsRound && !view?.round }] : [],
  );
}
