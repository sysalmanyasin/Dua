import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  compileRound,
  computeEffectiveRow,
  computeRowTimeDelta,
  detectConflicts,
  formatDuration,
  mergeFamilyCompiled,
  truncateExtraNote,
  varianceValuePaisa,
  EXTRA_NOTE_MAX_LENGTH,
  MAX_ROW_SECONDS,
} from '../../js/modules/audit/domain/compile.js';

// The same cases are run against the database function audit_compile_round() in supabase/tests/0402_audit_compile_test.sql.
// Expected figures were worked out by hand from docs/modules/audit.md, not produced by this code.
const { cases } = JSON.parse(readFileSync('tests/fixtures/audit/compile-cases.json', 'utf8'));

// Turns one fixture round into the input compileRound() takes.
function build(round, roundKey) {
  const items = round.items.map((it, i) => ({
    id: `${roundKey}-i${i}`,
    position: i + 1,
    company: it.company,
    code: it.code,
    name: it.name,
    qty: it.qty,
    pricePaisa: it.price_paisa,
  }));
  const assignments = round.assignments.map((a, n) => {
    const last = a.submissions[a.submissions.length - 1];
    const lines = {};
    if (last) {
      for (const [k, q] of Object.entries(last.counts || {})) lines[items[Number(k)].id] = { qty: q, auto: false };
      for (const k of last.auto || []) lines[items[k].id] = { qty: items[k].qty, auto: true };
    }
    return {
      id: `${roundKey}-a${n}`,
      auditorId: a.auditor,
      itemIds: a.items.map((i) => items[i].id),
      status: last ? 'submitted' : 'counting',
      submission: last ? { lines, extraNote: last.extraNote || '' } : null,
    };
  });
  const corrections = {};
  for (const [k, q] of Object.entries(round.corrections || {})) corrections[items[Number(k)].id] = q;
  return { items, assignments, corrections, allowMissing: round.allowMissing };
}

describe('audit compile maths (shared cases, also run against the database)', () => {
  for (const c of cases) {
    it(c.name, () => {
      const compiled = [];
      c.rounds.forEach((round, n) => {
        const key = `r${n}`;
        const input = build(round, key);
        const got = compileRound(input);
        if (round.expect.refused) {
          expect(got.refused).toBe(round.expect.refused);
          return;
        }
        round.expect.rows.forEach((want) => {
          const row = got.rows[want.item];
          expect(row.countedQty, 'counted').toBe(want.counted);
          expect(row.variance, 'variance').toBe(want.variance);
          expect(row.valuePaisa, 'value').toBe(want.value_paisa);
          expect(row.missing, 'missing').toBe(want.missing);
          expect(row.autoMatched, 'auto').toBe(want.auto);
          expect(row.corrected, 'corrected').toBe(want.corrected);
        });
        expect(got.variances).toBe(round.expect.variances);
        expect(got.valuePaisa).toBe(round.expect.value_paisa);
        expect(got.withMissing).toBe(round.expect.withMissing);
        expect(got.missingAssignmentIds.length).toBe(round.expect.missingAssignments);
        expect(detectConflicts(got.rows, compiled, key).length).toBe(round.expect.conflicts);
        if (round.expect.notes !== undefined) expect(got.notes.length).toBe(round.expect.notes);
        compiled.push({ roundId: key, rows: got.rows });
      });
    });
  }
});

