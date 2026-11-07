// The thin dark bar at the very top: live pills contributed by modules, and the Pakistan clock.
import { html, render } from '../shared/html.js';
import { log } from './logger.js';

const clock = () =>
  new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Karachi', hour: '2-digit', minute: '2-digit', hour12: true })
    .format(new Date())
    .toLowerCase();

const allowed = (status, perms) => !status.anyOf || status.anyOf.some((p) => perms.has(p));

// Modules offer a pill with `status: { anyOf: [...], load: () => import('./status.js') }` in their manifest;
// the loaded file exports `pill(ctx)` returning { label, value, href } or null.
export function startStatusBar(el, ctx, modules) {
  const perms = new Set(ctx.permissions);
  const pills = [];
  const draw = () =>
    render(
      el,
      html`<div class="status-inner">
        ${pills.map((p) => html`<a class="pill" href="${p.href ?? '#/home'}"><span>${p.label}</span><b>${p.value}</b></a>`)}
        <span class="spacer"></span><span class="clock" id="sb-clock">${clock()}</span>
      </div>`,
    );
  draw();
  for (const m of modules) {
    if (!m.status || !allowed(m.status, perms)) continue;
    m.status
      .load()
      .then((mod) => mod.pill(ctx))
      .then((p) => {
        if (p) {
          pills.push(p);
          draw();
        }
      })
      .catch((e) => log.warn('status pill failed', { module: m.id, message: String(e?.message ?? e) }));
  }
  const timer = setInterval(() => {
    const c = el.querySelector('#sb-clock');
    if (c) c.textContent = clock();
  }, 30_000);
  return () => clearInterval(timer);
}
