import { describe, expect, it } from 'vitest';
import {
  currentMonth,
  groupByProduct,
  historyRow,
  monthChoices,
  moreThanShown,
  overviewGroups,
  qtyText,
  searchTerm,
} from '../../js/modules/audit/domain/history.js';

const row = (o = {}) => ({
  engagement_id: 'e1',
  engagement_name: 'Annual audit',
  round_id: 'r1',
  round_label: '2',
  state: 'compiled',
  at: '2026-11-20T10:00:00Z',
  code: 'A1',
  name: 'Alpha one',
  company: 'Acme',
  system_qty: '10',
  counted_qty: '9',
  variance: '-1',
  variance_value: '-100.50',
  not_counted: false,
  assumed_to_match: false,
  corrected: false,
  total: 1,
  ...o,
});

describe('history helpers', () => {
  it('trims the search text and returns null when empty', () => {
    expect(searchTerm('  alpha ')).toBe('alpha');
    expect(searchTerm('   ')).toBeNull();
    expect(searchTerm(null)).toBeNull();
    expect(searchTerm('x'.repeat(200))).toHaveLength(80);
  });
  it('writes quantities without trailing zeros', () => {
    expect(qtyText('9.000')).toBe('9');
    expect(qtyText(2.5)).toBe('2.5');
    expect(qtyText(null)).toBe('–');
  });
  it('shapes a history row', () => {
    const r = historyRow(row({ corrected: true, not_counted: true }));
    expect(r.where).toBe('Annual audit · Round 2');
    expect(r.varianceText).toBe('−1');
    expect(r.value).toBe(-100.5);
    expect(r.flags).toEqual(['Not counted', 'Corrected']);
    expect(r.day).toBe('2026-11-20');
    expect(historyRow(row({ variance: '0' })).varianceText).toBe('Matches');
    expect(historyRow(row({ state: 'final' })).stateLabel).toBe('Final');
  });
  it('groups by product and keeps the order', () => {
    const g = groupByProduct([row(), row({ round_id: 'r2' }), row({ code: 'B1', name: 'Beta', company: 'Beta' })]);
    expect(g).toHaveLength(2);
    expect(g[0].rounds.map((x) => x.roundId)).toEqual(['r1', 'r2']);
    expect(groupByProduct(null)).toEqual([]);
  });
  it('knows when more rows exist than are shown', () => {
    expect(moreThanShown([row({ total: 5 })])).toBe(true);
    expect(moreThanShown([row({ total: 1 })])).toBe(false);
    expect(moreThanShown([])).toBe(false);
  });
  it('lists twelve months, newest first, across a year end', () => {
    const m = monthChoices(new Date('2026-02-10T08:00:00Z'));
    expect(m).toHaveLength(12);
    expect(m[0]).toEqual({ value: '2026-02', label: 'February 2026' });
    expect(m[2].value).toBe('2025-12');
    expect(m[11].value).toBe('2025-03');
  });
  it('takes the month in Pakistan time', () => {
    expect(currentMonth(new Date('2026-10-31T20:00:00Z'))).toBe('2026-11');
  });
  it('groups the overview by person and keeps unfinished rounds apart from zero differences', () => {
    const o = (x) => ({
      month: '2026-11',
      person_id: 'p1',
      person_name: 'Count One',
      engagement_id: 'e1',
      round_id: 'r1',
      round_label: '1',
      state: 'compiled',
      started_at: '2026-11-02T05:00:00Z',
      compiled_at: '2026-11-02T06:00:00Z',
      item_count: 2,
      variance_count: 2,
      variance_value: '-100',
      ...x,
    });
    const g = overviewGroups([
      o({}),
      o({ round_id: 'r2', state: 'counting', item_count: null, variance_count: null, variance_value: null }),
      o({ person_id: 'p2', person_name: 'Count Two', round_id: 'r3', variance_count: 0, variance_value: '0' }),
    ]);
    expect(g.map((p) => p.name)).toEqual(['Count One', 'Count Two']);
    expect(g[0].total).toBe(2);
    expect(g[0].waiting).toBe(1);
    expect(g[0].differences).toBeUndefined(); // never added across rounds
    expect(g[0].rounds[1].differences).toBeNull();
    expect(g[1].rounds[0].differences).toBe(0);
    expect(g[1].waiting).toBe(0);
    expect(overviewGroups(null)).toEqual([]);
  });
});

describe('what a round was started from, and the flat list', async () => {
  const { scopeLabel, flatRounds, overviewGroups } = await import('../../js/modules/audit/domain/history.js');
  it('names the template when there is one, whatever the companies are', () => {
    expect(scopeLabel('Morning shelf', ['Acme'])).toBe('Template: Morning shelf');
    expect(scopeLabel('  ', ['Acme'])).toBe('Acme');
  });
  it('lists up to two companies and counts the rest', () => {
    expect(scopeLabel(null, ['Acme'])).toBe('Acme');
    expect(scopeLabel(null, ['Acme', 'Beta'])).toBe('Acme, Beta');
    expect(scopeLabel(null, ['Acme', 'Beta', 'Cura'])).toBe('Acme, Beta +1 more');
  });
  it('says nothing when it is unknown', () => {
    expect(scopeLabel(null, [])).toBe('');
    expect(scopeLabel(undefined, undefined)).toBe('');
    expect(scopeLabel(null, ['', null])).toBe('');
  });
  it('puts every round newest first across people, and a round with no start last', () => {
    const base = {
      person_id: 'p',
      person_name: 'P',
      engagement_id: 'e',
      state: 'compiled',
      item_count: 1,
      variance_count: 0,
      variance_value: 0,
    };
    const rows = [
      { ...base, round_id: 'a', round_label: '1', started_at: '2026-11-02T05:00:00Z' },
      { ...base, person_id: 'q', person_name: 'Q', round_id: 'b', round_label: '2', started_at: '2026-11-09T05:00:00Z' },
      { ...base, round_id: 'c', round_label: '3', started_at: null },
    ];
    expect(flatRounds(overviewGroups(rows)).map((r) => r.roundId)).toEqual(['b', 'a', 'c']);
    expect(flatRounds(null)).toEqual([]);
  });
});
