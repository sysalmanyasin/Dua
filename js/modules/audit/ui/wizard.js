// The New audit wizard: Scope and method, Team, Split preview, then Lock and start. It uses the same database calls as the Audit and
// Round pages, one after the other, each remembering what is already done, so pressing a button again after a failure never makes a second
// audit, round or split. If a step fails, the wizard stops there and says which; what was made stays, and the Round page can carry on.
import { html, render } from '../../../shared/html.js';
import * as api from '../data/api.js';
import { friendlyError } from '../domain/errors.js';
import { newKey, setView } from '../domain/nav.js';
import { SPLITS, planAutoSplit } from '../domain/split.js';
import { EXTRA_ROLES, WIZARD_STEPS, companiesOf, extraMembers, scopeProblem, teamProblem } from '../domain/wizard.js';
import { companyPicker } from './companyPicker.js';
import { roundLabel } from './engagement.js';
import { toast } from './parts.js';

const SCOPES = { full: 'Full stock', selected: 'Selected companies', single: 'One company' };
const METHODS = { manual: 'Manual counting', barcode: 'Barcode scanning', hybrid: 'Scan or type' };
const UNITS = {
  company: 'Company (whole companies per person)',
  item: 'Item (items dealt one by one)',
};

/**
 * Draws the wizard into `host`. `people` are the people who can be given a part (null when the list could not load) and `companyList`
 * the stock companies (null when it could not load, so names are typed). Returns nothing; it manages its own screen.
 */
