// Hash router: "#/access" -> "/access". Pure matching so it can be unit tested.
export const DEFAULT_PATH = '/home';

export function pathFromHash(hash) {
  const h = String(hash ?? '').replace(/^#/, '');
  if (!h || h === '/') return DEFAULT_PATH;
  const path = h.startsWith('/') ? h : `/${h}`;
  return /^\/[a-z0-9/_-]*$/i.test(path) ? path.replace(/\/+$/, '') || DEFAULT_PATH : null;
}

export function matchRoute(hash, routes) {
  const path = pathFromHash(hash);
  if (!path) return null;
  return routes.find((r) => r.path === path) ?? null;
}

export function startRouter(getRoutes, onRoute, onNotFound) {
  const run = () => {
    const route = matchRoute(location.hash, getRoutes());
    if (route) onRoute(route);
    else onNotFound(pathFromHash(location.hash));
  };
  addEventListener('hashchange', run);
  run();
  return () => removeEventListener('hashchange', run);
}
