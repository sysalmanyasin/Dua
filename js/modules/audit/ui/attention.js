// What needs attention: rounds ready to compile, open conflicts, corrections waiting. Each list is exactly what its hub badge counts.
import { html, render } from '../../../shared/html.js';
import { hero } from '../../../shared/ui.js';
import * as api from '../data/api.js';
import { friendlyError } from '../domain/errors.js';
import { setView } from '../domain/nav.js';
import { attentionBadges } from '../domain/progress.js';
import { crumbs, errorCard, loadingCard } from './parts.js';

const NOTE = {
  ready: 'Every counter has submitted. Open the round to compile it.',
  conflicts: 'The same product was counted differently in another round. Choose which count stands.',
  corrections: 'Someone proposed a corrected count. Approve or reject it.',
};

export async function mount(el) {
  render(el, loadingCard());
  let badges;
  try {
    badges = attentionBadges(await api.attentionSummary());
  } catch (e) {
    return render(el, html`<div class="aud">${errorCard('what needs attention', friendlyError(e).message)}</div>`);
  }
  render(
    el,
    html`<div class="aud">
      ${crumbs([{ label: 'Audits', href: '#/audit/engagements' }, { label: 'Needs attention' }])}
      ${hero({ label: 'Audit', title: 'Needs attention', sub: 'Only what you can act on.' })}
      ${
        badges.length === 0
          ? html`<div class="card aud-card"><p class="muted" data-empty>Nothing is waiting for you.</p></div>`
          : badges.map(
              (b) =>
                html`<section class="card aud-card" aria-label="${b.text}" data-attn-list="${b.key}">
                  <h2>${b.text}</h2>
                  <p class="muted small">${NOTE[b.key]}</p>
                  <ul class="aud-list">
                    ${b.rows.map(
                      (r) =>
                        html`<li>
                          <span
                            ><strong>${r.engagementName} · Round ${r.label}</strong>${
                              b.key === 'ready'
                                ? ''
                                : html` <span class="muted small"
                                    >${r.n}
                                    ${b.key === 'conflicts' ? (r.n === 1 ? 'conflict' : 'conflicts') : r.n === 1 ? 'correction' : 'corrections'}</span
                                  >`
                            }</span
                          >
                          <button type="button" class="btn btn-sm" data-open data-e="${r.engagementId}" data-r="${r.roundId}">Open</button>
                        </li>`,
                    )}
                  </ul>
                </section>`,
            )
      }
    </div>`,
  );
  el.onclick = (e) => {
    const b = e.target.closest('button[data-open]');
    if (!b) return;
    setView({ engagement: b.dataset.e, round: b.dataset.r });
    location.hash = '#/audit/compile';
  };
}
