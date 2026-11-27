// The red strip at the top of the page when automatic attendance is not working on this phone. It never blocks anything: staff keep using
// Dua as normal. It checks the phone again every few minutes and whenever Dua is shown again, so it disappears by itself once fixed.
import { html, render } from '../shared/html.js';
import { inApp, trackingProblem } from './native.js';

const EVERY_MS = 5 * 60 * 1000;

export function startTrackingBanner(el, ctx, g = globalThis) {
  if (!el || !inApp(g)) return () => {};
  let stopped = false;
  let busy = false;
  const draw = (problem) => {
    if (stopped) return;
    if (!problem) {
      el.hidden = true;
      el.replaceChildren();
      return;
    }
    el.hidden = false;
    render(
      el,
      html`<a class="tracking-banner-link" href="#/manager/attendance"
        ><strong>Attendance is not being recorded</strong><span>${problem.text}</span></a
      >`,
    );
  };
  const check = async () => {
    if (busy || stopped) return;
    busy = true;
    try {
      draw(await trackingProblem(ctx, g));
    } catch {
      draw(null); // not being able to read the phone is no reason to alarm anyone
    } finally {
      busy = false;
    }
  };
  const visible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden';
  const timer = setInterval(() => visible() && check(), EVERY_MS);
  const onShow = () => visible() && check();
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onShow);
  check();
  return () => {
    stopped = true;
    clearInterval(timer);
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onShow);
  };
}
