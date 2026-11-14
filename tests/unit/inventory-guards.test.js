import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import manifest from '../../js/modules/inventory/manifest.js';

// Structural rules for the Inventory module (docs/modules/inventory-sync-design.md §8, MODULES.md §2). They are checked
// by reading the source, so a future change that breaks one fails here instead of on someone's phone.
const ROOT = new URL('../../js/modules/inventory/', import.meta.url).pathname;
const files = (dir = ROOT) =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.js') ? [p] : [];
  });
const sources = files().map((p) => ({ path: relative(ROOT, p), text: readFileSync(p, 'utf8') }));
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''); // ignore comments
const offenders = (test) => sources.filter((s) => test(code(s.text), s.path)).map((s) => s.path);

describe('Inventory module rules', () => {
  it('finds the module’s files', () => {
    expect(sources.length).toBeGreaterThan(10);
  });

  it('only data/ talks to Supabase', () => {
    expect(offenders((t, p) => /core\/supabase\.js/.test(t) && !p.startsWith('data/'))).toEqual([]);
  });

  it('nothing reads an inventory table directly: phones use the feed functions', () => {
    expect(offenders((t) => /\.from\(\s*['"`]inventory_/.test(t))).toEqual([]);
  });

  it('nothing selects every column', () => {
    expect(offenders((t) => /select\(\s*['"`]\s*\*\s*['"`]/.test(t))).toEqual([]);
  });

  it('nothing runs on a timer (refresh happens on open, on return after 15 minutes, and by hand)', () => {
    expect(offenders((t) => /setInterval\s*\(/.test(t))).toEqual([]);
  });

  it('nothing inserts raw HTML or evaluates text', () => {
    expect(offenders((t) => /innerHTML|insertAdjacentHTML|document\.write|\beval\s*\(|new Function\s*\(/.test(t))).toEqual([]);
  });

  it('product data is kept in IndexedDB only, never in localStorage or sessionStorage', () => {
    expect(offenders((t) => /localStorage|sessionStorage/.test(t))).toEqual([]);
  });

  it('every call that can return rows carries a limit', () => {
    const feed = code(sources.find((s) => s.path === 'data/feed.js').text);
    const calls = [...feed.matchAll(/call\(\s*'(inventory_[a-z_]+)'\s*(?:,\s*\{([^}]*)\})?/g)];
    expect(calls.length).toBeGreaterThanOrEqual(3);
    for (const [, name, args] of calls) {
      if (/^inventory_(changes_|search|balances)/.test(name)) expect(args ?? '', `${name} needs p_limit`).toContain('p_limit');
    }
  });

  it('the page size equals the database’s cap (1,000)', () => {
    expect(code(sources.find((s) => s.path === 'data/feed.js').text)).toMatch(/PAGE = 1000/);
  });
});

describe('manifest', () => {
  it('has one overview route guarded by inventory.search, a status pill, and the nav slot reserved for Inventory', () => {
    expect(manifest.id).toBe('inventory');
    expect(manifest.nav.order).toBe(40);
    expect(manifest.status.anyOf).toEqual(['inventory.search']);
    expect(manifest.routes.map((r) => [r.path, r.permission])).toEqual([['/inventory', 'inventory.search']]);
    for (const r of manifest.routes) expect(r.path.startsWith('/inventory')).toBe(true);
  });
});
