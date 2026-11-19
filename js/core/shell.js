// Permission-aware application shell with persistent global navigation.
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
const moduleIcon = (m) =>
  m.icon ??
  { home: 'home', sales: 'chart', manager: 'users', inventory: 'shield', closing: 'chart', access: 'shield', tools: 'menu' }[m.id] ??
  'shield';
function navigation(modules, activeId) {
  return html`<div class="side-nav-heading">WORKSPACE</div>
    ${modules.map((m) => html`<a class="side-link ${m.id === activeId ? 'is-active' : ''}" href="#${titled(m)[0]?.path ?? '/home'}" data-module="${m.id}" ${m.id === activeId ? 'aria-current="page"' : ''}><span class="side-icon">${icon(moduleIcon(m))}</span><span class="side-label">${m.title}</span><span class="side-chevron">›</span></a>`)}
    <div class="side-nav-footer"><span class="side-footer-mark"></span><span>Business workspace</span></div>`;
}
export function startShell(root, ctx, manifests) {
  const modules = resolveModules(manifests, { permissions: ctx.permissions, disabled: ctx.modules_disabled });
  const routes = routesFor(modules);
  const home = modules.find((m) => m.id === 'home');
  const first = modules.find((m) => m.id !== 'home');
  const hash = location.hash.replace(/^#/, '');
  // Landing page. replaceState (not location.hash) so the router does not see a second navigation and load the page twice.
  const land = (path) => path && history.replaceState(null, '', `#${path}`);
  if (!hash || hash === '/' || hash === '/home') {
    if (!home && first) land((titled(first)[0] ?? first.routes[0])?.path);
    else if (!hash || hash === '/') land('/home');
  }
  render(
    root,
    html`<div class="app app-shell">
      <div class="status-bar" id="status-bar"></div>
      <header class="hdr app-header">
        <button class="mobile-menu-btn" type="button" data-action="menu" aria-label="Open navigation" aria-expanded="false">
          ${icon('menu')}
        </button>
        <a class="brand-lockup" href="#/home" aria-label="Dua home"
          ><img class="hdr-logo" src="assets/icon.svg" width="38" height="38" alt="" /><span class="hdr-title"
            ><strong>Dua</strong><span>${BRAND.branch}</span></span
          ></a
        >
        <div class="header-context"><span class="context-dot"></span><span id="hdr-sub">${BRAND.title}</span></div>
        <div class="hdr-right">
          <div class="who"><strong>${ctx.full_name}</strong><span>${ROLE_LABEL[ctx.role] ?? ctx.role}</span></div>
          <button class="btn btn-ghost btn-sm" data-action="signout">${icon('logout')}<span>Sign out</span></button>
        </div>
      </header>
      <div class="app-workspace">
        <div class="nav-scrim" data-action="close-menu"></div>
        <aside class="app-sidebar" id="app-sidebar" aria-label="Main navigation">
          <div class="sidebar-top">
            <span class="sidebar-caption">YOUR BUSINESS</span
            ><button class="sidebar-close" data-action="close-menu" aria-label="Close navigation">×</button>
          </div>
          <nav class="global-nav" id="global-nav">${navigation(modules, '')}</nav>
        </aside>
        <section class="workspace-main">
          <div class="workspace-crumb" id="workspace-crumb"><span>Workspace</span><span>/</span><strong>Home</strong></div>
          <nav class="tabs sub" id="subtabs" aria-label="Pages" hidden></nav>
          <main class="content" id="content" tabindex="-1"></main>
        </section>
      </div>
    </div>`,
  );
  const content = root.querySelector('#content'),
    subtabs = root.querySelector('#subtabs'),
    menuButton = root.querySelector('[data-action="menu"]');
  const setMenu = (open) => {
    root.querySelector('.app-shell').classList.toggle('nav-open', open);
    menuButton?.setAttribute('aria-expanded', String(open));
    menuButton?.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
  };
  root.onclick = (e) => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'signout') signOut();
    if (action === 'menu') setMenu(true);
    if (action === 'close-menu') setMenu(false);
    if (e.target.closest('.side-link')) setMenu(false);
  };
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') setMenu(false);
  });
  const off = new Set(ctx.modules_disabled ?? []);
  const pillOwners = manifests.filter((m) => m.status && isUsable(m, new Set(ctx.permissions), off));
  const stopStatus = startStatusBar(root.querySelector('#status-bar'), ctx, pillOwners);
  let token = 0;
  const stopRouter = startRouter(
    () => routes,
    async (route) => {
      const mine = ++token,
        mod = modules.find((m) => m.id === route.moduleId);
      root.querySelector('#hdr-sub').textContent = mod.title;
      render(
        root.querySelector('#workspace-crumb'),
        html`<span>Workspace</span><span>/</span><strong>${route.title ?? mod.title}</strong>`,
      );
      root.querySelector('#status-bar').hidden = mod.id !== 'home';
      render(root.querySelector('#global-nav'), navigation(modules, mod.id));
      const pages = titled(mod),
        onHome = mod.id === 'home';
      const homeLink = home && !onHome ? html`<a class="nav-sub nav-home" href="#/home">‹ Home</a>` : '';
      subtabs.hidden = onHome || (!homeLink && (mod.hub || pages.length < 2));
      if (!onHome) {
        const hubBack =
          mod.hub && route.path !== pages[0].path ? html`<a class="nav-sub" href="#${pages[0].path}">← ${pages[0].title}</a>` : '';
        render(
          subtabs,
          html`${homeLink}${mod.hub ? hubBack : pages.map((r) => html`<a class="nav-sub" href="#${r.path}" data-path="${r.path}">${r.title}</a>`)}`,
        );
        subtabs.hidden = !(homeLink || hubBack || (!mod.hub && pages.length > 1));
        subtabs
          .querySelectorAll('.nav-sub[data-path]')
          .forEach((l) => l.setAttribute('aria-current', String(l.dataset.path === route.path)));
      }
      document.title = `${route.title ?? mod.title} · Dua`;
      render(content, html`<p class="muted">Loading…</p>`);
      try {
        const page = await route.load();
        if (mine !== token) return;
        const host = document.createElement('div');
        host.className = 'page';
        content.replaceChildren(host);
        await page.mount(host, { ctx, route, modules });
      } catch (err) {
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
