// Closing start page: continue a draft, begin a new closing, or (owner/admin) enter the one-time opening closing.
import { html, render } from '../../../shared/html.js';
import { hero } from '../../../shared/ui.js';
import { shortDate, todayPkt } from '../../../shared/format.js';
import * as api from '../data/api.js';
import { friendlyError } from '../domain/errors.js';
import { KINDS, slotLabel, suggestNext } from '../domain/slots.js';
import { newKey, setOpen } from '../domain/store.js';
import { errorCard, loadingCard, toast } from './parts.js';

const dot = (kind) => html`<span class="dot dot-${kind}"></span>`;
const goLedger = () => {
  location.hash = '#/closing/ledger';
};

export async function mount(el, { ctx } = {}) {
  const perms = ctx?.permissions ?? [];
  const canOpen = perms.includes('closing.settings');
  const canLedgers = ['closing.view_all', 'closing.review', 'closing.correct'].some((k) => perms.includes(k));
  render(el, loadingCard());
  let recent;
  try {
    recent = await api.myRecent(30);
  } catch (e) {
    return render(el, errorCard('your closings', friendlyError(e).message));
  }
  const drafts = recent.filter((r) => r.status === 'draft');
  const lastSubmitted = recent.find((r) => r.status === 'submitted');
  const today = todayPkt();
  const next = suggestNext(lastSubmitted) ?? { date: today, kind: 'night' };
  const pickDate = next.date > today ? today : next.date;

  const kindOptions = (selected) =>
    KINDS.map((k) => html`<option value="${k.kind}" ${k.kind === selected ? 'selected' : ''}>${k.label}</option>`);

  render(
    el,
    html`<div class="cls">
      ${hero({ label: 'Closing', title: 'Shift closing', sub: 'Start a new closing or continue a saved draft.' })}
      <div class="cls-grid">
        ${
          drafts.length
            ? html`<section class="card">
                <h2>Continue a draft</h2>
                <ul class="cls-list">
                  ${drafts.map(
                    (d) =>
                      html`<li>
                        <span
                          >${dot(d.kind)}<strong>${slotLabel(d.kind, d.seq)}</strong> · ${shortDate(d.business_date)}
                          <span class="cls-badge cls-badge-draft"
                            >${d.supersedes_id ? 'Correction' : d.is_opening ? 'Opening' : 'Draft'}</span
                          >
                          ${d.mode === 'final' ? html`<span class="cls-badge cls-badge-final">Final</span>` : ''}</span
                        >
                        <button
                          type="button"
                          class="btn btn-primary btn-sm"
                          data-act="continue"
                          data-key="${d.key}"
                          data-i="${drafts.indexOf(d)}"
                        >
                          Continue
                        </button>
                      </li>`,
                  )}
                </ul>
              </section>`
            : ''
        }
        <section class="card">
          <h2>New closing</h2>
          <div class="cls-pick">
            <div class="field">
              <label for="cls-date">Date</label><input id="cls-date" type="date" max="${today}" value="${pickDate}" />
            </div>
            <div class="field">
              <label for="cls-kind">Slot</label
              ><select id="cls-kind">
                ${kindOptions(next.kind)}
              </select>
            </div>
            <div class="field">
              <label for="cls-mode">Type</label>
              <select id="cls-mode">
                <option value="shift">Shift closing</option>
                <option value="final">Final (day end)</option>
              </select>
            </div>
          </div>
          <p class="cls-meta">A slot cannot be skipped. A Final closing may start after a gap.</p>
          <div class="actions"><button type="button" class="btn btn-primary" id="cls-new">Start closing</button></div>
        </section>
        ${
          canLedgers
            ? html`<section class="card">
                <h2>Ledgers</h2>
                <ul class="cls-list">
                  <li><a href="#/closing/credit">Credit Ledger</a><span class="cls-meta">Credit stored with each closing</span></li>
                  <li><a href="#/closing/misc">Misc Ledger</a><span class="cls-meta">Open charges and their age</span></li>
                </ul>
              </section>`
            : ''
        }
        ${
          canOpen
            ? html`<section class="card">
                <h2>Opening closing</h2>
                <p class="cls-meta">
                  One time only, before the first closing: enter the figures the shop starts with (cash, deposits, card and credit). It
                  counts as the first Final.
                </p>
                <div class="cls-pick">
                  <div class="field">
                    <label for="cls-odate">Date</label><input id="cls-odate" type="date" max="${today}" value="${today}" />
                  </div>
                  <div class="field">
                    <label for="cls-okind">Slot</label
                    ><select id="cls-okind">
                      ${kindOptions('night')}
                    </select>
                  </div>
                </div>
                <div class="actions"><button type="button" class="btn" id="cls-open">Start opening closing</button></div>
              </section>`
            : ''
        }
        ${
          recent.some((r) => r.status === 'submitted')
            ? html`<section class="card">
                <h2>Recently submitted</h2>
                <ul class="cls-list">
                  ${recent
                    .filter((r) => r.status === 'submitted')
                    .slice(0, 8)
                    .map(
                      (r) =>
                        html`<li>
                          <span>${dot(r.kind)}<strong>${slotLabel(r.kind, r.seq)}</strong> · ${shortDate(r.business_date)}</span>
                          <span class="cls-meta">${r.mode === 'final' ? 'Final' : 'Shift'}${r.is_opening ? ' · Opening' : ''}</span>
                        </li>`,
                    )}
                </ul>
              </section>`
            : ''
        }
      </div>
    </div>`,
  );

  const val = (id) => el.querySelector(id).value;
  el.querySelectorAll('[data-act="continue"]').forEach((b) =>
    b.addEventListener('click', () => {
      const d = drafts[Number(b.dataset.i)];
      setOpen({
        key: d.key,
        date: d.business_date,
        kind: d.kind,
        mode: d.mode,
        seq: d.seq,
        opening: d.is_opening,
        revision: Boolean(d.supersedes_id),
      });
      goLedger();
    }),
  );
  el.querySelector('#cls-new').addEventListener('click', () => {
    const date = val('#cls-date');
    if (!date || date > today) return toast('Pick today or an earlier day.', 'error');
    setOpen({ key: newKey(), date, kind: val('#cls-kind'), mode: val('#cls-mode'), opening: false });
    goLedger();
  });
  el.querySelector('#cls-open')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    const key = newKey();
    const date = val('#cls-odate');
    const kind = val('#cls-okind');
    try {
      await api.startOpening({ key, date, kind });
    } catch (err) {
      btn.disabled = false;
      return toast(friendlyError(err).message, 'error');
    }
    setOpen({ key, date, kind, mode: 'final', opening: true });
    goLedger();
  });
}
