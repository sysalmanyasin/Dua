// A searchable list of companies with a tick box, product count and stock value beside each, as in the old Random app.
// Used by the Individual Audit ("Whole companies") and by New audit (selected / one company). Typing in the search box
// only redraws the list, so the cursor stays put.
import { html, render } from '../../../shared/html.js';
import { money } from '../../../shared/format.js';
import { addUpTo, companySummary, visibleCompanies } from '../domain/companies.js';

/**
 * host: an empty element to draw into. companies: [{ company, skus, value }].
 * selected: names already ticked. max: the most that may be ticked. single: tick one at a time (radio behaviour).
 * onChange(names) is called with the ticked names, in list order, after every change.
 */
export function companyPicker(host, { companies, selected = [], max = 500, single = false, onChange = () => {} }) {
  const known = new Set(companies.map((c) => c.company));
  let picked = new Set(selected.filter((n) => known.has(n)));
  let query = '';
  let ascending = true;
  let limitNote = false;

  const emit = () => onChange(companies.filter((c) => picked.has(c.company)).map((c) => c.company));
  const rows = () => visibleCompanies(companies, query, ascending);

  const listHtml = () => {
    const shown = rows();
    if (shown.length === 0) return html`<p class="muted small aud-picker-empty">No companies match.</p>`;
    return html`${shown.map(
      (c) =>
        html`<label class="aud-picker-row"
          ><input
            type="${single ? 'radio' : 'checkbox'}"
            name="aud-company"
            data-company="${c.company}"
            ${picked.has(c.company) ? 'checked' : ''}
          />
          <span class="aud-picker-name"
            ><strong>${c.company}</strong><span class="muted small">${companySummary(c, (n) => money(n))}</span></span
          ></label
        >`,
    )}`;
  };
  const countText = () => {
    const n = picked.size;
    if (single) return n ? '1 company selected' : 'No company selected';
    return `${n} ${n === 1 ? 'company' : 'companies'} selected${limitNote ? ` — ${max} at most` : ''}`;
  };
  const redraw = () => {
    const list = host.querySelector('[data-plist]');
    if (list) render(list, listHtml());
    const count = host.querySelector('[data-pcount]');
    if (count) count.textContent = countText();
    const sort = host.querySelector('[data-pa="sort"]');
    if (sort) sort.textContent = ascending ? '↕ A-Z' : '↕ Z-A';
  };

  render(
    host,
    html`<div class="aud-picker">
      <div class="aud-picker-tools">
        <input type="search" data-pq autocomplete="off" spellcheck="false" placeholder="Search company…" aria-label="Search company" />
        <button type="button" class="btn btn-sm" data-pa="sort">↕ A-Z</button>
      </div>
      <div class="aud-picker-tools">
        ${
          single
            ? html`<button type="button" class="btn btn-sm" data-pa="none">Clear</button>`
            : html`<button type="button" class="btn btn-sm" data-pa="all">Select all (shown)</button
                ><button type="button" class="btn btn-sm" data-pa="none">Clear all</button>`
        }
      </div>
      <div class="aud-picker-list" data-plist role="group" aria-label="Companies"></div>
      <p class="muted small" data-pcount role="status"></p>
    </div>`,
  );
  redraw();

  host.addEventListener('input', (e) => {
    if (!e.target.matches?.('[data-pq]')) return;
    query = e.target.value;
    redraw();
  });
  host.addEventListener('change', (e) => {
    const name = e.target.dataset?.company;
    if (name === undefined) return;
    limitNote = false;
    if (single) picked = new Set(e.target.checked ? [name] : []);
    else if (e.target.checked) {
      const { next, hitLimit } = addUpTo(picked, [name], max);
      if (hitLimit) {
        limitNote = true;
        e.target.checked = false;
      }
      picked = next;
    } else picked.delete(name);
    redraw();
    emit();
  });
  host.addEventListener('click', (e) => {
    const b = e.target.closest?.('button[data-pa]');
    if (!b) return;
    limitNote = false;
    if (b.dataset.pa === 'sort') ascending = !ascending;
    else if (b.dataset.pa === 'none') picked = new Set();
    else if (b.dataset.pa === 'all') {
      const { next, hitLimit } = addUpTo(
        picked,
        rows().map((c) => c.company),
        max,
      );
      picked = next;
      limitNote = hitLimit;
    }
    redraw();
    if (b.dataset.pa !== 'sort') emit();
  });
  emit();
}
