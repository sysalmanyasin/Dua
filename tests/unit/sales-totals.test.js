import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { computeDiff, computeTotal, percentChange, roundRupee } from '../../js/modules/sales/domain/totals.js';

const cases = JSON.parse(readFileSync('tests/fixtures/sales-total-cases.json', 'utf8'));
const migration = readFileSync('supabase/migrations/0002_sales.sql', 'utf8');

// Read the real seed from the migration so the browser and the database cannot drift apart.
const methods = [...migration.matchAll(/^ \('([a-z_]+)', '[^']+', '[^']+', '(add|sub|none)'/gm)].map((m) => ({ code: m[1], sign: m[2] }));

describe('sales total (shared cases, also run against the database)', () => {
  it('reads the seeded methods', () => {
    expect(methods.length).toBe(31);
    expect(methods.find((m) => m.code === 'cash_returns').sign).toBe('sub');
  });
  for (const c of cases) it(c.name, () => expect(computeTotal(c.lines, methods)).toBe(c.total));
});

describe('helpers', () => {
  it('DIFF is total minus COMP SALE, empty COMP SALE counts as zero', () => {
    expect(computeDiff(100000, 90000)).toBe(10000);
    expect(computeDiff(100000, null)).toBe(100000);
  });
  it('rounds half up like Math.round', () => {
    for (const x of [0.5, 1.5, -0.5, -1.5, 2.4, -2.6]) expect(roundRupee(x) === Math.round(x)).toBe(true);
  });
  it('percent change has no answer without a base', () => {
    expect(percentChange(110, 100)).toBeCloseTo(10);
    expect(percentChange(5, 0)).toBeNull();
  });
});
