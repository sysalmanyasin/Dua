// Audits list and the form to start a new one.
import { html, render } from '../../../shared/html.js';
import { hero } from '../../../shared/ui.js';
import { shortDate } from '../../../shared/format.js';
import * as api from '../data/api.js';
import { friendlyError } from '../domain/errors.js';
import { setView } from '../domain/nav.js';
import { errorCard, loadingCard } from './parts.js';
import { mountProductSearch } from './productSearch.js';
import { mountWizard } from './wizard.js';

const SCOPE_LABEL = {
  full: 'Full stock',
  selected: 'Selected companies',
  single: 'One company',
  template: 'Template',
  individual: 'Individual',
};
const STATUS = { open: 'Open', archived: 'Archived', closed: 'Closed' };

export async function mount(el, { ctx } = {}) {
  const canManage = (ctx?.permissions ?? []).includes('audit.manage');
  let list = [];
  let people = []; // null = the list of people could not load
  let companyList = null; // null = could not load, so the typed box is used instead

  const draw = () => {
    render(
      el,
      html`<div class="aud">
        ${hero({ label: 'Audit', title: 'Audits', sub: 'One audit holds the rounds and the counting team for one piece of work.' })}
        ${canManage ? html`<div data-wizard-host></div>` : ''}
        <div data-search-host></div>
        <p class="aud-more"><a class="btn btn-sm" href="#/audit/individuals">Individual audits by person</a></p>
        <section class="card aud-card" aria-label="All audits">
          <h2>All audits</h2>
          ${
            list.length === 0
              ? html`<p class="muted">No audits yet.</p>`
              : html`<ul class="aud-list">
                  ${list.map(
                    (g) =>
                      html`<li>
                        <span
                          ><strong>${g.name}</strong>
                          <span class="muted small"
                            >${SCOPE_LABEL[g.scope_type] ?? g.scope_type}${g.scope_month ? ` · ${g.scope_month}` : ''} ·
                            ${shortDate(g.created_at.slice(0, 10))}</span
                          ></span
                        >
                        <span class="aud-actions">
                          <span class="aud-badge aud-badge-${g.status}">${STATUS[g.status] ?? g.status}</span>
                          <button type="button" class="btn btn-sm" data-act="open" data-id="${g.id}">Open</button>
                        </span>
                      </li>`,
                  )}
                </ul>`
          }
        </section>
      </div>`,
    );
    const host = el.querySelector('[data-wizard-host]');
    if (host) mountWizard(host, { people, companyList });
    const searchHost = el.querySelector('[data-search-host]');
    if (searchHost) mountProductSearch(searchHost);
  };

  el.onclick = (e) => {
    const b = e.target.closest('button[data-act="open"]');
    if (!b || b.disabled) return;
    setView({ engagement: b.dataset.id });
    location.hash = '#/audit/engagement';
  };

  render(el, loadingCard());
  try {
    list = await api.listEngagements(100);
    if (canManage) {
      try {
        const found = await api.listCompanies();
        if (Array.isArray(found) && found.length > 0) companyList = found;
      } catch {
        companyList = null;
      }
      try {
        people = await api.listPeopleForAudit();
      } catch {
        people = null;
      }
    }
  } catch (e) {
    return render(el, errorCard('the audits', friendlyError(e).message));
  }
  draw();
}
