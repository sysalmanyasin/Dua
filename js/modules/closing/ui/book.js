// Closing Book: one page per submitted closing, read oldest to newest like a book. Print / Save as PDF prints every page in the
// chosen range, one per sheet, through the browser's print dialog (CLS-9).
import { html, render } from '../../../shared/html.js';
import { hero } from '../../../shared/ui.js';
import * as api from '../data/api.js';
import { RANGES, bookSections, chronological, pageIndexForDate, pageTitle, rangeFor } from '../domain/book.js';
import { friendlyError } from '../domain/errors.js';
import { errorCard, loadingCard, toast } from './parts.js';

export const pageView = (p) =>
  html`<article class="cls-bk-page" data-closing="${p.closing_id}">
    <h2>${pageTitle(p)}</h2>
    ${bookSections(p).map(
      (s) =>
        html`<section class="cls-bk-sec" data-sec="${s.id}">
          <h3>${s.title}</h3>
          <dl class="cls-kv">
            ${s.rows.map(
              (r) =>
                html`<div>
                  <dt>${r.label}</dt>
                  <dd>${r.value}</dd>
                </div>`,
            )}
          </dl>
        </section>`,
    )}
  </article>`;

export function printBook(pages) {
  const root = document.createElement('div');
  root.id = 'cls-book-print';
  render(root, html`<div>${pages.map(pageView)}</div>`);
  document.body.append(root);
  document.body.classList.add('cls-printing-book');
  const done = () => {
    document.body.classList.remove('cls-printing-book');
    root.remove();
    window.removeEventListener('afterprint', done);
  };
  window.addEventListener('afterprint', done);
  window.print();
}

export const todayKarachi = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' });

export async function mount(el) {
  let rangeId = 'last10';
  let pages = [];
  let pos = 0;

  const draw = () => {
    const cur = pages[pos];
    render(
      el,
      html`<div class="cls">
        ${hero({ label: 'Closing', title: 'Closing Book', sub: 'Every submitted closing, one page each.' })}
        <div class="cls-grid">
          <section class="card">
            <div class="cls-bk-bar" role="group" aria-label="Range">
              ${RANGES.map((r) => html`<button type="button" class="btn btn-sm" data-range="${r.id}" aria-pressed="${r.id === rangeId}">${r.label}</button>`)}
            </div>
            <div class="cls-bk-bar">
              <div class="field"><label for="bk-date">Go to date</label><input id="bk-date" type="date" /></div>
              <button type="button" class="btn btn-sm" id="bk-go">Go</button>
              <button type="button" class="btn btn-sm" id="bk-print" ${pages.length ? '' : 'disabled'}>Print / Save as PDF</button>
            </div>
            <p class="cls-meta"><a href="#/closing">Back to Closing</a></p>
          </section>
          ${
            cur
              ? html`<section class="card">
                  <div class="cls-bk-bar">
                    <button type="button" class="btn btn-sm" id="bk-older" ${pos > 0 ? '' : 'disabled'}>‹ Older</button>
                    <span class="cls-meta" id="bk-count">Page ${pos + 1} of ${pages.length}</span>
                    <button type="button" class="btn btn-sm" id="bk-newer" ${pos < pages.length - 1 ? '' : 'disabled'}>Newer ›</button>
                  </div>
                  ${pageView(cur)}
                </section>`
              : html`<section class="card"><p class="muted">No submitted closings in this range.</p></section>`
          }
        </div>
      </div>`,
    );
    el.querySelectorAll('[data-range]').forEach((b) =>
      b.addEventListener('click', () => {
        rangeId = b.dataset.range;
        load();
      }),
    );
    el.querySelector('#bk-older')?.addEventListener('click', () => {
      pos = Math.max(0, pos - 1);
      draw();
    });
    el.querySelector('#bk-newer')?.addEventListener('click', () => {
      pos = Math.min(pages.length - 1, pos + 1);
      draw();
    });
    el.querySelector('#bk-go').addEventListener('click', () => {
      const d = el.querySelector('#bk-date').value;
      if (!d) return toast('Pick a date first.', 'error');
      const i = pageIndexForDate(pages, d);
      if (i < 0) return toast('There are no pages to jump to.', 'error');
      pos = i;
      draw();
    });
    el.querySelector('#bk-print').addEventListener('click', () => printBook(pages));
  };

  async function load() {
    render(el, loadingCard());
    try {
      pages = chronological(await api.closingBook(rangeFor(rangeId, todayKarachi())));
    } catch (e) {
      return render(el, errorCard('the Closing Book', friendlyError(e).message));
    }
    pos = Math.max(pages.length - 1, 0);
    draw();
  }
  await load();
}