export function mountWizard(host, { people = [], companyList = null } = {}) {
  const w = {
    step: 1,
    form: { name: '', scope: 'full', companies: '', picked: [], method: 'manual', unit: 'company' },
    counters: new Set(),
    roles: {},
    split: 'company',
    keys: { engagement: newKey(), round: newKey() },
    made: { engagementId: null, roundId: null, members: new Set(), assigned: false },
    overview: null,
    busy: false,
    error: null,
    stopped: null, // { where } when a step failed
  };
  const hasList = Boolean(companyList);

  const draw = () => {
    render(host, html`${shell()}`);
    const pick = host.querySelector('[data-picker-host]');
    if (pick) {
      companyPicker(pick, {
        companies: companyList,
        selected: w.form.picked,
        max: 500,
        single: w.form.scope === 'single',
        onChange: (names) => {
          w.form.picked = names;
          syncNext();
        },
      });
    }
  };
  // typing and ticking only update the button, so the field keeps focus
  const syncNext = () => {
    const next = host.querySelector('[data-act="wiz-next"]');
    if (next) next.disabled = w.busy || scopeProblem(w.form, hasList) !== null;
  };

  const stepsBar = () =>
    html`<ol class="aud-wiz-steps" aria-label="Steps">
      ${WIZARD_STEPS.map(
        (label, i) =>
          html`<li aria-current="${i + 1 === w.step ? 'step' : 'false'}" class="${i + 1 < w.step ? 'is-done' : ''}">
            <span aria-hidden="true">${i + 1 < w.step ? '✓' : i + 1}</span>
            ${label}${i + 1 < w.step ? html`<span class="sr-only"> (done)</span>` : ''}
          </li>`,
      )}
    </ol>`;

  const problem = () => (w.error ? html`<p class="note note-error" role="alert">${w.error}</p>` : '');
  const stopped = () =>
    w.stopped
      ? html`<p class="note" role="status" data-stopped>
          Stopped while ${w.stopped.where}. What was already made is kept. Press the button to try again, or
          ${w.made.roundId ? html`<button type="button" class="btn btn-ghost btn-sm" data-act="wiz-open">open the round page</button>` : 'start again'}.
        </p>`
      : '';

  const shell = () =>
    html`<section class="card aud-card" aria-label="New audit">
      <h2>New audit</h2>
      ${stepsBar()} ${problem()} ${stopped()} ${w.step === 1 ? step1() : w.step === 2 ? step2() : w.step === 3 ? step3() : step4()}
    </section>`;

  const step1 = () => {
    const why = scopeProblem(w.form, hasList);
    return html`<label class="field"
        ><span>Name</span
        ><input type="text" data-f="name" maxlength="120" value="${w.form.name}" placeholder="e.g. Annual stock audit" autocomplete="off"
      /></label>
      <label class="field"
        ><span>Scope</span
        ><select data-f="scope">
          ${Object.entries(SCOPES).map(([k, v]) => html`<option value="${k}" ${w.form.scope === k ? 'selected' : ''}>${v}</option>`)}
        </select></label
      >
      ${
        w.form.scope === 'full'
          ? ''
          : hasList
            ? html`<div class="field">
                <span>${w.form.scope === 'single' ? 'Company' : 'Companies'}</span>
                <div data-picker-host></div>
              </div>`
            : html`<label class="field"
                ><span>${w.form.scope === 'single' ? 'Company' : 'Companies (separate with commas)'}</span
                ><input
                  type="text"
                  data-f="companies"
                  value="${w.form.companies}"
                  placeholder="Exactly as written in the stock list"
                  autocomplete="off"
              /></label>`
      }
      <label class="field"
        ><span>Counting method</span
        ><select data-f="method">
          ${Object.entries(METHODS).map(([k, v]) => html`<option value="${k}" ${w.form.method === k ? 'selected' : ''}>${v}</option>`)}
        </select></label
      >
      <label class="field"
        ><span>Split the first round by</span
        ><select data-f="unit">
          ${Object.entries(UNITS).map(([k, v]) => html`<option value="${k}" ${w.form.unit === k ? 'selected' : ''}>${v}</option>`)}
        </select></label
      >
      <p class="muted small" data-why>${why ?? ''}</p>
      <div class="aud-actions">
        <button type="button" class="btn btn-primary" data-act="wiz-next" ${w.busy || why ? 'disabled' : ''}>Next: team</button>
        <button type="button" class="btn btn-ghost" data-act="create" ${w.busy ? 'disabled' : ''}>Create the audit only</button>
      </div>
      <p class="muted small">“Create the audit only” skips the team and the first round: add them later from the audit’s page.</p>`;
  };

  const step2 = () => {
    const list = people ?? [];
    const why = teamProblem(w.counters);
    return html`<p class="muted small">Tick who counts. A lead, deputy or observer can be added too; counters need no other role.</p>
      ${
        list.length === 0
          ? html`<p class="note" role="status">
              The list of people could not be loaded. Use “Create the audit only” and add the team from the audit’s page.
            </p>`
          : list.map(
              (p) =>
                html`<div class="row aud-wiz-person">
                  <span><strong>${p.full_name}</strong></span>
                  <span class="aud-actions">
                    ${
                      p.can_count
                        ? html`<label class="aud-check"
                            ><input type="checkbox" data-wcount="${p.user_id}" ${w.counters.has(p.user_id) ? 'checked' : ''} />
                            Counts</label
                          >`
                        : html`<span class="muted small">Cannot count</span>`
                    }
                    <select data-wrole="${p.user_id}" aria-label="Role of ${p.full_name}">
                      <option value="">No other role</option>
                      ${Object.entries(EXTRA_ROLES).map(
                        ([k, v]) => html`<option value="${k}" ${w.roles[p.user_id] === k ? 'selected' : ''}>${v}</option>`,
                      )}
                    </select>
                  </span>
                </div>`,
            )
      }
      <p class="muted small" data-why>${why ?? ''}</p>
      <div class="aud-actions">
        <button type="button" class="btn btn-ghost" data-act="wiz-back">Back</button>
        <button type="button" class="btn btn-primary" data-act="wiz-create" ${w.busy || why ? 'disabled' : ''}>
          ${w.busy ? 'Working…' : 'Next: make the round and preview'}
        </button>
      </div>
      <p class="muted small">This makes the audit and its first round as a draft. Nothing is given to anyone until you start counting.</p>`;
  };

  const plan = () => {
    const o = w.overview;
    return planAutoSplit({
      companies: o.companies.map((c) => ({ company: c.company, items: c.items })),
      auditors: [...w.counters],
      split: w.split,
      unit: o.round.unit,
    });
  };
  const nameOf = (id) => (people ?? []).find((p) => p.user_id === id)?.full_name ?? 'Someone';

  const step3 = () => {
    const p = plan();
    return html`<p>
        <strong>${roundLabel(w.overview.round)}</strong> is made as a draft: <strong>${w.overview.round.items}</strong> items in
        ${w.overview.companies.length} ${w.overview.companies.length === 1 ? 'company' : 'companies'}.
      </p>
      <label class="field"
        ><span>Balance</span
        ><select data-f="split">
          ${Object.entries(SPLITS).map(([k, v]) => html`<option value="${k}" ${w.split === k ? 'selected' : ''}>${v}</option>`)}
        </select></label
      >
      ${
        p.length
          ? html`<p class="muted small">Preview, before anything is given out:</p>
              ${p.map(
                (x) =>
                  html`<div class="row">
                    <span><strong>${nameOf(x.auditorId)}</strong></span
                    ><span class="muted small"
                      >${x.items} items · ${x.companies.length} ${x.companies.length === 1 ? 'company' : 'companies'}</span
                    >
                  </div>`,
              )}`
          : html`<p class="note" role="status">This round has no items, so there is nothing to give out.</p>`
      }
      <div class="aud-actions">
        <button type="button" class="btn btn-ghost" data-act="wiz-back">Back</button>
        <button type="button" class="btn btn-primary" data-act="wiz-next" ${p.length === 0 ? 'disabled' : ''}>Next: lock and start</button>
      </div>`;
  };

  const step4 = () => {
    const p = plan();
    return html`<p>
        Ready to give out <strong>${w.overview.round.items}</strong> items to <strong>${p.length}</strong>
        ${p.length === 1 ? 'person' : 'people'} and let them begin counting.
      </p>
      <p class="muted small">
        This gives each person their part, locks the round so the items cannot change, and starts the counting. It cannot be undone.
      </p>
      <div class="aud-actions">
        <button type="button" class="btn btn-ghost" data-act="wiz-back" ${w.busy ? 'disabled' : ''}>Back</button>
        <button type="button" class="btn btn-primary" data-act="wiz-start" ${w.busy ? 'disabled' : ''}>
          ${w.busy ? 'Working…' : 'Lock and start'}
        </button>
      </div>`;
  };

  // each step knows if it was done already, so a retry carries on from where it stopped
  async function makeEverything() {
    const m = w.made;
    let where = 'making the audit';
    try {
      if (!m.engagementId) {
        m.engagementId = await api.createEngagement({
          key: w.keys.engagement,
          name: w.form.name,
          scopeType: w.form.scope,
          companies: companiesOf(w.form, hasList),
          method: w.form.method,
        });
      }
      where = 'adding the team';
      for (const { userId, role } of extraMembers(w.roles)) {
        if (m.members.has(`${userId}:${role}`)) continue;
        await api.setMember(m.engagementId, userId, role);
        m.members.add(`${userId}:${role}`);
      }
      where = 'making the first round';
      if (!m.roundId) m.roundId = await api.createRound({ key: w.keys.round, engagementId: m.engagementId, unit: w.form.unit });
      where = 'reading the new round';
      w.overview = await api.roundOverview(m.roundId);
      return true;
    } catch (err) {
      w.stopped = { where };
      w.error = friendlyError(err).message;
      return false;
    }
  }

  async function startEverything() {
    const m = w.made;
    let where = 'reading the round';
    try {
      let o = await api.roundOverview(m.roundId);
      if (o.round.state === 'draft') {
        if (!m.assigned) {
          where = 'giving out the work';
          await api.assignAuto({ roundId: m.roundId, auditors: [...w.counters], split: w.split, version: o.round.version });
          m.assigned = true;
          o = await api.roundOverview(m.roundId);
        }
        where = 'locking the round';
        await api.lockRound(m.roundId, o.round.version);
        o = await api.roundOverview(m.roundId);
      }
      if (o.round.state === 'locked') {
        where = 'starting the counting';
        await api.startRound(m.roundId, o.round.version);
      }
      return true;
    } catch (err) {
      w.stopped = { where };
      const f = friendlyError(err);
      w.error = f.kind === 'conflict' ? `${f.message} Press the button again.` : f.message;
      return false;
    }
  }

  const open = () => {
    setView({ engagement: w.made.engagementId, round: w.made.roundId });
    location.hash = '#/audit/round';
  };

  host.oninput = (e) => {
    const f = e.target.dataset?.f;
    if (f === 'name' || f === 'companies') {
      w.form[f] = e.target.value;
      const why = host.querySelector('[data-why]');
      if (why) why.textContent = scopeProblem(w.form, hasList) ?? '';
      syncNext();
    }
  };
  host.onchange = (e) => {
    const t = e.target;
    if (t.dataset?.wcount !== undefined) {
      if (t.checked) w.counters.add(t.dataset.wcount);
      else w.counters.delete(t.dataset.wcount);
      w.error = null;
      return draw();
    }
    if (t.dataset?.wrole !== undefined) {
      w.roles[t.dataset.wrole] = t.value;
      return;
    }
    const f = t.dataset?.f;
    if (f === 'scope' || f === 'method' || f === 'unit') {
      w.form[f] = t.value;
      if (f === 'scope' && w.form.scope === 'single') w.form.picked = w.form.picked.slice(0, 1);
      draw();
    } else if (f === 'split') {
      w.split = t.value;
      w.made.assigned = false; // a different balance is given out afresh
      draw();
    }
  };
  host.onclick = async (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b || b.disabled) return;
    const act = b.dataset.act;
    if (act === 'wiz-open') return open();
    if (act === 'wiz-back') {
      w.step = Math.max(1, w.step - 1);
      w.error = null;
      w.stopped = null;
      return draw();
    }
    if (act === 'wiz-next') {
      if (w.step === 1 && scopeProblem(w.form, hasList) !== null) return;
      w.step += 1;
      w.error = null;
      return draw();
    }
    const run = async (fn) => {
      w.busy = true;
      w.error = null;
      w.stopped = null;
      draw();
      const ok = await fn();
      w.busy = false;
      return ok;
    };
    if (act === 'wiz-create') {
      if (teamProblem(w.counters) !== null) return;
      const ok = await run(makeEverything);
      if (ok) w.step = 3;
      return draw();
    }
    if (act === 'wiz-start') {
      const ok = await run(startEverything);
      if (ok) {
        toast('Counting started.');
        return open();
      }
      return draw();
    }
    if (act === 'create') {
      // the audit only, as before: no team, no round
      const ok = await run(async () => {
        try {
          w.made.engagementId ??= await api.createEngagement({
            key: w.keys.engagement,
            name: w.form.name,
            scopeType: w.form.scope,
            companies: companiesOf(w.form, hasList),
            method: w.form.method,
          });
          return true;
        } catch (err) {
          w.error = friendlyError(err).message;
          return false;
        }
      });
      if (ok) {
        toast('Audit created.');
        setView({ engagement: w.made.engagementId });
        location.hash = '#/audit/engagement';
        return;
      }
      return draw();
    }
  };

  draw();
}
