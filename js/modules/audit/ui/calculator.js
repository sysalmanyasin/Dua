// The counting calculator: a bottom sheet over the count screen. It works out "6 × 10 + 4" and hands the answer to the count box
// the person was in. The running sum is throwaway: it is not saved, and a new sheet always starts empty.
import { html, render } from '../../../shared/html.js';
import { displayText, expressionText, initialCalc, insertable, press, previewText } from '../domain/calc.js';

// [key, label, spoken name, extra class]; the keypad is a 4-column grid
const PAD = [
  ['clear', 'C', 'Clear', 'is-fn'],
  ['÷', '÷', 'Divide', 'is-op'],
  ['×', '×', 'Times', 'is-op'],
  ['back', '⌫', 'Delete last', 'is-fn'],
  ['7', '7'],
  ['8', '8'],
  ['9', '9'],
  ['−', '−', 'Minus', 'is-op'],
  ['4', '4'],
  ['5', '5'],
  ['6', '6'],
  ['+', '+', 'Plus', 'is-op'],
  ['1', '1'],
  ['2', '2'],
  ['3', '3'],
  ['=', '=', 'Equals', 'is-op'],
  ['0', '0', null, 'is-wide'],
  ['.', '.', 'Point', 'is-wide'],
];

/**
 * Opens the calculator. `target` is the name of the count box the answer goes into ('' when none is chosen: the sheet still works
 * but cannot insert). `onInsert(qty)` is called once with a valid count, after the sheet has closed. Returns { close }.
 * `deps` lets tests replace the document.
 */
export function openCalculator({ target = '', onInsert, onClose, deps = {} } = {}) {
  const doc = deps.doc ?? document;
  const opener = doc.activeElement;
  let state = initialCalc();
  let closed = false;

  const host = doc.createElement('div');
  host.className = 'aud-calc';
  host.setAttribute('role', 'dialog');
  host.setAttribute('aria-modal', 'true');
  host.setAttribute('aria-labelledby', 'aud-calc-title');
  doc.body.append(host);

  render(
    host,
    html`<div class="aud-calc-box">
      <div class="aud-calc-head">
        <h2 id="aud-calc-title">Calculator</h2>
        <button type="button" class="btn btn-ghost btn-sm" data-s="close">Close</button>
      </div>
      <p class="aud-calc-target muted small">
        ${target ? html`The answer goes into <strong>${target}</strong>.` : 'Tap a count box first, then open the calculator to put an answer in it.'}
      </p>
      <div class="aud-calc-screen" tabindex="-1" data-screen>
        <div class="aud-calc-expr" data-expr></div>
        <div class="aud-calc-main" data-main></div>
        <div class="aud-calc-total muted small" data-total></div>
      </div>
      <p class="aud-calc-note" role="status" aria-live="polite" data-note></p>
      <div class="aud-calc-pad" role="group" aria-label="Keypad">
        ${PAD.map(([key, label, name, cls]) => html`<button type="button" class="aud-calc-key ${cls ?? ''}" data-k="${key}" aria-label="${name ?? label}">${label}</button>`)}
      </div>
      <button type="button" class="btn btn-primary aud-calc-insert" data-s="insert" ${target ? '' : 'disabled'}>
        Put in the count box
      </button>
    </div>`,
  );
  const q = (sel) => host.querySelector(sel);
  const note = (message) => {
    q('[data-note]').textContent = message;
  };
  const insertButton = () => q('[data-s="insert"]');

  // only the text that changed is rewritten, so focus stays on the key that was pressed
  function show() {
    q('[data-expr]').textContent = expressionText(state);
    q('[data-main]').textContent = displayText(state);
    const total = previewText(state);
    q('[data-total]').textContent = total === null ? '' : `= ${total}`;
    const ready = insertable(state);
    insertButton().textContent = ready.ok && target ? `Put ${ready.text} in the count box` : 'Put in the count box';
  }

  function close() {
    if (closed) return;
    closed = true;
    host.remove();
    opener?.focus?.();
    onClose?.();
  }

  function tap(key) {
    const was = state;
    state = press(state, key);
    show();
    if (state.error && !was.error) note(state.error);
    else if (key === '=' && state.done) note(`Equals ${displayText(state)}.`);
    else note('');
  }

  function insert() {
    if (!target) return note('Tap a count box first, then open the calculator.');
    const r = insertable(state);
    if (!r.ok) return note(r.reason);
    close();
    onInsert?.(r.qty);
  }

  host.onclick = (e) => {
    const key = e.target.closest('button[data-k]');
    if (key) return tap(key.dataset.k);
    const action = e.target.closest('button[data-s]')?.dataset.s;
    if (action === 'close') close();
    else if (action === 'insert') insert();
    else if (e.target === host) close(); // a tap on the dimmed area behind the sheet
  };

  host.onkeydown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      return close();
    }
    if (e.key === 'Tab') {
      const focusable = [...host.querySelectorAll('button:not([disabled])')];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (e.shiftKey && doc.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && doc.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    // a focused button keeps its own Enter and Space; anywhere else Enter is "="
    if (e.key === 'Enter' && e.target.closest?.('button')) return;
    const key = e.key === 'Enter' ? '=' : e.key === 'Backspace' ? 'back' : e.key === 'Delete' ? 'clear' : e.key === ',' ? '.' : e.key;
    if (/^[0-9.+\-*/xX=]$/.test(key) || key === 'back' || key === 'clear') {
      e.preventDefault();
      tap(key);
    }
  };

  show();
  q('[data-screen]').focus();
  return {
    close,
    get state() {
      return state;
    },
  };
}
