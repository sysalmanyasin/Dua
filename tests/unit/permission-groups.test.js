import { describe, expect, it } from 'vitest';
import {
  applyOverride,
  buildGroups,
  bulkPlan,
  effectForToggle,
  filterGroups,
  groupId,
  groupLabel,
  shortName,
} from '../../js/shared/permissionGroups.js';

const permissions = [
  { key: 'audit.count', description: 'Count assigned audit items' },
  { key: 'audit.barcode_admin', description: 'Resolve barcode conflicts' },
  { key: 'audit.assign', description: 'Assign audit counters' },
  { key: 'closing.enter_own', description: 'Enter own closing' },
  { key: 'mgmt.salary', description: 'Salary' },
  { key: 'plain', description: 'No module part' },
];
const rolePerms = [
  { role: 'junior', perm_key: 'audit.count' },
  { role: 'junior', perm_key: 'closing.enter_own' },
  { role: 'senior', perm_key: 'audit.count' },
];

describe('names', () => {
  it('splits the module from the key', () => {
    expect(groupId('audit.barcode_admin')).toBe('audit');
    expect(groupId('plain')).toBe('other');
    expect(shortName('audit.barcode_admin')).toBe('Barcode admin');
    expect(groupLabel('mgmt')).toBe('Manager');
    expect(groupLabel('new_module')).toBe('New module');
  });
});

describe('buildGroups', () => {
  it('groups by module, sorted, with counts', () => {
    const gs = buildGroups(permissions, 'junior', rolePerms, [{ perm_key: 'audit.assign', effect: 'grant' }]);
    expect(gs.map((g) => g.id)).toEqual(['audit', 'closing', 'mgmt', 'other']);
    const audit = gs[0];
    expect(audit.items.map((i) => i.key)).toEqual(['audit.assign', 'audit.barcode_admin', 'audit.count']);
    expect(audit.total).toBe(3);
    expect(audit.allowedCount).toBe(2); // count from the role, assign from a personal Allow
    expect(audit.customCount).toBe(1);
  });
  it('deny wins over the role preset', () => {
    const gs = buildGroups(permissions, 'junior', rolePerms, [{ perm_key: 'audit.count', effect: 'deny' }]);
    const item = gs[0].items.find((i) => i.key === 'audit.count');
    expect(item).toMatchObject({ allowed: false, fromRole: true, override: 'deny' });
  });
  it('uses a given label instead of the key', () => {
    const gs = buildGroups([{ key: 'audit.count', label: 'Count stock', description: 'x' }], 'junior', rolePerms, []);
    expect(gs[0].items[0].name).toBe('Count stock');
  });
});

describe('filterGroups', () => {
  const gs = buildGroups(permissions, 'junior', rolePerms, [{ perm_key: 'mgmt.salary', effect: 'grant' }]);
  it('searches name, key, description and group', () => {
    expect(filterGroups(gs, { query: 'barcode' }).flatMap((g) => g.items.map((i) => i.key))).toEqual(['audit.barcode_admin']);
    expect(filterGroups(gs, { query: 'manager' }).map((g) => g.id)).toEqual(['mgmt']);
    expect(filterGroups(gs, { query: 'zzz' })).toEqual([]);
  });
  it('shows only allowed or only custom rows', () => {
    expect(filterGroups(gs, { filter: 'allowed' }).flatMap((g) => g.items.map((i) => i.key))).toEqual([
      'audit.count',
      'closing.enter_own',
      'mgmt.salary',
    ]);
    expect(filterGroups(gs, { filter: 'custom' }).flatMap((g) => g.items.map((i) => i.key))).toEqual(['mgmt.salary']);
  });
});

describe('checkbox to stored value', () => {
  it('stores nothing when the box matches the role preset', () => {
    expect(effectForToggle(true, true)).toBeNull();
    expect(effectForToggle(false, false)).toBeNull();
  });
  it('stores a personal Allow or Deny otherwise', () => {
    expect(effectForToggle(false, true)).toBe('grant');
    expect(effectForToggle(true, false)).toBe('deny');
  });
});

