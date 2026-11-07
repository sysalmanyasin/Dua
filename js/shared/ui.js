// Shared page furniture: the hero banner every page starts with (same look as the original app).
import { html } from './html.js';

export const hero = ({ label, title, sub = '', actions = '' }) =>
  html`<section class="hero">
    <div class="hero-text">
      <div class="hlabel">${label}</div>
      <h1 class="htitle">${title}</h1>
      ${sub ? html`<div class="hsub">${sub}</div>` : ''}
    </div>
    ${actions ? html`<div class="hero-actions">${actions}</div>` : ''}
  </section>`;

export const sectionLabel = (text) => html`<h3 class="sec-label">${text}</h3>`;
