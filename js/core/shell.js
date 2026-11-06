// The signed-in app frame: sidebar, header, content area. Loads each module's page on demand.
import { html, render } from '../shared/html.js';
import { icon } from '../shared/icons.js';
import { log } from './logger.js';
import { routesFor, resolveModules } from './registry.js';
import { startRouter } from './router.js';
import { signOut } from './auth.js';

// A module with several titled pages becomes a group with sub-links; otherwise a single link.
function navFor(m) {
  const pages = m.routes.filter((r) => r.title);
  if (pages.length <= 1) {
    const target = pages[0] ?? m.routes[0];
    return html`<a class="nav-link" href="#${target.path}" data-module="${m.id}" data-path="${target.path}"
      >${icon(m.icon)}<span>${m.title}</span></a
    >`;
  }
  return html`<div class="nav-group">
    <div class="nav-group-title">${icon(m.icon)}<span>${m.title}</span></div>
    ${pages.map((r) => html`<a class="nav-link nav-sub" href="#${r.path}" data-module="${m.id}" data-path="${r.path}"><span>${r.title}</span></a>`)}
  </div>`;
}

const ROLE_LABEL = { admin: 'Owner / Manager', senior: 'Senior staff', junior: 'Junior staff' };

export function startShell(root, ctx, manifests) {
  const modules = resolveModules(manifests, { permissions: ctx.permissions, disabled: ctx.modules_disabled });
  const routes = routesFor(modules);

  render(
    root,
    html`<div class="shell">
      <aside class="sidebar" id="sidebar" aria-label="Main">
        <div class="brand">${icon('shield')}<strong>Dua</strong></div>
        <nav>${modules.map(navFor)}</nav>
        <div class="sidebar-foot">
          <div class="who"><strong>${ctx.full_name}</strong><span>${ROLE_LABEL[ctx.role] ?? ctx.role}</span></div>
          <button class="btn btn-ghost" data-action="signout">${icon('logout')}<span>Sign out</span></button>
        </div>
      </aside>
      <div class="main">
        <header class="topbar">
          <button class="icon-btn" data-action="menu" aria-label="Menu" aria-controls="sidebar">${icon('menu')}</button
          ><span class="topbar-title" id="page-title"></span>
        </header>
        <div class="content" id="content" tabindex="-1"></div>
      </div>
    </div>`,
  );

  root.onclick = (e) => {
    const a = e.target.closest('[data-action]');
    if (a?.dataset.action === 'signout') signOut();
    if (a?.dataset.action === 'menu') document.getElementById('sidebar').classList.toggle('open');
    if (e.target.closest('.nav-link')) document.getElementById('sidebar').classList.remove('open');
  };

  const content = root.querySelector('#content');
  const title = root.querySelector('#page-title');
  let token = 0;

  return startRouter(
    () => routes,
    async (route) => {
      const mine = ++token;
      const mod = modules.find((m) => m.id === route.moduleId);
      title.textContent = route.title ?? mod.title;
      root.querySelectorAll('.nav-link').forEach((l) => l.setAttribute('aria-current', String(l.dataset.path === route.path)));
      render(content, html`<p class="muted">Loading…</p>`);
      try {
        const page = await route.load(); // the module's code is downloaded only now
        if (mine !== token) return;
        content.replaceChildren();
        await page.mount(content, { ctx, route });
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
}
