// Module registry. Modules are discovered from js/modules/index.js and filtered by permission and the off-switch.
import { MODULE_IDS } from '../modules/index.js';

export async function loadManifests(ids = MODULE_IDS, importer = (id) => import(`../modules/${id}/manifest.js`)) {
  const results = await Promise.allSettled(ids.map((id) => importer(id)));
  return results.flatMap((r, i) => (r.status === 'fulfilled' ? [r.value.default] : (reportBroken(ids[i], r.reason), [])));
}

let onBroken = () => {};
export const setBrokenHandler = (fn) => {
  onBroken = fn;
};
const reportBroken = (id, reason) => onBroken(id, reason);

export function isUsable(manifest, permissions, disabled) {
  if (!manifest.core && disabled.has(manifest.id)) return false;
  return !manifest.permission || permissions.has(manifest.permission);
}

// A page may need one permission (`permission`) or any one of several (`anyOf`).
export function routeAllowed(route, permissions) {
  if (route.anyOf) return route.anyOf.some((p) => permissions.has(p));
  return !route.permission || permissions.has(route.permission);
}

// Pure: which modules, and which of their pages, this user may open right now.
export function resolveModules(manifests, { permissions = [], disabled = [] } = {}) {
  const perms = new Set(permissions);
  const off = new Set(disabled);
  return manifests
    .filter((m) => isUsable(m, perms, off))
    .map((m) => ({ ...m, routes: m.routes.filter((r) => routeAllowed(r, perms)) }))
    .filter((m) => m.routes.length > 0)
    .sort((a, b) => (a.nav?.order ?? 100) - (b.nav?.order ?? 100));
}

export function routesFor(modules) {
  return modules.flatMap((m) => m.routes.map((r) => ({ ...r, moduleId: m.id })));
}
