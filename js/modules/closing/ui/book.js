// Closing Book: the saved closing sheets as a PDF made inside the app. Pick a range (3, 7 or 15 days, or your own dates) and, if you like,
// the first and last shift, then download one PDF with every sheet in it, or one closing's own PDF. Page 1 of each closing is the shift sheet
// and page 2 the Final page, as on the old printed register.
import { html, render } from '../../../shared/html.js';
import { hero } from '../../../shared/ui.js';
import { money } from '../../../shared/format.js';
import * as api from '../data/api.js';
import { PRESETS, SHIFTS, inRange, pageTitle, rangeFor, variance } from '../domain/book.js';
import { friendlyError } from '../domain/errors.js';
import { buildClosingBookPdf, pdfFileName } from '../domain/sheet.js';
import { errorCard, loadingCard, toast } from './parts.js';

export const todayKarachi = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' });

/** Hands a file to the browser's download. */
export function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 15000);
}

const M = (v) => money(v, { decimals: true });
const MAX = 200;

export async function mount(el) {
  const today = todayKarachi();
  let preset = 'days3';
  let { from, to } = rangeFor(preset, today);
  let fromShift = 'any';
  let toShift = 'any';
  let all = []; // newest first, as the database returns them
  let busy = false;

  const shown = () => all.filter((p) => inRange(p, { from, fromShift, to, toShift }));

  const draw = () => {
    const list = shown();
    render(
      el,
      html`<div class="cls">
        ${hero({ label: 'Closing', title: 'Closing Book', sub: 'The saved closing sheets, as a PDF.' })}
        <div class="cls-grid">
          <section class="card">
            <div class="cls-bk-bar" role="group" aria-label="Quick ranges">
              ${PRESETS.map((r) => html`<button type="button" class="btn btn-sm" data-preset="${r.id}" aria-pressed="${r.id === preset}">${r.label}</button>`)}
            </div>
            <div class="cls-bk-bar">
              <div class="field"><label for="bk-from">From</label><input id="bk-from" type="date" value="${from}" /></div>
              <div class="field">
                <label for="bk-from-shift">First shift</label>
                <select id="bk-from-shift">
                  ${SHIFTS.map((s) => html`<option value="${s.v}" ${s.v === fromShift ? 'selected' : ''}>${s.label}</option>`)}
                </select>
              </div>
            </div>
            <div class="cls-bk-bar">
              <div class="field"><label for="bk-to">To</label><input id="bk-to" type="date" value="${to}" /></div>
              <div class="field">
                <label for="bk-to-shift">Last shift</label>
                <select id="bk-to-shift">
                  ${SHIFTS.map((s) => html`<option value="${s.v}" ${s.v === toShift ? 'selected' : ''}>${s.label}</option>`)}
                </select>
              </div>
              <button type="button" class="btn btn-sm" id="bk-apply">Show</button>
            </div>
            <p class="cls-meta" id="bk-count">
              ${list.length} ${list.length === 1 ? 'closing' : 'closings'} · ${list.length * 2} PDF pages
              ${all.length >= MAX ? html`· only the latest ${MAX} are loaded, narrow the dates` : ''}
            </p>
            <div class="actions">
              <button type="button" class="btn btn-primary" id="bk-pdf" ${list.length && !busy ? '' : 'disabled'}>
                ${busy ? 'Preparing the PDF…' : 'Download PDF'}
              </button>
            </div>
            <p class="cls-meta"><a href="#/closing">Back to Closing</a></p>
          </section>
          ${
            list.length
              ? html`<section class="card" id="bk-list">
                  <ul class="cls-list">
                    ${list.map(
                      (p) =>
                        html`<li data-closing="${p.closing_id}">
                          <span>
                            <strong>${pageTitle(p)}</strong><br />
                            <span class="cls-meta"
                              >Net sale ${M(p.results?.net_sale)} · Net cash ${M(p.results?.net_cash)} ·
                              ${variance(p.results?.shift_variance)}</span
                            >
                          </span>
                          <button type="button" class="btn btn-sm" data-one="${p.closing_id}">PDF</button>
                        </li>`,
                    )}
                  </ul>
                </section>`
              : html`<section class="card"><p class="muted">No saved closings in this range.</p></section>`
          }
        </div>
      </div>`,
    );
    el.querySelectorAll('[data-preset]').forEach((b) =>
      b.addEventListener('click', () => {
        preset = b.dataset.preset;
        ({ from, to } = rangeFor(preset, today));
        fromShift = 'any';
        toShift = 'any';
        load();
      }),
    );
    el.querySelector('#bk-apply').addEventListener('click', () => {
      const f = el.querySelector('#bk-from').value;
      const t = el.querySelector('#bk-to').value;
      if (!f || !t) return toast('Pick both dates.', 'error');
      if (f > t) return toast('The start date is after the end date.', 'error');
      preset = 'custom';
      from = f;
      to = t;
      fromShift = el.querySelector('#bk-from-shift').value;
      toShift = el.querySelector('#bk-to-shift').value;
      load();
    });
    el.querySelector('#bk-pdf').addEventListener('click', () => download(shown()));
    el.querySelectorAll('[data-one]').forEach((b) =>
      b.addEventListener('click', () => download(all.filter((p) => p.closing_id === b.dataset.one))),
    );
  };

  function download(pages) {
    if (!pages.length || busy) return;
    busy = true;
    draw();
    // let the "Preparing" state paint before the (synchronous) PDF build
    setTimeout(() => {
      try {
        const name = pdfFileName(pages);
        saveBlob(buildClosingBookPdf(pages, { title: name.replace(/\.pdf$/, '') }).toBlob(), name);
        toast(`${name} is ready.`);
      } catch (e) {
        toast(`The PDF could not be made (${e.message}).`, 'error');
      }
      busy = false;
      draw();
    }, 30);
  }

  async function load() {
    render(el, loadingCard());
    try {
      all = await api.closingBook({ from, to, limit: MAX });
    } catch (e) {
      return render(el, errorCard('the Closing Book', friendlyError(e).message));
    }
    draw();
  }
  await load();
}
