// @vitest-environment jsdom
// The shared outbox (OD-6): one queue contract on IndexedDB and memory, a registry of unsent work from any module, and the
// sign-out guard that blocks leaving while something is waiting (AUD-9).
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearOutboxRegistry,
  createIdbQueue,
  createMemoryQueue,
  installSignOutGuard,
  registerManifestOutboxes,
  registerOutbox,
  resetSignOutGuard,
  signOutMessage,
  unsentSummary,
} from '../../js/shared/outbox.js';

const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));

describe.each([
  ['memory queue', () => createMemoryQueue({ keyPath: 'id', groupField: 'kind' })],
  ['IndexedDB queue', () => createIdbQueue({ dbName: `t${Math.random()}`, keyPath: 'id', groupField: 'kind', factory: new IDBFactory() })],
])('%s', (_name, make) => {
  it('keeps records in the order they were added and groups them', async () => {
    const q = make();
    await q.add({ id: 'a', kind: 'scan' });
    await q.add({ id: 'b', kind: 'register' });
    await q.add({ id: 'c', kind: 'scan' });
    expect((await q.all()).map((e) => e.id)).toEqual(['a', 'b', 'c']);
    expect((await q.all('scan')).map((e) => e.id)).toEqual(['a', 'c']);
    expect(await q.count('register')).toBe(1);
    expect((await q.take('scan', 1)).map((e) => e.id)).toEqual(['a']);
  });
  it('adding the same id again keeps one record', async () => {
    const q = make();
    await q.add({ id: 'a', kind: 'scan', v: 1 });
    await q.add({ id: 'a', kind: 'scan', v: 2 });
    expect(await q.count()).toBe(1);
  });
  it('removes, clears one group, and resets everything including the saved copy', async () => {
    const q = make();
    for (const id of ['a', 'b', 'c']) await q.add({ id, kind: id === 'c' ? 'x' : 'scan' });
    await q.setKv('list', { n: 1 });
    await q.remove(['a']);
    await q.clear('scan');
    expect((await q.all()).map((e) => e.id)).toEqual(['c']);
    expect(await q.getKv('list')).toEqual({ n: 1 });
    await q.reset();
    expect(await q.count()).toBe(0);
    expect(await q.getKv('list')).toBeNull();
  });
});

describe('registry and sign-out guard', () => {
  beforeEach(() => {
    clearOutboxRegistry();
    resetSignOutGuard();
    document.body.innerHTML = '<button data-action="signout">Sign out</button>';
  });
  const fake = (id, n) => {
    const state = { n, discarded: 0 };
    registerOutbox({
      id,
      label: id === 'audit' ? 'count' : 'scan',
      count: async () => state.n,
      discard: async () => ((state.n = 0), state.discarded++),
    });
    return state;
  };

  it('lists only the outboxes that have something, with the right singular and plural', async () => {
    fake('audit', 1);
    fake('barcode', 0);
    expect(await unsentSummary()).toEqual([{ id: 'audit', label: 'count', count: 1 }]);
    fake('barcode', 3);
    expect(await unsentSummary()).toEqual([
      { id: 'audit', label: 'count', count: 1 },
      { id: 'barcode', label: 'scans', count: 3 },
    ]);
  });
  it('treats an outbox that cannot be read as empty, so it cannot trap the person', async () => {
    registerOutbox({ id: 'broken', label: 'thing', count: async () => Promise.reject(new Error('no')), discard: async () => {} });
    expect(await unsentSummary()).toEqual([]);
  });
  it('words the warning for one and for many', () => {
    expect(signOutMessage([{ label: 'count', count: 1 }])).toMatch(/^1 count has not been sent yet\. If you sign out now it is lost/);
    expect(
      signOutMessage([
        { label: 'counts', count: 4 },
        { label: 'scans', count: 2 },
      ]),
    ).toMatch(/^4 counts, 2 scans have not been sent/);
  });
  it('cancel keeps the person signed in; OK discards everything and lets sign-out through', async () => {
    const audit = fake('audit', 2);
    const barcode = fake('barcode', 5);
    const answers = [false, true];
    const ask = vi.fn(() => answers.shift());
    installSignOutGuard(document, ask);
    const reached = vi.fn();
    document.body.addEventListener('click', (e) => e.target.closest('[data-action="signout"]') && reached());
    document.querySelector('button').click();
    await tick();
    expect(reached).not.toHaveBeenCalled();
    expect(audit.n + barcode.n).toBe(7);
    expect(ask.mock.calls[0][0]).toMatch(/2 counts, 5 scans/);
    document.querySelector('button').click();
    await tick();
    expect(reached).toHaveBeenCalledTimes(1);
    expect(audit.discarded).toBe(1);
    expect(barcode.discarded).toBe(1);
  });
  it('signs out without asking when nothing is waiting, and still forgets private local copies', async () => {
    const audit = fake('audit', 0);
    const ask = vi.fn();
    installSignOutGuard(document, ask);
    const reached = vi.fn();
    document.body.addEventListener('click', (e) => e.target.closest('[data-action="signout"]') && reached());
    document.querySelector('button').click();
    await tick();
    expect(ask).not.toHaveBeenCalled();
    expect(reached).toHaveBeenCalledTimes(1);
    expect(audit.discarded).toBe(1);
  });
  it('installing twice does not ask twice', async () => {
    fake('audit', 1);
    const ask = vi.fn(() => false);
    installSignOutGuard(document, ask);
    installSignOutGuard(document, ask);
    document.querySelector('button').click();
    await tick();
    expect(ask).toHaveBeenCalledTimes(1);
  });
  it('registers every manifest that declares an outbox, and ignores a broken one', async () => {
    const loaded = vi.fn();
    await registerManifestOutboxes([
      {
        id: 'a',
        outbox: async () => ({
          default: () => (loaded(), registerOutbox({ id: 'a', label: 'x', count: async () => 1, discard: async () => {} })),
        }),
      },
      { id: 'b', outbox: async () => Promise.reject(new Error('missing')) },
      { id: 'c' },
    ]);
    expect(loaded).toHaveBeenCalledTimes(1);
    expect(await unsentSummary()).toHaveLength(1);
  });
});
