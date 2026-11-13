// Small UI helpers for the Manager pages: toast, dialog, reason prompt, loading and error cards.
// (Local copies on purpose: shared promotion goes through the owner, SESSIONS.md §5 F8. The dialog and toast styles live in css/sales.css.)
import { html, render } from '../../../shared/html.js';

export const newKey = () => crypto.randomUUID();

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

// Asks for a reason and resolves with the text, or null if cancelled. Used for every correction (reversal, changed deduction...).
export function askReason({ title, hint = '', confirm = 'Confirm', min = 3, optional = false }) {
  return new Promise((resolve) => {
    let done = false;
    const dlg = openDialog(
      html`<h2>${title}</h2>
        ${hint ? html`<p class="muted small">${hint}</p>` : ''}
        <label class="field"
          ><span>Reason${optional ? ' (optional)' : ''}</span><input id="reason" maxlength="200" autocomplete="off"
        /></label>
        <small class="err" id="reason-err" hidden>Please give a short reason (at least ${min} characters).</small>
        <div class="actions">
          <button type="button" class="btn btn-ghost" data-close>Cancel</button
          ><button type="button" class="btn btn-primary" data-ok>${confirm}</button>
        </div>`,
      { label: title },
    );
    dlg.addEventListener('click', (e) => {
      if (!e.target.closest('[data-ok]')) return;
      const v = dlg.querySelector('#reason').value.trim();
      if (!optional && v.length < min) {
        dlg.querySelector('#reason-err').hidden = false;
        return;
      }
      done = true;
      resolve(v);
      dlg.close();
    });
    dlg.addEventListener('close', () => {
      if (!done) resolve(null);
    });
  });
}

export const loadingCard = () => html`<div class="card"><p class="muted">Loading…</p></div>`;
export const errorCard = (what = 'this page') =>
  html`<div class="card">
    <h2>Could not load ${what}</h2>
    <p class="muted">Check your connection and try again. If it keeps happening, tell the owner.</p>
  </div>`;
