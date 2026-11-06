// Prints a short receipt on a 72 mm thermal printer through the browser's print dialog.
import { html, render } from '../../../shared/html.js';

export function printThermal(content) {
  const root = document.createElement('div');
  root.id = 'print-root';
  render(root, content);
  document.body.append(root);
  document.body.classList.add('printing-thermal');
  const done = () => {
    document.body.classList.remove('printing-thermal');
    root.remove();
    window.removeEventListener('afterprint', done);
  };
  window.addEventListener('afterprint', done);
  window.print();
}
export const receiptLine = (left, right) => html`<div class="rc-line"><span>${left}</span><span>${right}</span></div>`;
