// Review of one round: who has counted, Force Submit and reopen, compile, the differences, corrections, conflicts, and the next round.
// The numbers come from the database (audit_compile_round); this screen only shows them and sends the owner's decisions.
import { html, render } from '../../../shared/html.js';
import { hero } from '../../../shared/ui.js';
import * as api from '../data/api.js';
import { parseQty, rupees, toPaisa } from '../domain/count.js';
import { friendlyError } from '../domain/errors.js';
import { getView, newKey, setView } from '../domain/nav.js';
import { roundLabel } from './engagement.js';
import { recompileNeeded } from '../domain/pipeline.js';
import { crumbs, errorCard, goPipe, loadingCard, pipelineStrip, toast } from './parts.js';
import { progressClick, progressPanel, progressState } from './progress.js';

const STATE = { draft: 'Being set up', locked: 'Locked', counting: 'Counting', compiled: 'Compiled', final: 'Final' };
const ASG = { assigned: 'Not started', counting: 'Counting', submitted: 'Submitted' };
const PAGE = 50;
const q = (n) => String(Number(n));
const when = (iso) => (iso ? new Date(iso).toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short' }) : '');
const money = (v) => rupees(toPaisa(v));

// The review page serves three ways: the whole page (no `screen`, as before), the Compile & Review screen, or the Corrections screen.
const PARTS = {
  review: ['progress', 'compile', 'differences', 'conflicts'],
  corrections: ['corrections', 'next'],
  // an Individual round compiles itself on submit: no progress, no compile button, no cross-round conflicts, no final snapshot, no next round
  individual: ['differences', 'corrections'],
};

export async function mount(el, { ctx, screen = null } = {}) {
  const individual = screen === 'individual';
  const shows = (part) => !screen || (PARTS[screen] ?? []).includes(part);
  const perms = ctx?.permissions ?? [];
  const can = (k) => perms.includes(k) || perms.includes('audit.manage');
  const canCompile = can('audit.compile');
  const canReview = can('audit.review');
  const canSuggest = can('audit.suggest');
  const canReopen = can('audit.reopen');
  const canPeek = can('audit.assign') || can('audit.compile') || can('audit.view');
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
    prog: progressState(),
    o: null,
    rows: [],
    total: 0,
    page: 0,
    mode: 'diff',
    text: '',
    form: null, // the one open inline form: { type, id, ... }
    allowMissing: false,
    nextMode: 'differences',
    sample: 20,
    nextKey: newKey(),
    busy: false,
    error: null,
  };

  async function loadRows() {
    const c = s.o.compilation;
    if (!c) {
      s.rows = [];
      s.total = 0;
      return;
    }
    const r = await api.compiledRows({
      compilationId: c.id,
      mode: s.mode,
      text: s.text,
      from: s.page * PAGE,
      to: s.page * PAGE + PAGE - 1,
    });
    s.rows = r.rows;
    s.total = r.total;
  }
  async function load() {
    s.o = await api.compileOverview(view.round);
    await loadRows();
  }

  const nameOf = (id) => s.o.assignments.find((a) => a.auditor_id === id)?.name ?? 'Someone';

  // ── sections ──
  function progress() {
    const { round, assignments } = s.o;
    const f = s.form;
    return html`<section class="card aud-card" aria-label="Progress" data-sec="progress" tabindex="-1">
      <h2>Who has counted</h2>
      ${assignments.length === 0 ? html`<p class="muted">Nobody has been given anything to count.</p>` : ''}
      ${assignments.map(
        (a) =>
          html`<div class="aud-block">
            <div class="row">
              <div>
                <strong>${a.name}</strong><br />
                <span class="muted small"
                  >${a.counted} of ${a.items} counted ·
                  ${ASG[a.status] ?? a.status}${a.revisions > 1 ? ` · revision ${a.revisions}` : ''}${a.forced ? ' · forced by the owner' : ''}</span
                >
              </div>
              <span class="aud-actions">
                ${
                  canPeek
                    ? html`<button type="button" class="btn btn-sm btn-ghost" data-peek="${a.id}" aria-expanded="${s.prog.id === a.id}">
                        Items
                      </button>`
                    : ''
                }
                ${
                  round.state === 'counting' && a.status !== 'submitted' && canCompile
                    ? html`<button type="button" class="btn btn-sm" data-form="force" data-id="${a.id}">Force submit</button>`
                    : ''
                }
                ${
                  a.status === 'submitted' && round.state !== 'final' && canReopen
                    ? html`<button type="button" class="btn btn-sm btn-ghost" data-form="reopen" data-id="${a.id}">Reopen</button>`
                    : ''
                }
              </span>
            </div>
            ${s.prog.id === a.id ? progressPanel(s.prog) : ''} ${f && f.id === a.id && f.type === 'force' ? forceForm() : ''}
            ${f && f.id === a.id && f.type === 'reopen' ? reasonForm('Reopen this count', 'Reopen', 'reopen-yes') : ''}
          </div>`,
      )}
    </section>`;
  }

  const reasonForm = (title, button, act) =>
    html`<div class="aud-form">
      <label class="field"
        ><span>${title}: why? (kept in the history)</span
        ><input type="text" data-field="reason" maxlength="500" value="${s.form.reason ?? ''}"
      /></label>
      <div class="aud-actions">
        <button type="button" class="btn btn-primary btn-sm" data-act="${act}" ${s.busy ? 'disabled' : ''}>${button}</button>
        <button type="button" class="btn btn-ghost btn-sm" data-act="close-form">Cancel</button>
      </div>
    </div>`;
  const forceForm = () =>
    html`<div class="aud-form">
      <p class="small">What should happen to the items this person has not counted?</p>
      <label class="aud-radio"
        ><input type="radio" name="fmode" data-field="mode" value="as_counted" ${s.form.mode === 'as_counted' ? 'checked' : ''} /> Leave
        them uncounted (they count as zero in stock)</label
      >
      <label class="aud-radio"
        ><input type="radio" name="fmode" data-field="mode" value="match" ${s.form.mode === 'match' ? 'checked' : ''} /> Mark them as
        matching the system (kept flagged as assumed)</label
      >
      <label class="field"
        ><span>Why? (kept in the history)</span><input type="text" data-field="reason" maxlength="500" value="${s.form.reason ?? ''}"
      /></label>
      <div class="aud-actions">
        <button type="button" class="btn btn-primary btn-sm" data-act="force-yes" ${s.busy ? 'disabled' : ''}>Force submit</button>
        <button type="button" class="btn btn-ghost btn-sm" data-act="close-form">Cancel</button>
      </div>
    </div>`;

  function compileCard() {
    const { round, assignments, compilation: c } = s.o;
    if (!canCompile || !['counting', 'compiled'].includes(round.state)) return '';
    const missing = assignments.filter((a) => a.status !== 'submitted');
    return html`<section class="card aud-card" aria-label="Compile" data-sec="compile" tabindex="-1">
      <h2>${round.state === 'compiled' ? 'Compile again' : 'Compile'}</h2>
      ${
        missing.length
          ? html`<p class="note" role="status">Not submitted yet: ${missing.map((m) => m.name).join(', ')}.</p>
              <label class="aud-radio"
                ><input type="checkbox" data-field="allow" ${s.allowMissing ? 'checked' : ''} /> Compile anyway. Their uncounted items count
                as zero and the result is marked incomplete.</label
              >`
          : html`<p class="muted small">Everyone has submitted.</p>`
      }
      ${round.state === 'compiled' ? html`<p class="muted small">Compiling again applies approved corrections and reopened counts. The earlier compile is kept.</p>` : ''}
      <button type="button" class="btn btn-primary" data-act="compile" ${s.busy || (missing.length && !s.allowMissing) ? 'disabled' : ''}>
        ${s.busy ? 'Working…' : c ? 'Compile again' : 'Compile now'}
      </button>
    </section>`;
  }

  function results() {
    const { compilation: c, history } = s.o;
    if (!c) return '';
    return html`<section class="card aud-card" aria-label="Result">
      <h2>Result · revision ${c.revision}</h2>
      <p>
        <strong>${c.variance_count}</strong> of ${c.item_count} items differ · net <strong>${money(c.variance_value)}</strong>
        <span class="muted small"> · compiled ${when(c.compiled_at)}</span>
      </p>
      ${c.with_missing ? html`<p class="note" role="status">Incomplete: ${c.missing_assignment_ids.length} ${c.missing_assignment_ids.length === 1 ? 'person had' : 'people had'} not submitted.</p>` : ''}
      ${
        c.auditor_notes.length
          ? html`<h3>Notes from counters</h3>
              ${c.auditor_notes.map((n) => html`<p class="small"><strong>${nameOf(n.auditor_id)}:</strong> ${n.note}</p>`)}`
          : ''
      }
      ${
        history.length > 1
          ? html`<details>
              <summary>Earlier compiles (${history.length - 1})</summary>
              ${history
                .slice(1)
                .map(
                  (h) =>
                    html`<p class="small muted">
                      Revision ${h.revision} · ${when(h.compiled_at)} · ${h.variance_count} differ ·
                      ${money(h.variance_value)}${h.with_missing ? ' · incomplete' : ''}
                    </p>`,
                )}
            </details>`
          : ''
      }
    </section>`;
  }

  function rowsCard() {
    const { round, compilation: c } = s.o;
    if (!c) return '';
    const from = s.total === 0 ? 0 : s.page * PAGE + 1;
    const to = Math.min(s.total, s.page * PAGE + s.rows.length);
    return html`<section class="card aud-card" aria-label="Items" data-sec="differences" tabindex="-1">
      <h2>Items</h2>
      <div class="aud-filters">
        <select data-f="mode" aria-label="Show">
          ${[
            ['diff', 'Differences'],
            ['missing', 'Not counted or assumed'],
            ['all', 'All items'],
          ].map(([v, t]) => html`<option value="${v}" ${s.mode === v ? 'selected' : ''}>${t}</option>`)}
        </select>
        <input type="search" data-f="text" placeholder="Search name, code or company" value="${s.text}" aria-label="Search items" />
      </div>
      ${s.rows.length === 0 ? html`<p class="muted">Nothing to show.</p>` : ''}
      ${s.rows.map((r) => {
        const open = s.form && s.form.type === 'suggest' && s.form.id === r.round_item_id;
        return html`<div class="aud-row">
          <div class="aud-row-main">
            <strong>${r.name || r.code}</strong>
            <span class="muted small">${r.code ? `${r.code} · ` : ''}${r.company}${r.auditor_id ? ` · ${nameOf(r.auditor_id)}` : ''}</span>
            <span class="small"
              >System ${q(r.system_qty)} · counted ${q(r.counted_qty)} ·
              <strong class="${Number(r.variance) === 0 ? 'aud-diff-ok' : 'aud-diff-bad'}"
                >${Number(r.variance) > 0 ? '+' : ''}${q(r.variance)} (${money(r.variance_value)})</strong
              ></span
            >
            <span class="muted small"
              >${[r.missing ? (r.auto_matched ? 'assumed to match' : 'not counted') : '', r.corrected_by ? 'corrected' : '', r.note].filter(Boolean).join(' · ')}</span
            >
          </div>
          ${
            canSuggest && round.state === 'compiled'
              ? html`<div class="aud-actions">
                  <button type="button" class="btn btn-sm btn-ghost" data-form="suggest" data-id="${r.round_item_id}">
                    Suggest a correction
                  </button>
                </div>`
              : ''
          }
          ${
            open
              ? html`<div class="aud-form">
                  <label class="field"
                    ><span>Correct count</span><input type="text" inputmode="decimal" data-field="qty" value="${s.form.qty ?? ''}"
                  /></label>
                  <label class="field"
                    ><span>Why?</span><input type="text" data-field="reason" maxlength="500" value="${s.form.reason ?? ''}"
                  /></label>
                  <div class="aud-actions">
                    <button type="button" class="btn btn-primary btn-sm" data-act="suggest-yes" ${s.busy ? 'disabled' : ''}>
                      Send for approval
                    </button>
                    <button type="button" class="btn btn-ghost btn-sm" data-act="close-form">Cancel</button>
                  </div>
                </div>`
              : ''
          }
        </div>`;
      })}
      <p class="muted small">${s.total ? `Showing ${from}–${to} of ${s.total}` : ''}</p>
      <div class="aud-actions">
        <button type="button" class="btn btn-ghost btn-sm" data-act="prev" ${s.page === 0 ? 'disabled' : ''}>Previous</button>
        <button type="button" class="btn btn-ghost btn-sm" data-act="next" ${(s.page + 1) * PAGE >= s.total ? 'disabled' : ''}>Next</button>
      </div>
    </section>`;
  }

  function correctionsCard() {
    const { round, corrections: all } = s.o;
    if (all.length === 0) {
      if (screen !== 'corrections' && !individual) return '';
      return html`<section class="card aud-card" aria-label="Corrections" data-sec="corrections" tabindex="-1">
        <h2>Corrections</h2>
        ${
          individual
            ? html`<p class="muted" data-empty>
                No corrections have been proposed for this round. Propose one from an item in the list above.
              </p>`
            : html`<p class="muted" data-empty>
                No corrections have been proposed for this round. A correction is proposed from the items on the
                <a href="#/audit/compile">Compile &amp; Review</a> screen.
              </p>`
        }
      </section>`;
    }
    // on the Corrections screen: waiting first, then approved (applied at the next compile), then rejected
    const rank = { proposed: 0, approved: 1, rejected: 2 };
    const grouped = screen === 'corrections' || individual;
    const corrections = grouped ? [...all].sort((a, b) => (rank[a.status] ?? 3) - (rank[b.status] ?? 3)) : all;
    const count = (status) => all.filter((c) => c.status === status).length;
    return html`<section class="card aud-card" aria-label="Corrections" data-sec="corrections" tabindex="-1">
      <h2>Corrections</h2>
      ${
        screen === 'corrections'
          ? html`<p class="muted small" data-correction-counts>
              ${count('proposed')} waiting · ${count('approved')} approved · ${count('rejected')} rejected
            </p>`
          : ''
      }
      ${corrections.map((c) => {
        const open = s.form && s.form.type === 'reject' && s.form.id === c.id;
        return html`<div class="aud-block">
          <p>
            <strong>${c.name || c.code}</strong> <span class="muted small">${c.code}</span><br />
            <span class="small"
              >System ${q(c.system_qty)} → proposed count <strong>${q(c.counted_qty)}</strong> by ${c.proposed_by} · ${c.reason}</span
            ><br />
            <span class="aud-badge aud-badge-${c.status === 'approved' ? 'compiled' : c.status === 'rejected' ? 'draft' : 'counting'}"
              >${c.status === 'proposed' ? 'Waiting' : c.status === 'approved' ? 'Approved' : 'Rejected'}</span
            >
            ${c.status === 'approved' ? html`<span class="muted small"> applies at the next compile${c.decided_by ? ` · by ${c.decided_by}` : ''}</span>` : ''}
            ${c.status === 'rejected' ? html`<span class="muted small"> ${c.decision_note}${c.decided_by ? ` · by ${c.decided_by}` : ''}</span>` : ''}
          </p>
          ${
            c.status === 'proposed' && canReview && round.state !== 'final'
              ? html`<div class="aud-actions">
                  <button type="button" class="btn btn-primary btn-sm" data-act="approve" data-id="${c.id}" ${s.busy ? 'disabled' : ''}>
                    Approve
                  </button>
                  <button type="button" class="btn btn-sm" data-form="reject" data-id="${c.id}">Reject</button>
                </div>`
              : ''
          }
          ${open ? reasonForm('Reject this correction', 'Reject', 'reject-yes') : ''}
        </div>`;
      })}
    </section>`;
  }

  function conflictsCard() {
    const { round, conflicts } = s.o;
    if (conflicts.length === 0) return '';
    return html`<section class="card aud-card" aria-label="Conflicts" data-sec="conflicts" tabindex="-1">
      <h2>Conflicts between rounds</h2>
      <p class="muted small">The same product was counted differently in two rounds. Nothing is decided for you.</p>
      ${conflicts.map((k) => {
        const open = s.form && s.form.type === 'resolve' && s.form.id === k.id;
        return html`<div class="aud-block">
          <p>
            <strong>${k.name || k.code}</strong> <span class="muted small">${k.code} · ${k.company}</span><br />
            <span class="small"
              >Round ${k.a_round}: <strong>${q(k.a_qty)}</strong>${k.a_name ? ` (${k.a_name})` : ''} · Round ${k.b_round}:
              <strong>${q(k.b_qty)}</strong>${k.b_name ? ` (${k.b_name})` : ''}</span
            ><br />
            ${
              k.resolved_side
                ? html`<span class="aud-badge aud-badge-compiled">Kept round ${k.resolved_side === 'a' ? k.a_round : k.b_round}</span>
                    <span class="muted small"> ${k.resolved_reason} · ${k.resolved_by}</span>`
                : html`<span class="aud-badge aud-badge-counting">Open</span>`
            }
          </p>
          ${
            !k.resolved_side && canReview && round.state !== 'final'
              ? html`<div class="aud-actions">
                  <button type="button" class="btn btn-sm" data-form="resolve" data-id="${k.id}" data-side="a">
                    Keep round ${k.a_round}
                  </button>
                  <button type="button" class="btn btn-sm" data-form="resolve" data-id="${k.id}" data-side="b">
                    Keep round ${k.b_round}
                  </button>
                </div>`
              : ''
          }
          ${open ? reasonForm(`Keep round ${s.form.side === 'a' ? k.a_round : k.b_round}`, 'Save choice', 'resolve-yes') : ''}
        </div>`;
      })}
    </section>`;
  }

  function nextCard() {
    const { round, compilation: c } = s.o;
    if (!canCompile || round.state !== 'compiled' || !c) return '';
    return html`<section class="card aud-card" aria-label="Next round" data-sec="next" tabindex="-1">
      <h2>Count again</h2>
      <p class="muted small">
        Makes the next lettered round from this result, on today's stock: current quantities and prices, and new products in the companies
        when you choose whole companies. Assign and start it like any round.
      </p>
      <label class="field"
        ><span>Which items?</span>
        <select data-f="nextMode">
          <option value="differences" ${s.nextMode === 'differences' ? 'selected' : ''}>
            Only the items that differ (${c.variance_count})
          </option>
          <option value="company" ${s.nextMode === 'company' ? 'selected' : ''}>Every item of the companies that have a difference</option>
          <option value="spot" ${s.nextMode === 'spot' ? 'selected' : ''}>A random sample of the whole round</option>
        </select></label
      >
      ${s.nextMode === 'spot' ? html`<label class="field"><span>Sample size (1 to 1000)</span><input type="text" inputmode="numeric" data-f="sample" value="${s.sample}" /></label>` : ''}
      <button type="button" class="btn btn-primary" data-act="next-round" ${s.busy ? 'disabled' : ''}>Make the next round</button>
    </section>`;
  }

  // on the Compile & Review screen: corrections waiting for a decision live on their own screen
  function correctionsHint() {
    if (screen !== 'review') return '';
    const waiting = s.o.corrections.filter((x) => x.status === 'proposed').length;
    if (waiting === 0) return '';
    return html`<p class="note" role="status" data-corrections-hint>
      ${waiting} ${waiting === 1 ? 'correction is' : 'corrections are'} waiting for a decision.
      <a href="#/audit/corrections">Open Corrections</a>
    </p>`;
  }

  // O4: the result on screen is older than something that was decided after it
  function recompileBanner() {
    const need = recompileNeeded(s.o);
    if (!need || !canCompile) return '';
    return html`<section class="card aud-card aud-recompile" aria-label="Recompile" data-recompile>
      <p class="note" role="status"><strong>Out of date.</strong> ${need.text}.</p>
      ${
        need.ready
          ? html`<button type="button" class="btn btn-primary" data-act="recompile" ${s.busy ? 'disabled' : ''}>
              ${s.busy ? 'Working…' : 'Recompile now'}
            </button>`
          : html`<p class="muted small">Recompile once they have submitted again.</p>`
      }
    </section>`;
  }

  // O3: jump links to the parts of this page, each with the number that needs a look
  function stepBar() {
    const { assignments, compilation: c, corrections, conflicts } = s.o;
    const waiting = corrections.filter((x) => x.status === 'proposed').length;
    const open = conflicts.filter((k) => !k.resolved_side).length;
    const submitted = assignments.filter((a) => a.status === 'submitted').length;
    const steps = [
      ['progress', 'Progress', `${submitted}/${assignments.length}`],
      canCompile && ['counting', 'compiled'].includes(s.o.round.state) && ['compile', 'Compile', ''],
      c && ['differences', 'Differences', String(c.variance_count)],
      corrections.length > 0 && ['corrections', 'Corrections', waiting ? String(waiting) : ''],
      conflicts.length > 0 && ['conflicts', 'Conflicts', open ? String(open) : ''],
      canCompile && s.o.round.state === 'compiled' && c && ['next', 'Next round', ''],
    ]
      .filter(Boolean)
      .filter(([key]) => shows(key));
    if (steps.length < 2) return '';
    return html`<nav class="aud-stepbar" aria-label="Parts of this page">
      ${steps.map(
        ([key, label, badge]) =>
          html`<button type="button" class="btn btn-ghost btn-sm" data-jump="${key}">
            ${label}${badge ? html` <span class="aud-badge">${badge}</span>` : ''}
          </button>`,
      )}
    </nav>`;
  }

  function draw() {
    const { round } = s.o;
    render(
      el,
      html`<div class="aud">
        ${crumbs(
          individual
            ? [{ label: 'Individual audits', href: '#/audit/individuals' }, { label: roundLabel(round) }, { label: 'Review & corrections' }]
            : [
                { label: 'Audits', href: '#/audit/engagements' },
                { label: 'This audit', href: '#/audit/engagement' },
                { label: roundLabel(round), href: '#/audit/round' },
                { label: screen === 'corrections' ? 'Corrections' : 'Review' },
              ],
        )}
        ${hero({
          label: 'Audit',
          title: `${roundLabel(round)} · ${individual ? 'review & corrections' : screen === 'corrections' ? 'corrections' : 'review'}`,
          sub: `${STATE[round.state] ?? round.state} · ${round.items} items`,
          actions: html`${
            !individual && (round.state === 'compiled' || round.state === 'final')
              ? html`<a class="btn btn-sm" href="#/audit/final">${round.state === 'final' ? 'Final' : 'Final snapshot'}</a> `
              : ''
          }`,
        })}
        ${screen === 'corrections' || individual ? '' : pipelineStrip(s.o, perms, 'compile')} ${stepBar()}
        ${s.error ? html`<p class="note note-error" role="alert">${s.error}</p>` : ''} ${correctionsHint()} ${recompileBanner()}
        ${shows('progress') ? progress() : ''} ${shows('compile') ? compileCard() : ''}
        ${shows('differences') ? html`${results()} ${rowsCard()}` : ''} ${shows('corrections') ? correctionsCard() : ''}
        ${shows('conflicts') ? conflictsCard() : ''} ${shows('next') ? nextCard() : ''}
      </div>`,
    );
  }

  async function run(fn, done) {
    s.busy = true;
    s.error = null;
    draw();
    try {
      await fn();
      s.form = null;
      await load();
      if (done) toast(done);
    } catch (e) {
      const f = friendlyError(e);
      s.error = f.message;
      if (f.kind === 'conflict') await load().catch(() => {}); // someone else changed it: show the fresh state
    }
    s.busy = false;
    draw();
  }

  // ── events ──
  el.oninput = (e) => {
    const t = e.target;
    if (t.dataset?.field && s.form) s.form[t.dataset.field] = t.value; // typing never redraws, so focus stays
    if (t.dataset?.f === 'text') {
      clearTimeout(s.searchTimer);
      s.text = t.value;
      s.searchTimer = setTimeout(async () => {
        s.page = 0;
        try {
          await loadRows();
        } catch (err) {
          s.error = friendlyError(err).message;
        }
        draw();
        el.querySelector('input[data-f="text"]')?.focus();
      }, 300);
    }
  };
  el.onchange = async (e) => {
    const t = e.target;
    if (t.dataset?.field === 'mode' && s.form) s.form.mode = t.value;
    if (t.dataset?.field === 'allow') {
      s.allowMissing = t.checked;
      return draw();
    }
    if (t.dataset?.f === 'mode') {
      s.mode = t.value;
      s.page = 0;
      try {
        await loadRows();
      } catch (err) {
        s.error = friendlyError(err).message;
      }
      return draw();
    }
    if (t.dataset?.f === 'nextMode') {
      s.nextMode = t.value;
      return draw();
    }
    if (t.dataset?.f === 'sample') s.sample = t.value;
  };
  el.onclick = async (e) => {
    if (progressClick(s.prog, e, draw)) return;
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    if (b.dataset.pipe) return goPipe(b.dataset.pipe, { engagement: s.o.round.engagement_id, round: view.round });
    if (b.dataset.jump) {
      const target = el.querySelector(`[data-sec="${b.dataset.jump}"]`);
      target?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
      return target?.focus?.({ preventScroll: true });
    }
    if (b.dataset.form) {
      s.form = { type: b.dataset.form, id: b.dataset.id, side: b.dataset.side, mode: 'as_counted', reason: '', qty: '' };
      return draw();
    }
    const id = b.dataset.id;
    const reason = (s.form?.reason ?? '').trim();
    switch (b.dataset.act) {
      case 'close-form':
        s.form = null;
        return draw();
      case 'prev':
      case 'next': {
        s.page += b.dataset.act === 'next' ? 1 : -1;
        try {
          await loadRows();
        } catch (err) {
          s.error = friendlyError(err).message;
        }
        return draw();
      }
      case 'force-yes':
        return run(() => api.forceSubmit({ assignmentId: s.form.id, mode: s.form.mode, reason }), 'Submitted for them.');
      case 'reopen-yes':
        return run(() => api.reopenAssignment({ assignmentId: s.form.id, reason }), 'Reopened. They can count again.');
      case 'recompile': {
        const need = recompileNeeded(s.o);
        return run(
          () => api.compileRound({ roundId: view.round, allowMissing: need?.allowMissing ?? false, version: s.o.round.version }),
          'Compiled again.',
        );
      }
      case 'compile':
        return run(() => api.compileRound({ roundId: view.round, allowMissing: s.allowMissing, version: s.o.round.version }), 'Compiled.');
      case 'suggest-yes': {
        const n = parseQty(s.form.qty);
        if (n === null) {
          s.error = 'Enter the correct count as a number, zero or more.';
          return draw();
        }
        return run(() => api.proposeCorrection({ roundId: view.round, itemId: s.form.id, qty: n, reason }), 'Sent for approval.');
      }
      case 'approve':
        return run(() => api.decideCorrection({ id, approve: true }), 'Approved. It applies at the next compile.');
      case 'reject-yes':
        return run(() => api.decideCorrection({ id: s.form.id, approve: false, note: reason }), 'Rejected.');
      case 'resolve-yes':
        return run(() => api.resolveConflict({ id: s.form.id, side: s.form.side, reason }), 'Choice saved.');
      case 'next-round': {
        s.busy = true;
        s.error = null;
        draw();
        try {
          const sample = s.nextMode === 'spot' ? parseQty(String(s.sample)) : null;
          const r = await api.nextRound({ key: s.nextKey, baseRoundId: view.round, mode: s.nextMode, sample });
          s.nextKey = newKey();
          setView({ ...(getView() ?? {}), round: r.round_id });
          toast(
            `Round ${r.round_number ?? ''}${r.round_suffix ?? ''} made with ${r.items ?? ''} items${r.new_items ? `, ${r.new_items} of them new` : ''}.`,
          );
          location.hash = '#/audit/round';
        } catch (err) {
          const f = friendlyError(err);
          if (f.kind === 'refused') s.nextKey = newKey(); // a refusal is final; a lost connection keeps the key for the retry
          s.error = f.message;
          s.busy = false;
          draw();
        }
        return;
      }
      default:
    }
  };

  render(el, loadingCard());
  try {
    await load();
  } catch (e) {
    return render(el, errorCard('the review', friendlyError(e).message));
  }
  draw();
}
