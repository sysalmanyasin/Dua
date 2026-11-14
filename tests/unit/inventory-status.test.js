// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ listeners: [], latest: null }));

vi.mock('../../js/core/supabase.js', () => ({
  db: () => ({ auth: { onAuthStateChange: (fn) => h.listeners.push(fn) } }),
}));
vi.mock('../../js/modules/inventory/data/feed.js', () => ({
  PAGE: 1000,
  latestSync: async () => h.latest,
  changesStock: async () => ({
    reset: false,
    cols: ['code', 'name', 'qty'],
    rows: [['A', 'Item A', 3]],
    removed: [],
    next: 1,
    done: true,
    seq: 1,
    activeCount: 1,
  }),
  changesSales: async () => ({ reset: false, cols: ['code', 'n90'], rows: [], removed: [], next: 0, done: true, seq: 0, activeCount: 1 }),
}));

beforeEach(() => {
  vi.resetModules();
  h.listeners = [];
  h.latest = {
    synced_at: '2026-11-12T12:00:00Z',
    item_count: 1,
    source: 'dropbox',
    seq_stock: 1,
    seq_sales: 0,
    active_count: 1,
    schema_version: 1,
  };
});

describe('status pill', () => {
  it('shows when the stock data was last checked, in Pakistan time, and links to the overview', async () => {
    const { pill } = await import('../../js/modules/inventory/status.js');
    expect(await pill({})).toEqual({ label: 'Stock', value: '05:00 pm', href: '#/inventory' });
  });

  it('shows nothing when nothing has ever been synced', async () => {
    h.latest = null;
    const { pill } = await import('../../js/modules/inventory/status.js');
    expect(await pill({})).toBeNull();
  });
});

describe('sign-out wipe', () => {
  it('arms one listener no matter how often it is asked', async () => {
    const { pill } = await import('../../js/modules/inventory/status.js');
    await pill({});
    await pill({});
    expect(h.listeners).toHaveLength(1);
  });

  it('removes the local copy on SIGNED_OUT, and only then', async () => {
    const { pill } = await import('../../js/modules/inventory/status.js');
    const { localMirror, syncFor } = await import('../../js/modules/inventory/data/local.js');
    await pill({});
    await syncFor({ user_id: 'u1', permissions: ['inventory.search'] });
    expect((await localMirror().read()).stock).toHaveLength(1);

    h.listeners[0]('TOKEN_REFRESHED');
    h.listeners[0]('SIGNED_IN');
    await Promise.resolve();
    expect((await localMirror().read()).stock).toHaveLength(1);

    h.listeners[0]('SIGNED_OUT');
    await vi.waitFor(async () => expect((await localMirror().read()).stock).toHaveLength(0));
    expect((await localMirror().meta()) ?? null).toBeNull();
  });
});

describe('refresh on return', () => {
  const flush = () => new Promise((r) => setTimeout(r, 15));

  it('refreshes a copy older than 15 minutes when the tab comes back, leaves a younger one alone, and stops once its screen is gone', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-11-12T12:00:00Z'));
      const { syncFor, refreshOnReturn } = await import('../../js/modules/inventory/data/local.js');
      const ctx = { user_id: 'u1', permissions: ['inventory.search'] };
      await syncFor(ctx);
      let alive = true;
      let updated = 0;
      refreshOnReturn(ctx, { alive: () => alive, onUpdated: () => updated++ });
      const comeBack = async () => {
        document.dispatchEvent(new Event('visibilitychange'));
        await flush();
      };

      vi.setSystemTime(new Date('2026-11-12T12:14:00Z'));
      await comeBack();
      expect(updated).toBe(0); // 14 minutes: still fresh

      vi.setSystemTime(new Date('2026-11-12T12:16:00Z'));
      await comeBack();
      expect(updated).toBe(1); // 16 minutes: refreshed

      await comeBack();
      expect(updated).toBe(1); // and now fresh again

      alive = false;
      vi.setSystemTime(new Date('2026-11-12T13:00:00Z'));
      await comeBack();
      expect(updated).toBe(1); // the screen is gone: nothing happens, and the listener removes itself
    } finally {
      vi.useRealTimers();
    }
  });
});
