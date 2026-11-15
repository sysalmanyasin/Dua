// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startStatusBar } from '../../js/core/statusbar.js';
import { startShell } from '../../js/core/shell.js';

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};
let el;
beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '<div id="sb"></div>';
  el = document.getElementById('sb');
});
afterEach(() => vi.useRealTimers());

const mod = (id, pillFn, extra = {}) => ({ id, status: { anyOf: ['x.view'], load: async () => ({ pill: pillFn }), ...extra } });
const ctx = { permissions: ['x.view'] };

describe('status bar pills', () => {
  it('a pill without refreshMs loads once, as before', async () => {
    const pill = vi.fn(async () => ({ label: 'A', value: '1' }));
    const stop = startStatusBar(el, ctx, [mod('a', pill)]);
    await flush();
    vi.advanceTimersByTime(300_000);
    await flush();
    expect(pill).toHaveBeenCalledTimes(1);
    expect(el.textContent).toContain('A');
    stop();
  });
  it('a pill with refreshMs reloads on the timer and shows the new value', async () => {
    let n = 0;
    const pill = vi.fn(async () => ({ label: 'T', value: String(++n) }));
    const stop = startStatusBar(el, ctx, [mod('t', pill, { refreshMs: 60_000 })]);
    await flush();
    expect(el.textContent).toContain('T1');
    vi.advanceTimersByTime(60_000);
    await flush();
    expect(el.textContent).toContain('T2');
    stop();
  });
  it('never runs two loads of the same pill at once', async () => {
    let release;
    const pill = vi.fn(() => new Promise((r) => (release = () => r({ label: 'S', value: '1' }))));
    const stop = startStatusBar(el, ctx, [mod('s', pill, { refreshMs: 1000 })]);
    await flush();
    vi.advanceTimersByTime(5000);
    await flush();
    expect(pill).toHaveBeenCalledTimes(1);
    release();
    await flush();
    stop();
  });
  it('a failed refresh removes the pill instead of leaving an old number', async () => {
    let fail = false;
    const pill = vi.fn(async () => {
      if (fail) throw new Error('offline');
      return { label: 'F', value: '9' };
    });
    const stop = startStatusBar(el, ctx, [mod('f', pill, { refreshMs: 1000 })]);
    await flush();
    expect(el.textContent).toContain('F9');
    fail = true;
    vi.advanceTimersByTime(1000);
    await flush();
    expect(el.textContent).not.toContain('F9');
    stop();
  });
  it('stops its timers when the app signs out', async () => {
    const pill = vi.fn(async () => ({ label: 'Z', value: '1' }));
    const stop = startStatusBar(el, ctx, [mod('z', pill, { refreshMs: 1000 })]);
    await flush();
    stop();
    vi.advanceTimersByTime(10_000);
    await flush();
    expect(pill).toHaveBeenCalledTimes(1);
  });
  it('does not call the pill for someone without the permission', async () => {
    const pill = vi.fn(async () => ({ label: 'N', value: '1' }));
    const stop = startStatusBar(el, { permissions: [] }, [mod('n', pill)]);
    await flush();
    expect(pill).not.toHaveBeenCalled();
    stop();
  });
});

describe('shell: a pill without a tab', () => {
  it("staff who hold only today's total get the pill but no Candela tab", async () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = document.getElementById('root');
    const manifests = [
      {
        id: 'home',
        title: 'Home',
        icon: 'home',
        core: true,
        nav: { order: 0 },
        permission: null,
        routes: [{ path: '/home', load: async () => ({ mount: (e) => (e.textContent = 'home') }) }],
      },
      {
        id: 'candela-sales',
        title: 'Candela Sales',
        icon: 'chart',
        nav: { order: 15 },
        permission: null,
        status: {
          anyOf: ['candela.today_total', 'candela.view'],
          load: async () => ({ pill: async () => ({ label: 'Candela today', value: '₨ 5', href: '#/home' }) }),
        },
        routes: [{ path: '/candela-sales', title: 'Overview', permission: 'candela.view', load: async () => ({ mount: () => {} }) }],
      },
    ];
    const stop = startShell(
      root,
      { permissions: ['candela.today_total'], modules_disabled: [], full_name: 'T', role: 'junior' },
      manifests,
    );
    await flush();
    expect(root.querySelector('.status-bar').textContent).toContain('Candela today');
    expect(root.querySelector('.tabs').textContent).not.toContain('Candela Sales');
    stop();
  });
});
