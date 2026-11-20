import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { computePrecache, currentList } from '../../tools/sw-precache.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
const SW = readFileSync(resolve(ROOT, 'sw.js'), 'utf8');
const BASE = 'https://dua.test/';
// The cache name changes whenever the worker's caching rules change, so read it from the worker instead of repeating it here.
const CACHE = /const CACHE = '([^']+)'/.exec(SW)[1];

describe('service worker file list', () => {
  const list = currentList(SW);
  it('is up to date: run `node tools/sw-precache.mjs` after adding files the app loads', () => {
    expect(list).toEqual(computePrecache(ROOT));
  });
  it('lists every file Emergency Billing needs to open and run offline', () => {
    for (const f of [
      'index.html',
      'js/core/app.js',
      'js/core/offlineContext.js',
      'js/modules/index.js',
      'js/modules/ebill/manifest.js',
      'js/modules/ebill/ui/pos.js',
      'js/modules/ebill/ui/productHelp.js',
      'js/modules/ebill/data/localDb.js',
      'js/modules/ebill/data/sync.js',
      'js/modules/ebill/data/offlineKit.js',
      'js/modules/ebill/data/localPin.js',
      'js/modules/ebill/domain/offline.js',
      'js/modules/inventory/data/local.js',
      'css/ebill.css',
      'vendor/supabase-js-2.45.4.umd.js',
      'assets/icon.svg',
    ])
      expect(list, f).toContain(f);
    expect(list.some((f) => f.startsWith('vendor/fonts/'))).toBe(true);
  });
  it('lists only files that exist, never the worker itself', () => {
    for (const f of list) expect(existsSync(resolve(ROOT, f)), f).toBe(true);
    expect(list).not.toContain('sw.js');
  });
});

// ── run sw.js against a fake browser ──
function load({ files = {}, net } = {}) {
  const handlers = {};
  const stores = new Map();
  const keyOf = (r, ignoreSearch) => {
    const u = new URL(typeof r === 'string' ? r : r.url, BASE);
    if (ignoreSearch) u.search = '';
    return u.href;
  };
  const cacheObj = (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const m = stores.get(name);
    return {
      match: async (r, o = {}) => {
        const k = keyOf(r, o.ignoreSearch);
        for (const [mk, v] of m) if (keyOf(mk, o.ignoreSearch) === k) return v.clone();
        return undefined;
      },
      put: async (r, res) => {
        m.set(keyOf(r), res);
      },
    };
  };
  const caches = {
    open: async (n) => cacheObj(n),
    keys: async () => [...stores.keys()],
    delete: async (n) => stores.delete(n),
  };
  const fetched = [];
  const fetch = vi.fn(async (r) => {
    fetched.push(typeof r === 'string' ? r : r.url);
    return net(typeof r === 'string' ? r : r);
  });
  class Req {
    constructor(p, init = {}) {
      this.url = new URL(p, BASE).href;
      this.method = init.method || 'GET';
      this.mode = init.mode || 'cors';
      this.cache = init.cache;
    }
  }
  const self = {
    location: { origin: 'https://dua.test' },
    addEventListener: (t, f) => (handlers[t] = f),
    skipWaiting: vi.fn(async () => {}),
    clients: { claim: vi.fn(async () => {}) },
  };
  new Function('self', 'caches', 'fetch', 'Request', 'URL', 'setTimeout', 'Promise', SW)(
    self,
    caches,
    fetch,
    Req,
    URL,
    setTimeout,
    Promise,
  );
  for (const [path, body] of Object.entries(files))
    stores.set(CACHE, (stores.get(CACHE) ?? new Map()).set(new URL(path, BASE).href, new Response(body)));
  const event = (extra) => {
    const e = {
      waits: [],
      waitUntil(p) {
        this.waits.push(p);
      },
      respondWith(p) {
        this.response = p;
      },
      ...extra,
    };
    return e;
  };
  const req = (path, init = {}) => new Req(path, init);
  return { handlers, stores, caches, fetch, fetched, event, req, self };
}
// a real same-origin response has type "basic"; the fake one does not, so say so
const basic = (r) => Object.defineProperty(r, 'type', { value: 'basic' });
const ok =
  (body = 'live') =>
  async () =>
    basic(new Response(body, { status: 200 }));
const offline = async () => {
  throw new TypeError('Failed to fetch');
};
const text = async (p) => (await p).text();

