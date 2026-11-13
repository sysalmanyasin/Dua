// Prints a short receipt on a 72 mm thermal printer through the browser's print dialog (CLS-5). Closing keeps its own copy of
// this small helper and its own print styles (css/closing.css), so it never imports from Sales and works even if Sales CSS changes.
import { html, render } from '../../../shared/html.js';

/** One receipt row (see receiptRows in domain/ledgers.js) as markup. */
export const receiptRow = (r) =>
  r.title
    ? html`<div class="cls-rc-title">${r.title}</div>`
    : r.sub
      ? html`<div class="cls-rc-sub">${r.sub}</div>`
      : r.rule
        ? html`<hr />`
        : html`<div class="cls-rc-line"><span>${r.left}</span><span>${r.right}</span></div>`;

export function printThermal(rows) {
  const root = document.createElement('div');
  root.id = 'cls-print-root';
  render(root, html`<div>${rows.map(receiptRow)}</div>`);
  document.body.append(root);
  document.body.classList.add('cls-printing');
  const done = () => {
    document.body.classList.remove('cls-printing');
    root.remove();
    window.removeEventListener('afterprint', done);
  };
  window.addEventListener('afterprint', done);
  window.print();
}
