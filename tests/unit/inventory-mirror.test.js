import { describe, expect, it } from 'vitest';
import { createMirror, isStale, LOCAL_SCHEMA, STALE_AFTER_MS } from '../../js/modules/inventory/data/mirror.js';
import { memoryStore } from '../../js/modules/inventory/data/memoryStore.js';

// A fake server that behaves like the real feed: every changed row gets its own counter value, removed products stay
// as tombstones, pages are cut by counter, and `reset` is answered when a device is ahead of the server.
const STOCK_COLS = ['code', 'name', 'qty', 'price', 'pack'];
const SALES_COLS = ['code', 'n30', 'n90'];

function fakeServer({ pageSize = 3, schema = 1 } = {}) {
  const rows = new Map();
  const s = { seqStock: 0, seqSales: 0, calls: [], resetNext: false, schema, pageSize };
  const active = () => [...rows.values()].filter((r) => r.active).length;
  const page = (group, since) => {
    const seqKey = group === 'stock' ? 'seqStock' : 'seqSales';
    s.calls.push(`${group}:${since}`);
    const cols = group === 'stock' ? STOCK_COLS : SALES_COLS;
    if (s.resetNext || since > s[group === 'stock' ? 'seqStock' : 'seqSales']) {
      s.resetNext = false;
      return {
        reset: true,
        cols,
        rows: [],
        removed: [],
        next: 0,
        done: true,
        seq: s[group === 'stock' ? 'seqStock' : 'seqSales'],
        activeCount: active(),
      };
    }
    const chunk = [...rows.values()]
      .filter((r) => r[seqKey] > since)
      .sort((a, b) => a[seqKey] - b[seqKey])
      .slice(0, s.pageSize);
    return {
      reset: false,
      cols,
      rows: chunk.filter((r) => r.active).map((r) => cols.map((c) => r[c])),
      removed: chunk.filter((r) => !r.active).map((r) => r.code),
      next: chunk.length ? chunk[chunk.length - 1][seqKey] : since,
      done: chunk.length < s.pageSize,
      seq: s[group === 'stock' ? 'seqStock' : 'seqSales'],
      activeCount: active(),
    };
  };
  const server = {
    state: s,
    put(code, fields = {}) {
      const r = rows.get(code) ?? { code, name: `Item ${code}`, qty: 1, price: 1, pack: 1, n30: 0, n90: 0, active: true, seqSales: 0 };
      Object.assign(r, fields, { active: true, seqStock: ++s.seqStock });
      if (!r.seqSales) r.seqSales = ++s.seqSales;
      rows.set(code, r);
    },
    sell(code, n30) {
      const r = rows.get(code);
      Object.assign(r, { n30, n90: n30 * 3, seqSales: ++s.seqSales });
    },
    remove(code) {
      Object.assign(rows.get(code), { active: false, seqStock: ++s.seqStock, seqSales: ++s.seqSales });
    },
    feed: {
      async latestSync() {
        s.calls.push('latest');
        if (s.down) throw new TypeError('Failed to fetch');
        if (s.denied) throw Object.assign(new Error('not allowed'), { code: '42501' });
        return {
          synced_at: '2026-11-12T12:00:00Z',
          item_count: active(),
          source: 'dropbox',
          seq_stock: s.seqStock,
          seq_sales: s.seqSales,
          active_count: active(),
          schema_version: s.schema,
        };
      },
      async changesStock(since) {
        return page('stock', since);
      },
      async changesSales(since) {
        return page('sales', since);
      },
    },
  };
  return server;
}
const fill = (server, n) => {
  for (let i = 1; i <= n; i++) server.put(`P${String(i).padStart(3, '0')}`, { qty: i, price: 2 });
};
const setup = (opts, n = 7) => {
  const server = fakeServer(opts);
  fill(server, n);
  const store = memoryStore();
  let t = 1_000_000;
  const mirror = createMirror({ store, feed: server.feed, now: () => t });
  return { server, store, mirror, tick: (ms) => (t += ms) };
};
const ME = { userId: 'u1', canSales: true };
const dataCalls = (server) => server.state.calls.filter((c) => c !== 'latest');

