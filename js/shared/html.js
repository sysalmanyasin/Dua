// Safe HTML templating. Everything interpolated is escaped unless wrapped with raw().
// This is the ONLY file allowed to touch the DOM parser (see eslint.config.js).
class SafeHtml {
  constructor(value) {
    this.value = value;
  }
  toString() {
    return this.value;
  }
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };
export const escapeHtml = (v) => String(v ?? '').replace(/[&<>"'`]/g, (c) => ESCAPES[c]);

export const raw = (s) => new SafeHtml(String(s));

function part(v) {
  if (v instanceof SafeHtml) return v.value;
  if (Array.isArray(v)) return v.map(part).join('');
  return escapeHtml(v);
}

export function html(strings, ...values) {
  let out = strings[0];
  values.forEach((v, i) => {
    out += part(v) + strings[i + 1];
  });
  return new SafeHtml(out);
}

export function render(el, safe) {
  if (!(safe instanceof SafeHtml)) throw new TypeError('render() needs html`...` output');
  el.replaceChildren(document.createRange().createContextualFragment(safe.value));
}
