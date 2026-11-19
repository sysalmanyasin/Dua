// Racks and the monthly rack-to-person assignment (owner only). A rack is never deleted, only switched off, so old entries keep
// their rack name. Giving a rack again in the same month replaces who has it.
import { html, render } from '../../../shared/html.js';
import { hero } from '../../../shared/ui.js';
import * as api from '../data/api.js';
import { friendlyError } from '../domain/errors.js';
import { monthLabel, shiftMonth } from '../domain/expiry.js';
import { errorCard, loadingCard, toast } from './parts.js';

export async function mount(el) {
  const s = { ov: null, people: [], month: '', name: '', busy: false, error: null };

  async function load(month) {
    s.ov = await api.expiryOverview(month || s.month || null);
    s.month = s.ov.month;
  }
  const assignmentFor = (rackId) => s.ov.assignments.find((a) => a.rack_id === rackId);
  const nearby = () => [-1, 0, 1, 2, 3].map((n) => shiftMonth(s.ov.current_month, n));

  function draw() {
    render(
      el,
      html`<div class="aud">
        ${hero({ label: 'Audit', title: 'Racks', sub: 'Who checks which rack each month', actions: html`<a class="btn btn-ghost btn-sm" href="#/audit/expiry">Back</a>` })}
        ${s.error ? html`<p class="note note-error" role="alert">${s.error}</p>` : ''}
        <section class="card aud-card" aria-label="Add a rack">
          <h2>Add a rack</h2>
          <label class="field"
            ><span>Name</span><input type="text" data-field="name" maxlength="60" value="${s.name}" placeholder="Rack A2"
          /></label>
          <button type="button" class="btn btn-primary" data-act="add" ${s.busy ? 'disabled' : ''}>Add rack</button>
        </section>
        <section class="card aud-card" aria-label="Racks for the month">
          <h2>Racks for ${monthLabel(s.month)}</h2>
          <label class="field"
            ><span>Month</span>
            <select data-field="month">
              ${nearby().map((m) => html`<option value="${m}" ${m === s.month ? 'selected' : ''}>${monthLabel(m)}</option>`)}
            </select>
          </label>
          ${
            s.ov.racks.length
              ? html`<ul class="aud-list">
                  ${s.ov.racks.map((r) => {
                    const a = assignmentFor(r.id);
                    return html`<li>
                      <span
                        ><strong>${r.name}</strong>${r.active ? '' : ' (off)'}<br /><span class="muted small"
                          >${a ? `Checked by ${a.staff_name}` : 'Nobody this month'}</span
                        ></span
                      >
                      ${
                        r.active
                          ? html`<select data-rack="${r.id}" aria-label="Give ${r.name} to">
                              <option value="">Give to…</option>
                              ${s.people.map((p) => html`<option value="${p.user_id}" ${a?.user_id === p.user_id ? 'selected' : ''}>${p.full_name}${p.can_log ? '' : ' (no logging key)'}</option>`)}
                            </select>`
                          : ''
                      }
                      ${a ? html`<button type="button" class="btn btn-sm btn-ghost" data-act="unassign" data-id="${a.id}">Take back</button>` : ''}
                      <button type="button" class="btn btn-sm btn-ghost" data-act="toggle" data-id="${r.id}">
                        ${r.active ? 'Switch off' : 'Switch on'}
                      </button>
                    </li>`;
                  })}
                </ul>`
              : html`<p class="muted">No racks yet.</p>`
          }
        </section>
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
    if (e.target.dataset?.field === 'name') s.name = e.target.value;
  };
  el.onchange = (e) => {
    const t = e.target;
    if (t.dataset?.field === 'month') return run(async () => load(t.value));
    if (t.dataset?.rack && t.value)
      return run(() => api.assignRack({ rackId: t.dataset.rack, userId: t.value, month: s.month }), 'Rack given.');
  };
  el.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    const id = b.dataset.id;
    if (b.dataset.act === 'add') {
      return run(async () => {
        await api.saveRack({ name: s.name });
        s.name = '';
      }, 'Rack added.');
    }
    if (b.dataset.act === 'unassign') return run(() => api.unassignRack(id), 'Rack taken back.');
    if (b.dataset.act === 'toggle') {
      const r = s.ov.racks.find((x) => x.id === id);
      return run(() => api.saveRack({ id, name: r.name, active: !r.active }), r.active ? 'Rack switched off.' : 'Rack switched on.');
    }
  };

  render(el, loadingCard());
  try {
    [s.people] = await Promise.all([api.expiryPeople(), load()]);
  } catch (e) {
    return render(el, errorCard('the racks', friendlyError(e).message));
  }
  draw();
}
