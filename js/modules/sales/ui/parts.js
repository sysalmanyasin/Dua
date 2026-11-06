// Small UI helpers shared by the Sales pages: toast, dialog, loading and error cards.
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
  t.textContent = message;
  box.append(t);
  setTimeout(() => t.remove(), kind === 'error' ? 6000 : 3500);
}

export function openDialog(content, { label = 'Details' } = {}) {
  const dlg = document.createElement('dialog');
  dlg.className = 'dlg';
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

export const loadingCard = () => html`<div class="card"><p class="muted">Loading…</p></div>`;
export const errorCard = (what = 'this page') =>
  html`<div class="card">
    <h2>Could not load ${what}</h2>
    <p class="muted">Check your connection and try again. If it keeps happening, tell the owner.</p>
  </div>`;

export const diffClass = (v) => (Number(v) > 0 ? 'pos' : Number(v) < 0 ? 'neg' : '');
