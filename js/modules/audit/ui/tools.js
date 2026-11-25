// Audit Tools: the supporting utilities under one tab (expiry, barcodes, racks, templates, administration).
// A presentation of existing routes; each link is shown only when the route's own permission list allows it, and the database still decides.
import { html, render } from '../../../shared/html.js';
import { hero } from '../../../shared/ui.js';
import manifest from '../manifest.js';
import { toolGroups } from '../domain/tools.js';

export async function mount(el, { ctx } = {}) {
  const perms = new Set(ctx?.permissions ?? []);
  const groups = toolGroups(manifest.routes, perms);
  render(
    el,
    html`<div class="aud aud-tools">
      ${hero({ label: 'Audit', title: 'Tools', sub: 'Expiry, barcodes, templates and administration' })}
      ${
        groups.length === 0
          ? html`<div class="card aud-card"><p class="aud-empty">No Audit tools are available for your current permissions.</p></div>`
          : groups.map(
              (g) =>
                html`<section class="card aud-card" aria-label="${g.title}" data-tool-group="${g.key}">
                  <h2>${g.title}</h2>
                  <div class="aud-group-links">
                    ${g.items.map(
                      (item) =>
                        html`<a class="aud-nav-link" href="#${item.path}">
                          <span class="aud-nav-link-copy">
                            <strong>${item.label}</strong>
                            <span class="muted small">${item.description}</span>
                          </span>
                          <span class="aud-nav-arrow" aria-hidden="true">›</span>
                        </a>`,
                    )}
                  </div>
                </section>`,
            )
      }
    </div>`,
  );
}
