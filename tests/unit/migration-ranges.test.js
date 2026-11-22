import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';

// The range table in docs/MODULES.md §5.1 is the contract between sessions. Parse it and hold the migration files to it.
const doc = readFileSync(new URL('../../docs/MODULES.md', import.meta.url), 'utf8');
const ranges = [...doc.matchAll(/^\| `(\d{4})`–`(\d{4})` \| (.+?) \|$/gm)].map((m) => ({
  from: Number(m[1]),
  to: Number(m[2]),
  owner: m[3],
}));
const files = readdirSync(new URL('../../supabase/migrations/', import.meta.url)).filter((f) => f.endsWith('.sql'));

describe('migration ranges (docs/MODULES.md §5.1)', () => {
  it('reads the range table', () => {
    expect(ranges.length).toBeGreaterThanOrEqual(14);
  });

  it('has no overlapping ranges and each is ordered', () => {
    const sorted = [...ranges].sort((a, b) => a.from - b.from);
    for (const r of sorted) expect(r.from).toBeLessThanOrEqual(r.to);
    for (let i = 1; i < sorted.length; i++)
      expect(sorted[i].from, `${sorted[i - 1].owner} overlaps ${sorted[i].owner}`).toBeGreaterThan(sorted[i - 1].to);
  });

  it('reserves the redesign ranges', () => {
    const has = (from, to) => ranges.some((r) => r.from === from && r.to === to);
    expect(has(700, 749)).toBe(true); // Operations Dashboard
    expect(has(750, 799)).toBe(true); // Unified Reports
    expect(has(800, 899)).toBe(true); // AI
    expect(has(1200, 1299)).toBe(true); // Task Master
    expect(has(1300, 1399)).toBe(true); // Notifications & Reminders
  });

  it('keeps every migration file inside a reserved range', () => {
    const outside = files.filter((f) => {
      const n = Number(f.slice(0, 4));
      return !ranges.some((r) => n >= r.from && n <= r.to);
    });
    expect(outside).toEqual([]);
  });
});
