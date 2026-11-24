import { describe, expect, it } from 'vitest';
import { FILTERS, attentionBadges, filterCounts, filterItems, progressModel } from '../../js/modules/audit/domain/progress.js';

const item = (o = {}) => ({
  round_item_id: 'i1',
  code: 'A1',
  name: 'Alpha one',
  company: 'Acme',
  counted: true,
  qty: '4',
  auto_matched: false,
  confirmed_same: false,
  note: '',
  counted_at: '2026-11-20T10:00:00Z',
  ...o,
});
const res = () => ({
  assignment: { id: 'a1', name: 'Count One', status: 'counting', round_state: 'counting' },
  items: [
    item(),
    item({ round_item_id: 'i2', code: 'A2', counted: false, qty: null }),
    item({ round_item_id: 'i3', code: 'B1', auto_matched: true, qty: '8', note: 'sealed' }),
    item({ round_item_id: 'i4', code: 'C1', counted: false, qty: null }),
  ],
});

describe('progress model', () => {
  it('counts items and keeps not-counted quantities null, never zero', () => {
    const m = progressModel(res());
    expect(m.name).toBe('Count One');
    expect(m.total).toBe(4);
    expect(m.counted).toBe(2);
    expect(m.left).toBe(2);
    expect(m.items[1].qty).toBeNull();
    expect(m.items[0].qty).toBe(4);
  });
  it('copes with an empty answer', () => {
    const m = progressModel(null);
    expect(m.total).toBe(0);
    expect(m.name).toBe('Someone');
  });
  it('filters, and the chip numbers equal what each filter shows', () => {
    const m = progressModel(res());
    expect(filterItems(m.items, 'left').map((i) => i.code)).toEqual(['A2', 'C1']);
    expect(filterItems(m.items, 'counted')).toHaveLength(2);
    expect(filterItems(m.items, 'assumed').map((i) => i.code)).toEqual(['B1']);
    expect(filterItems(m.items, 'notes').map((i) => i.code)).toEqual(['B1']);
    expect(filterItems(m.items, 'nonsense')).toHaveLength(4);
    const c = filterCounts(m.items);
    for (const f of FILTERS) expect(c[f.key]).toBe(filterItems(m.items, f.key).length);
  });
});

describe('attention badges', () => {
  const row = (o = {}) => ({ engagement_id: 'e1', engagement_name: 'Annual', round_id: 'r1', round_label: '2', n: 1, ...o });
  it('counts rounds for ready and sums n for conflicts and corrections', () => {
    const b = attentionBadges({
      ready: [row(), row({ round_id: 'r2' })],
      conflicts: [row({ n: 2 }), row({ round_id: 'r3', n: 3 })],
      corrections: [row({ n: 1 })],
    });
    expect(b.map((x) => [x.key, x.count])).toEqual([
      ['ready', 2],
      ['conflicts', 5],
      ['corrections', 1],
    ]);
    expect(b[0].text).toBe('2 rounds ready to compile');
    expect(b[1].text).toBe('5 open conflicts');
    expect(b[2].text).toBe('1 correction waiting');
    for (const x of b) expect(x.count).toBe(x.key === 'ready' ? x.rows.length : x.rows.reduce((n, r) => n + r.n, 0));
  });
  it('uses the singular and leaves out empty lists', () => {
    const b = attentionBadges({ ready: [row()], conflicts: [], corrections: [] });
    expect(b).toHaveLength(1);
    expect(b[0].text).toBe('1 round ready to compile');
    expect(attentionBadges(null)).toEqual([]);
  });
});
