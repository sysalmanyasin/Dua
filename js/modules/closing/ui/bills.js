// Bill Number Sheet: opens already filled in (the start follows the last submitted closing), shows the A4 page, and prints it.
// Open to everyone with closing access. Nothing is saved to the database; the names and count are remembered on this device only.
import { html, render } from '../../../shared/html.js';
import { hero } from '../../../shared/ui.js';
import { longDate, todayPkt } from '../../../shared/format.js';
import * as api from '../data/api.js';
import { friendlyError } from '../domain/errors.js';
import {
  DEFAULT_BOXES,
  DEFAULT_COUNT,
  DEFAULT_TITLE,
  cleanBoxes,
  numberColumns,
  padBill,
  parseCount,
  parseStart,
  rangeLabel,
  startAfter,
} from '../domain/billsheet.js';
import { slotLabel } from '../domain/slots.js';
import { errorCard, loadingCard, toast } from './parts.js';

const KEY = 'dua.closing.billsheet.v1';
const load = () => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') ?? {};
  } catch {
    return {};
  }
};
const save = (v) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(v));
  } catch {
    /* private window or full storage: the sheet still works, it just forgets the names */
  }
};

/** The latest submitted closing in a list of closing_book pages (a corrected revision beats the original). */
export function latestPage(pages) {
  const key = (p) => `${p.business_date}|${String(p.seq).padStart(5, '0')}|${String(p.revision ?? 0).padStart(4, '0')}`;
  return [...(pages ?? [])].sort((a, b) => key(b).localeCompare(key(a)))[0] ?? null;
}

/** One A4 sheet as markup. Used for the preview on screen and, copied, for the print. */
export function sheetMarkup(m) {
  const cols = numberColumns(m.start, m.count);
  return html`<div class="cls-a4">
    <header class="cls-a4-head">
      <div class="cls-a4-shop">${m.shop}</div>
      <div class="cls-a4-branch">${m.branch}</div>
      <div class="cls-a4-title">${m.title} · Number Sheet</div>
      <div class="cls-a4-meta">
        <span>Date: ${m.dateLabel}</span><span>Bills ${rangeLabel(m.start, m.count)} (${parseCount(m.count)})</span>
        <span>Responsible: ______________</span>
      </div>
    </header>
    <div class="cls-a4-nums">
      ${cols.map((c) => html`<div class="cls-a4-col">${c.map((n) => html`<div class="cls-a4-num"><span>${n}</span></div>`)}</div>`)}
    </div>
    <div class="cls-a4-boxes">
      ${m.boxes.map(
        (name) =>
          html`<section class="cls-a4-box">
            <h3>${name}</h3>
            <div class="cls-a4-bh"><span>Bill No.</span><span>Amount</span></div>
            ${[1, 2, 3, 4, 5].map(() => html`<div class="cls-a4-line"><span></span><span></span></div>`)}
            <div class="cls-a4-tot"><span>Total</span><span></span></div>
          </section>`,
      )}
    </div>
  </div>`;
}

