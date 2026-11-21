// @vitest-environment jsdom
// The phone's copy of the barcode list and the scan outbox: paging, the overlapping delta, offline, and what sign-out may discard.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearOutboxRegistry, discardAll, registerOutbox, unsentSummary } from '../../js/shared/outbox.js';
import {
  barcodeStore,
  createMemoryBarcodeStore,
  loadMirror,
  refreshMirror,
  saveScan,
  sendScans,
  useBarcodeStore,
} from '../../js/modules/audit/data/barcodeStore.js';
import { makeScanEvent } from '../../js/modules/audit/domain/barcode.js';

const row = (n, at = '2026-11-19T10:00:00.000Z') => ({
  id: `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`,
  barcode: `CODE${String(n).padStart(6, '0')}`,
  product_code: `P${n}`,
  product_name: `Product ${n}`,
  status: 'verified',
  conflict_product_code: null,
  updated_at: at,
});

describe('the saved copy of the list', () => {
  let store;
  beforeEach(() => {
    store = createMemoryBarcodeStore();
    useBarcodeStore(store);
  });

  it('starts empty', async () => {
    expect(await loadMirror(store)).toMatchObject({ count: 0, cursor: { since: null, after: null } });
  });

  it('downloads every page the first time and remembers the newest row', async () => {
    const all = Array.from({ length: 1500 }, (_, i) =>
      row(i + 1, `2026-11-19T10:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}.000Z`),
    );
    const fetchPage = vi.fn(async ({ limit, after }) => {
      const start = after ? all.findIndex((r) => r.id === after) + 1 : 0;
      return all.slice(start, start + limit);
    });
    const r = await refreshMirror({ fetchPage, store });
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(fetchPage.mock.calls[0][0]).toMatchObject({ since: null, after: null, limit: 1000 });
    expect(fetchPage.mock.calls[1][0].after).toBe(all[999].id);
    expect(r.count).toBe(1500);
    expect(r.cursor.after).toBe(all[1499].id);
    expect((await loadMirror(store)).count).toBe(1500);
  });

  it('asks only for changes later, starting a few minutes before the newest row, and applies them over the old ones', async () => {
    await refreshMirror({ fetchPage: async () => [row(1, '2026-11-19T10:00:00.000Z'), row(2, '2026-11-19T10:30:00.000Z')], store });
    const fetchPage = vi.fn(async () => [
      { ...row(2, '2026-11-19T11:00:00.000Z'), product_code: 'MOVED' },
      row(3, '2026-11-19T11:05:00.000Z'),
    ]);
    const r = await refreshMirror({ fetchPage, store });
    expect(fetchPage.mock.calls[0][0].since).toBe('2026-11-19T10:25:00.000Z');
    expect(r.count).toBe(3);
    expect(r.changed).toBe(2);
    expect((await loadMirror(store)).index.get('CODE000002').product_code).toBe('MOVED');
  });

  it('keeps the saved copy and throws when offline', async () => {
    await refreshMirror({ fetchPage: async () => [row(1)], store });
    const offline = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(refreshMirror({ fetchPage: offline, store })).rejects.toThrow('Failed to fetch');
    expect((await loadMirror(store)).count).toBe(1);
  });
});

describe('scans waiting to send', () => {
  let store;
  beforeEach(() => {
    store = createMemoryBarcodeStore();
    useBarcodeStore(store);
    clearOutboxRegistry();
    // importing the store registered its outbox once; register again after the clear, as the manifest loader does in the app
    registerOutbox({
      id: 'barcode',
      label: 'barcode scan',
      plural: 'barcode scans',
      count: () => barcodeStore().count('scan'),
      discard: () => barcodeStore().clear('scan'),
    });
  });

  it('saves, counts and sends scans, and an unsendable batch stays', async () => {
    await saveScan(makeScanEvent({ barcode: 'CODE0001', result: 'matched' }), store);
    await saveScan(makeScanEvent({ barcode: 'CODE0002', result: 'not_found' }), store);
    expect(await unsentSummary()).toEqual([{ id: 'barcode', label: 'barcode scans', count: 2 }]);
    const failing = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    expect((await sendScans(failing, store)).left).toBe(2);
    const ok = vi.fn(async (batch) => ({ saved: batch.length, duplicates: 0, rejected: 0 }));
    expect(await sendScans(ok, store)).toMatchObject({ sent: 2, left: 0 });
    expect(await unsentSummary()).toEqual([]);
  });

  it('discarding forgets scans but keeps the saved list (it holds no stock or prices)', async () => {
    await refreshMirror({ fetchPage: async () => [row(1)], store });
    await saveScan(makeScanEvent({ barcode: 'CODE0001', result: 'matched' }), store);
    await discardAll();
    expect(await store.count('scan')).toBe(0);
    expect((await loadMirror(store)).count).toBe(1);
  });
});
