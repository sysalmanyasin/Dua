// Individual Audit: the person picks their own products (from a saved template, or whole companies) and counts them alone.
// One rolling engagement per month holds every self-pick; one person has one open self-pick at a time (R8).
import { html, render } from '../../../shared/html.js';
import { hero } from '../../../shared/ui.js';
import * as api from '../data/api.js';
import { MAX_COMPANIES, parseCompanies } from '../domain/count.js';
import { friendlyError } from '../domain/errors.js';
import { getView, newKey, setView } from '../domain/nav.js';
import { companyPicker } from './companyPicker.js';
import { errorCard, loadingCard, toast } from './parts.js';

const KEY = 'dua.audit.individualKey';
const safe = (fn) => {
  try {
    return fn();
  } catch {
    return null;
  }
};
// the same key is reused until a start succeeds, so a retry after a dropped connection can never make a second round
const currentKey = () =>
  safe(() => sessionStorage.getItem(KEY)) ??
  (safe(() => sessionStorage.setItem(KEY, newKey())), safe(() => sessionStorage.getItem(KEY)) ?? newKey());
const forgetKey = () => safe(() => sessionStorage.removeItem(KEY));

export async function mount(el, { ctx } = {}) {
  render(el, loadingCard());
  let mine;
  let templates = [];
  try {
    [mine, templates] = await Promise.all([api.myAssignments(), api.listTemplates()]);
  } catch (e) {
    return render(el, errorCard('Individual Audit', friendlyError(e).message));
  }
  const canTemplates = (ctx?.permissions ?? []).includes('audit.templates');
  const open = mine.find((a) => a.method === 'individual-self-pick' && a.status !== 'submitted' && a.status !== 'revoked');
  // The company list is a convenience: if it cannot be loaded, the typed box still works.
  let companyList = null;
  try {
    const list = await api.listCompanies();
    if (Array.isArray(list) && list.length > 0) companyList = list;
  } catch {
    companyList = null;
  }
  const s = {
    by: 'template',
    companies: '',
    picked: [],
    template: '',
    busy: false,
    error: null,
    note: null,
  };
  const ready = () => {
    if (s.busy) return false;
    if (s.by === 'template') return !!s.template;
    if (companyList) return s.picked.length > 0 && s.picked.length <= MAX_COMPANIES;
    return parseCompanies(s.companies).length > 0 && parseCompanies(s.companies).length <= MAX_COMPANIES;
  };

  function draw() {
    const nCompanies = parseCompanies(s.companies).length;
    render(
      el,
      html`<div class="aud">
        ${hero({ label: 'Audit', title: 'Individual Audit', sub: 'Pick products yourself and count them.' })}
        ${
          open
            ? html`<section class="card aud-card" aria-label="Open audit">
                <h2>You have one open</h2>
                <p class="muted">${open.items} items · ${open.counted} counted${open.template_name ? ` · ${open.template_name}` : ''}</p>
                <button type="button" class="btn btn-primary" data-act="continue">Continue counting</button>
                <p class="muted small">Submit it before starting another.</p>
              </section>`
            : html`<section class="card aud-card" aria-label="Start">
                <h2>Start an Individual Audit</h2>
                <p class="muted small">Your pick joins this month's Individual audits. Quantities and prices are today's stock.</p>
                ${s.error ? html`<p class="note note-error" role="alert">${s.error}</p>` : ''}
                <div class="aud-seg" role="group" aria-label="Pick by">
                  <button
                    type="button"
                    class="btn ${s.by === 'template' ? 'btn-primary' : 'btn-ghost'}"
                    data-act="by"
                    data-by="template"
                    aria-pressed="${s.by === 'template'}"
                  >
                    From a template
                  </button>
                  <button
                    type="button"
                    class="btn ${s.by === 'companies' ? 'btn-primary' : 'btn-ghost'}"
                    data-act="by"
                    data-by="companies"
                    aria-pressed="${s.by === 'companies'}"
                  >
                    Pick companies
                  </button>
                </div>
                ${
                  s.by === 'template'
                    ? templates.length === 0
                      ? html`<p class="muted">
                          No saved templates
                          yet.${
                            canTemplates
                              ? html` <a class="aud-link-inline" href="#/audit/templates">Add one in Templates</a>.`
                              : ' Ask the owner to add one.'
                          }
                        </p>`
                      : html`<div class="aud-picker-list" role="radiogroup" aria-label="Saved templates">
                          ${templates.map(
                            (t) =>
                              html`<label class="aud-picker-row"
                                ><input
                                  type="radio"
                                  name="aud-template"
                                  data-f="template"
                                  value="${t.id}"
                                  ${s.template === t.id ? 'checked' : ''}
                                />
                                <span class="aud-picker-name"
                                  ><strong>${t.name}</strong
                                  ><span class="muted small">${t.codes.length} ${t.codes.length === 1 ? 'code' : 'codes'}</span></span
                                ></label
                              >`,
                          )}
                        </div>`
                    : ''
                }
                ${
                  s.by === 'companies' && companyList
                    ? html`<div class="field">
                        <span>Companies (up to ${MAX_COMPANIES})</span>
                        <div data-picker-host></div>
                      </div>`
                    : ''
                }
                ${
                  s.by === 'companies' && !companyList
                    ? html`<label class="field"
                          ><span>Company names, one per line, as they appear in Inventory</span
                          ><textarea data-f="companies" rows="4" autocomplete="off" spellcheck="false">${s.companies}</textarea>
                        </label>
                        <p class="muted small" data-count>
                          ${nCompanies}
                          ${nCompanies === 1 ? 'company' : 'companies'}${nCompanies > MAX_COMPANIES ? ` — too many, ${MAX_COMPANIES} at most` : ''}
                        </p>`
                    : ''
                }
                <button type="button" class="btn btn-primary" data-act="start" ${ready() ? '' : 'disabled'}>
                  ${s.busy ? 'Starting…' : 'Start counting'}
                </button>
              </section>`
        }
      </div>`,
    );
    const host = el.querySelector('[data-picker-host]');
    if (host) {
      companyPicker(host, {
        companies: companyList,
        selected: s.picked,
        max: MAX_COMPANIES,
        onChange: (names) => {
          s.picked = names;
          refresh();
        },
      });
    }
  }

  const refresh = () => {
    const btn = el.querySelector('button[data-act="start"]');
    if (btn) btn.disabled = !ready();
    const c = el.querySelector('[data-count]');
    if (!c) return;
    if (s.by === 'companies') {
      const n = parseCompanies(s.companies).length;
      c.textContent = `${n} ${n === 1 ? 'company' : 'companies'}${n > MAX_COMPANIES ? ` — too many, ${MAX_COMPANIES} at most` : ''}`;
    }
  };
  el.oninput = (e) => {
    const f = e.target.dataset?.f;
    if (f === 'companies') {
      s[f] = e.target.value; // typing never redraws, so the cursor stays where it is
      refresh();
    }
  };
  el.onchange = (e) => {
    const f = e.target.dataset?.f;
    if (f === 'template') {
      s.template = e.target.value;
      s.error = null;
      refresh();
    }
  };
  el.onclick = async (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b || b.disabled) return;
    if (b.dataset.act === 'continue') {
      setView({ ...(getView() ?? {}), assignment: open.assignment_id });
      location.hash = '#/audit/count';
      return;
    }
    if (b.dataset.act === 'by') {
      s.by = b.dataset.by;
      s.error = null;
      return draw();
    }
    if (b.dataset.act !== 'start') return;
    s.busy = true;
    s.error = null;
    draw();
    try {
      const r = await api.startIndividual({
        key: currentKey(),
        codes: [],
        companies: s.by === 'companies' ? (companyList ? s.picked : parseCompanies(s.companies)) : [],
        templateId: s.by === 'template' ? s.template : null,
      });
      forgetKey();
      setView({ ...(getView() ?? {}), assignment: r.assignment_id });
      if (r.requested > r.items) toast(`${r.requested - r.items} of the codes were not found and are left out.`);
      location.hash = '#/audit/count';
    } catch (err) {
      const f = friendlyError(err);
      if (f.kind === 'refused') forgetKey(); // a refusal is final; a lost connection keeps the key for the retry
      s.error = f.message;
      s.busy = false;
      draw();
    }
  };
  void ctx;
  draw();
}
