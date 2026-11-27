// The pure side of the live round view: rows, people, totals, A to Z, filters.
import { describe, expect, it } from 'vitest';
import { LIVE_FILTERS, diffText, filterLive, liveCounts, liveFrom } from '../../js/modules/audit/domain/roundLive.js';

const row = (o) => ({
  round_item_id: o.code,
  assignment_id: 'a1',
  person: 'P',
  company: 'Acme',
  system_qty: 10,
  counted: false,
  qty: null,
  auto_matched: false,
  note: '',
  ...o,
});

describe('liveFrom', () => {
  const res = {
    round: { state: 'counting' },
    assignments: [{ id: 'a1', name: 'P', status: 'assigned', items: 4, counted: 9, differences: 2, forced: false }],
    items: [
      row({ code: 'B', name: 'beta', counted: true, qty: 8, difference: -2, difference_value: -40 }),
      row({ code: 'A', name: 'Alpha', counted: true, qty: 10, difference: 0, difference_value: 0 }),
      row({ code: 'C', name: 'Cura', counted: true, qty: 13, difference: 3, difference_value: 30.5 }),
      row({ code: 'D', name: 'Dova' }),
    ],
  };
  it('sorts A to Z without caring about case', () => {
    expect(liveFrom(res).items.map((i) => i.name)).toEqual(['Alpha', 'beta', 'Cura', 'Dova']);
  });
  it('totals: counted, remaining, percent, differences and their value', () => {
    expect(liveFrom(res).totals).toEqual({ items: 4, counted: 3, remaining: 1, percent: 75, differences: 2, value: -9.5 });
  });
  it('an uncounted item has no quantity and no difference, not zero', () => {
    const d = liveFrom(res).items.find((i) => i.name === 'Dova');
    expect(d).toMatchObject({ counted: false, qty: null, difference: null, value: null, hasDifference: false });
  });
  it('a counted item with no difference is not a difference', () => {
    expect(liveFrom(res).items.find((i) => i.name === 'Alpha').hasDifference).toBe(false);
  });
  it('people never show more done than they were given', () => {
    expect(liveFrom(res).people[0]).toMatchObject({ total: 4, done: 4, percent: 100, differences: 2, submitted: false });
  });
  it('copes with an empty or missing answer', () => {
    expect(liveFrom(null)).toMatchObject({ state: null, items: [], people: [], totals: { items: 0, percent: 0, differences: 0 } });
  });
});

describe('filters', () => {
  const m = liveFrom({
    items: [
      row({ code: 'A', name: 'A', counted: true, qty: 10, difference: 0 }),
      row({ code: 'B', name: 'B', counted: true, qty: 9, difference: -1 }),
      row({ code: 'C', name: 'C' }),
    ],
  });
  it('offers All, Differences, Counted and Not counted', () => {
    expect(LIVE_FILTERS.map((f) => f.label)).toEqual(['All', 'Differences', 'Counted', 'Not counted']);
  });
  it('shows what each one says', () => {
    expect(filterLive(m.items, 'diff').map((i) => i.name)).toEqual(['B']);
    expect(filterLive(m.items, 'counted').map((i) => i.name)).toEqual(['A', 'B']);
    expect(filterLive(m.items, 'left').map((i) => i.name)).toEqual(['C']);
    expect(filterLive(m.items, 'nonsense')).toHaveLength(3);
    expect(liveCounts(m.items)).toEqual({ all: 3, diff: 1, counted: 2, left: 1 });
  });
});

describe('diffText', () => {
  it('signs the difference', () => {
    expect([diffText(2), diffText(-1), diffText(0), diffText(null), diffText(-0.5)]).toEqual(['+2', '−1', '0', '–', '−0.5']);
  });
});
