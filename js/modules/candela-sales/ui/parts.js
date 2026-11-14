// Small shared pieces for the Candela pages.
import { html } from '../../../shared/html.js';
import { money } from '../../../shared/format.js';

export const m = (v) => money(v, { decimals: Math.round(Number(v) * 100) % 100 !== 0 });
export const loadingCard = () => html`<div class="card" aria-busy="true"><p class="muted">Loading…</p></div>`;
export const errorCard = (retry = true) =>
  html`<div class="card">
    <h2>Could not load</h2>
    <p class="muted">
      ${typeof navigator !== 'undefined' && navigator.onLine === false ? 'You appear to be offline. Candela figures need a connection.' : 'Something went wrong while loading. Your data is safe.'}
    </p>
    ${retry ? html`<button type="button" class="btn" data-act="retry">Try again</button>` : ''}
  </div>`;
export const emptyCard = (text) => html`<div class="card"><p class="muted">${text}</p></div>`;
export const notIncome = html`<p class="muted small">
  Credit sales on the day, as sent by Candela. This is not an outstanding balance and not an invoice list.
</p>`;

// "14 Nov, 3:05 pm" in Pakistan time.
export const stamp = (iso) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Karachi',
    day: '2-digit',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(iso));
