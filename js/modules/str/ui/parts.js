// Small helpers for the STR pages. STR keeps its own copy so it never imports from another module (MODULES 3.1).
import { html } from '../../../shared/html.js';
import { STAGE_LABEL } from '../domain/filter.js';
import { diffQty, diffText, diffTone } from '../domain/pack.js';

const MARK = { awaited: '○', dispatched: '➜', received: '✓' };
// Status is a word and a mark as well as a colour.
export const stageBadge = (stage) =>
  html`<span class="str-badge str-${stage}"><span aria-hidden="true">${MARK[stage]}</span> ${STAGE_LABEL[stage]}</span>`;

export const loadingCard = () => html`<div class="card"><p class="muted">Loading…</p></div>`;
export const errorCard = (what = 'this page') =>
  html`<div class="card">
    <h2>Could not load ${what}</h2>
    <p class="muted">Check your connection and try again. If it keeps happening, tell the owner.</p>
  </div>`;

export const fmtQty = (v) => (v === null || v === undefined ? '—' : String(v));

const TONE_MARK = { short: '▼', over: '▲', even: '=', none: '' };
const TONE_WORD = { short: 'short', over: 'extra', even: 'even', none: '' };
// Difference in words and a mark as well as colour.
export const diffCell = (l) => {
  const d = diffQty(l);
  const tone = diffTone(d);
  return html`<td class="num str-diff str-diff-${tone}">
    ${d === null ? '' : html`<span aria-hidden="true">${TONE_MARK[tone]}</span> ${diffText(d)} <span class="str-word">${TONE_WORD[tone]}</span>`}
  </td>`;
};

export const printHead = (title, right) =>
  html`<header class="str-print-head">
    <div>
      <h1>${title}</h1>
      <p>
        Printed ${new Date().toLocaleDateString('en-PK', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Karachi' })}
      </p>
    </div>
    <div>${right}</div>
  </header>`;
