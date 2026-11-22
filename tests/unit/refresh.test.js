import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRefresher } from '../../js/shared/refresh.js';

const fakeEnv = (online = true) => {
  const handlers = { doc: {}, win: {} };
  return {
    handlers,
    document: {
      visibilityState: 'visible',
      addEventListener: (n, f) => (handlers.doc[n] = f),
      removeEventListener: (n) => delete handlers.doc[n],
    },
    navigator: { onLine: online },
    addEventListener: (n, f) => (handlers.win[n] = f),
    removeEventListener: (n) => delete handlers.win[n],
  };
};

describe('createRefresher', () => {
  let clock;
  beforeEach(() => {
    vi.useFakeTimers();
    clock = 1_000_000;
  });
  afterEach(() => vi.useRealTimers());
  const make = (load, extra = {}) => {
    const states = [];
    const env = fakeEnv();
    const r = createRefresher({
      load,
      onChange: (s) => states.push(s),
      now: () => clock,
      env,
      intervalMs: 60_000,
      staleAfterMs: 180_000,
      ...extra,
    });
    return { r, states, env };
  };

  it('loads once on start and records the time of the last success', async () => {
    const load = vi.fn().mockResolvedValue({ n: 1 });
    const { r } = make(load);
    r.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenCalledTimes(1);
    expect(r.getState()).toMatchObject({ status: 'ok', data: { n: 1 }, lastSuccess: clock, stale: false });
    r.stop();
  });

  it('refreshes on the timer while visible and skips while hidden', async () => {
    const load = vi.fn().mockResolvedValue(1);
    const { r, env } = make(load);
    r.start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(load).toHaveBeenCalledTimes(2);
    env.document.visibilityState = 'hidden';
    await vi.advanceTimersByTimeAsync(120_000);
    expect(load).toHaveBeenCalledTimes(2);
    r.stop();
  });

  it('refreshes when the tab becomes visible again and when the phone is back online', async () => {
    const load = vi.fn().mockResolvedValue(1);
    const { r, env } = make(load);
    r.start();
    await vi.advanceTimersByTimeAsync(0);
    env.handlers.doc.visibilitychange();
    await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenCalledTimes(2);
    env.handlers.win.online();
    await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenCalledTimes(3);
    r.stop();
  });

  it('never runs two loads at once', async () => {
    let release;
    const load = vi.fn(() => new Promise((res) => (release = res)));
    const { r } = make(load);
    r.start();
    r.refresh();
    r.refresh();
    await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenCalledTimes(1);
    release(1);
    await vi.advanceTimersByTimeAsync(0);
    r.refresh();
    await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenCalledTimes(2);
    r.stop();
  });

  it('keeps the last good data and marks it stale when a load fails', async () => {
    const load = vi.fn().mockResolvedValueOnce({ n: 1 }).mockRejectedValueOnce(new Error('offline'));
    const { r } = make(load);
    r.start();
    await vi.advanceTimersByTimeAsync(0);
    await r.refresh();
    expect(r.getState()).toMatchObject({ status: 'error', data: { n: 1 }, lastError: 'offline', stale: true });
    r.stop();
  });

  it('marks old data stale even when no refresh has failed (for example offline)', async () => {
    const load = vi.fn().mockResolvedValue(1);
    const states = [];
    const env = fakeEnv(false);
    const r = createRefresher({ load, onChange: (s) => states.push(s), now: () => clock, env, intervalMs: 60_000, staleAfterMs: 180_000 });
    r.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(r.getState().stale).toBe(false);
    clock += 200_000;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(load).toHaveBeenCalledTimes(1); // offline: no attempt
    expect(r.getState().stale).toBe(true);
    r.stop();
  });

  it('a first load that fails is an error with no data, not a blank success', async () => {
    const { r } = make(vi.fn().mockRejectedValue(new Error('x')));
    r.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(r.getState()).toMatchObject({ status: 'error', data: null, lastSuccess: null, stale: true });
    r.stop();
  });

  it('stops by itself when its page has been replaced', async () => {
    const load = vi.fn().mockResolvedValue(1);
    let alive = true;
    const { r, env } = make(load, { isAlive: () => alive });
    r.start();
    await vi.advanceTimersByTimeAsync(0);
    alive = false;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(load).toHaveBeenCalledTimes(1);
    expect(env.handlers.doc.visibilitychange).toBeUndefined();
  });

  it('does not report after stop', async () => {
    const load = vi.fn().mockResolvedValue(1);
    const { r, states } = make(load);
    r.start();
    r.stop();
    const n = states.length;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(states.length).toBe(n);
  });
});
