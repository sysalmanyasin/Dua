// Individual Audit: the person picks their own products (typed codes or a template) and counts them alone.
// One rolling engagement per month holds every self-pick; one person has one open self-pick at a time (R8).
import { html, render } from '../../../shared/html.js';
import { hero } from '../../../shared/ui.js';
import * as api from '../data/api.js';
import { MAX_CODES, parseCodes } from '../domain/count.js';
import { friendlyError } from '../domain/errors.js';
import { getView, newKey, setView } from '../domain/nav.js';
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
  const s = { codes: '', template: '', busy: false, error: null, note: null };

  function draw() {
    const typed = parseCodes(s.codes);
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
                ${s.error ? html`<p class="note note-error" role="alert">${s.error}</p>` : ''}
                ${s.note ? html`<p class="note" role="status">${s.note}</p>` : ''}
                ${
                  templates.length
                    ? html`<label class="field"
                        ><span>From a template</span
                        ><select data-f="template">
                          <option value="">None, I will type codes</option>
                          ${templates.map((t) => html`<option value="${t.id}" ${s.template === t.id ? 'selected' : ''}>${t.name} (${t.codes.length})</option>`)}
                        </select></label
                      >`
                    : ''
                }
                ${
                  s.template
                    ? ''
                    : html`<label class="field"
                          ><span>Product codes (spaces, commas or new lines)</span
                          ><textarea data-f="codes" rows="5" autocomplete="off" spellcheck="false">${s.codes}</textarea>
                        </label>
                        <p class="muted small">
                          ${typed.length}
                          ${typed.length === 1 ? 'code' : 'codes'}${typed.length > MAX_CODES ? ` — too many, ${MAX_CODES} at most` : ''}
                        </p>`
                }
                <button
                  type="button"
                  class="btn btn-primary"
                  data-act="start"
                  ${s.busy || (!s.template && (typed.length === 0 || typed.length > MAX_CODES)) ? 'disabled' : ''}
                >
                  ${s.busy ? 'Starting…' : 'Start counting'}
                </button>
              </section>`
        }
      </div>`,
    );
  }

  el.oninput = (e) => {
    if (e.target.dataset?.f === 'codes') {
      s.codes = e.target.value;
      const n = parseCodes(s.codes).length;
      const btn = el.querySelector('button[data-act="start"]');
      if (btn) btn.disabled = s.busy || n === 0 || n > MAX_CODES;
      const hint = el.querySelector('textarea[data-f="codes"] ~ p');
      if (hint) hint.textContent = `${n} ${n === 1 ? 'code' : 'codes'}${n > MAX_CODES ? ` — too many, ${MAX_CODES} at most` : ''}`;
    }
  };
  el.onchange = (e) => {
    if (e.target.dataset?.f === 'template') {
      s.template = e.target.value;
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
        codes: s.template ? [] : parseCodes(s.codes),
        templateId: s.template || null,
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