describe('audit compile maths (rules not in the shared cases)', () => {
  it('an untouched item is 0 and missing; null counts as untouched', () => {
    expect(computeEffectiveRow(10, undefined, false)).toEqual({ effectiveQty: 0, missing: true, variance: -10 });
    expect(computeEffectiveRow(10, null, false).missing).toBe(true);
  });

  it('an auto-match reads as a real match but stays missing', () => {
    const real = computeEffectiveRow(34, 34, false);
    const auto = computeEffectiveRow(34, 34, true);
    expect(auto.effectiveQty).toBe(real.effectiveQty);
    expect(auto.variance).toBe(real.variance);
    expect(real.missing).toBe(false);
    expect(auto.missing).toBe(true);
  });

  it('money rounds half away from zero and never leaves float dust', () => {
    expect(varianceValuePaisa(-0.5, 101)).toBe(-51);
    expect(varianceValuePaisa(0.5, 101)).toBe(51);
    expect(varianceValuePaisa(0.1, 100)).toBe(10);
    expect(varianceValuePaisa(0, 12345)).toBe(0);
    expect(Object.is(varianceValuePaisa(-0.0001, 100), -0)).toBe(false);
  });

  it('a count for an item outside the assignment is ignored, not a crash', () => {
    const items = [{ id: 'i0', position: 1, company: 'Acme', code: 'C1', name: 'W', qty: 10, pricePaisa: 1000 }];
    const a = [
      { id: 'a0', auditorId: 'c1', itemIds: ['i0'], status: 'submitted', submission: { lines: { ROGUE: { qty: 99 } }, extraNote: '' } },
    ];
    const got = compileRound({ items, assignments: a });
    expect(got.rows[0].missing).toBe(true);
    expect(got.rows[0].countedQty).toBe(0);
  });

  it('an item with no assignment (a revoked person) is missing with no auditor', () => {
    const items = [{ id: 'i0', position: 1, company: 'Acme', code: 'C1', name: 'W', qty: 4, pricePaisa: 500 }];
    const got = compileRound({ items, assignments: [] });
    expect(got.rows[0]).toMatchObject({ missing: true, auditorId: null, variance: -4, valuePaisa: -2000 });
  });

  it('a conflict never compares a round with itself and keeps the later row of a repeated code', () => {
    const row = (itemId, position, qty) => ({
      itemId,
      position,
      company: 'Acme',
      code: 'C1',
      name: 'W',
      countedQty: qty,
      missing: false,
      auditorId: 'x',
    });
    const mine = [row('i0', 1, 5), row('i1', 2, 7)];
    expect(detectConflicts(mine, [{ roundId: 'r1', rows: mine }], 'r1')).toEqual([]);
    const got = detectConflicts(mine, [{ roundId: 'r2', rows: [row('j0', 1, 7)] }], 'r1');
    expect(got).toEqual([]); // 7 equals the later row, so no conflict
    expect(detectConflicts(mine, [{ roundId: 'r2', rows: [row('j0', 1, 5)] }], 'r1')).toHaveLength(1);
  });
});

describe('family merge, timing and notes (ported from the old tests)', () => {
  it('combines every round of the family and ignores others', () => {
    const rounds = [
      { roundId: 'r1', compiledAt: '2026-01-01T00:00:00Z', variances: [{ company: 'Acme', code: 'C1' }], mergedItems: [] },
      { roundId: 'r1a', compiledAt: '2026-01-02T00:00:00Z', variances: [{ company: 'Beta', code: 'C9' }], mergedItems: [] },
      { roundId: 'zz', compiledAt: '2026-01-03T00:00:00Z', variances: [{ company: 'Gamma', code: 'C5' }], mergedItems: [] },
    ];
    const m = mergeFamilyCompiled(['r1', 'r1a'], rounds);
    expect(m.variances.map((v) => v.company).sort()).toEqual(['Acme', 'Beta']);
    expect(m.memberCount).toBe(2);
  });

  it('a duplicate keeps the most recently compiled side; an empty family is empty', () => {
    const rounds = [
      { roundId: 'r1', compiledAt: '2026-01-01T00:00:00Z', variances: [{ company: 'Acme', code: 'C1', countedQty: 5 }], mergedItems: [] },
      { roundId: 'r1a', compiledAt: '2026-01-05T00:00:00Z', variances: [{ company: 'Acme', code: 'C1', countedQty: 9 }], mergedItems: [] },
    ];
    const m = mergeFamilyCompiled(['r1', 'r1a'], rounds);
    expect(m.variances).toHaveLength(1);
    expect(m.variances[0].countedQty).toBe(9);
    expect(mergeFamilyCompiled([], [])).toEqual({ mergedItems: [], variances: [], memberCount: 0 });
  });

  it('row time is the gap, capped, never negative', () => {
    expect(computeRowTimeDelta(1_000_000, 1_045_000)).toBe(45);
    expect(computeRowTimeDelta(1_000_000, 1_000_000 + 3_600_000)).toBe(MAX_ROW_SECONDS);
    expect(computeRowTimeDelta(null, Date.now())).toBe(0);
    expect(computeRowTimeDelta(undefined, Date.now())).toBe(0);
    expect(computeRowTimeDelta(1000, 1000)).toBe(0);
    expect(computeRowTimeDelta(1000, 500)).toBe(0);
    expect(computeRowTimeDelta(0, 500_000, 60)).toBe(60);
  });

  it('formats durations', () => {
    expect(formatDuration(45)).toBe('45s');
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(65)).toBe('1m 05s');
    expect(formatDuration(600)).toBe('10m 00s');
    expect(formatDuration(3661)).toBe('1h 01m');
    expect(formatDuration(7200)).toBe('2h 00m');
    expect(formatDuration(null)).toBe('—');
    expect(formatDuration(undefined)).toBe('—');
    expect(formatDuration(-5)).toBe('—');
  });

  it('caps the auditor note', () => {
    expect(truncateExtraNote('Panadol 10s found on shelf')).toBe('Panadol 10s found on shelf');
    expect(truncateExtraNote('x'.repeat(EXTRA_NOTE_MAX_LENGTH + 500))).toHaveLength(EXTRA_NOTE_MAX_LENGTH);
    expect(truncateExtraNote(undefined)).toBe('');
    expect(truncateExtraNote(null)).toBe('');
  });
});