describe('first install', () => {
  it('pages through the whole feed and stores every product, with the sales half when allowed', async () => {
    const { server, mirror } = setup({}, 7);
    const r = await mirror.sync(ME);
    expect(r.status).toBe('updated');
    const { stock, sales, meta } = await mirror.read();
    expect(stock).toHaveLength(7);
    expect(stock.find((x) => x.code === 'P003')).toMatchObject({ name: 'Item P003', qty: 3, price: 2 });
    expect(sales.size).toBe(7);
    expect(meta).toMatchObject({
      userId: 'u1',
      schema: LOCAL_SCHEMA,
      seqStock: 7,
      seqSales: 7,
      syncedAt: '2026-11-12T12:00:00Z',
      fetchedAt: 1_000_000,
    });
    expect(dataCalls(server).filter((c) => c.startsWith('stock'))).toEqual(['stock:0', 'stock:3', 'stock:6']);
  });

  it('without inventory.view the sales half is never requested and never stored', async () => {
    const { server, mirror } = setup({}, 4);
    await mirror.sync({ userId: 'u1', canSales: false });
    expect(dataCalls(server).some((c) => c.startsWith('sales'))).toBe(false);
    expect((await mirror.read()).sales).toBeNull();
  });

  it('says so when the server has never synced', async () => {
    const server = fakeServer();
    server.feed.latestSync = async () => null;
    const mirror = createMirror({ store: memoryStore(), feed: server.feed });
    expect((await mirror.sync(ME)).status).toBe('no-data');
  });
});

describe('nothing changed', () => {
  it('makes exactly one small call and no data call', async () => {
    const { server, mirror, tick } = setup();
    await mirror.sync(ME);
    server.state.calls.length = 0;
    tick(60_000);
    const r = await mirror.sync(ME);
    expect(r.status).toBe('current');
    expect(server.state.calls).toEqual(['latest']);
    expect(r.meta.fetchedAt).toBe(1_060_000);
  });
});

describe('changes since the last visit', () => {
  it('applies changed rows, new rows and removals, and only fetches what moved', async () => {
    const { server, mirror } = setup({}, 7);
    await mirror.sync(ME);
    server.put('P002', { price: 9 });
    server.put('P100', { qty: 5 });
    server.remove('P005');
    server.sell('P001', 4);
    server.state.calls.length = 0;
    const r = await mirror.sync(ME);
    expect(r.status).toBe('updated');
    const { stock, sales } = await mirror.read();
    expect(stock).toHaveLength(7);
    expect(stock.find((x) => x.code === 'P002').price).toBe(9);
    expect(stock.some((x) => x.code === 'P005')).toBe(false);
    expect(stock.some((x) => x.code === 'P100')).toBe(true);
    expect(sales.get('P001').n30).toBe(4);
    expect(sales.has('P005')).toBe(false);
    expect(dataCalls(server)[0]).toBe('stock:7');
    // the delta alone was enough: nothing was wiped and reloaded to make the numbers agree
    expect(dataCalls(server).filter((c) => c.endsWith(':0'))).toEqual([]);
  });
});

describe('a crash in the middle of a first install', () => {
  it('keeps the last complete page and resumes from it, without downloading it again', async () => {
    const { server, store, mirror } = setup({}, 10);
    store.failNextApply(); // the first page fails
    await expect(mirror.sync(ME)).rejects.toThrow('simulated crash');
    expect(await store.count('stock')).toBe(0);
    expect(await store.readMeta()).toBeNull();

    // now let page 1 and 2 land, then crash on page 3
    const orig = store.applyBatch;
    let n = 0;
    store.applyBatch = async (b) => {
      if (++n === 3) throw new Error('simulated crash');
      return orig(b);
    };
    await expect(mirror.sync(ME)).rejects.toThrow('simulated crash');
    expect(await store.count('stock')).toBe(6); // two complete pages
    expect((await store.readMeta()).seqStock).toBe(6); // and the counter that goes with exactly those pages

    store.applyBatch = orig;
    server.state.calls.length = 0;
    const r = await mirror.sync(ME);
    expect(r.status).toBe('updated');
    expect(dataCalls(server).filter((c) => c.startsWith('stock'))[0]).toBe('stock:6'); // resumed, not restarted
    expect(await store.count('stock')).toBe(10);
  });
});

