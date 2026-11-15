// A small modal for the few questions Emergency Billing asks: a PIN, a reason, a number. Resolves the typed values, or null on cancel.
import { html, render } from '../../../shared/html.js';

/**
 * @param {HTMLElement} host
 * @param {{ title: string, intro?: string, error?: string, confirm?: string,
 *           fields: { id: string, label: string, type?: string, value?: string, inputmode?: string, maxlength?: number, placeholder?: string, autocomplete?: string }[] }} o
 * @returns {Promise<Record<string,string>|null>}
 */
export function ask(host, { title, intro = '', error = '', confirm = 'OK', fields }) {
  return new Promise((resolve) => {
    render(
      host,
      html`<div class="eb-modal" role="dialog" aria-modal="true" aria-label="${title}">
        <div class="eb-ask">
          <h2>${title}</h2>
          ${intro ? html`<p class="muted">${intro}</p>` : ''} ${error ? html`<p class="note note-error" role="alert">${error}</p>` : ''}
          <div class="eb-ask-fields">
            ${fields.map(
              (f) =>
                html`<label class="field"
                  ><span>${f.label}</span
                  ><input
                    data-f="${f.id}"
                    type="${f.type || 'text'}"
                    value="${f.value ?? ''}"
                    ${f.inputmode ? `inputmode=${f.inputmode}` : ''}
                    ${f.maxlength ? `maxlength=${f.maxlength}` : ''}
                    placeholder="${f.placeholder || ''}"
                    autocomplete="${f.autocomplete || 'off'}"
                /></label>`,
            )}
          </div>
          <div class="eb-ask-actions">
            <button type="button" class="btn" data-act="no">Cancel</button
            ><button type="button" class="btn btn-primary" data-act="yes">${confirm}</button>
          </div>
        </div>
      </div>`,
    );
    const root = host.querySelector('.eb-modal');
    const values = () => Object.fromEntries([...root.querySelectorAll('[data-f]')].map((i) => [i.dataset.f, i.value]));
    const done = (v) => {
      document.removeEventListener('keydown', onKey, true);
      host.replaceChildren();
      resolve(v);
    };
    function onKey(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        done(null);
      } else if (e.key === 'Enter' && root.contains(e.target) && e.target.tagName === 'INPUT') {
        e.preventDefault();
        e.stopPropagation();
        done(values());
      }
    }
    document.addEventListener('keydown', onKey, true);
    root.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'no') done(null);
      if (act === 'yes') done(values());
    });
    root.querySelector('[data-f]')?.focus();
  });
}
