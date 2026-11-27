// Docs-consistency guard (Audit 0, T6). docs/PROJECT_STATUS.md carries a small block of structural facts between
// <!-- repo-facts --> markers. This test fails when they drift from the repository, so the status document cannot silently go stale
// the way the 22 Nov snapshot did (92 vs 131 migrations). Update the block when you add a migration, test file, function or module.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '../..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const count = (dir, re) => readdirSync(path.join(root, dir)).filter((f) => re.test(f)).length;

const status = read('docs/PROJECT_STATUS.md');
const block = /<!-- repo-facts -->([\s\S]*?)<!-- \/repo-facts -->/.exec(status)?.[1] ?? '';
const fact = (key) => Number(new RegExp(`^- ${key}: (\\d+)\\s*$`, 'm').exec(block)?.[1]);

describe('docs/PROJECT_STATUS.md repo-facts block', () => {
  it('exists and lists the four structural facts', () => {
    for (const k of ['Migration files', 'Database test files', 'Registered modules', 'Edge Functions'])
      expect(fact(k), k).toBeGreaterThan(0);
  });
  it('matches the number of migration files', () => expect(fact('Migration files')).toBe(count('supabase/migrations', /^\d{4}_.*\.sql$/)));
  it('matches the number of database test files', () => expect(fact('Database test files')).toBe(count('supabase/tests', /_test\.sql$/)));
  it('matches the number of registered modules', async () => {
    const { MODULE_IDS } = await import('../../js/modules/index.js');
    expect(fact('Registered modules')).toBe(MODULE_IDS.length);
  });
  it('matches the number of Edge Functions', () => {
    const dirs = readdirSync(path.join(root, 'supabase/functions'), { withFileTypes: true }).filter(
      (d) => d.isDirectory() && !d.name.startsWith('_') && d.name !== 'node_modules',
    );
    expect(fact('Edge Functions')).toBe(dirs.length);
  });
});

describe('workflow and docs agree on the Edge Functions', () => {
  it('CI type-checks every Edge Function directory', () => {
    const ci = read('.github/workflows/ci.yml');
    const listed = /for f in ([^;]+); do/.exec(ci)?.[1].trim().split(/\s+/) ?? [];
    const dirs = readdirSync(path.join(root, 'supabase/functions'), { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('_') && d.name !== 'node_modules')
      .map((d) => d.name);
    expect(listed.sort()).toEqual(dirs.sort());
  });
  it('every function with a public (verify_jwt = false) entry has its own check documented in config.toml', () => {
    const toml = read('supabase/config.toml');
    const pub = [...toml.matchAll(/\[functions\.([\w-]+)\]\s*\nverify_jwt = false/g)].map((m) => m[1]);
    for (const name of pub) expect(readdirSync(path.join(root, 'supabase/functions')), name).toContain(name);
  });
});

describe('every non-historical doc that names a count agrees with the repository', () => {
  it('README and the status document do not state a stale migration-file count', () => {
    const n = count('supabase/migrations', /^\d{4}_.*\.sql$/);
    for (const f of ['README.md', 'docs/PROJECT_STATUS.md']) {
      for (const m of read(f).matchAll(/(\d+) migration (?:SQL )?files/gi)) expect(Number(m[1]), `${f}: "${m[0]}"`).toBe(n);
    }
  });
});
