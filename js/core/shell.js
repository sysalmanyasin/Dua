// The signed-in app frame: sidebar, header, content area. Loads each module's page on demand.
import { html, render } from '../shared/html.js';
import { icon } from '../shared/icons.js';
import { log } from './logger.js';
import { routesFor, resolveModules } from './registry.js';
import { startRouter } from './router.js';
import { signOut } from './auth.js';

const ROLE_LABEL = { admin: 'Owner / Manager', senior: 'Senior staff', junior: 'Junior staff' };

export function startShell(root, ctx, manifests) {
  const modules = resolveModules(manifests, { permissions: ctx.permissions, disabled: ctx.modules_disabled });
  const routes = routesFor(modules);

  render(
    root,
    html`<div class="shell">
      <aside class="sidebar" id="sidebar" aria-label="Main">
        <div class="brand">${icon('shield')}<strong>Dua</strong></div>
        <nav>
          ${modules.map((m) => html`<a class="nav-link" href="#${m.routes[0].path}" data-module="${m.id}">${icon(m.icon)}<span>${m.title}</span></a>`)}
        </nav>
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
      title.textContent = mod.title;
      root.querySelectorAll('.nav-link').forEach((l) => l.setAttribute('aria-current', String(l.dataset.module === mod.id)));
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
