// The signed-in app frame: status bar, header with logo, module tabs, page tabs and the content area.
// Each module's pages are loaded on demand when their tab is opened.
import { html, render } from '../shared/html.js';
import { icon } from '../shared/icons.js';
import { BRAND } from './config.js';
import { log } from './logger.js';
import { routesFor, resolveModules } from './registry.js';
import { startRouter } from './router.js';
import { startStatusBar } from './statusbar.js';
import { signOut } from './auth.js';

const ROLE_LABEL = { admin: 'Owner / Manager', senior: 'Senior staff', junior: 'Junior staff' };
const titled = (m) => m.routes.filter((r) => r.title);

// One tab per module; it opens the module's first page.
const moduleTab = (m) => {
  const first = titled(m)[0] ?? m.routes[0];
  return html`<a class="nav-link" href="#${first.path}" data-module="${m.id}" data-path="${first.path}"
    >${icon(m.icon)}<span>${m.title}</span></a
  >`;
};
const pageTabs = (m) => titled(m).map((r) => html`<a class="nav-sub" href="#${r.path}" data-path="${r.path}">${r.title}</a>`);

export function startShell(root, ctx, manifests) {
  const modules = resolveModules(manifests, { permissions: ctx.permissions, disabled: ctx.modules_disabled });
  const routes = routesFor(modules);

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
      <nav class="tabs" aria-label="Sections">${modules.map(moduleTab)}</nav>
      <nav class="tabs sub" id="subtabs" aria-label="Pages" hidden></nav>
      <main class="content" id="content" tabindex="-1"></main>
    </div>`,
  );

  root.onclick = (e) => {
    if (e.target.closest('[data-action="signout"]')) signOut();
  };

  const content = root.querySelector('#content');
  const subtabs = root.querySelector('#subtabs');
  const stopStatus = startStatusBar(root.querySelector('#status-bar'), ctx, modules);
  let token = 0;
  let shownModule = null;

  const stopRouter = startRouter(
    () => routes,
    async (route) => {
      const mine = ++token;
      const mod = modules.find((m) => m.id === route.moduleId);
      root.querySelector('#hdr-sub').textContent = `${BRAND.branch} · ${mod.title}`;
      root.querySelectorAll('.nav-link').forEach((l) => l.setAttribute('aria-current', String(l.dataset.module === mod.id)));
      if (shownModule !== mod.id) {
        shownModule = mod.id;
        const pages = titled(mod);
        subtabs.hidden = pages.length < 2;
        render(subtabs, html`${pageTabs(mod)}`);
      }
      subtabs.querySelectorAll('.nav-sub').forEach((l) => l.setAttribute('aria-current', String(l.dataset.path === route.path)));
      document.title = `${route.title ?? mod.title} · ${BRAND.title}`;
      render(content, html`<p class="muted">Loading…</p>`);
      try {
        const page = await route.load(); // the module's code is downloaded only now
        if (mine !== token) return;
        // A fresh container for every page, so one page's event handlers can never fire on the next page.
        const host = document.createElement('div');
        host.className = 'page';
        content.replaceChildren(host);
        await page.mount(host, { ctx, route });
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
