// Small cards shared by the Inventory screens.
import { html } from '../../../shared/html.js';

export const loadingCard = (text = 'Loading…') => html`<section class="card"><p class="muted" role="status">${text}</p></section>`;

export const errorCard = (what) =>
  html`<section class="card">
    <h2>Could not load ${what}</h2>
    <p class="muted">Check the connection and try again. If it keeps happening, tell the owner.</p>
    <a class="btn" href="">Try again</a>
  </section>`;

export const emptyCard = (text) => html`<section class="card"><p class="muted">${text}</p></section>`;
