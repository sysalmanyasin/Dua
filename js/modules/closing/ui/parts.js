// Small UI helpers for the Closing pages: toast, dialog, loading and error cards. Closing keeps its own copy so it
// never imports from another module (MODULES section 3.1).
import { html, render } from '../../../shared/html.js';

export function toast(message, kind = 'ok') {
  let box = document.getElementById('toasts');
  if (!box) {
    box = document.createElement('div');
    box.id = 'toasts';
    box.setAttribute('role', 'status');
    box.setAttribute('aria-live', 'polite');
    document.body.append(box);
  }
  const t = document.createElement('div');
  t.className = `toast toast-${kind}`;
  // an error is announced at once (assertive); an ordinary confirmation waits its turn (the box itself is polite)
  if (kind === 'error') t.setAttribute('role', 'alert');
  t.textContent = message;
  box.append(t);
  setTimeout(() => t.remove(), kind === 'error' ? 6000 : 3500);
}

export function openDialog(content, { label = 'Details' } = {}) {
  const dlg = document.createElement('dialog');
  dlg.className = 'dlg cls'; // dialogs are appended to <body>, outside the page's .cls wrapper: without this none of the Closing colours reach them
  dlg.setAttribute('aria-label', label);
  render(dlg, html`<div class="dlg-body">${content}</div>`);
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg || e.target.closest('[data-close]')) dlg.close();
  });
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
  return dlg;
}

export const loadingCard = () => html`<div class="card" role="status" aria-busy="true"><p class="muted">Loading…</p></div>`;
export const errorCard = (what = 'this page', message = '') =>
  html`<div class="card" role="alert">
    <h2>Could not load ${what}</h2>
    <p class="muted">${message || 'Check your connection and try again. If it keeps happening, tell the owner.'}</p>
  </div>`;

// A page that is drawn again (a new month, a filter, a struck-out row) replaces its elements, and the keyboard focus would
// fall back to the top of the page. This remembers which control had focus and puts it back on the same control.
const focusSelector = (n) => {
  if (!n || n === document.body || !n.getAttribute) return '';
  const q = (v) => (globalThis.CSS?.escape ? CSS.escape(v) : v);
  if (n.id) return `#${q(n.id)}`;
  const parts = ['f', 'list', 'id', 'k', 'act', 'day', 'preset', 'jump', 'go', 'one', 'strip', 'acct', 'item', 'num', 'key', 'acc']
    .filter((k) => n.dataset?.[k] !== undefined)
    .map((k) => `[data-${k}="${String(n.dataset[k]).replaceAll('"', '\\"')}"]`);
  return parts.length ? `${n.tagName.toLowerCase()}${parts.join('')}` : '';
};
export function keepFocus(root, redraw) {
  const active = root.contains(document.activeElement) ? document.activeElement : null;
  const selector = focusSelector(active);
  const result = redraw();
  if (selector) {
    const again = root.querySelector(selector);
    if (again && typeof again.focus === 'function' && !again.disabled) again.focus({ preventScroll: true });
  }
  return result;
}

/** Moves focus to a heading or summary line (made focusable for the moment) so a screen reader announces the new content. */
export function focusHeading(node) {
  if (!node) return;
  if (!node.hasAttribute('tabindex')) node.setAttribute('tabindex', '-1');
  node.focus({ preventScroll: true });
}
