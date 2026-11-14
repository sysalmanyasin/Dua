import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls = [];
let result = { data: [], error: null };
const builder = (name) => {
  const b = {
    select: (cols) => (calls.push({ name, select: cols }), b),
    eq: (...a) => (calls.push({ name, eq: a }), b),
    in: () => b,
    order: () => b,
    limit: () => b,
    maybeSingle: () => b,
    then: (res, rej) => Promise.resolve(result).then(res, rej),
  };
  return b;
};
const rpc = vi.fn(async () => result);
vi.mock('../../js/core/supabase.js', () => ({ db: () => ({ from: (t) => builder(t), rpc }) }));

const api = await import('../../js/modules/str/data/api.js');
const inv = await import('../../js/modules/str/data/inventory.js');

beforeEach(() => {
  calls.length = 0;
  rpc.mockClear();
  result = { data: [], error: null };
});

describe('STR reads', () => {
  it('always names its columns, never reads cost, never uses select *', async () => {
    await api.feedHeaders();
    await api.headerById(1);
    await api.lines(1);
    await api.dataAsOf();
    const cols = calls.map((c) => c.select).filter(Boolean);
    expect(cols).toHaveLength(4);
    for (const c of cols) {
      expect(c).not.toContain('*');
      expect(c).not.toMatch(/cost/i);
    }
  });
  it('reads the live feed only for the default list', async () => {
    await api.feedHeaders();
    expect(calls.find((c) => c.eq)?.eq).toEqual(['in_feed', true]);
  });
  it('sends the search to the server with the 50-row page and blanks as null', async () => {
    await api.searchHeaders({ text: 'syrup', offset: 50 });
    expect(rpc).toHaveBeenCalledWith('str_search_headers', {
      p_text: 'syrup',
      p_from: null,
      p_to: null,
      p_stage: null,
      p_direction: null,
      p_limit: 50,
      p_offset: 50,
    });
  });
  it('throws the database error so the page can show its own message', async () => {
    result = { data: null, error: { message: 'boom' } };
    await expect(api.feedHeaders()).rejects.toMatchObject({ message: 'boom' });
  });
  it('reports when the feed last wrote STR rows', async () => {
    result = { data: [{ synced_at: '2026-11-14T08:00:00Z' }], error: null };
    expect(await api.dataAsOf()).toBe('2026-11-14T08:00:00Z');
    result = { data: [], error: null };
    expect(await api.dataAsOf()).toBeNull();
  });
});

describe('Inventory product lookup', () => {
  it('maps what Inventory returns', async () => {
    result = { data: [{ code: 'P1', supplier: 'Alpha', conversion_factor: 10, found: true }], error: null };
    expect(await inv.productMeta(['P1', 'P1', ''])).toEqual({ P1: { supplier: 'Alpha', factor: 10 } });
    expect(rpc).toHaveBeenCalledWith('inventory_product_meta', { p_codes: ['P1'] });
  });
  it('asks nothing when there are no codes', async () => {
    expect(await inv.productMeta([])).toEqual({});
    expect(rpc).not.toHaveBeenCalled();
  });
  it('returns null when Inventory does not offer the lookup yet', async () => {
    result = { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.inventory_product_meta' } };
    expect(await inv.productMeta(['P1'])).toBeNull();
  });
  it('still throws on a real failure', async () => {
    result = { data: null, error: { code: '42501', message: 'not allowed' } };
    await expect(inv.productMeta(['P1'])).rejects.toBeTruthy();
  });
  it('splits more than 500 codes into calls of at most 500', async () => {
    await inv.productMeta(Array.from({ length: 1100 }, (_, i) => `C${i}`));
    expect(rpc).toHaveBeenCalledTimes(3);
    expect(rpc.mock.calls[0][1].p_codes).toHaveLength(500);
    expect(rpc.mock.calls[2][1].p_codes).toHaveLength(100);
  });
});

describe('Batch line reads', () => {
  it('reads lines in batches of 25 STRs, never selecting cost', async () => {
    await api.linesFor(Array.from({ length: 60 }, (_, i) => i + 1));
    const reads = calls.filter((c) => c.select);
    expect(reads).toHaveLength(3);
    expect(reads.every((c) => !/cost|\*/.test(c.select))).toBe(true);
  });
});