describe('start over', () => {
  it('wipes and reloads when the server answers reset', async () => {
    const { server, mirror } = setup({}, 5);
    await mirror.sync(ME);
    server.put('P001', { qty: 99 });
    server.state.resetNext = true;
    const r = await mirror.sync(ME);
    expect(r.status).toBe('updated');
    const { stock, meta } = await mirror.read();
    expect(stock).toHaveLength(5);
    expect(stock.find((x) => x.code === 'P001').qty).toBe(99);
    expect(meta.seqStock).toBe(server.state.seqStock);
  });

  it('wipes a copy that belongs to someone else', async () => {
    const { mirror } = setup();
    await mirror.sync(ME);
    await mirror.sync({ userId: 'u2', canSales: false });
    const { meta, sales } = await mirror.read();
    expect(meta.userId).toBe('u2');
    expect(sales).toBeNull();
  });

  it('forgetIfNotMine removes another person’s copy before anything is shown', async () => {
    const { mirror } = setup();
    await mirror.sync(ME);
    await mirror.forgetIfNotMine('u2');
    expect((await mirror.read()).stock).toEqual([]);
    await mirror.sync(ME);
    await mirror.forgetIfNotMine('u1');
    expect((await mirror.read()).stock).toHaveLength(7);
  });

  it('wipes a copy made for another server schema', async () => {
    const { server, mirror } = setup();
    await mirror.sync(ME);
    server.state.schema = 2;
    server.state.calls.length = 0;
    await mirror.sync(ME);
    expect((await mirror.meta()).serverSchema).toBe(2);
    expect(dataCalls(server)[0]).toBe('stock:0'); // started from zero
  });
});

describe('the copy must match the server', () => {
  it('repulls once when the count is off (the server moved while reading), then accepts', async () => {
    const { server, mirror } = setup({}, 7);
    const orig = server.feed.changesStock;
    let first = true;
    server.feed.changesStock = async (since) => {
      const p = await orig(since);
      if (first && p.done) {
        first = false;
        server.put('P200'); // a product arrives right after the last page was cut
        return { ...p, activeCount: p.activeCount + 1 };
      }
      return p;
    };
    const r = await mirror.sync(ME);
    expect(r.status).toBe('updated');
    expect(await mirror.read().then((x) => x.stock.length)).toBe(8);
  });

  it('wipes and reloads once, then reports an error if it still does not match', async () => {
    const { server, mirror } = setup({}, 5);
    const orig = server.feed.changesStock;
    server.feed.changesStock = async (since) => ({ ...(await orig(since)), activeCount: 999 });
    await expect(mirror.sync(ME)).rejects.toThrow('does not match');
  });
});

describe('permissions and connection', () => {
  it('keeps the copy and says offline when the connection is down', async () => {
    const { server, mirror } = setup();
    await mirror.sync(ME);
    server.state.down = true;
    const r = await mirror.sync(ME);
    expect(r.status).toBe('offline');
    expect((await mirror.read()).stock).toHaveLength(7);
  });

  it('throws when offline with no copy', async () => {
    const { server, mirror } = setup();
    server.state.down = true;
    await expect(mirror.sync(ME)).rejects.toThrow('Failed to fetch');
  });

  it('wipes everything when the server says the person may no longer see inventory', async () => {
    const { server, mirror } = setup();
    await mirror.sync(ME);
    server.state.denied = true;
    await expect(mirror.sync(ME)).rejects.toMatchObject({ code: '42501' });
    expect((await mirror.read()).stock).toEqual([]);
  });

  it('drops only the sales half when inventory.view is withdrawn, and gets it back when granted again', async () => {
    const { mirror } = setup();
    await mirror.sync(ME);
    await mirror.sync({ userId: 'u1', canSales: false });
    let r = await mirror.read();
    expect(r.stock).toHaveLength(7);
    expect(r.sales).toBeNull();
    await mirror.sync(ME);
    r = await mirror.read();
    expect(r.sales.size).toBe(7);
  });

  it('two syncs started together share one run', async () => {
    const { server, mirror } = setup();
    const [a, b] = await Promise.all([mirror.sync(ME), mirror.sync(ME)]);
    expect(a).toBe(b);
    expect(server.state.calls.filter((c) => c === 'latest')).toHaveLength(1);
  });
});

describe('when to refresh', () => {
  it('an empty copy and a copy older than 15 minutes are stale; a fresh one is not', () => {
    expect(isStale(null)).toBe(true);
    expect(isStale({ fetchedAt: 1000 }, 1000 + STALE_AFTER_MS)).toBe(false);
    expect(isStale({ fetchedAt: 1000 }, 1000 + STALE_AFTER_MS + 1)).toBe(true);
    expect(STALE_AFTER_MS).toBe(15 * 60 * 1000);
  });
});
