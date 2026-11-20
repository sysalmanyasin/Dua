// A submitted closing, read only: every section as the cashier entered it, plus its PDF. Staff open their own closings here
// (the old app opened a saved closing view-only); people with view-all can open any.
import { html, render } from '../../../shared/html.js';
import { hero } from '../../../shared/ui.js';
import { longDate } from '../../../shared/format.js';
import * as api from '../data/api.js';
import { friendlyError } from '../domain/errors.js';
import { SECTIONS } from '../domain/sections.js';
import { snapshotRows } from '../domain/snapshot.js';
import { buildClosingBookPdf, pdfFileName } from '../domain/sheet.js';
import { slotLabel } from '../domain/slots.js';
import { getView } from '../domain/store.js';
import { saveBlob } from './book.js';
import { errorCard, loadingCard, toast } from './parts.js';

export async function mount(el) {
  const target = getView();
  if (!target?.id) {
    return render(
      el,
      html`<div class="cls">
        <div class="card">
          <p>No closing chosen. <a href="#/closing">Back to Closing</a></p>
        </div>
      </div>`,
    );
  }
  render(el, loadingCard());
  let page;
  try {
    page = (await api.ownBook({ closing: target.id, limit: 1 }))?.[0];
  } catch (e) {
    return render(el, errorCard('this closing', friendlyError(e).message));
  }
  if (!page) return render(el, errorCard('this closing', 'It is not available to you.'));

  const make = () => {
    const name = pdfFileName([page]);
    return { name, blob: buildClosingBookPdf([page], { title: name.replace(/\.pdf$/, '') }).toBlob() };
  };
  render(
    el,
    html`<div class="cls">
      ${hero({
        label: 'Closing',
        title: `${slotLabel(page.kind, page.seq)} closing`,
        sub: `${longDate(page.business_date)} · ${page.is_opening ? 'Opening' : page.mode === 'final' ? 'Final' : 'Shift'} · view only`,
      })}
      <div class="cls-grid">
        <section class="card">
          <p class="cls-meta">
            <span aria-hidden="true">🔒</span> Saved and locked${page.staff ? html` · responsible: ${page.staff}` : ''}.
          </p>
          <div class="actions">
            <button type="button" class="btn btn-primary" data-act="pdf">Download PDF</button>
            <button type="button" class="btn" data-act="open">Open to print</button>
            <a class="btn" href="#/closing">Back to Closing</a>
          </div>
        </section>
        ${SECTIONS.map((sec) => ({ sec, rows: snapshotRows(sec.key, page) }))
          .filter((x) => x.rows.length)
          .map(
            ({ sec, rows }) =>
              html`<section class="card cls-prev">
                <div class="cls-prev-head" role="heading" aria-level="2"><span aria-hidden="true">${sec.icon}</span> ${sec.title}</div>
                ${rows.map(([l, v]) => html`<div class="cls-prev-row"><span>${l}</span><span>${v}</span></div>`)}
              </section>`,
          )}
      </div>
    </div>`,
  );
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    try {
      const { name, blob } = make();
      if (b.dataset.act === 'open') {
        const url = URL.createObjectURL(blob);
        if (!window.open(url, '_blank')) toast('Your browser blocked the new tab. Allow pop-ups, or use Download PDF.', 'error');
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      } else saveBlob(blob, name);
    } catch (err) {
      toast(`The PDF could not be made (${err.message}).`, 'error');
    }
  });
}
