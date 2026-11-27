import { describe, expect, it } from 'vitest';
import manifest from '../../js/modules/tasks/manifest.js';

describe('tasks manifest', () => {
  const by = Object.fromEntries(manifest.routes.map((r) => [r.path, r.permission]));
  it('gates each page by the permission the database also checks', () => {
    expect(by).toEqual({
      '/tasks': 'tasks.view_own',
      '/tasks/verify': 'tasks.verify',
      '/tasks/manage': 'tasks.manage',
      '/tasks/requests': 'tasks.manage',
      '/tasks/schedules': 'tasks.manage',
      '/tasks/team': 'tasks.manage',
      '/tasks/guide': 'tasks.manage',
    });
  });
  it('has titles and descriptions for the page list', () => {
    for (const r of manifest.routes) {
      expect(r.title.length).toBeGreaterThan(2);
      expect(r.desc.length).toBeGreaterThan(5);
    }
  });
  it('loads every page lazily', async () => {
    for (const r of manifest.routes) expect(typeof (await r.load()).mount).toBe('function');
  });
});