describe('bulkPlan', () => {
  const items = buildGroups(permissions, 'junior', rolePerms, [
    { perm_key: 'audit.count', effect: 'deny' },
    { perm_key: 'audit.assign', effect: 'grant' },
  ])[0].items; // assign (grant), barcode_admin (role no), count (deny over role yes)
  it('allow all changes only what is not allowed yet', () => {
    expect(bulkPlan(items, 'allow')).toEqual([
      { key: 'audit.barcode_admin', effect: 'grant' },
      { key: 'audit.count', effect: null }, // the role already gives it: remove the Deny
    ]);
  });
  it('allow none changes only what is allowed now', () => {
    expect(bulkPlan(items, 'clear')).toEqual([{ key: 'audit.assign', effect: null }]);
  });
  it('reset removes every personal setting', () => {
    expect(bulkPlan(items, 'reset')).toEqual([
      { key: 'audit.assign', effect: null },
      { key: 'audit.count', effect: null },
    ]);
  });
});

describe('applyOverride', () => {
  it('adds, replaces and removes', () => {
    let list = applyOverride([], 'a.b', 'grant');
    expect(list).toEqual([{ perm_key: 'a.b', effect: 'grant' }]);
    list = applyOverride(list, 'a.b', 'deny');
    expect(list).toEqual([{ perm_key: 'a.b', effect: 'deny' }]);
    expect(applyOverride(list, 'a.b', null)).toEqual([]);
  });
});

import { buildPermissionRows, filterPermissionRows } from '../../js/shared/permissionGroups.js';

describe('buildPermissionRows (By permission view)', () => {
  const people = [
    { user_id: 'o', username: 'owner', role_template: 'admin', staff: { full_name: 'Owner' } },
    { user_id: 'a', username: 'ann', role_template: 'junior', staff: { full_name: 'Ann' } },
    { user_id: 'b', username: 'bob', role_template: 'senior', staff: null, disabled_at: '2026-01-01' },
  ];
  const overrides = [
    { user_id: 'a', perm_key: 'audit.assign', effect: 'grant' },
    { user_id: 'b', perm_key: 'audit.count', effect: 'deny' },
  ];
  const groups = buildPermissionRows(permissions, people, rolePerms, overrides);
  const item = (key) => groups.flatMap((g) => g.items).find((i) => i.key === key);

  it('leaves the owner out and lists everyone else for every permission', () => {
    expect(item('audit.count').total).toBe(2);
    expect(
      item('audit.count')
        .people.map((p) => p.user_id)
        .sort(),
    ).toEqual(['a', 'b']);
  });
  it('uses role preset plus personal settings, deny wins', () => {
    expect(
      item('audit.count')
        .people.filter((p) => p.allowed)
        .map((p) => p.user_id),
    ).toEqual(['a']);
    expect(
      item('audit.assign')
        .people.filter((p) => p.allowed)
        .map((p) => p.user_id),
    ).toEqual(['a']);
    expect(item('mgmt.salary').allowedCount).toBe(0);
  });
  it('counts custom settings, falls back to username, and flags disabled logins', () => {
    expect(item('audit.count').customCount).toBe(1);
    const bob = item('audit.count').people.find((p) => p.user_id === 'b');
    expect(bob.name).toBe('bob');
    expect(bob.disabled).toBe(true);
  });
  it('puts allowed people first', () => {
    expect(item('audit.count').people[0].user_id).toBe('a');
  });
  it('filters by someone/nobody/custom and by search text', () => {
    const keys = (f) => filterPermissionRows(groups, f).flatMap((g) => g.items.map((i) => i.key));
    expect(keys({ filter: 'nobody' })).toContain('mgmt.salary');
    expect(keys({ filter: 'nobody' })).not.toContain('audit.count');
    expect(keys({ filter: 'allowed' })).toContain('closing.enter_own');
    expect(keys({ filter: 'custom' }).sort()).toEqual(['audit.assign', 'audit.count']);
    expect(keys({ query: 'salary' })).toEqual(['mgmt.salary']);
  });
});
