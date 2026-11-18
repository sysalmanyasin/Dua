// Counting logic and the offline outbox: what a person typed, the difference on a row, and the PHONE 1 promise —
// 200 counts made without signal are all sent after reconnecting, none lost and none doubled.
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import {
  filterItems,
  parseCodes,
  parseCompanies,
  parseQty,
  rowView,
  rupees,
  summarize,
  toPaisa,
} from '../../js/modules/audit/domain/count.js';
import { BATCH_SIZE, flushOutbox, latestByItem, makeEvent, toWire } from '../../js/modules/audit/domain/outbox.js';
import { createIdbStore, createMemoryStore } from '../../js/modules/audit/data/outboxStore.js';

const item = (id, over = {}) => ({
  round_item_id: id,
  code: id.toUpperCase(),
  name: `Item ${id}`,
  company: 'Acme',
  system_qty: 10,
  retail_price: 100.5,
  ...over,
});

describe('reading what was typed', () => {
  it('accepts plain quantities with up to three decimals and nothing else', () => {
    expect(parseQty('12')).toBe(12);
    expect(parseQty(' 2.5 ')).toBe(2.5);
    expect(parseQty('0')).toBe(0);
    for (const bad of ['', '-1', '1,5', '1.2345', 'abc', '1e3', '١٢', '1000000000']) expect(parseQty(bad)).toBeNull();
  });
  it('splits company names on lines and semicolons only, since a name can contain a comma', () => {
    expect(parseCompanies('Acme, Inc\nBeta;Acme, Inc\n ')).toEqual(['Acme, Inc', 'Beta']);
  });
  it('splits codes on spaces, commas, semicolons and lines, keeping the first of any repeat', () => {
    expect(parseCodes('A1, A2;A3\nA1  B9\n')).toEqual(['A1', 'A2', 'A3', 'B9']);
    expect(parseCodes('  ')).toEqual([]);
  });
});

describe('a row and its difference', () => {
  it('values a shortage at the retail price, in paisa', () => {
    const v = rowView(item('a'), { qty: 7, auto: false });
    expect(v).toMatchObject({ counted: true, difference: -3, value: -30150 });
    expect(rupees(v.value)).toBe('-Rs 301.50');
  });
  it('an uncounted row has no difference yet; marking as matching reads as zero', () => {
    expect(rowView(item('a'), undefined)).toMatchObject({ counted: false, difference: null, value: null });
    expect(rowView(item('a'), { qty: 10, auto: true })).toMatchObject({ counted: true, auto: true, difference: 0, value: 0 });
  });
  it('a real zero is a count, not a missing one', () => {
    expect(rowView(item('a'), { qty: 0, auto: false })).toMatchObject({ counted: true, difference: -10 });
  });
  it('converts a price to paisa without float drift', () => {
    expect(toPaisa(100.5)).toBe(10050);
    expect(toPaisa('19.99')).toBe(1999);
    expect(toPaisa(0.29)).toBe(29);
  });
  it('totals and filters', () => {
    const items = [item('a'), item('b'), item('c', { company: 'Beta', name: 'Zinc tablets' })];
    const entries = { a: { qty: 10, auto: false }, b: { qty: 8, auto: false } };
    expect(summarize(items, entries)).toEqual({ total: 3, counted: 2, left: 1, different: 1, value: -20100 });
    const ids = (f) => filterItems(items, entries, f).map((i) => i.round_item_id);
    expect(ids({ mode: 'todo' })).toEqual(['c']);
    expect(ids({ mode: 'done' })).toEqual(['a', 'b']);
    expect(ids({ mode: 'diff' })).toEqual(['b']);
    expect(ids({ company: 'Beta' })).toEqual(['c']);
    expect(ids({ text: 'ZINC' })).toEqual(['c']);
  });
});

describe('events', () => {
  it('keeps notes and time within the database limits', () => {
    const e = makeEvent({ assignmentId: 'x', itemId: 'a', qty: 3, note: 'n'.repeat(900), rowSeconds: 9999 });
    expect(e.note).toHaveLength(500);
    expect(e.row_seconds).toBe(600);
    expect(makeEvent({ assignmentId: 'x', itemId: 'a', auto: true, qty: 4 }).qty).toBeNull();
    expect(Object.keys(toWire(e)).sort()).toEqual(['at', 'auto', 'confirmed', 'event_id', 'item', 'note', 'qty', 'row_seconds']);
  });
  it('shows the newest waiting count per item', () => {
    const l = latestByItem([
      { item: 'a', qty: 1 },
      { item: 'b', qty: 2 },
      { item: 'a', qty: 3 },
    ]);
    expect(l.a.qty).toBe(3);
    expect(l.b.qty).toBe(2);
  });
});

