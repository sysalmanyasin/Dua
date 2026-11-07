// Add Entry: enter or correct one day of sales. The preview uses the same rule as the database.
import { html, render } from '../../../shared/html.js';
import { hero } from '../../../shared/ui.js';
import { longDate, money, signed, todayPkt } from '../../../shared/format.js';
import * as api from '../data/api.js';
import { HEADER_FIELDS, emptyForm, formFromDay, friendlyError, parseForm, preview } from '../domain/entry.js';
import { diffClass, errorCard, loadingCard, toast } from './parts.js';

const SECTIONS = ['Cash', 'Banks', 'Credit Clients'];
const shiftDate = (iso, days) => new Date(new Date(`${iso}T00:00:00Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);

export async function mount(el, { ctx }) {
  render(el, loadingCard());
  const perms = new Set(ctx.permissions);
  let methods;
  try {
    methods = await api.listMethods();
  } catch {
    return render(el, errorCard('the entry form'));
  }

  const handoff = sessionStorage.getItem('sales.entry.date');
  sessionStorage.removeItem('sales.entry.date');
  const today = todayPkt();
  const state = {
    date: handoff || today,
    form: emptyForm(),
    existing: null,
    showAll: false,
    key: crypto.randomUUID(),
    busy: false,
    errors: {},
  };

  async function loadDay() {
    state.existing = null;
    state.form = emptyForm();
    state.errors = {};
    if (perms.has('sales.view_history')) {
      try {
        const { day, lines } = await api.getDay(state.date);
        if (day) {
          state.existing = day;
          state.form = formFromDay(day, lines);
        }
      } catch {
        toast('Could not check whether this day already exists.', 'error');
      }
    }
    state.key = crypto.randomUUID();
    draw();
  }

  const visible = (m) => state.showAll || m.show_in_entry || state.form.values[m.code];
  const hiddenCount = () => methods.filter((m) => !m.show_in_entry && !state.form.values[m.code]).length;
  const canSave = () => (state.existing ? perms.has('sales.edit') : perms.has('sales.enter'));

  function field(m) {
    const bad = state.errors[m.code];
    return html`<label class="field amount ${bad ? 'bad' : ''}"
      ><span>${m.label}${m.sign === 'sub' ? html` <em>(deducts)</em>` : ''}</span>
      <input inputmode="decimal" autocomplete="off" data-code="${m.code}" value="${state.form.values[m.code] ?? ''}" placeholder="0" />
      ${bad ? html`<small class="err">${bad}</small>` : ''}</label
    >`;
  }

  function draw() {
    const p = preview(state.form, methods);
    const ex = state.existing;
    render(
      el,
      html`${hero({ label: 'Data entry', title: 'Add Daily Record', sub: 'Pick a date and enter the amounts. Total and diff work themselves out.' })}
        <section class="card">
          <div class="date-row">
            <button class="icon-btn" data-act="prev" aria-label="Previous day">‹</button>
            <label class="field grow"><span>Date</span><input type="date" id="date" value="${state.date}" max="${today}" /></label>
            <button class="icon-btn" data-act="next" aria-label="Next day" ${state.date >= today ? 'disabled' : ''}>›</button>
          </div>
          <p class="muted small">
            ${longDate(state.date)} ·
            ${ex ? html`<span class="chip chip-warn">Saved · revision ${ex.revision}${ex.source === 'import' ? ' · imported' : ''}</span>` : html`<span class="chip">New day</span>`}
          </p>
          ${ex && !perms.has('sales.edit') ? html`<p class="note note-error">This day is already saved. You do not have permission to correct it.</p>` : ''}
        </section>
        <section class="card total-card" aria-live="polite">
          <div><span class="label">TOTAL SALE</span><strong id="pv-total">${money(p.total)}</strong></div>
          <div>
            <span class="label">DIFF</span
            ><strong id="pv-diff" class="${diffClass(p.diff)}">${p.hasData || state.form.header.comp_sale ? signed(p.diff) : '–'}</strong>
          </div>
        </section>
        ${SECTIONS.map((sec) => {
          const list = methods.filter((m) => m.section === sec && visible(m));
          return list.length
            ? html`<section class="card">
                <h2>${sec}</h2>
                <div class="fields">${list.map(field)}</div>
              </section>`
            : '';
        })}
        ${hiddenCount() > 0 && !state.showAll ? html`<button class="btn btn-ghost" data-act="showall">Show ${hiddenCount()} more fields</button>` : ''}
        <section class="card">
          <h2>Summary</h2>
          <div class="fields">
            ${HEADER_FIELDS.map(
              (f) =>
                html`<label class="field amount ${state.errors[f.key] ? 'bad' : ''}"
                  ><span>${f.label}</span>
                  <input
                    inputmode="${f.integer ? 'numeric' : 'decimal'}"
                    autocomplete="off"
                    data-hdr="${f.key}"
                    value="${state.form.header[f.key] ?? ''}"
                    placeholder="0"
                  />
                  ${state.errors[f.key] ? html`<small class="err">${state.errors[f.key]}</small>` : ''}</label
                >`,
            )}
            <label class="field span-all"
              ><span>Low Sale Reason</span
              ><input data-hdr="low_sale_reason" maxlength="200" value="${state.form.header.low_sale_reason ?? ''}"
            /></label>
          </div>
        </section>
        ${
          ex
            ? html`<section class="card">
                <label class="field"
                  ><span>Reason for this correction (required)</span>
                  <input id="reason" maxlength="200" value="${state.form.reason}" placeholder="e.g. typed the wrong cash amount"
                /></label>
              </section>`
            : ''
        }
        <div class="actions-bar">
          <button class="btn btn-primary" data-act="save" ${state.busy || !canSave() ? 'disabled' : ''}>
            ${ex ? 'Save correction' : 'Save day'}
          </button>
        </div>`,
    );
  }

  function refreshPreview() {
    const p = preview(state.form, methods);
    el.querySelector('#pv-total').textContent = money(p.total);
    const d = el.querySelector('#pv-diff');
    d.textContent = p.hasData || state.form.header.comp_sale ? signed(p.diff) : '–';
    d.className = diffClass(p.diff);
  }

  el.oninput = (e) => {
    const t = e.target;
    state.key = crypto.randomUUID(); // changed data is a new save, not a retry
    if (t.dataset.code) state.form.values[t.dataset.code] = t.value;
    else if (t.dataset.hdr) state.form.header[t.dataset.hdr] = t.value;
    else if (t.id === 'reason') state.form.reason = t.value;
    else return;
    t.closest('.field')?.classList.remove('bad');
    if (!t.id) refreshPreview();
  };
  el.onchange = (e) => {
    if (e.target.id === 'date' && e.target.value) {
      state.date = e.target.value > today ? today : e.target.value;
      loadDay();
    }
  };
  el.onclick = async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    if (b.dataset.act === 'prev' || b.dataset.act === 'next') {
      state.date = shiftDate(state.date, b.dataset.act === 'prev' ? -1 : 1);
      if (state.date > today) state.date = today;
      return loadDay();
    }
    if (b.dataset.act === 'showall') {
      state.showAll = true;
      return draw();
    }
    if (b.dataset.act === 'save') return save();
  };

  async function save() {
    const parsed = parseForm(state.form, methods);
    state.errors = parsed.errors;
    if (!parsed.ok) {
      draw();
      return toast('Please fix the highlighted numbers.', 'error');
    }
    if (state.existing && state.form.reason.trim().length < 3) {
      toast('Please write the reason for this correction.', 'error');
      return el.querySelector('#reason')?.focus();
    }
    if (!state.existing && parsed.lines.length === 0) return toast('Enter at least one amount.', 'error');
    state.busy = true;
    draw();
    const { data, error } = await api.saveDay(state.date, parsed.header, parsed.lines, state.form.reason, state.key);
    state.busy = false;
    if (error) {
      draw();
      return toast(friendlyError(error.message), 'error');
    }
    toast(`Saved ${longDate(state.date)} · total ${money(data.total)}`);
    await loadDay();
  }

  await loadDay();
}
