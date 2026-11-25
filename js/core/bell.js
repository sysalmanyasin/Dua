// The bell in the top bar. A module offers it with `bell: { href, refreshMs, load }` in its manifest; the loaded file exports
// `poll()` returning { count, items: [{ id, title, body, href }] } (or null when this person has no inbox).
// The bell shows the unread number, puts it in the browser tab title "(3) Page · Dua", sets the app badge where the browser
// supports it, and pops a small notice for each message that arrives while the app is open. It is in-app only (D-58): no
// push or system notification. A failed check never leaves an old number looking current: the number is cleared.
import { html, render } from '../shared/html.js';
import { icon } from '../shared/icons.js';
import { log } from './logger.js';

const TITLE_COUNT = /^\(\d+\+?\)\s/;
const shown = (n) => (n > 99 ? '99+' : String(n));
const visible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden';

export function startBell(slot, owner) {
  if (!slot || !owner?.bell) return { retitle() {}, refresh() {}, stop() {} };
  const { href = '/inbox', refreshMs = 60_000, load } = owner.bell;
  let count = 0,
    available = false,
    busy = false,
    stopped = false,
    first = true;
  const seen = new Set();

  const draw = () => {
    render(
      slot,
      available
        ? html`<a class="bell-btn" href="#${href}" aria-label="${count ? `Inbox, ${count} unread` : 'Inbox, no new messages'}">
            ${icon('bell')}${count ? html`<span class="bell-count">${shown(count)}</span>` : ''}
          </a>`
        : html``,
    );
    slot.hidden = !available;
  };
  const retitle = () => {
    const base = document.title.replace(TITLE_COUNT, '');
    document.title = count > 0 ? `(${shown(count)}) ${base}` : base;
    try {
      if (count > 0) navigator.setAppBadge?.(count)?.catch?.(() => {});
      else navigator.clearAppBadge?.()?.catch?.(() => {});
    } catch {
      /* the badge is a nicety */
    }
  };
  const notice = (text, to) => {
    let box = document.getElementById('bell-notices');
    if (!box) {
      box = document.createElement('div');
      box.id = 'bell-notices';
      box.setAttribute('role', 'status');
      box.setAttribute('aria-live', 'polite');
      document.body.append(box);
    }
    const a = document.createElement('a');
    a.className = 'bell-notice';
    a.href = `#${to}`;
    a.textContent = text;
    a.addEventListener('click', () => a.remove());
    box.append(a);
    setTimeout(() => a.remove(), 7000);
  };

  async function refresh() {
    if (busy || stopped) return;
    busy = true;
    try {
      const r = await (await load()).poll();
      if (stopped) return;
      available = r !== null && r !== undefined;
      count = available ? r.count : 0;
      const fresh = available ? r.items.filter((i) => !seen.has(i.id)) : [];
      fresh.forEach((i) => seen.add(i.id));
      if (available && first && count > 0) notice(count === 1 ? 'You have 1 new message' : `You have ${count} new messages`, href);
      else if (available && !first) for (const i of fresh.slice(0, 3)) notice(i.body ? `${i.title}: ${i.body}` : i.title, i.href ?? href);
      if (available && !first && fresh.length > 3) notice(`${fresh.length - 3} more new messages`, href);
      first = false;
    } catch (e) {
      count = 0;
      log.warn('bell check failed', { message: String(e?.message ?? e) });
    } finally {
      busy = false;
      if (!stopped) {
        draw();
        retitle();
      }
    }
  }

  draw();
  refresh();
  const timer = setInterval(() => visible() && refresh(), refreshMs);
  const onShow = () => visible() && refresh();
  document.addEventListener('visibilitychange', onShow);
  document.addEventListener('dua:inbox-changed', refresh);
  return {
    retitle,
    refresh,
    stop() {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onShow);
      document.removeEventListener('dua:inbox-changed', refresh);
    },
  };
}