// A stand-in for audit_count_batch: ignores an event id it has already seen, like the unique key does.
function fakeServer({ failTimes = 0, loseReplyOnce = false } = {}) {
  const seen = new Map();
  let fails = failTimes;
  let lost = loseReplyOnce;
  return {
    seen,
    calls: 0,
    async send(_assignment, events) {
      this.calls += 1;
      if (fails > 0) {
        fails -= 1;
        throw new TypeError('Failed to fetch');
      }
      for (const e of events) if (!seen.has(e.event_id)) seen.set(e.event_id, e);
      if (lost) {
        lost = false;
        throw new TypeError('Failed to fetch'); // saved, but the answer never arrived
      }
      return { accepted: events.length };
    },
  };
}

for (const [name, make] of [
  ['memory store', () => createMemoryStore()],
  ['IndexedDB store', () => createIdbStore(new IDBFactory())],
]) {
  describe(`outbox (${name})`, () => {
    const fill = async (store, n, assignment = 'asg1') => {
      for (let i = 0; i < n; i++) await store.add(makeEvent({ assignmentId: assignment, itemId: `i${i % 150}`, qty: i }));
    };

    it('PHONE 1: 200 counts made offline are all sent after reconnecting, none lost, none doubled', async () => {
      const store = make();
      await fill(store, 200);
      const server = fakeServer({ failTimes: 3 });
      // airplane mode: every attempt fails and nothing is dropped
      for (let i = 0; i < 3; i++) {
        const r = await flushOutbox({ store, send: (a, e) => server.send(a, e), assignmentId: 'asg1' });
        expect(r.error.kind).toBe('offline');
        expect(r.left).toBe(200);
      }
      expect(server.seen.size).toBe(0);
      // signal returns
      const r = await flushOutbox({ store, send: (a, e) => server.send(a, e), assignmentId: 'asg1' });
      expect(r).toEqual({ sent: 200, left: 0, error: null });
      expect(server.seen.size).toBe(200);
      expect(await store.count('asg1')).toBe(0);
    });

    it('a batch the server saved but whose reply was lost is resent without doubling', async () => {
      const store = make();
      await fill(store, 30);
      const server = fakeServer({ loseReplyOnce: true });
      const first = await flushOutbox({ store, send: (a, e) => server.send(a, e), assignmentId: 'asg1' });
      expect(first.error.kind).toBe('offline');
      expect(first.left).toBe(30); // the device cannot know the server got them, so it keeps them
      const second = await flushOutbox({ store, send: (a, e) => server.send(a, e), assignmentId: 'asg1' });
      expect(second.left).toBe(0);
      expect(server.seen.size).toBe(30); // the same 30 events, once each
    });

    it('sends oldest first, in batches, and only the one assignment', async () => {
      const store = make();
      await fill(store, BATCH_SIZE + 5);
      await fill(store, 4, 'other');
      const sizes = [];
      const order = [];
      const r = await flushOutbox({
        store,
        assignmentId: 'asg1',
        send: async (_a, events) => {
          sizes.push(events.length);
          order.push(...events.map((e) => e.qty));
        },
      });
      expect(r.sent).toBe(BATCH_SIZE + 5);
      expect(sizes).toEqual([BATCH_SIZE, 5]);
      expect(order).toEqual([...order].sort((a, b) => a - b));
      expect(await store.count('other')).toBe(4);
    });

    it('stops at a refusal, keeps the counts, and explains it', async () => {
      const store = make();
      await fill(store, 3);
      const refuse = Object.assign(new Error('x'), { hint: 'round_not_counting' });
      const r = await flushOutbox({ store, assignmentId: 'asg1', send: async () => Promise.reject(refuse) });
      expect(r).toMatchObject({ sent: 0, left: 3, error: { kind: 'refused', code: 'round_not_counting' } });
    });

    it('keeps a saved list and forgets everything on reset', async () => {
      const store = make();
      await fill(store, 2);
      await store.setKv('items:asg1', { a: 1 });
      expect(await store.getKv('items:asg1')).toEqual({ a: 1 });
      await store.reset();
      expect(await store.count()).toBe(0);
      expect(await store.getKv('items:asg1')).toBeNull();
    });
  });
}
