// Prints through the browser's print dialog (Save as PDF works there too). STR keeps its own copy of this small helper
// and its own print styles (css/str.css), so it never imports from Sales (MODULES 3.1, 6.5).
import { html, render } from '../../../shared/html.js';

export function printPage(content) {
  const root = document.createElement('div');
  root.id = 'str-print-root';
  render(root, html`<div>${content}</div>`);
  document.body.append(root);
  document.body.classList.add('str-printing');
  const done = () => {
    document.body.classList.remove('str-printing');
    root.remove();
    window.removeEventListener('afterprint', done);
  };
  window.addEventListener('afterprint', done);
  window.print();
}
