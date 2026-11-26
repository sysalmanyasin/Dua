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
 * Opens the calculator as a floating panel at the side of the counting screen. It does not cover the page or take focus, so the
 * count boxes stay usable while it is open. The answer goes to the count box named by `getTarget()` (read each time, so it follows
 * the box the person is in); it returns '' when none is chosen and the panel then works as a plain calculator. `onInsert(qty)` is
 * called with a valid count; the panel stays open and starts a new sum. Returns { close, refreshTarget, toggleMinimized }.
 * `deps` lets tests replace the document.
 */
export function openCalculator({ target = '', getTarget, onInsert, onClose, deps = {} } = {}) {
  const doc = deps.doc ?? document;
  let state = initialCalc();
  let closed = false;
  let minimized = false;
  const targetNow = () => (getTarget ? getTarget() : target) || '';

  const host = doc.createElement('aside');
  host.className = 'aud-calc';
  host.setAttribute('role', 'dialog');
  host.setAttribute('aria-modal', 'false');
  host.setAttribute('aria-labelledby', 'aud-calc-title');
  doc.body.append(host);

  render(
    host,
    html`<div class="aud-calc-box">
      <div class="aud-calc-head">
        <h2 id="aud-calc-title">Calculator</h2>
        <span class="aud-calc-head-actions">
          <button type="button" class="btn btn-ghost btn-sm" data-s="min" aria-expanded="true" aria-label="Minimise calculator">–</button>
          <button type="button" class="btn btn-ghost btn-sm" data-s="close" aria-label="Close calculator">✕</button>
        </span>
      </div>
      <div class="aud-calc-body" data-body>
        <p class="aud-calc-target muted small" data-target></p>
        <div class="aud-calc-screen" data-screen>
          <div class="aud-calc-expr" data-expr></div>
          <div class="aud-calc-main" data-main></div>
          <div class="aud-calc-total muted small" data-total></div>
        </div>
        <p class="aud-calc-note" role="status" aria-live="polite" data-note></p>
        <div class="aud-calc-pad" role="group" aria-label="Keypad">
          ${PAD.map(([key, label, name, cls]) => html`<button type="button" class="aud-calc-key ${cls ?? ''}" data-k="${key}" aria-label="${name ?? label}">${label}</button>`)}
        </div>
        <button type="button" class="btn btn-primary aud-calc-insert" data-s="insert" disabled>Put in the count box</button>
      </div>
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
    const where = targetNow();
    q('[data-target]').replaceChildren();
    if (where) {
      q('[data-target]').append('Answer goes into ');
      const strong = doc.createElement('strong');
      strong.textContent = where;
      q('[data-target]').append(strong);
    } else q('[data-target]').textContent = 'Tap a count box, and the answer goes into it.';
    insertButton().disabled = !where;
    insertButton().textContent = ready.ok && where ? `Put ${ready.text} in the count box` : 'Put in the count box';
  }

  function close() {
    if (closed) return;
    closed = true;
    doc.defaultView?.removeEventListener('hashchange', close);
    host.remove();
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
    if (!targetNow()) return note('Tap a count box first.');
    const r = insertable(state);
    if (!r.ok) return note(r.reason);
    state = initialCalc(); // the panel stays open for the next item, with a fresh sum
    note('');
    onInsert?.(r.qty);
    show();
  }

  function toggleMinimized() {
    minimized = !minimized;
    host.classList.toggle('is-min', minimized);
    const btn = q('[data-s="min"]');
    btn.setAttribute('aria-expanded', String(!minimized));
    btn.setAttribute('aria-label', minimized ? 'Expand calculator' : 'Minimise calculator');
    btn.textContent = minimized ? '+' : '–';
  }

  host.onclick = (e) => {
    const key = e.target.closest('button[data-k]');
    if (key) return tap(key.dataset.k);
    const action = e.target.closest('button[data-s]')?.dataset.s;
    if (action === 'close') close();
    else if (action === 'min') toggleMinimized();
    else if (action === 'insert') insert();
  };
  // a key press must not take the cursor out of the count box (and so must not drop the phone's keyboard)
  host.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button[data-k], button[data-s="insert"]')) e.preventDefault();
  });

  host.onkeydown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      return close();
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

  doc.defaultView?.addEventListener('hashchange', close);
  show();
  return {
    close,
    refreshTarget: () => {
      if (!closed) show();
    },
    toggleMinimized,
    get state() {
      return state;
    },
  };
}
