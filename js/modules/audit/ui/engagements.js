// Audits list and the form to start a new one.
import { html, render } from '../../../shared/html.js';
import { hero } from '../../../shared/ui.js';
import { shortDate } from '../../../shared/format.js';
import * as api from '../data/api.js';
import { friendlyError } from '../domain/errors.js';
import { newKey, setView } from '../domain/nav.js';
import { errorCard, loadingCard, toast } from './parts.js';

const SCOPES = {
  full: 'Full stock',
  selected: 'Selected companies',
  single: 'One company',
};
const METHODS = { manual: 'Manual counting', barcode: 'Barcode scanning', hybrid: 'Scan or type' };
const SCOPE_LABEL = { ...SCOPES, template: 'Template', individual: 'Individual' };
const STATUS = { open: 'Open', archived: 'Archived', closed: 'Closed' };

export async function mount(el, { ctx } = {}) {
  const canManage = (ctx?.permissions ?? []).includes('audit.manage');
  const form = { name: '', scope: 'full', companies: '', method: 'manual', key: newKey(), busy: false, error: null };
  let list = [];

  const draw = () =>
    render(
      el,
      html`<div class="aud">
        ${hero({ label: 'Audit', title: 'Audits', sub: 'One audit holds the rounds and the counting team for one piece of work.' })}
        ${canManage ? newForm() : ''}
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

  const newForm = () =>
    html`<section class="card aud-card" aria-label="New audit">
      <h2>New audit</h2>
      ${form.error ? html`<p class="note note-error" role="alert">${form.error}</p>` : ''}
      <label class="field"
        ><span>Name</span
        ><input type="text" data-f="name" maxlength="120" value="${form.name}" placeholder="e.g. Annual stock audit" autocomplete="off"
      /></label>
      <label class="field"
        ><span>Scope</span
        ><select data-f="scope">
          ${Object.entries(SCOPES).map(([k, v]) => html`<option value="${k}" ${form.scope === k ? 'selected' : ''}>${v}</option>`)}
        </select></label
      >
      ${
        form.scope === 'full'
          ? ''
          : html`<label class="field"
              ><span>${form.scope === 'single' ? 'Company' : 'Companies (separate with commas)'}</span
              ><input
                type="text"
                data-f="companies"
                value="${form.companies}"
                placeholder="Exactly as written in the stock list"
                autocomplete="off"
            /></label>`
      }
      <label class="field"
        ><span>Counting method</span
        ><select data-f="method">
          ${Object.entries(METHODS).map(([k, v]) => html`<option value="${k}" ${form.method === k ? 'selected' : ''}>${v}</option>`)}
        </select></label
      >
      <button type="button" class="btn btn-primary" data-act="create" ${form.busy ? 'disabled' : ''}>Create audit</button>
    </section>`;

  el.oninput = (e) => {
    const f = e.target.dataset?.f;
    if (f === 'name' || f === 'companies') form[f] = e.target.value;
  };
  el.onchange = (e) => {
    const f = e.target.dataset?.f;
    if (f === 'scope' || f === 'method') {
      form[f] = e.target.value;
      draw();
    }
  };
  el.onclick = async (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b || b.disabled) return;
    if (b.dataset.act === 'open') {
      setView({ engagement: b.dataset.id });
      location.hash = '#/audit/engagement';
      return;
    }
    if (b.dataset.act === 'create') {
      form.busy = true;
      form.error = null;
      draw();
      try {
        const id = await api.createEngagement({
          key: form.key,
          name: form.name,
          scopeType: form.scope,
          companies: form.scope === 'full' ? [] : form.companies.split(','),
          method: form.method,
        });
        toast('Audit created.');
        setView({ engagement: id });
        location.hash = '#/audit/engagement';
        return;
      } catch (err) {
        form.error = friendlyError(err).message;
        form.busy = false;
        draw();
      }
    }
  };

  render(el, loadingCard());
  try {
    list = await api.listEngagements(100);
  } catch (e) {
    return render(el, errorCard('the audits', friendlyError(e).message));
  }
  draw();
}
