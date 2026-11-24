// Individual audits of one month, grouped by the person who counted them.
import { html, render } from '../../../shared/html.js';
import { hero } from '../../../shared/ui.js';
import { money } from '../../../shared/format.js';
import * as api from '../data/api.js';
import { friendlyError } from '../domain/errors.js';
import { currentMonth, monthChoices, overviewGroups } from '../domain/history.js';
import { setView } from '../domain/nav.js';
import { crumbs, errorCard, loadingCard } from './parts.js';

export async function mount(el) {
  const months = monthChoices();
  const s = { month: currentMonth(), groups: null, error: '' };

  const draw = () => {
    render(
      el,
      html`<div class="aud">
        ${crumbs([{ label: 'Audits', href: '#/audit/engagements' }, { label: 'Individual audits' }])}
        ${hero({ label: 'Audit', title: 'Individual audits', sub: 'Who counted what this month, and how it came out.' })}
        <section class="card aud-card" aria-label="Month">
          <label
            ><span>Month</span>
            <select data-s="month">
              ${months.map((m) => html`<option value="${m.value}" ${m.value === s.month ? 'selected' : ''}>${m.label}</option>`)}
            </select>
          </label>
        </section>
        ${
          s.error
            ? errorCard('this month', s.error)
            : s.groups === null
              ? loadingCard()
              : s.groups.length === 0
                ? html`<div class="card aud-card">
                    <p class="muted" data-empty>Nobody has counted an Individual audit in this month.</p>
                  </div>`
                : s.groups.map(
                    (p) =>
                      html`<section class="card aud-card" aria-label="${p.name}" data-person>
                        <h2>${p.name}</h2>
                        <p class="muted small">
                          ${p.total} ${p.total === 1 ? 'audit' : 'audits'}${p.waiting ? ` · ${p.waiting} not finished` : ''} ·
                          ${p.differences} ${p.differences === 1 ? 'difference' : 'differences'}
                        </p>
                        <ul class="aud-list">
                          ${p.rounds.map(
                            (r) =>
                              html`<li>
                                <span
                                  ><strong>Round ${r.label}</strong>
                                  <span class="muted small">${r.stateLabel}${r.day ? ` · ${r.day}` : ''}</span>
                                  <span class="small"
                                    >${
                                      r.done
                                        ? `${r.items} items · ${r.differences} ${r.differences === 1 ? 'difference' : 'differences'} (${money(r.value, { decimals: true })})`
                                        : 'Not compiled yet'
                                    }</span
                                  ></span
                                >
                                <button
                                  type="button"
                                  class="btn btn-sm"
                                  data-open
                                  data-e="${r.engagementId}"
                                  data-r="${r.roundId}"
                                  data-state="${r.state}"
                                >
                                  Open
                                </button>
                              </li>`,
                          )}
                        </ul>
                      </section>`,
                  )
        }
      </div>`,
    );
  };

  const load = async () => {
    s.groups = null;
    s.error = '';
    draw();
    const asked = s.month;
    try {
      const rows = await api.individualOverview(asked);
      if (asked !== s.month) return;
      s.groups = overviewGroups(rows);
    } catch (e) {
      if (asked !== s.month) return;
      s.error = friendlyError(e).message;
    }
    draw();
  };

  el.onchange = (e) => {
    const sel = e.target.closest('select[data-s="month"]');
    if (!sel) return;
    s.month = sel.value;
    load();
  };
  el.onclick = (e) => {
    const b = e.target.closest('button[data-open]');
    if (!b) return;
    setView({ engagement: b.dataset.e, round: b.dataset.r });
    location.hash = b.dataset.state === 'final' ? '#/audit/final' : '#/audit/compile';
  };
  await load();
}
