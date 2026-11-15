// The thin dark bar at the very top: live pills contributed by modules, and the Pakistan clock.
import { html, render } from '../shared/html.js';
import { log } from './logger.js';

const clock = () =>
  new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Karachi', hour: '2-digit', minute: '2-digit', hour12: true })
    .format(new Date())
    .toLowerCase();

const allowed = (status, perms) => !status.anyOf || status.anyOf.some((p) => perms.has(p));

// Modules offer a pill with `status: { anyOf: [...], load: () => import('./status.js'), refreshMs? }` in their manifest;
// the loaded file exports `pill(ctx)` returning { label, value, href } or null.
// A pill with `refreshMs` is reloaded on that timer and whenever the app becomes visible again (never two requests
// for the same pill at once, and nothing while the tab is hidden). A failed refresh removes the pill rather than
// leaving an old number that looks current.
export function startStatusBar(el, ctx, modules) {
  const perms = new Set(ctx.permissions);
  const mine = modules.filter((m) => m.status && allowed(m.status, perms));
  const pills = new Map(); // module id -> pill; drawn in module order
  const busy = new Set();
  let stopped = false;
  const draw = () =>
    render(
      el,
      html`<div class="status-inner">
        ${mine
          .map((m) => pills.get(m.id))
          .filter(Boolean)
          .map((p) => html`<a class="pill" href="${p.href ?? '#/home'}"><span>${p.label}</span><b>${p.value}</b></a>`)}
        <span class="spacer"></span><span class="clock" id="sb-clock">${clock()}</span>
      </div>`,
    );
  draw();

  async function refresh(m) {
    if (busy.has(m.id) || stopped) return;
    busy.add(m.id);
    try {
      const p = await (await m.status.load()).pill(ctx);
      if (p) pills.set(m.id, p);
      else pills.delete(m.id);
    } catch (e) {
      pills.delete(m.id);
      log.warn('status pill failed', { module: m.id, message: String(e?.message ?? e) });
    } finally {
      busy.delete(m.id);
      if (!stopped) draw();
    }
  }

  for (const m of mine) refresh(m);

  const live = mine.filter((m) => m.status.refreshMs > 0);
  const visible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden';
  const timers = live.map((m) => setInterval(() => visible() && refresh(m), m.status.refreshMs));
  const onShow = () => visible() && live.forEach(refresh);
  if (live.length && typeof document !== 'undefined') document.addEventListener('visibilitychange', onShow);

  const timer = setInterval(() => {
    const c = el.querySelector('#sb-clock');
    if (c) c.textContent = clock();
  }, 30_000);
  return () => {
    stopped = true;
    clearInterval(timer);
    timers.forEach(clearInterval);
    if (live.length && typeof document !== 'undefined') document.removeEventListener('visibilitychange', onShow);
  };
}
