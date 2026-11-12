import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MODULE_IDS } from '../../js/modules/index.js';

const migrations = readdirSync('supabase/migrations')
  .map((f) => readFileSync(`supabase/migrations/${f}`, 'utf8'))
  .join('\n');
const dbPermissions = new Set([...migrations.matchAll(/^\s*\('([a-z_]+\.[a-z_]+)',/gm)].map((m) => m[1]));

describe('modules match the database', () => {
  it('finds the seeded permission list', () => {
    expect(dbPermissions.size).toBeGreaterThanOrEqual(25);
  });
  for (const id of MODULE_IDS) {
    it(`module "${id}" has a valid manifest whose permission exists in the database`, async () => {
      const m = (await import(`../../js/modules/${id}/manifest.js`)).default;
      expect(m.id).toBe(id);
      expect(typeof m.title).toBe('string');
      expect(m.routes.length).toBeGreaterThan(0);
      for (const r of m.routes) {
        expect(r.path).toMatch(/^\/[a-z0-9/_-]+$/);
        expect(typeof r.load).toBe('function');
      }
      if (m.permission) expect(dbPermissions.has(m.permission), `${m.permission} is not seeded`).toBe(true);
    });
  }
  it('route paths are unique across modules', async () => {
    const paths = [];
    for (const id of MODULE_IDS) paths.push(...(await import(`../../js/modules/${id}/manifest.js`)).default.routes.map((r) => r.path));
    expect(new Set(paths).size).toBe(paths.length);
  });
});

describe('every public table is protected', () => {
  it('has RLS enabled for each created table', () => {
    const created = [...migrations.matchAll(/create table public\.(\w+)/g)].map((m) => m[1]);
    for (const t of created) expect(migrations).toContain(`alter table public.${t} enable row level security`);
  });
});
