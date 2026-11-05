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

// Pure: which modules this user may open right now.
export function resolveModules(manifests, { permissions = [], disabled = [] } = {}) {
  const perms = new Set(permissions);
  const off = new Set(disabled);
  return manifests.filter((m) => isUsable(m, perms, off)).sort((a, b) => (a.nav?.order ?? 100) - (b.nav?.order ?? 100));
}

export function routesFor(modules) {
  return modules.flatMap((m) => m.routes.map((r) => ({ ...r, moduleId: m.id })));
}
