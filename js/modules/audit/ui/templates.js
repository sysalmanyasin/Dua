// Templates: saved lists of product codes. Only codes are kept; names, stock and prices are read fresh when a template is used (R12).
import { html, render } from '../../../shared/html.js';
import { hero } from '../../../shared/ui.js';
import * as api from '../data/api.js';
import { parseCodes } from '../domain/count.js';
import { friendlyError } from '../domain/errors.js';
import { errorCard, loadingCard, toast } from './parts.js';

export async function mount(el, { ctx } = {}) {
  const canEdit = (ctx?.permissions ?? []).includes('audit.templates');
  const s = { list: [], editing: null, name: '', codes: '', busy: false, error: null, confirmDelete: null };

  async function load() {
    s.list = await api.listTemplates();
  }

  function draw() {
    const typed = parseCodes(s.codes);
    render(
      el,
      html`<div class="aud">
        ${hero({ label: 'Audit', title: 'Templates', sub: 'Saved lists of product codes for repeat audits.' })}
        ${s.error ? html`<p class="note note-error" role="alert">${s.error}</p>` : ''}
        <section class="card aud-card" aria-label="Templates">
          <h2>Saved templates</h2>
          ${
            s.list.length === 0
              ? html`<p class="muted">No templates yet.</p>`
              : s.list.map(
                  (t) =>
                    html`<div class="row">
                      <div><strong>${t.name}</strong><br /><span class="muted small">${t.codes.length} codes</span></div>
                      ${
                        canEdit
                          ? html`<div class="aud-actions">
                              <button type="button" class="btn btn-ghost btn-sm" data-act="edit" data-id="${t.id}">Edit</button>
                              ${
                                s.confirmDelete === t.id
                                  ? html`<button
                                      type="button"
                                      class="btn btn-sm"
                                      data-act="delete-yes"
                                      data-id="${t.id}"
                                      ${s.busy ? 'disabled' : ''}
                                    >
                                      Delete for good
                                    </button>`
                                  : html`<button type="button" class="btn btn-ghost btn-sm" data-act="delete" data-id="${t.id}">
                                      Delete
                                    </button>`
                              }
                            </div>`
                          : ''
                      }
                    </div>`,
                )
          }
        </section>
        ${
          canEdit
            ? html`<section class="card aud-card" aria-label="${s.editing ? 'Edit template' : 'New template'}">
                <h2>${s.editing ? 'Edit template' : 'New template'}</h2>
                <label class="field"><span>Name</span><input type="text" data-f="name" maxlength="80" value="${s.name}" /></label>
                <label class="field"
                  ><span>Product codes (spaces, commas or new lines)</span
                  ><textarea data-f="codes" rows="6" spellcheck="false">${s.codes}</textarea>
                </label>
                <p class="muted small" data-count>${typed.length} ${typed.length === 1 ? 'code' : 'codes'}</p>
                <div class="aud-actions">
                  <button
                    type="button"
                    class="btn btn-primary"
                    data-act="save"
                    ${s.busy || s.name.trim().length < 2 || typed.length === 0 ? 'disabled' : ''}
                  >
                    Save
                  </button>
                  ${s.editing ? html`<button type="button" class="btn btn-ghost" data-act="cancel">Cancel</button>` : ''}
                </div>
              </section>`
            : ''
        }
      </div>`,
    );
  }

  async function run(fn, done) {
    s.busy = true;
    s.error = null;
    draw();
    try {
      await fn();
      await load();
      if (done) toast(done);
    } catch (e) {
      s.error = friendlyError(e).message;
    }
    s.busy = false;
    draw();
  }

  el.oninput = (e) => {
    const f = e.target.dataset?.f;
    if (f !== 'name' && f !== 'codes') return;
    s[f === 'name' ? 'name' : 'codes'] = e.target.value;
    const n = parseCodes(s.codes).length;
    const btn = el.querySelector('button[data-act="save"]');
    if (btn) btn.disabled = s.busy || s.name.trim().length < 2 || n === 0;
    const c = el.querySelector('[data-count]');
    if (c) c.textContent = `${n} ${n === 1 ? 'code' : 'codes'}`;
  };
  el.onclick = (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b || b.disabled) return;
    const id = b.dataset.id;
    switch (b.dataset.act) {
      case 'edit': {
        const t = s.list.find((x) => x.id === id);
        Object.assign(s, { editing: id, name: t.name, codes: t.codes.join('\n'), error: null });
        return draw();
      }
      case 'cancel':
        Object.assign(s, { editing: null, name: '', codes: '', error: null });
        return draw();
      case 'save':
        return run(async () => {
          await api.saveTemplate({ id: s.editing, name: s.name.trim(), codes: parseCodes(s.codes) });
          Object.assign(s, { editing: null, name: '', codes: '' });
        }, 'Template saved.');
      case 'delete':
        s.confirmDelete = id;
        return draw();
      case 'delete-yes':
        return run(async () => {
          await api.deleteTemplate(id);
          s.confirmDelete = null;
        }, 'Template deleted.');
      default:
    }
  };

  render(el, loadingCard());
  try {
    await load();
  } catch (e) {
    return render(el, errorCard('templates', friendlyError(e).message));
  }
  draw();
}
