// A small accessible dialog used by Workspace screens. It is appended to <body>, traps Tab inside itself, closes on Escape,
// on a click outside, and when the address changes, and hands focus back to whatever had it before.
let counter = 0;

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function openPanel({ title, onClose = () => {}, wide = false } = {}) {
  const previous = document.activeElement;
  const id = `ws-panel-${(counter += 1)}`;
  const backdrop = document.createElement('div');
  backdrop.className = 'ws-backdrop';
  const panel = document.createElement('section');
  panel.className = wide ? 'ws-panel ws-wide' : 'ws-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-labelledby', `${id}-title`);
  const head = document.createElement('header');
  head.className = 'ws-panel-head';
  const h = document.createElement('h2');
  h.id = `${id}-title`;
  h.textContent = title ?? '';
  const x = document.createElement('button');
  x.type = 'button';
  x.className = 'btn btn-ghost btn-sm';
  x.textContent = 'Close';
  head.append(h, x);
  const body = document.createElement('div');
  body.className = 'ws-panel-body';
  panel.append(head, body);
  backdrop.append(panel);
  document.body.append(backdrop);

  let open = true;
  const close = () => {
    if (!open) return;
    open = false;
    removeEventListener('keydown', onKey, true);
    removeEventListener('hashchange', close);
    backdrop.remove();
    if (previous && previous.isConnected && typeof previous.focus === 'function') previous.focus();
    onClose();
  };
  function onKey(e) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
      return;
    }
    if (e.key !== 'Tab') return;
    const items = [...panel.querySelectorAll(FOCUSABLE)].filter((el) => !el.hidden && el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
  addEventListener('keydown', onKey, true);
  addEventListener('hashchange', close);
  backdrop.addEventListener('mousedown', (e) => {
    if (e.target === backdrop) close();
  });
  x.addEventListener('click', close);

  return {
    body,
    panel,
    close,
    setTitle: (t) => (h.textContent = t),
    isOpen: () => open,
    focusFirst: () => (panel.querySelector(`.ws-panel-body ${FOCUSABLE.split(', ').join(', .ws-panel-body ')}`) ?? x).focus(),
  };
}

// Asks the person to confirm something. Resolves true or false.
export function confirmAction({ title, message, confirmLabel = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    let answer = false;
    const p = openPanel({ title, onClose: () => resolve(answer) });
    const msg = document.createElement('p');
    msg.textContent = message;
    const row = document.createElement('div');
    row.className = 'actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn';
    cancel.textContent = 'Cancel';
    const ok = document.createElement('button');
    ok.type = 'button';
    ok.className = danger ? 'btn btn-primary ws-danger' : 'btn btn-primary';
    ok.textContent = confirmLabel;
    cancel.addEventListener('click', () => p.close());
    ok.addEventListener('click', () => {
      answer = true;
      p.close();
    });
    row.append(cancel, ok);
    p.body.append(msg, row);
    cancel.focus();
  });
}

// Asks for one line of text. Resolves the trimmed text, or null if cancelled.
export function askText({ title, label, value = '', confirmLabel = 'Save', maxLength = 200 }) {
  return new Promise((resolve) => {
    let answer = null;
    const p = openPanel({ title, onClose: () => resolve(answer) });
    const field = document.createElement('label');
    field.className = 'field';
    const span = document.createElement('span');
    span.textContent = label;
    const input = document.createElement('input');
    input.type = 'text';
    input.value = value;
    input.maxLength = maxLength;
    field.append(span, input);
    const row = document.createElement('div');
    row.className = 'actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn';
    cancel.textContent = 'Cancel';
    const ok = document.createElement('button');
    ok.type = 'button';
    ok.className = 'btn btn-primary';
    ok.textContent = confirmLabel;
    const submit = () => {
      const v = input.value.trim();
      if (!v) return;
      answer = v;
      p.close();
    };
    cancel.addEventListener('click', () => p.close());
    ok.addEventListener('click', submit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
    });
    row.append(cancel, ok);
    p.body.append(field, row);
    input.focus();
    input.select();
  });
}
