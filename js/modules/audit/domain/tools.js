// The groups on the Tools tab. Pure: the manifest's routes and the person's permissions in, the groups they may see out.
// Access is the route's own permission list, so there is no second permission table to keep in step.

const GROUPS = [
  {
    key: 'expiry',
    title: 'Expiry management',
    items: [
      ['/audit/expiry', 'Expiry register', 'Log near-expiry stock and search the shared register.'],
      ['/audit/expiry/racks', 'Racks', 'Manage racks and who checks which rack each month.'],
    ],
  },
  {
    key: 'barcode',
    title: 'Barcode tools',
    items: [['/audit/barcode', 'Barcode centre', 'Find a product by barcode, register and verify barcodes, settle conflicts.']],
  },
  {
    key: 'templates',
    title: 'Audit templates',
    items: [['/audit/templates', 'Templates', 'Saved lists of product codes.']],
  },
  {
    key: 'admin',
    title: 'Audit administration',
    items: [['/audit/team', 'Team access', 'Give a person the Deputy or Sub-Auditor set of audit permissions, or switch single ones.']],
  },
];

const canOpen = (route, perms) => {
  if (!route) return false;
  if (route.permission) return perms.has(route.permission);
  return (route.anyOf ?? []).some((key) => perms.has(key));
};

export function toolGroups(routes, permissions) {
  const perms = permissions instanceof Set ? permissions : new Set(permissions ?? []);
  return GROUPS.flatMap((group) => {
    const items = group.items.flatMap(([path, label, description]) =>
      canOpen(
        routes.find((r) => r.path === path),
        perms,
      )
        ? [{ path, label, description }]
        : [],
    );
    return items.length ? [{ key: group.key, title: group.title, items }] : [];
  });
}
