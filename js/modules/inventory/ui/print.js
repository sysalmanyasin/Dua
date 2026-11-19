// Prints a report through the browser's print dialog, where "Save as PDF" is one of the choices. The Inventory module keeps
// its own copy of this small helper and its own print styles (css/inventory.css), like STR, so it never imports from
// another module (MODULES 3.1, 6.5). Works offline: nothing is fetched or sent.
import { html, render } from '../../../shared/html.js';

const nf = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
export const printCell = (v) =>
  typeof v === 'number' ? (Number.isFinite(v) ? nf.format(v) : '') : v === null || v === undefined ? '' : String(v);

// A long list stays readable on paper; the full list is always in the Excel file.
export const PRINT_LIMIT = 1500;

/**
 * @param {{ title: string, subtitle?: string, head: string[], rows: Array<Array<unknown>>, limit?: number }} report
 * @returns {{ printed: number, total: number }}
 */
export function printReport({ title, subtitle = '', head, rows, limit = PRINT_LIMIT }) {
  const shown = rows.slice(0, limit);
  const root = document.createElement('div');
  root.id = 'inv-print-root';
  render(
    root,
    html`<div>
      <h1>${title}</h1>
      ${subtitle ? html`<p class="inv-print-sub">${subtitle}</p>` : ''}
      <table>
        <thead>
          <tr>
            ${head.map((h) => html`<th>${h}</th>`)}
          </tr>
        </thead>
        <tbody>
          ${shown.map(
            (r) =>
              html`<tr>
                ${head.map((_, i) => html`<td class="${typeof r[i] === 'number' ? 'num' : ''}">${printCell(r[i])}</td>`)}
              </tr>`,
          )}
        </tbody>
      </table>
      <p class="inv-print-foot">
        ${rows.length > shown.length ? `Showing the first ${nf.format(shown.length)} of ${nf.format(rows.length)} rows. The Excel file has the full list.` : `${nf.format(rows.length)} row${rows.length === 1 ? '' : 's'}.`}
      </p>
    </div>`,
  );
  // Wide tables need the paper turned sideways; browsers that ignore this simply print upright.
  const page = document.createElement('style');
  page.id = 'inv-print-page';
  page.textContent = '@page { size: A4 landscape; margin: 10mm; }';
  document.head.append(page);
  document.body.append(root);
  document.body.classList.add('inv-printing');
  const done = () => {
    document.body.classList.remove('inv-printing');
    root.remove();
    page.remove();
    window.removeEventListener('afterprint', done);
  };
  window.addEventListener('afterprint', done);
  window.print();
  return { printed: shown.length, total: rows.length };
}