export async function mount(el) {
  render(el, loadingCard());
  let last = null;
  try {
    last = latestPage(await api.ownBook({ limit: 3 }));
  } catch (e) {
    return render(el, errorCard('the last closing', friendlyError(e).message));
  }
  const saved = load();
  const auto = startAfter(last?.inputs?.last_bill_no);
  const st = {
    start: auto,
    count: parseCount(saved.count ?? DEFAULT_COUNT),
    title: saved.title || DEFAULT_TITLE,
    boxes: cleanBoxes(saved.boxes ?? DEFAULT_BOXES),
    startText: auto === null ? '' : String(auto),
  };
  const shop = last?.shop?.title || "Fazal Din's Pharma Plus";
  const branch = last?.shop?.branch || 'Bahria Town Branch';
  const model = () => ({
    shop,
    branch,
    title: st.title.trim() || DEFAULT_TITLE,
    dateLabel: longDate(todayPkt()),
    start: st.start ?? 0,
    count: st.count,
    boxes: st.boxes,
  });

  const print = () => {
    if (st.start === null) return toast('Type the start number first.', 'error');
    save({ count: st.count, title: st.title, boxes: st.boxes });
    const root = document.createElement('div');
    root.id = 'cls-a4-root';
    render(root, sheetMarkup(model()));
    document.body.append(root);
    document.body.classList.add('cls-printing-a4');
    const done = () => {
      document.body.classList.remove('cls-printing-a4');
      root.remove();
      window.removeEventListener('afterprint', done);
    };
    window.addEventListener('afterprint', done);
    window.print();
  };

  const paint = () => {
    const slots = [...Array(6).keys()];
    render(
      el,
      html`<div class="cls">
        ${hero({
          label: 'Closing',
          title: 'Bill Number Sheet',
          sub: last
            ? `Starts after the last closing (${slotLabel(last.kind, last.seq)}, ${longDate(last.business_date)}): last bill ${padBill(Number(last.inputs?.last_bill_no) || 0)}`
            : 'No closing with a last bill number yet: type the start number.',
          actions: html`<a class="btn btn-sm" href="#/closing">‹ Closing</a>`,
        })}
        <section class="card cls-a4-controls" aria-label="Sheet settings">
          <div class="cls-bk-bar">
            <label class="field"
              ><span>Start number (last 5 digits)</span>
              <input data-f="start" inputmode="numeric" maxlength="6" value="${st.startText}" aria-describedby="cls-a4-note"
            /></label>
            <label class="field"
              ><span>Bills</span> <input data-f="count" inputmode="numeric" maxlength="3" value="${String(st.count)}"
            /></label>
            <label class="field"><span>Sheet name</span><input data-f="title" maxlength="30" value="${st.title}" /></label>
          </div>
          <p class="cls-meta" id="cls-a4-note">
            The start number is filled in from the last closing. Change it only if the bill book was reset or a closing is missing.
          </p>
          <div class="cls-bk-bar">
            ${slots.map(
              (i) =>
                html`<label class="field"
                  ><span>Credit box ${i + 1}</span> <input data-box="${i}" maxlength="28" value="${st.boxes[i] ?? ''}"
                /></label>`,
            )}
          </div>
          <div class="actions"><button type="button" class="btn btn-primary" data-act="print">Print A4</button></div>
        </section>
        ${st.start === null ? html`<div class="card"><p class="muted">Type the start number to see the sheet.</p></div>` : html`<div class="cls-a4-wrap">${sheetMarkup(model())}</div>`}
      </div>`,
    );
  };

  // typing redraws only the sheet preview, so the cursor never leaves the box being typed in
  const preview = () => {
    const wrap = el.querySelector('.cls-a4-wrap');
    if (wrap && st.start !== null) render(wrap, sheetMarkup(model()));
    else paint();
  };
  el.addEventListener('input', (e) => {
    const f = e.target.dataset?.f;
    if (f === 'start') {
      st.startText = e.target.value;
      const had = st.start === null;
      st.start = parseStart(e.target.value);
      if (had !== (st.start === null)) return paintKeepFocus(e.target);
    } else if (f === 'count') st.count = parseCount(e.target.value);
    else if (f === 'title') st.title = e.target.value;
    else if (e.target.dataset?.box !== undefined) {
      const boxes = [...el.querySelectorAll('[data-box]')].map((n) => n.value);
      st.boxes = cleanBoxes(boxes);
    } else return;
    preview();
  });
  const paintKeepFocus = (node) => {
    const sel = node.dataset.f ? `[data-f="${node.dataset.f}"]` : '';
    const pos = node.selectionStart;
    paint();
    const again = sel && el.querySelector(sel);
    if (again) {
      again.focus({ preventScroll: true });
      try {
        again.setSelectionRange(pos, pos);
      } catch {
        /* not a text box */
      }
    }
  };
  el.addEventListener('click', (e) => {
    if (e.target.closest('[data-act="print"]')) print();
  });
  paint();
}
