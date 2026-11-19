// Reports of one audit: every round with its totals, who counted what, and the audit trail. Print / Save as PDF for the report.
import { html, render } from '../../../shared/html.js';
import { hero } from '../../../shared/ui.js';
import * as api from '../data/api.js';
import { rupees, toPaisa } from '../domain/count.js';
import { friendlyError } from '../domain/errors.js';
import { getView, setView } from '../domain/nav.js';
import { actionText } from '../domain/report.js';
import { errorCard, loadingCard } from './parts.js';
import { printDocument } from './print.js';

const STATE = { draft: 'Being set up', locked: 'Locked', counting: 'Counting', compiled: 'Compiled', final: 'Final' };
const ASG = { assigned: 'Not started', counting: 'Counting', submitted: 'Submitted' };
const TRAIL_PAGE = 50;
const money = (v) => (v === null || v === undefined ? '–' : rupees(toPaisa(v)));
const when = (iso) => (iso ? new Date(iso).toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short' }) : '');

const roundsTable = (rounds, links = false) =>
  html`<div class="aud-scroll">
    <table class="aud-table">
      <thead>
        <tr>
          <th>Round</th>
          <th>State</th>
          <th class="num">Items</th>
          <th class="num">People</th>
          <th class="num">Differ</th>
          <th class="num">Net</th>
          ${links ? html`<th></th>` : ''}
        </tr>
      </thead>
      <tbody>
        ${rounds.map((r) => {
          const fin = r.state === 'final';
          return html`<tr>
            <td><strong>${r.label}</strong></td>
            <td>${STATE[r.state] ?? r.state}${r.forced ? ` · ${r.forced} forced` : ''}</td>
            <td class="num">${r.items}</td>
            <td class="num">${r.people}</td>
            <td class="num">${(fin ? r.final_variance_count : r.variance_count) ?? '–'}</td>
            <td class="num">${money(fin ? r.final_variance_value : r.variance_value)}</td>
            ${
              links
                ? html`<td>
                    ${
                      r.state === 'compiled' || fin
                        ? html`<button type="button" class="btn btn-sm btn-ghost" data-act="open" data-id="${r.id}">
                            ${fin ? 'Final' : 'Review'}
                          </button>`
                        : ''
                    }
                  </td>`
                : ''
            }
          </tr>`;
        })}
      </tbody>
    </table>
  </div>`;

export async function mount(el, { ctx } = {}) {
  const perms = ctx?.permissions ?? [];
  const can = (k) => perms.includes(k) || perms.includes('audit.manage');
  const canTrail = can('audit.report') || can('audit.review');
  const view = getView();
  const s = { list: [], id: view?.engagement ?? null, rep: null, trail: [], more: false, busy: false, error: null };

  async function loadTrail(reset) {
    if (!canTrail) return;
    const before = reset || !s.trail.length ? null : s.trail[s.trail.length - 1].id;
    const r = await api.auditTrail({ engagementId: s.id, limit: TRAIL_PAGE, before });
    s.trail = reset ? r.rows : [...s.trail, ...r.rows];
    s.more = r.rows.length === TRAIL_PAGE;
  }
  async function loadReport() {
    s.rep = null;
    s.trail = [];
    s.more = false;
    if (!s.id) return;
    s.rep = await api.reportEngagement(s.id);
    await loadTrail(true);
  }

  function picker() {
    return html`<section class="card aud-card" aria-label="Choose an audit">
      <label class="field"
        ><span>Audit</span>
        <select data-field="engagement">
          <option value="">Choose…</option>
          ${s.list.map((e) => html`<option value="${e.id}" ${e.id === s.id ? 'selected' : ''}>${e.name}</option>`)}
        </select></label
      >
    </section>`;
  }

  function report() {
    if (!s.rep) return '';
    const { engagement: e, rounds, people } = s.rep;
    return html` <section class="card aud-card" aria-label="Rounds">
        <h2>${e.name}</h2>
        <p class="muted small">Started ${when(e.created_at)}</p>
        ${rounds.length ? roundsTable(rounds, true) : html`<p class="muted">No rounds yet.</p>`}
        <div class="aud-actions no-print"><button type="button" class="btn btn-sm" data-act="print">Print / Save as PDF</button></div>
      </section>
      <section class="card aud-card" aria-label="People">
        <h2>Who counted what</h2>
        ${
          people.length
            ? html`<ul class="aud-list">
                ${people.map(
                  (p) =>
                    html`<li>
                      <span
                        ><strong>${p.name}</strong><br /><span class="muted small"
                          >Round ${p.round} · ${p.items} items · ${ASG[p.status] ?? p.status}</span
                        ></span
                      >
                    </li>`,
                )}
              </ul>`
            : html`<p class="muted">Nobody has been given anything to count.</p>`
        }
      </section>
      ${
        canTrail
          ? html`<section class="card aud-card" aria-label="Audit trail">
              <h2>Audit trail</h2>
              <ul class="aud-list">
                ${s.trail.map(
                  (t) =>
                    html`<li>
                      <span
                        ><strong>${actionText(t.action)}</strong><br /><span class="muted small"
                          >${when(t.at)} · ${t.actor ?? 'System'}${t.reason ? ` · ${t.reason}` : ''}</span
                        ></span
                      >
                    </li>`,
                )}
              </ul>
              ${s.trail.length ? '' : html`<p class="muted">Nothing recorded yet.</p>`}
              ${s.more ? html`<button type="button" class="btn btn-sm btn-ghost" data-act="more" ${s.busy ? 'disabled' : ''}>Show older</button>` : ''}
            </section>`
          : ''
      }`;
  }

  function draw() {
    render(
      el,
      html`<div class="aud">
        ${hero({ label: 'Audit', title: 'Reports', sub: 'Rounds, results, people and the audit trail', actions: html`<a class="btn btn-ghost btn-sm" href="#/audit">Back</a>` })}
        ${s.error ? html`<p class="note note-error" role="alert">${s.error}</p>` : ''} ${picker()} ${report()}
      </div>`,
    );
  }

  async function run(fn) {
    s.busy = true;
    s.error = null;
    draw();
    try {
      await fn();
    } catch (e) {
      s.error = friendlyError(e).message;
    }
    s.busy = false;
    draw();
  }

  el.onchange = (e) => {
    if (e.target.dataset?.field !== 'engagement') return;
    s.id = e.target.value || null;
    if (s.id) setView({ ...(getView() ?? {}), engagement: s.id });
    return run(loadReport);
  };
  el.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    if (b.dataset.act === 'more') return run(() => loadTrail(false));
    if (b.dataset.act === 'open') {
      setView({ engagement: s.id, round: b.dataset.id });
      const r = s.rep.rounds.find((x) => x.id === b.dataset.id);
      location.hash = r?.state === 'final' ? '#/audit/final' : '#/audit/compile';
      return;
    }
    if (b.dataset.act === 'print') {
      const { engagement: x, rounds, people } = s.rep;
      printDocument(
        html`<div class="aud-print">
          <h1>${x.name} · Report</h1>
          ${roundsTable(rounds)}
          <h2>Who counted what</h2>
          <ul>
            ${people.map((p) => html`<li>${p.name}: round ${p.round}, ${p.items} items, ${ASG[p.status] ?? p.status}</li>`)}
          </ul>
        </div>`,
      );
    }
  };

  render(el, loadingCard());
  try {
    s.list = await api.listEngagements(100);
    await loadReport();
  } catch (e) {
    return render(el, errorCard('the reports', friendlyError(e).message));
  }
  draw();
}