describe('service worker behaviour', () => {
  it('online: returns the live file and keeps a copy', async () => {
    const w = load({ net: ok('live') });
    const e = w.event({ request: w.req('js/app.js') });
    w.handlers.fetch(e);
    expect(await text(e.response)).toBe('live');
    const c = await w.caches.open(CACHE);
    await vi.waitFor(async () => expect(await text(c.match('js/app.js'))).toBe('live')); // the copy is kept in the background
  });
  it('offline: serves the last copy it saw', async () => {
    const w = load({ net: offline, files: { 'js/app.js': 'saved' } });
    const e = w.event({ request: w.req('js/app.js') });
    w.handlers.fetch(e);
    expect(await text(e.response)).toBe('saved');
  });
  it('offline: a page address nobody saved falls back to the app shell', async () => {
    const w = load({ net: offline, files: { 'index.html': '<shell>' } });
    const e = w.event({ request: w.req('some/where', { mode: 'navigate' }) });
    w.handlers.fetch(e);
    expect(await text(e.response)).toBe('<shell>');
  });
  it('offline with nothing saved: the failure is passed on, not hidden', async () => {
    const w = load({ net: offline });
    const e = w.event({ request: w.req('js/new.js') });
    w.handlers.fetch(e);
    await expect(e.response).rejects.toThrow('Failed to fetch');
  });
  it('a slow connection does not hold the page up when a saved copy exists', async () => {
    vi.useFakeTimers();
    const w = load({ net: () => new Promise(() => {}), files: { 'js/app.js': 'saved' } });
    const e = w.event({ request: w.req('js/app.js') });
    w.handlers.fetch(e);
    await vi.advanceTimersByTimeAsync(6100);
    expect(await text(e.response)).toBe('saved');
    vi.useRealTimers();
  });
  it('does not keep a failing response (404/500) over a good saved copy', async () => {
    const w = load({ net: async () => new Response('nope', { status: 404 }), files: { 'js/app.js': 'saved' } });
    const e = w.event({ request: w.req('js/app.js') });
    w.handlers.fetch(e);
    await e.response;
    const c = await w.caches.open(CACHE);
    expect(await text(c.match('js/app.js'))).toBe('saved');
  });
  it('leaves other sites (Supabase, Google) and non-GET requests entirely alone', () => {
    const w = load({ net: ok() });
    const cross = w.event({ request: { method: 'GET', url: 'https://abc.supabase.co/rest/v1/x', mode: 'cors' } });
    w.handlers.fetch(cross);
    expect(cross.response).toBeUndefined();
    const post = w.event({ request: { method: 'POST', url: BASE + 'api', mode: 'cors' } });
    w.handlers.fetch(post);
    expect(post.response).toBeUndefined();
  });
  it('install fetches the whole list, tolerates a file that fails, and takes over at once', async () => {
    const list = currentList(SW);
    const w = load({
      net: async (r) => (String(r.url).endsWith('js/core/app.js') ? new Response('x', { status: 404 }) : new Response('ok')),
    });
    const e = w.event({});
    w.handlers.install(e);
    await Promise.all(e.waits);
    expect(w.fetched.length).toBe(list.length);
    expect(w.self.skipWaiting).toHaveBeenCalled();
    const c = await w.caches.open(CACHE);
    expect(await c.match('index.html')).toBeTruthy();
    expect(await c.match('./')).toBeTruthy(); // the bare address opens the shell too
    expect(await c.match('js/core/app.js')).toBeUndefined();
  });
  it('a REFRESH message re-fetches the list bypassing the browser cache', async () => {
    const w = load({ net: ok('new') });
    const e = w.event({ data: { type: 'REFRESH' } });
    w.handlers.message(e);
    await Promise.all(e.waits);
    expect(w.fetched.length).toBeGreaterThan(100);
    expect(w.fetch.mock.calls.every(([r]) => r.cache === 'reload')).toBe(true);
  });
  it('activate removes old Dua caches only, then claims the open pages', async () => {
    const w = load({ net: ok() });
    w.stores.set('dua-shell-v0', new Map());
    w.stores.set(CACHE, new Map());
    w.stores.set('someone-elses', new Map());
    const e = w.event({});
    w.handlers.activate(e);
    await Promise.all(e.waits);
    expect([...w.stores.keys()].sort()).toEqual([CACHE, 'someone-elses']);
    expect(w.self.clients.claim).toHaveBeenCalled();
  });
});
