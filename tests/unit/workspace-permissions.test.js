import { describe, expect, it } from 'vitest';
import { ACTIONS, can, ROLES, roleLabel } from '../../js/modules/workspace/domain/permissions.js';

// The matrix from docs/modules/workspace.md section 5: [action, owner, editor, viewer]
const MATRIX = [
  ['read', true, true, true],
  ['download', true, true, true],
  ['edit', true, true, false],
  ['upload', true, true, false],
  ['snapshot', true, true, false],
  ['resolve_own_conflicts', true, true, false],
  ['restore', true, false, false],
  ['share', true, false, false],
  ['manage_members', true, false, false],
  ['transfer', true, false, false],
  ['archive', true, false, false],
  ['delete', true, false, false],
  ['rename', true, false, false],
  ['history_setting', true, false, false],
];

describe('permission matrix', () => {
  it.each(MATRIX)('%s: owner %s, editor %s, viewer %s', (action, owner, editor, viewer) => {
    expect(can('owner', action)).toBe(owner);
    expect(can('editor', action)).toBe(editor);
    expect(can('viewer', action)).toBe(viewer);
  });
  it('covers every action exactly once', () => {
    const named = new Set([...MATRIX.map((m) => m[0]), 'view_history']);
    expect([...named].sort()).toEqual([...ACTIONS].sort());
  });
  it('viewers see history only while the owner allows it', () => {
    expect(can('viewer', 'view_history', { historyVisible: true })).toBe(true);
    expect(can('viewer', 'view_history', { historyVisible: false })).toBe(false);
    expect(can('editor', 'view_history', { historyVisible: false })).toBe(true);
    expect(can('owner', 'view_history', { historyVisible: false })).toBe(true);
  });
  it('an archived document is read-only, even for its owner', () => {
    for (const a of ['edit', 'upload', 'snapshot', 'restore', 'share', 'rename', 'transfer'])
      expect(can('owner', a, { archived: true }), a).toBe(false);
    for (const a of ['read', 'download', 'archive', 'delete']) expect(can('owner', a, { archived: true }), a).toBe(true);
    expect(can('editor', 'edit', { archived: true })).toBe(false);
  });
  it('unknown roles and actions are always refused', () => {
    expect(can('admin', 'read')).toBe(false);
    expect(can(undefined, 'read')).toBe(false);
    expect(can('owner', 'launch')).toBe(false);
    expect(can('owner', undefined)).toBe(false);
  });
  it('has exactly three roles with readable labels', () => {
    expect(ROLES).toEqual(['owner', 'editor', 'viewer']);
    expect(roleLabel('editor')).toBe('Can edit');
    expect(roleLabel('viewer')).toBe('Can view');
    expect(roleLabel('owner')).toBe('Owner');
    expect(roleLabel('x')).toBe('');
  });
});
