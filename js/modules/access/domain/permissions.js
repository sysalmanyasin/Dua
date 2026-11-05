// Pure: what a person effectively gets, given their role preset and personal overrides.
export function effectiveAccess(role, rolePerms, overrides, key) {
  const override = overrides.find((o) => o.perm_key === key)?.effect ?? null;
  const fromRole = rolePerms.some((r) => r.role === role && r.perm_key === key);
  const allowed = role === 'admin' ? true : override === 'deny' ? false : override === 'grant' ? true : fromRole;
  return { override, fromRole, allowed };
}
