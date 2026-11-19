// Individual Audit: the person picks their own products (typed codes or a template) and counts them alone.
// One rolling engagement per month holds every self-pick; one person has one open self-pick at a time (R8).
import { html, render } from '../../../shared/html.js';
import { hero } from '../../../shared/ui.js';
import * as api from '../data/api.js';
import { MAX_CODES, MAX_COMPANIES, parseCodes, parseCompanies } from '../domain/count.js';
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
    by: templates.length ? 'template' : 'codes',
    codes: '',
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
    if (s.by === 'codes') return parseCodes(s.codes).length > 0 && parseCodes(s.codes).length <= MAX_CODES;
    if (companyList) return s.picked.length > 0 && s.picked.length <= MAX_COMPANIES;
    return parseCompanies(s.companies).length > 0 && parseCompanies(s.companies).length <= MAX_COMPANIES;
  };

  function draw() {
    const nCodes = parseCodes(s.codes).length;
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
                <label class="field"
                  ><span>Pick by</span
                  ><select data-f="by">
                    ${templates.length ? html`<option value="template" ${s.by === 'template' ? 'selected' : ''}>A saved template</option>` : ''}
                    <option value="codes" ${s.by === 'codes' ? 'selected' : ''}>Product codes</option>
                    <option value="companies" ${s.by === 'companies' ? 'selected' : ''}>Whole companies</option>
                  </select></label
                >
                ${
                  s.by === 'template'
                    ? html`<label class="field"
                        ><span>Template</span
                        ><select data-f="template">
                          <option value="">Choose one</option>
                          ${templates.map((t) => html`<option value="${t.id}" ${s.template === t.id ? 'selected' : ''}>${t.name} (${t.codes.length})</option>`)}
                        </select></label
                      >`
                    : ''
                }
                ${
                  s.by === 'codes'
                    ? html`<label class="field"
                          ><span>Product codes (spaces, commas or new lines)</span
                          ><textarea data-f="codes" rows="5" autocomplete="off" spellcheck="false">${s.codes}</textarea>
                        </label>
                        <p class="muted small" data-count>
                          ${nCodes} ${nCodes === 1 ? 'code' : 'codes'}${nCodes > MAX_CODES ? ` — too many, ${MAX_CODES} at most` : ''}
                        </p>`
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
    if (s.by === 'codes') {
      const n = parseCodes(s.codes).length;
      c.textContent = `${n} ${n === 1 ? 'code' : 'codes'}${n > MAX_CODES ? ` — too many, ${MAX_CODES} at most` : ''}`;
    } else if (s.by === 'companies') {
      const n = parseCompanies(s.companies).length;
      c.textContent = `${n} ${n === 1 ? 'company' : 'companies'}${n > MAX_COMPANIES ? ` — too many, ${MAX_COMPANIES} at most` : ''}`;
    }
  };
  el.oninput = (e) => {
    const f = e.target.dataset?.f;
    if (f === 'codes' || f === 'companies') {
      s[f] = e.target.value; // typing never redraws, so the cursor stays where it is
      refresh();
    }
  };
  el.onchange = (e) => {
    const f = e.target.dataset?.f;
    if (f === 'by' || f === 'template') {
      s[f] = e.target.value;
      s.error = null;
      draw();
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
    if (b.dataset.act !== 'start') return;
    s.busy = true;
    s.error = null;
    draw();
    try {
      const r = await api.startIndividual({
        key: currentKey(),
        codes: s.by === 'codes' ? parseCodes(s.codes) : [],
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
