// Pure helpers for the grouped permission list (Users & Access, Audit team). No DOM, no database.
// A permission key is "<module>.<name>". The module part is the group; nothing has to be stored for it.

const GROUP_LABELS = {
  activity: 'Activity log',
  audit: 'Audit',
  backup: 'Backups',
  candela: 'Candela sales',
  checklist: 'Checklist',
  closing: 'Closing',
  credit: 'Credit',
  deposits: 'Deposits',
  ebill: 'E-Bill',
  field: 'Field',
  hs: 'HS',
  inventory: 'Inventory',
  invoice_desk: 'Invoice desk',
  mediq: 'MediQ',
  mgmt: 'Manager',
  notification: 'Notifications',
  notifications: 'Notifications',
  opening: 'Opening',
  reports: 'Reports',
  sales: 'Sales',
  settings: 'Settings',
  str: 'STR',
  strips: 'Strips',
  targets: 'Targets',
  tools: 'Tools',
  users: 'Users & access',
  vault: 'Vault',
  workspace: 'Workspace',
};

export const groupId = (key) => (key.includes('.') ? key.slice(0, key.indexOf('.')) : 'other');

export function groupLabel(id) {
  if (GROUP_LABELS[id]) return GROUP_LABELS[id];
  const text = id.replace(/_/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// "audit.barcode_admin" -> "Barcode admin"
export function shortName(key) {
  const rest = key.includes('.') ? key.slice(key.indexOf('.') + 1) : key;
  const text = rest.replace(/[._]/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// What one person effectively holds for one key: role preset plus a personal Allow or Deny (deny wins).
export function accessFor(role, rolePerms, overrides, key) {
  const override = overrides.find((o) => o.perm_key === key)?.effect ?? null;
  const fromRole = rolePerms.some((r) => r.role === role && r.perm_key === key);
  const allowed = override === 'deny' ? false : override === 'grant' ? true : fromRole;
  return { override, fromRole, allowed };
}

// Permissions: [{ key, description, label? }]. Returns groups in A-Z order of their label, keys in A-Z order inside.
export function buildGroups(permissions, role, rolePerms, overrides) {
  const byId = new Map();
  for (const perm of permissions) {
    const id = groupId(perm.key);
    const a = accessFor(role, rolePerms, overrides, perm.key);
    if (!byId.has(id)) byId.set(id, { id, label: groupLabel(id), items: [] });
    byId.get(id).items.push({
      key: perm.key,
      name: perm.label ?? shortName(perm.key),
      description: perm.description ?? '',
      ...a,
    });
  }
  const groups = [...byId.values()];
  for (const g of groups) {
    g.items.sort((x, y) => x.key.localeCompare(y.key));
    g.total = g.items.length;
    g.allowedCount = g.items.filter((i) => i.allowed).length;
    g.customCount = g.items.filter((i) => i.override !== null).length;
  }
  return groups.sort((x, y) => x.label.localeCompare(y.label));
}

// filter: 'all' | 'allowed' | 'custom'. A group with no matching rows is dropped. Counts stay for the whole group.
export function filterGroups(groups, { query = '', filter = 'all' } = {}) {
  const q = query.trim().toLowerCase();
  const out = [];
  for (const g of groups) {
    const items = g.items.filter((i) => {
      if (filter === 'allowed' && !i.allowed) return false;
      if (filter === 'custom' && i.override === null) return false;
      if (!q) return true;
      return `${g.label} ${i.key} ${i.name} ${i.description}`.toLowerCase().includes(q);
    });
    if (items.length) out.push({ ...g, items });
  }
  return out;
}

// A checkbox tells the final result. The stored value is the smallest change that gives that result:
// no personal setting when the box matches the role preset, otherwise a personal Allow or Deny.
export const effectForToggle = (fromRole, checked) => (checked === fromRole ? null : checked ? 'grant' : 'deny');

// Calls needed for a group action. Only rows that really change are returned, so every call is a real, logged change.
//   allow: everyone in the list ends up allowed   clear: everyone ends up not allowed   reset: back to the role preset
export function bulkPlan(items, action) {
  const ops = [];
  for (const i of items) {
    if (action === 'allow' && !i.allowed) ops.push({ key: i.key, effect: effectForToggle(i.fromRole, true) });
    if (action === 'clear' && i.allowed) ops.push({ key: i.key, effect: effectForToggle(i.fromRole, false) });
    if (action === 'reset' && i.override !== null) ops.push({ key: i.key, effect: null });
  }
  return ops;
}

// The overrides list after one change, so the page can show it at once without asking the database again.
export function applyOverride(overrides, key, effect) {
  const rest = overrides.filter((o) => o.perm_key !== key);
  return effect === null ? rest : [...rest, { perm_key: key, effect }];
}
