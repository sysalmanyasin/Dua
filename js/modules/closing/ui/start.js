// Closing start page: a calendar to pick the day, the closings of that day, saved records (continue / open / PDF), and (owner/admin)
// the one-time opening closing.
import { html, render } from '../../../shared/html.js';
import { longDate, shortDate, todayPkt } from '../../../shared/format.js';
import * as api from '../data/api.js';
import { MONTHS, WEEKDAYS, dotsByDate, monthCells, suggestForDate } from '../domain/calendar.js';
import { friendlyError } from '../domain/errors.js';
import { buildClosingBookPdf, pdfFileName } from '../domain/sheet.js';
import { KINDS, slotLabel, suggestNext } from '../domain/slots.js';
import { newKey, setOpen, setView } from '../domain/store.js';
import { saveBlob } from './book.js';
import { errorCard, loadingCard, toast } from './parts.js';

const dot = (kind) => html`<span class="dot dot-${kind}"></span>`;
const goLedger = () => {
  location.hash = '#/closing/ledger';
};

export async function mount(el, { ctx } = {}) {
  const perms = ctx?.permissions ?? [];
  const has = (...keys) => keys.some((k) => perms.includes(k));
  const canOpen = has('closing.settings');
  const canBooks = has('closing.view_all', 'closing.review', 'closing.correct');
  const canReview = has('closing.review', 'closing.correct');
  render(el, loadingCard());
  let recent;
  try {
    recent = await api.myRecent(100);
  } catch (e) {
    return render(el, errorCard('your closings', friendlyError(e).message));
  }
  const drafts = recent.filter((r) => r.status === 'draft');
  const submitted = recent.filter((r) => r.status === 'submitted');
  const today = todayPkt();
  const next = suggestNext(submitted[0]) ?? { date: today, kind: 'night' };
  const startDate = next.date > today ? today : next.date;
  const dots = dotsByDate(recent);
  const draftDates = new Set(drafts.map((d) => d.business_date));
  let sel = startDate;
  let view = { y: Number(startDate.slice(0, 4)), m: Number(startDate.slice(5, 7)) - 1 };
  let showAll = false;

  const kindOptions = (selected) =>
    KINDS.map((k) => html`<option value="${k.kind}" ${k.kind === selected ? 'selected' : ''}>${k.label}</option>`);

  const badges = (r) =>
    html`${r.status === 'draft' ? html`<span class="cls-badge cls-badge-draft">${r.supersedes_id ? 'Correction' : r.is_opening ? 'Opening' : 'Draft'}</span>` : ''}
    ${r.mode === 'final' ? html`<span class="cls-badge cls-badge-final">Final</span>` : ''}
    ${r.status === 'submitted' && r.is_opening ? html`<span class="cls-badge">Opening</span>` : ''}`;

  const recordRow = (r) =>
    html`<li>
      <span>${dot(r.kind)}<strong>${slotLabel(r.kind, r.seq)}</strong> · ${shortDate(r.business_date)} ${badges(r)}</span>
      <span class="cls-actions-inline">
        ${
          r.status === 'draft'
            ? html`<button type="button" class="btn btn-primary btn-sm" data-act="continue" data-key="${r.key}">Continue</button>`
            : html`<button type="button" class="btn btn-sm" data-act="view" data-id="${r.closing_id}">Open</button>
                <button type="button" class="btn btn-sm" data-act="pdf" data-id="${r.closing_id}">PDF</button>`
        }
      </span>
    </li>`;

  const calendar = () =>
    html`<section class="card cls-cal" aria-label="Closing calendar">
      <div class="cls-cal-head">
        <button type="button" class="btn btn-sm" data-act="prev-month" aria-label="Previous month">‹</button>
        <strong>${MONTHS[view.m]} ${view.y}</strong>
        <button type="button" class="btn btn-sm" data-act="next-month" aria-label="Next month">›</button>
      </div>
      <div class="cls-cal-grid">
        ${WEEKDAYS.map((w) => html`<span class="cls-cal-dow">${w}</span>`)}
        ${monthCells(view.y, view.m).map((c) =>
          c
            ? html`<button
                type="button"
                class="cls-cal-day ${c.date === sel ? 'is-sel' : ''} ${c.date === today ? 'is-today' : ''}"
                data-day="${c.date}"
                ${c.date > today ? 'disabled' : ''}
                aria-label="${longDate(c.date)}${(dots[c.date] ?? []).length ? ', closings saved' : ''}"
                aria-pressed="${c.date === sel}"
              >
                <span>${c.day}</span>
                <span class="cls-cal-dots"
                  >${(dots[c.date] ?? []).map(dot)}${draftDates.has(c.date) ? html`<span class="dot dot-draft"></span>` : ''}</span
                >
              </button>`
            : html`<span></span>`,
        )}
      </div>
      <p class="cls-meta cls-legend">
        <span class="dot dot-night"></span>Night <span class="dot dot-morning"></span>Morning <span class="dot dot-handover"></span>Handover
        <span class="dot dot-evening"></span>Evening <span class="dot dot-draft"></span>Draft
      </p>
    </section>`;

  const dayPanel = () => {
    const todays = recent.filter((r) => r.business_date === sel);
    const suggested = suggestForDate(sel, recent);
    return html`<section class="card" id="cls-day">
      <h2>${longDate(sel)}</h2>
      ${
        todays.length
          ? html`<ul class="cls-list">
              ${todays.map(recordRow)}
            </ul>`
          : html`<p class="cls-meta">Nothing saved for this day yet.</p>`
      }
      ${
        suggested
          ? ''
          : html`<p class="cls-meta">
              This day's Evening closing is saved. You can still start another closing for it if the owner asked.
            </p>`
      }
      <div class="cls-pick">
        <div class="field">
          <label for="cls-kind">Slot</label>
          <select id="cls-kind">
            ${kindOptions(suggested ?? 'evening')}
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
      <div class="actions"><button type="button" class="btn btn-primary" id="cls-new">Start closing for this day</button></div>
    </section>`;
  };

  const records = () => {
    const list = [...drafts, ...submitted];
    const shown = showAll ? list : list.slice(0, 6);
    return html`<section class="card">
      <h2>Saved records</h2>
      ${
        shown.length
          ? html`<ul class="cls-list">
              ${shown.map(recordRow)}
            </ul>`
          : html`<p class="cls-meta">No closings yet.</p>`
      }
      ${
        list.length > 6
          ? html`<div class="actions">
              <button type="button" class="btn btn-sm" data-act="more">${showAll ? 'Show fewer' : `Show all ${list.length}`}</button>
            </div>`
          : ''
      }
    </section>`;
  };

  // The old app's chip row: every other closing page is one tap away, nothing else is shown.
  const chip = (href, name) => html`<a class="cls-chip" href="${href}">${name}</a>`;
  const chips = () =>
    html`<nav class="cls-chips" aria-label="Closing pages">
      ${canBooks ? chip('#/closing/credit', 'Credit Ledger') : ''} ${canBooks ? chip('#/closing/misc', 'Misc Ledger') : ''}
      ${canBooks ? chip('#/closing/book', 'Closing Book') : ''} ${canBooks ? chip('#/closing/history/cc', 'CC history') : ''}
      ${canBooks ? chip('#/closing/history/rbd', 'RBD history') : ''} ${canBooks ? chip('#/closing/history/mediq', 'MEDIQ history') : ''}
      ${canReview ? chip('#/closing/review', 'Review') : ''} ${canOpen ? chip('#/closing/settings', 'Settings') : ''}
    </nav>`;

  const draw = () => {
    render(
      el,
      html`<div class="cls">
        ${chips()}
        <div class="cls-grid">
          ${calendar()} ${dayPanel()} ${records()}
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
                      <label for="cls-okind">Slot</label>
                      <select id="cls-okind">
                        ${kindOptions('night')}
                      </select>
                    </div>
                  </div>
                  <div class="actions"><button type="button" class="btn" id="cls-open">Start opening closing</button></div>
                </section>`
              : ''
          }
        </div>
      </div>`,
    );
    wire();
  };

  const val = (id) => el.querySelector(id).value;

  async function pdfFor(id) {
    try {
      const pages = await api.ownBook({ closing: id, limit: 1 });
      if (!pages?.length) return toast('That sheet is not available to you.', 'error');
      const name = pdfFileName(pages);
      saveBlob(buildClosingBookPdf(pages, { title: name.replace(/\.pdf$/, '') }).toBlob(), name);
    } catch (err) {
      toast(friendlyError(err).message, 'error');
    }
  }

  function wire() {
    const on = (selector, handler) => el.querySelectorAll(selector).forEach((b) => b.addEventListener('click', () => handler(b)));
    on('[data-day]', (b) => {
      sel = b.dataset.day;
      draw();
    });
    on('[data-act="prev-month"]', () => {
      view = view.m === 0 ? { y: view.y - 1, m: 11 } : { y: view.y, m: view.m - 1 };
      draw();
    });
    on('[data-act="next-month"]', () => {
      view = view.m === 11 ? { y: view.y + 1, m: 0 } : { y: view.y, m: view.m + 1 };
      draw();
    });
    on('[data-act="more"]', () => {
      showAll = !showAll;
      draw();
    });
    on('[data-act="continue"]', (b) => {
      const d = drafts.find((x) => x.key === b.dataset.key);
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
    });
    on('[data-act="view"]', (b) => {
      setView({ id: b.dataset.id });
      location.hash = '#/closing/view';
    });
    on('[data-act="pdf"]', (b) => pdfFor(b.dataset.id));
    on('#cls-new', () => {
      if (!sel || sel > today) return toast('Pick today or an earlier day.', 'error');
      setOpen({ key: newKey(), date: sel, kind: val('#cls-kind'), mode: val('#cls-mode'), opening: false });
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

  draw();
}
