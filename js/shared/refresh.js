// One refresh policy for live dashboard data (Operations redesign, Stage 2).
//   - loads once when started, then on a timer while the page is visible, when the tab comes back and when the phone is back online
//   - never runs two loads at once; a manual refresh while one is running waits for that one
//   - keeps the last good data when a load fails and says so (stale), instead of showing nothing or pretending it is current
//   - stops by itself when the page it belongs to has been replaced (isAlive() turns false), because pages have no unmount hook
// Pure apart from the timer and the browser events it is given (`env`), so it is tested without a browser.

export function createRefresher({
  load,
  onChange,
  intervalMs = 60_000,
  staleAfterMs = 180_000,
  now = () => Date.now(),
  env = globalThis,
  isAlive = () => true,
}) {
  let state = { status: 'idle', data: null, lastSuccess: null, lastError: null, stale: false };
  let timer = null;
  let inflight = null;
  let stopped = false;

  const isStale = (s) => (s.lastSuccess === null ? s.status === 'error' : s.status === 'error' || now() - s.lastSuccess > staleAfterMs);
  const set = (patch) => {
    const next = { ...state, ...patch };
    state = { ...next, stale: isStale(next) };
    if (!stopped) onChange?.(state);
  };
  const visible = () => !env.document || env.document.visibilityState !== 'hidden';
  const online = () => !env.navigator || env.navigator.onLine !== false;

  function refresh() {
    if (stopped) return Promise.resolve(state);
    if (inflight) return inflight;
    set({ status: state.lastSuccess === null ? 'loading' : 'refreshing' });
    inflight = Promise.resolve()
      .then(load)
      .then(
        (data) => set({ status: 'ok', data, lastSuccess: now(), lastError: null }),
        (e) => set({ status: 'error', lastError: String(e?.message ?? e) }),
      )
      .then(() => {
        inflight = null;
        return state;
      });
    return inflight;
  }

  function tick() {
    if (!isAlive()) return stop();
    if (!visible()) return undefined;
    // offline: do not hammer the network, but let the stale warning appear once the data is old enough
    if (!online()) return set({});
    return refresh();
  }
  const onShow = () => {
    if (!isAlive()) return stop();
    if (visible() && online()) refresh();
  };
  const onOnline = onShow;

  function start() {
    if (timer !== null || stopped) return;
    refresh();
    timer = setInterval(tick, intervalMs);
    env.document?.addEventListener?.('visibilitychange', onShow);
    env.addEventListener?.('online', onOnline);
  }
  function stop() {
    stopped = true;
    if (timer !== null) clearInterval(timer);
    timer = null;
    env.document?.removeEventListener?.('visibilitychange', onShow);
    env.removeEventListener?.('online', onOnline);
  }
  return { start, stop, refresh, getState: () => state };
}
