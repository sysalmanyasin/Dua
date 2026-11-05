import { loadContext } from './auth.js';
import { getConfig } from './config.js';
import { installGlobalHandlers, log } from './logger.js';
import { loadManifests, setBrokenHandler } from './registry.js';
import { showBlocked, showLogin, showMfa } from './screens.js';
import { startShell } from './shell.js';
import { html, render } from '../shared/html.js';

const root = document.getElementById('app');
let stopRouter = null;

async function route() {
  stopRouter?.();
  stopRouter = null;
  const { db } = await import('./supabase.js');
  const { data } = await db().auth.getSession();
  if (!data.session) return showLogin(root, { onDone: route });

  const ctx = await loadContext();
  if (!ctx) return showBlocked(root, 'This account is not active. Ask the owner to enable it.');
  if (!ctx.mfa_ok) {
    return showMfa(root, { onDone: route });
  }
  const manifests = await loadManifests();
  stopRouter = startShell(root, ctx, manifests);
}

async function boot() {
  installGlobalHandlers();
  setBrokenHandler((id, reason) => log.error('module manifest failed', { module: id, message: String(reason) }));
  if (!getConfig().configured) {
    return render(
      root,
      html`<main class="auth">
        <section class="card auth-card">
          <h1>Not configured</h1>
          <p class="muted">Set the Supabase URL and publishable key for this environment in js/core/config.js.</p>
        </section>
      </main>`,
    );
  }
  const { db } = await import('./supabase.js');
  db().auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') route();
  });
  await route();
}

boot().catch((e) => {
  log.error('boot failed', { message: String(e?.message ?? e) });
  render(
    root,
    html`<main class="auth">
      <section class="card auth-card">
        <h1>Something went wrong</h1>
        <p class="muted">Reload the page. If it keeps happening, tell the owner.</p>
      </section>
    </main>`,
  );
});
