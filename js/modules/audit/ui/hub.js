// Audit hub: the audits the person may see, and the audit pages they may open.
import { html, render } from '../../../shared/html.js';
import { hero } from '../../../shared/ui.js';
import { shortDate } from '../../../shared/format.js';
import * as api from '../data/api.js';
import { friendlyError } from '../domain/errors.js';
import manifest from '../manifest.js';
import { errorCard, loadingCard } from './parts.js';
import { installSignOutGuard } from './signoutGuard.js';

const SCOPE = { full: 'Full stock', selected: 'Selected companies', single: 'One company', template: 'Template', individual: 'Individual' };
const STATUS = { open: 'Open', archived: 'Archived', closed: 'Closed' };

export async function mount(el, { ctx } = {}) {
  const perms = ctx?.permissions ?? [];
  installSignOutGuard(); // counts waiting on this device block signing out (AUD-9)
  render(el, loadingCard());
  let engagements;
  try {
    engagements = await api.listEngagements();
  } catch (e) {
    return render(el, errorCard('your audits', friendlyError(e).message));
  }
  const pages = manifest.routes.filter(
    (r) => r.path !== '/audit' && (r.permission ? perms.includes(r.permission) : (r.anyOf ?? []).some((k) => perms.includes(k))),
  );
  render(
    el,
    html`<div class="aud">
      ${hero({ label: 'Audit', title: 'Audit Hub', sub: 'Stock audits, counting teams and reports.' })}
      <section class="card aud-card" aria-label="Your audits">
        <h2>Your audits</h2>
        ${
          engagements.length === 0
            ? html`<p class="muted">No audits yet. Rounds can be created once the Inventory update that supplies the stock list is in.</p>`
            : html`<ul class="aud-list">
                ${engagements.map(
                  (g) =>
                    html`<li>
                      <span
                        ><strong>${g.name}</strong>
                        <span class="muted small"
                          >${SCOPE[g.scope_type] ?? g.scope_type}${g.scope_month ? ` · ${g.scope_month}` : ''} ·
                          ${shortDate(g.created_at.slice(0, 10))}</span
                        ></span
                      >
                      <span class="aud-badge aud-badge-${g.status}">${STATUS[g.status] ?? g.status}</span>
                    </li>`,
                )}
              </ul>`
        }
      </section>
      ${
        pages.length
          ? html`<section class="card aud-card" aria-label="Audit pages">
              <h2>Pages</h2>
              ${pages.map(
                (p) =>
                  html`<a class="aud-link" href="#${p.path}"><strong>${p.title}</strong><span class="muted small">${p.desc}</span></a>`,
              )}
            </section>`
          : ''
      }
    </div>`,
  );
}
