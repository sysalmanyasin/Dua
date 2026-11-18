// Print / Save as PDF: the page to print is built into its own block, the rest of the app is hidden while the browser prints
// (css/audit.css, "@media print"), and the block is removed afterwards. Nothing is sent anywhere.
import { render } from '../../../shared/html.js';

export function printDocument(safe) {
  const root = document.createElement('div');
  root.id = 'aud-print-root';
  document.body.append(root);
  render(root, safe);
  document.body.classList.add('aud-printing');
  const done = () => {
    document.body.classList.remove('aud-printing');
    root.remove();
    window.removeEventListener('afterprint', done);
  };
  window.addEventListener('afterprint', done);
  window.print();
}

/** Hands text to the person as a file (Blob and a temporary link). A byte-order mark makes Excel read UTF-8 correctly. */
export function downloadText(name, text, type = 'text/csv') {
  const blob = new Blob(['﻿', text], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
