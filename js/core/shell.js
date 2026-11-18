// The signed-in app frame: status bar, header with logo, module tabs, page tabs and the content area.
// Each module's pages are loaded on demand when their tab is opened.
import { html, render } from '../shared/html.js';
import { icon } from '../shared/icons.js';
import { BRAND } from './config.js';
import { log } from './logger.js';
import { isUsable, routesFor, resolveModules } from './registry.js';
import { startRouter } from './router.js';
import { startStatusBar } from './statusbar.js';
import { signOut } from './auth.js';

const ROLE_LABEL = { admin: 'Owner / Manager', senior: 'Senior staff', junior: 'Junior staff' };
const titled = (m) => m.routes.filter((r) => r.title);

const pageTabs = (m) => titled(m).map((r) => html`<a class="nav-sub" href="#${r.path}" data-path="${r.path}">${r.title}</a>`);

export function startShell(root, ctx, manifests) {
  const modules = resolveModules(manifests, { permissions: ctx.permissions, disabled: ctx.modules_disabled });
  const routes = routesFor(modules);
  // Home is a launcher: one tile per module the person may use. Someone with a single module has nothing to choose,
  // so they land inside it and see no Home link.
  const others = modules.filter((m) => m.id !== 'home' && titled(m).length);
  const solo = others.length === 1 ? others[0] : null;
  const hash = location.hash.replace(/^#/, '');
  if (solo && (hash === '' || hash === '/' || hash === '/home')) location.hash = `#${titled(solo)[0].path}`;

  render(
    root,
    html`<div class="app">
      <div class="status-bar" id="status-bar"></div>
      <header class="hdr">
        <img class="hdr-logo" src="assets/icon.svg" width="38" height="38" alt="" />
        <div class="hdr-title"><strong>${BRAND.title}</strong><span id="hdr-sub">${BRAND.branch}</span></div>
        <div class="hdr-right">
          <div class="who"><strong>${ctx.full_name}</strong><span>${ROLE_LABEL[ctx.role] ?? ctx.role}</span></div>
          <button class="btn btn-ghost btn-sm" data-action="signout">${icon('logout')}<span>Sign out</span></button>
        </div>
      </header>
      <nav class="tabs sub" id="subtabs" aria-label="Pages" hidden></nav>
      <main class="content" id="content" tabindex="-1"></main>
    </div>`,
  );

  root.onclick = (e) => {
    if (e.target.closest('[data-action="signout"]')) signOut();
  };

  const content = root.querySelector('#content');
  const subtabs = root.querySelector('#subtabs');
  // A status pill may belong to a module the person has no page in (for example staff who may see only today's
  // Candela total), so pills are offered from every usable module, not only those that show a tab.
  const off = new Set(ctx.modules_disabled ?? []);
  const pillOwners = manifests.filter((m) => m.status && isUsable(m, new Set(ctx.permissions), off));
  const stopStatus = startStatusBar(root.querySelector('#status-bar'), ctx, pillOwners);
  let token = 0;

  const stopRouter = startRouter(
    () => routes,
    async (route) => {
      const mine = ++token;
      const mod = modules.find((m) => m.id === route.moduleId);
      root.querySelector('#hdr-sub').textContent = `${BRAND.branch} · ${mod.title}`;
      // Inside a module: "‹ Home" (when there is a Home to go to), then the module's own pages. A module with `hub: true`
      // (its first page lists everything else) shows only a link back to that first page instead of a row of tabs.
      const onHome = mod.id === 'home';
      root.querySelector('#status-bar').hidden = !onHome;
      const pages = titled(mod);
      const home = solo ? '' : html`<a class="nav-sub nav-home" href="#/home">‹ Home</a>`;
      subtabs.hidden = onHome || (!home && (mod.hub || pages.length < 2));
      if (!onHome) {
        const hubBack =
          mod.hub && route.path !== pages[0].path ? html`<a class="nav-sub" href="#${pages[0].path}">← ${pages[0].title}</a>` : '';
        render(subtabs, html`${home}${mod.hub ? hubBack : pageTabs(mod)}`);
        subtabs.hidden = !(home || hubBack || (!mod.hub && pages.length > 1));
        subtabs
          .querySelectorAll('.nav-sub[data-path]')
          .forEach((l) => l.setAttribute('aria-current', String(l.dataset.path === route.path)));
      }
      document.title = `${route.title ?? mod.title} · ${BRAND.title}`;
      render(content, html`<p class="muted">Loading…</p>`);
      try {
        const page = await route.load(); // the module's code is downloaded only now
        if (mine !== token) return;
        // A fresh container for every page, so one page's event handlers can never fire on the next page.
        const host = document.createElement('div');
        host.className = 'page';
        content.replaceChildren(host);
        await page.mount(host, { ctx, route, modules });
      } catch (err) {
        // One broken module never takes the app down.
        log.error('module failed', { module: mod.id, message: String(err?.message ?? err) });
        if (mine === token)
          render(
            content,
            html`<div class="card">
              <h2>This section could not load</h2>
              <p class="muted">The rest of the app still works. Try again, or tell the owner.</p>
            </div>`,
          );
      }
    },
    (path) =>
      render(
        content,
        html`<div class="card">
          <h2>Not found</h2>
          <p class="muted">There is nothing at ${path ?? 'that address'}, or you do not have access.</p>
          <a class="btn" href="#/home">Go home</a>
        </div>`,
      ),
  );
  return () => {
    stopRouter();
    stopStatus();
  };
}
