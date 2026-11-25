// The Audit tab frame. It wraps a page that already exists: the four primary tabs on top, and inside Team Audit the five screens.
// The page itself is not touched; it is mounted in the space below the tabs and keeps its own state, events and permissions.
import { html, render } from '../../../shared/html.js';
import * as api from '../data/api.js';
import { getView } from '../domain/nav.js';
import { individualScreens, placeOf, teamScreens, visibleTabs } from '../domain/workspace.js';

const tabLink = (tab, active) =>
  html`<a class="aud-tab" href="#${tab.path}" data-tab="${tab.key}" aria-current="${active ? 'page' : 'false'}">${tab.label}</a>`;

const screenLink = (screen, active) =>
  screen.waiting
    ? html`<span class="aud-screen aud-screen-waiting" data-screen="${screen.key}" aria-disabled="true" title="Open an audit round first"
        >${screen.label}</span
      >`
    : html`<a class="aud-screen" href="#${screen.path}" data-screen="${screen.key}" aria-current="${active ? 'page' : 'false'}"
        >${screen.label}</a
      >`;

// Which audit and round the Team screens are on, so every screen says so and links back to the audit. Read once per audit and
// kept for the session; a failed read just leaves the line out.
const names = new Map();
async function auditContext(view) {
  if (!view?.engagement) return null;
  try {
    let overview = names.get(view.engagement);
    const find = (o) => (view.round ? o?.rounds?.find((r) => r.id === view.round) : null);
    if (!overview || (view.round && !find(overview))) {
      overview = await api.engagementOverview(view.engagement);
      names.set(view.engagement, overview);
    }
    const round = find(overview);
    return { name: overview.engagement?.name ?? '', round: round ? `${round.round_number}${round.round_suffix ?? ''}` : '' };
  } catch {
    return null;
  }
}

async function fillContext(bar, view) {
  const context = await auditContext(view);
  const slot = bar.querySelector('[data-context]');
  if (!slot || !context?.name) return;
  slot.replaceChildren();
  const link = document.createElement('a');
  link.href = '#/audit/engagement';
  link.className = 'aud-context-link';
  link.textContent = context.round ? `${context.name} · Round ${context.round}` : context.name;
  link.title = 'Back to this audit';
  slot.append(link);
}

/** The tabs (and the Team or Individual Audit screens) for the page at `path`, as markup. Empty markup when the page has no tab bar. */
export function frameBar({ path, routes, permissions, view }) {
  const place = placeOf(path);
  if (!place) return html``;
  const tabs = visibleTabs(routes, permissions);
  const screens =
    place.tab === 'team'
      ? teamScreens(routes, permissions, view)
      : place.tab === 'individual'
        ? individualScreens(routes, permissions, view)
        : [];
  const name = place.tab === 'team' ? 'Team Audit' : 'Individual Audit';
  return html`<div class="aud aud-frame">
    <nav class="aud-tabs" aria-label="Audit sections">${tabs.map((t) => tabLink(t, t.key === place.tab))}</nav>
    ${place.tab === 'team' && view?.engagement ? html`<p class="aud-context" data-context></p>` : ''}
    ${
      screens.length > 1
        ? html`<nav class="aud-screens" aria-label="${name} screens">${screens.map((s) => screenLink(s, s.key === place.screen))}</nav>`
        : ''
    }
  </div>`;
}

/**
 * Wraps a page loader. `options` are handed to the page's mount, so one page can serve more than one screen
 * (the review page shows either the Compile & Review screen or the Corrections screen).
 * Returns what a route's `load` must return: an object with `mount`.
 */
export async function framed(loader, options = {}) {
  const inner = await loader();
  // the manifest is already loaded by the time a page opens; it is read here, not imported by the frame's caller, to avoid a cycle
  const { default: manifest } = await import('../manifest.js');
  return {
    async mount(host, args = {}) {
      const path = args.route?.path;
      const bar = document.createElement('div');
      const body = document.createElement('div');
      host.replaceChildren(bar, body);
      const view = getView();
      render(bar, frameBar({ path, routes: manifest.routes, permissions: new Set(args.ctx?.permissions ?? []), view }));
      void fillContext(bar, view);
      return inner.mount(body, { ...args, ...options });
    },
  };
}
