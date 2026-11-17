// Audit access bundles (AUD-1, AUD-2). A bundle is NOT a new permission mechanism: the owner applies it by calling the core
// set_user_permission once per key, so every grant is logged. Pure functions, no database.

export const AUDIT_KEYS = [
  { key: 'audit.count', label: 'Count stock', help: 'Count the items assigned to them and submit' },
  { key: 'audit.individual', label: 'Individual audits', help: 'Start their own Individual Audit' },
  { key: 'audit.view', label: 'View results', help: 'See engagements they belong to, rounds, progress and variance values' },
  { key: 'audit.suggest', label: 'Suggest corrections', help: 'Propose a corrected count with a reason' },
  { key: 'audit.report', label: 'Export reports', help: 'Download and print reports' },
  { key: 'audit.barcode_scan', label: 'Scan barcodes', help: 'Scan while counting' },
  { key: 'audit.barcode_register', label: 'Register barcodes', help: 'Register and verify barcodes, report conflicts' },
  { key: 'audit.expiry_log', label: 'Log near-expiry', help: 'Log near-expiry stock' },
  { key: 'audit.review', label: 'Review rounds', help: 'Review compiled rounds and conflicts' },
  { key: 'audit.assign', label: 'Assign counters', help: 'Split a round between counters' },
  { key: 'audit.compile', label: 'Compile rounds', help: 'Compile a round, with or without missing counters' },
  { key: 'audit.finalize', label: 'Finalize', help: 'Make a round final' },
  { key: 'audit.reopen', label: 'Reopen counts', help: 'Reopen a submitted count, with a reason' },
  { key: 'audit.templates', label: 'Templates', help: 'Create and edit audit templates' },
  { key: 'audit.barcode_admin', label: 'Barcode admin', help: 'Fix or remove registered barcodes' },
  { key: 'audit.expiry_manage', label: 'Manage expiry', help: 'Reopen locked expiry entries, edit the list' },
  { key: 'audit.manage', label: 'Manage audits', help: 'Create engagements and rounds, set members' },
];

export const BUNDLES = {
  deputy: {
    label: 'Deputy Auditor',
    blurb: 'Senior role: sees results of audits they belong to, suggests corrections, exports reports, registers barcodes.',
    keys: ['audit.view', 'audit.suggest', 'audit.report', 'audit.barcode_register', 'audit.count'],
  },
  sub: {
    label: 'Sub-Auditor',
    blurb: 'Junior role: counts, starts Individual Audits, scans barcodes, logs near-expiry stock.',
    keys: ['audit.count', 'audit.individual', 'audit.barcode_scan', 'audit.expiry_log'],
  },
  // AUD-1: only the owner is Main Auditor; this hands a trusted person every key. It is a deliberate, visible choice.
  lead: {
    label: 'Lead (every audit key)',
    blurb: 'Everything the owner can do in Audit except what needs the owner sign-in. Use for one trusted person only.',
    keys: AUDIT_KEYS.map((k) => k.key),
  },
};

export const keyLabel = (key) => AUDIT_KEYS.find((k) => k.key === key)?.label ?? key;

// What one person effectively holds for one key: their role preset plus a personal Allow or Deny (deny wins).
export function keyAccess(role, rolePerms, overrides, key) {
  const override = overrides.find((o) => o.perm_key === key)?.effect ?? null;
  const fromRole = rolePerms.some((r) => r.role === role && r.perm_key === key);
  const allowed = override === 'deny' ? false : override === 'grant' ? true : fromRole;
  return { override, fromRole, allowed };
}

// 'full' when the person holds every key of the bundle, 'none' when none, else 'partial'.
export function bundleStatus(bundleId, role, rolePerms, overrides) {
  const keys = BUNDLES[bundleId].keys;
  const held = keys.filter((k) => keyAccess(role, rolePerms, overrides, k).allowed).length;
  return held === keys.length ? 'full' : held === 0 ? 'none' : 'partial';
}

// The calls needed to give a person a bundle: a personal Allow for each key they do not hold yet (this also clears a Deny).
export function planApply(bundleId, role, rolePerms, overrides) {
  return BUNDLES[bundleId].keys.filter((k) => !keyAccess(role, rolePerms, overrides, k).allowed).map((key) => ({ key, effect: 'grant' }));
}

// The calls needed to take every personal audit setting away (back to the role preset). Keys with no override are left alone.
export function planClear(overrides) {
  return overrides.filter((o) => o.perm_key.startsWith('audit.')).map((o) => ({ key: o.perm_key, effect: null }));
}
