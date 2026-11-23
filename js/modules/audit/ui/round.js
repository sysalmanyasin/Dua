// One round: who has which part, the auto-split with a preview, moving a company, taking a part back, locking and starting.
import { html, render } from '../../../shared/html.js';
import { hero } from '../../../shared/ui.js';
import * as api from '../data/api.js';
import { friendlyError } from '../domain/errors.js';
import { getView } from '../domain/nav.js';
import { previousRound } from '../domain/pipeline.js';
import { SPLITS, planAutoSplit } from '../domain/split.js';
import { sameTeam } from '../domain/wizard.js';
import { roundLabel } from './engagement.js';
import { crumbs, errorCard, goPipe, loadingCard, pipelineStrip, toast } from './parts.js';

const STATE = { draft: 'Being set up', locked: 'Locked', counting: 'Counting', compiled: 'Compiled', final: 'Final' };
const ASG = { assigned: 'Not started', counting: 'Counting', submitted: 'Submitted' };

export async function mount(el, { ctx } = {}) {
  const perms = ctx?.permissions ?? [];
  const canAssign = perms.includes('audit.assign') || perms.includes('audit.manage');
  const canManage = perms.includes('audit.manage');
  const view = getView();
  if (!view?.round) {
    return render(
      el,
      html`<div class="aud">
        <div class="card aud-card">
          <p>No round chosen. <a href="#/audit/engagements">Back to audits</a></p>
        </div>
      </div>`,
    );
  }
  const s = {
    o: null,
    prev: null,
    people: [],
    picked: new Set(),
    split: 'company',
    moveCompany: '',
    moveTo: '',
    reason: '',
    busy: false,
    error: null,
  };

  async function load() {
    s.o = await api.roundOverview(view.round);
    s.people = canAssign ? await api.listPeopleForAudit() : [];
    await loadPrevious();
  }

  // O5: the counters of the round before this one, offered when a new round is being split. Best effort: the split works without it.
  async function loadPrevious() {
    s.prev = null;
    const { round } = s.o;
    if (round.state !== 'draft' || !canAssign) return;
    try {
      const engagement = await api.engagementOverview(round.engagement_id);
      const before = previousRound(engagement.rounds, round.id);
      if (!before) return;
      const team = sameTeam((await api.roundOverview(before.id)).assignments, s.people);
      if (team.ids.length > 0) s.prev = { label: roundLabel(before), ...team };
    } catch {
      s.prev = null;
    }
  }

  function draw() {
    const { round, assignments, companies } = s.o;
    const draftOpen = round.state === 'draft' && canAssign;
    const unassigned = companies.reduce((t, c) => t + c.unassigned, 0);
    const counters = s.people.filter((p) => p.can_count);
    const nameOf = (id) => s.people.find((p) => p.user_id === id)?.full_name ?? 'Someone';
    const plan = planAutoSplit({
      companies: companies.map((c) => ({ company: c.company, items: c.items })),
      auditors: counters.filter((p) => s.picked.has(p.user_id)).map((p) => p.user_id),
      split: s.split,
      unit: round.unit,
    });
    render(
      el,
      html`<div class="aud">
        ${crumbs([{ label: 'Audits', href: '#/audit/engagements' }, { label: 'This audit', href: '#/audit/engagement' }, { label: roundLabel(round) }])}
        ${hero({
          label: 'Audit',
          title: roundLabel(round),
          sub: `${STATE[round.state] ?? round.state} · ${round.items} items · by ${round.unit}`,
        })}
        ${s.error ? html`<p class="note note-error" role="alert">${s.error}</p>` : ''}
        ${pipelineStrip({ round, assignments, compilation: null }, perms, 'round')}
        <section class="card aud-card" aria-label="Who counts what">
          <h2>Who counts what</h2>
          ${
            assignments.length === 0
              ? html`<p class="muted">Nobody has a part yet.</p>`
              : assignments.map(
                  (a) =>
                    html`<div class="row">
                      <div>
                        <strong>${a.name}</strong><br /><span class="muted small"
                          >${a.items} items · ${a.companies} ${a.companies === 1 ? 'company' : 'companies'} ·
                          ${ASG[a.status] ?? a.status}</span
                        >
                      </div>
                      ${
                        canAssign && a.status !== 'submitted' && round.state !== 'final'
                          ? html`<button
                              type="button"
                              class="btn btn-ghost btn-sm"
                              data-act="revoke"
                              data-id="${a.id}"
                              ${s.busy ? 'disabled' : ''}
                            >
                              Take back
                            </button>`
                          : ''
                      }
                    </div>`,
                )
          }
          ${
            unassigned > 0
              ? html`<p class="note"><strong>▲ ${unassigned} items</strong> are not given to anyone yet.</p>`
              : assignments.length
                ? html`<p class="muted small">✓ Every item is given to someone.</p>`
                : ''
          }
          ${
            canAssign && assignments.length && round.state !== 'final'
              ? html`<label class="field"
                  ><span>Reason (needed to take a part back)</span
                  ><input type="text" data-f="reason" maxlength="200" value="${s.reason}" autocomplete="off"
                /></label>`
              : ''
          }
        </section>
        ${draftOpen ? splitCard(counters, plan) : ''} ${draftOpen && assignments.length > 0 ? moveCard(companies) : ''}
        ${stateCard(round, unassigned, assignments.length)}
      </div>`,
    );
    void nameOf;
  }

  const splitCard = (counters, plan) =>
    html`<section class="card aud-card" aria-label="Split between counters">
      <h2>Split between counters</h2>
      ${
        counters.length === 0
          ? html`<p class="muted">No one can count yet. Give people the counting permission in Team access.</p>`
          : html`<fieldset class="aud-pick">
                <legend class="muted small">Who counts in this round</legend>
                ${counters.map(
                  (p) =>
                    html`<label class="aud-check"
                      ><input type="checkbox" data-pick="${p.user_id}" ${s.picked.has(p.user_id) ? 'checked' : ''} /> ${p.full_name}</label
                    >`,
                )}
              </fieldset>
              ${sameTeamButton()}
              <label class="field"
                ><span>Balance</span
                ><select data-f="split">
                  ${Object.entries(SPLITS).map(([k, v]) => html`<option value="${k}" ${s.split === k ? 'selected' : ''}>${v}</option>`)}
                </select></label
              >
              ${
                plan.length
                  ? html`<p class="muted small">Preview, before anything is saved:</p>
                      ${plan.map(
                        (p) =>
                          html`<div class="row">
                            <span><strong>${counters.find((c) => c.user_id === p.auditorId)?.full_name}</strong></span
                            ><span class="muted small"
                              >${p.items} items · ${p.companies.length} ${p.companies.length === 1 ? 'company' : 'companies'}</span
                            >
                          </div>`,
                      )}`
                  : html`<p class="muted small">Tick at least one person to see the split.</p>`
              }
              <button type="button" class="btn btn-primary" data-act="split" ${s.busy || plan.length === 0 ? 'disabled' : ''}>
                Apply this split
              </button>
              <p class="muted small">Applying replaces any split made before.</p>`
      }
    </section>`;

  const sameTeamButton = () => {
    const t = s.prev;
    if (!t) return '';
    const names = t.ids.map((id) => s.people.find((p) => p.user_id === id)?.full_name ?? 'Someone').join(', ');
    const already = t.ids.length === s.picked.size && t.ids.every((id) => s.picked.has(id));
    return html`<div class="aud-block" data-same-team>
      <button type="button" class="btn btn-sm" data-act="same-team" ${already ? 'disabled' : ''}>Same team as last round</button>
      <p class="muted small">${t.label}: ${names}.${t.gone.length ? ` ${t.gone.join(', ')} can no longer count.` : ''}</p>
    </div>`;
  };

  const moveCard = (companies) => {
    const others = s.o.assignments.map((a) => ({ id: a.auditor_id, name: a.name }));
    return html`<section class="card aud-card" aria-label="Move a company">
      <h2>Move a company</h2>
      <label class="field"
        ><span>Company</span
        ><select data-f="moveCompany">
          <option value="">Choose…</option>
          ${companies.map((c) => html`<option value="${c.company}" ${s.moveCompany === c.company ? 'selected' : ''}>${c.company} (${c.items})</option>`)}
        </select></label
      >
      <label class="field"
        ><span>To</span
        ><select data-f="moveTo">
          <option value="">Choose…</option>
          ${others.map((p) => html`<option value="${p.id}" ${s.moveTo === p.id ? 'selected' : ''}>${p.name}</option>`)}
        </select></label
      >
      <button type="button" class="btn btn-sm" data-act="move" ${s.busy || !s.moveCompany || !s.moveTo ? 'disabled' : ''}>Move</button>
    </section>`;
  };

  const stateCard = (round, unassigned, people) => {
    if (['counting', 'compiled', 'final'].includes(round.state)) {
      return html`<section class="card aud-card" aria-label="Progress and results">
        <h2>Progress and results</h2>
        <p class="muted small">Who has counted, compile, corrections, conflicts and the next round.</p>
        <a class="btn btn-primary" href="#/audit/compile">Open the review</a>
      </section>`;
    }
    if (!canManage) return '';
    if (round.state === 'draft') {
      return html`<section class="card aud-card" aria-label="Lock">
        <h2>Lock the round</h2>
        <p class="muted small">Locking freezes the items and what each person will count. Every item must be given to someone first.</p>
        <button type="button" class="btn btn-primary" data-act="lock" ${s.busy || unassigned > 0 || people === 0 ? 'disabled' : ''}>
          Lock the round
        </button>
      </section>`;
    }
    if (round.state === 'locked') {
      return html`<section class="card aud-card" aria-label="Start counting">
        <h2>Start counting</h2>
        <p class="muted small">Counters can begin as soon as you start. This cannot be undone.</p>
        <button type="button" class="btn btn-primary" data-act="start" ${s.busy ? 'disabled' : ''}>Start counting</button>
      </section>`;
    }
    return '';
  };

  async function run(fn, doneText) {
    s.busy = true;
    s.error = null;
    draw();
    try {
      await fn();
      if (doneText) toast(doneText);
    } catch (e) {
      const f = friendlyError(e);
      s.error = f.kind === 'conflict' ? `${f.message} The page was refreshed.` : f.message;
    }
    s.busy = false;
    try {
      await load();
    } catch (e) {
      return render(el, errorCard('this round', friendlyError(e).message));
    }
    draw();
  }

  el.oninput = (e) => {
    if (e.target.dataset?.f === 'reason') s.reason = e.target.value;
  };
  el.onchange = (e) => {
    const t = e.target;
    if (t.dataset?.pick !== undefined) {
      if (t.checked) s.picked.add(t.dataset.pick);
      else s.picked.delete(t.dataset.pick);
      return draw();
    }
    const f = t.dataset?.f;
    if (f === 'split' || f === 'moveCompany' || f === 'moveTo') {
      s[f] = t.value;
      draw();
    }
  };
  el.onclick = (e) => {
    const p = e.target.closest('button[data-pipe]');
    if (p) return goPipe(p.dataset.pipe, { engagement: s.o.round.engagement_id, round: s.o.round.id });
    const b = e.target.closest('button[data-act]');
    if (!b || b.disabled) return;
    const v = s.o.round.version;
    const rid = s.o.round.id;
    switch (b.dataset.act) {
      case 'same-team':
        s.picked = new Set(s.prev?.ids ?? []);
        return draw();
      case 'split':
        return run(() => api.assignAuto({ roundId: rid, auditors: [...s.picked], split: s.split, version: v }), 'Split applied.');
      case 'move':
        return run(async () => {
          const ids = await api.companyItemIds(rid, s.moveCompany);
          await api.assignMove({ roundId: rid, itemIds: ids, toUser: s.moveTo, version: v });
          s.moveCompany = '';
          s.moveTo = '';
        }, 'Moved.');
      case 'revoke':
        return run(async () => {
          await api.revokeAssignment(b.dataset.id, s.reason);
          s.reason = '';
        }, 'Taken back.');
      case 'lock':
        return run(() => api.lockRound(rid, v), 'Round locked.');
      case 'start':
        return run(() => api.startRound(rid, v), 'Counting started.');
      default:
    }
  };

  render(el, loadingCard());
  try {
    await load();
  } catch (e) {
    return render(el, errorCard('this round', friendlyError(e).message));
  }
  draw();
}
