// The guided closing ledger (Session A: sections 1-5; Submit is not built yet).
// One page, one section at a time. Typing is kept in the form object and a local copy at once; the server copy is
// saved a moment later and the save chip always says which of the two is current.
import { html, render } from '../../../shared/html.js';
import { hero } from '../../../shared/ui.js';
import { longDate, money, parseAmount } from '../../../shared/format.js';
import * as api from '../data/api.js';
import { conflictVersion, friendlyError } from '../domain/errors.js';
import {
  emptyForm,
  emptyRow,
  formFromRow,
  localTotals,
  namedEntry,
  payloadFromForm,
  rowExtra,
  rupees,
  stripLineTotal,
} from '../domain/form.js';
import { overviewValue, prevTitle, snapshotRows } from '../domain/snapshot.js';
import { buildClosingBookPdf, pdfFileName } from '../domain/sheet.js';
import { SECTIONS, clampSection, sectionIndex } from '../domain/sections.js';
import { slotLabel } from '../domain/slots.js';
import { clearLocal, getOpen, loadLocal, saveLocal } from '../domain/store.js';
import { errorCard, loadingCard, openDialog, toast } from './parts.js';
import { saveBlob } from './book.js';
import { lateSections, previewFigures } from './sections-late.js';

const SAVE_DELAY = 2500;
const bad = (invalid, path) => (invalid.includes(path) ? 'true' : 'false');

export async function mount(el, { ctx } = {}) {
  const target = getOpen();
  if (!target) {
    return render(
      el,
      html`<div class="cls">
        ${hero({ label: 'Closing', title: 'Closing ledger' })}
        <div class="card">
          <p>No closing is open. <a href="#/closing">Go to Closing</a> to start or continue one.</p>
        </div>
      </div>`,
    );
  }
  render(el, loadingCard());

  let strips;
  let staff;
  let row;
  let accounts;
  let auditRequired = null;
  try {
    [strips, staff, row, accounts, auditRequired] = await Promise.all([
      api.listStrips(),
      api.staffChoices().catch(() => []),
      api.loadByKey(target.key),
      api.listCreditAccounts().catch(() => []),
      api.readAuditRequired().catch(() => null),
    ]);
  } catch (e) {
    return render(el, errorCard('the closing', friendlyError(e).message));
  }

  const S = {
    key: target.key,
    date: target.date,
    kind: target.kind,
    seq: target.seq ?? null,
    mode: target.mode ?? 'shift',
    opening: Boolean(target.opening),
    id: null,
    version: null,
    carry: null,
    form: emptyForm(strips, accounts),
    section: 0,
    period: null,
    auditRequired,
    tierNames: [1, 2, 3].map((n) => accounts.filter((a) => a.kind === 'tier_name' && a.tier_no === n).map((a) => a.label)),
    submitting: false,
    done: null,
    seen: new Set([0]),
    prev: null,
    prevError: '',
    showWarn: false,
    status: 'saved', // saved | saving | dirty | offline | failed | conflict | invalid
    invalid: [],
    preview: null,
    saving: false,
    again: false,
    timer: null,
  };

  const adopt = (r) => {
    S.id = r.id;
    S.version = r.draft_version;
    S.mode = r.mode;
    S.opening = r.is_opening;
    S.date = r.closing_slots?.business_date ?? S.date;
    S.kind = r.closing_slots?.kind ?? S.kind;
    S.seq = r.closing_slots?.seq ?? S.seq;
    S.carry = { cc: r.prev_cc, credit: r.prev_credit, deposits: r.prev_deposits, cash: r.prev_cash, from: r.source_closing_id };
    S.form = formFromRow(r, strips, accounts);
  };

  if (row) {
    if (row.status !== 'draft') {
      return render(el, errorCard('this closing', 'It is already submitted. Reopen it from Closing to correct it.'));
    }
    adopt(row);
    // typing that never reached the server (connection dropped) comes back if it is newer than the saved draft
    const local = loadLocal(S.key);
    if (local?.dirty && local.version === S.version && local.form && local.savedAt > row.updated_at) {
      S.form = local.form;
      S.status = 'dirty';
      toast('Restored your unsent typing.');
    }
  } else {
    // a new draft is created at once so the slot rules and the carried figures are checked before anything is typed
    try {
      const res = await api.saveDraft({
        key: S.key,
        date: S.date,
        kind: S.kind,
        mode: S.mode,
        payload: {},
        handoverSeq: S.seq,
        expectedVersion: null,
      });
      const fresh = await api.loadById(res.closing_id);
      adopt(fresh);
    } catch (e) {
      const f = friendlyError(e);
      return render(
        el,
        html`<div class="cls">
          ${hero({ label: 'Closing', title: 'Cannot start this closing' })}
          <div class="card">
            <p>${f.message}</p>
            <p><a class="btn" href="#/closing">Back to Closing</a></p>
          </div>
        </div>`,
      );
    }
  }

  // the frozen inventory audit of this draft, if it has one (a reopened revision keeps what its original had)
  S.audit = { phase: 'idle', preview: null, error: '', snap: null };
  if (!S.opening) {
    try {
      S.audit.snap = await api.readAudit(S.id);
    } catch {
      /* it simply shows as not verified yet */
    }
  }

  // what the closing before this one entered (read-only card under each section); absent when there is none or it cannot be read
  async function loadPrev() {
    S.prev = null;
    S.prevError = '';
    if (S.opening || !S.carry?.from) return;
    try {
      S.prev = await api.prevPage(S.id);
    } catch (e) {
      S.prevError = friendlyError(e).message;
    }
  }
  await loadPrev();

  async function auditSync() {
    if (['syncing', 'verifying'].includes(S.audit.phase)) return;
    S.audit.phase = 'syncing';
    S.audit.error = '';
    draw();
    try {
      S.audit.preview = await api.auditPreview();
      S.audit.phase = 'preview';
    } catch (e) {
      S.audit.phase = 'error';
      S.audit.error = friendlyError(e).message;
    }
    draw();
  }
  async function auditVerify() {
    const p = S.audit.preview;
    if (S.audit.phase !== 'preview' || !p) return;
    S.audit.phase = 'verifying';
    draw();
    try {
      await api.auditVerify(S.key, p.digest);
      S.audit.snap = (await api.readAudit(S.id).catch(() => null)) ?? {
        verified_at: new Date().toISOString(),
        data_as_of: p.data_as_of,
        codes_checked: p.codes_checked,
        not_found: p.not_found,
        by: null,
        items: p.items.map((i) => ({ item_code: i.code, item_name: i.name, qty: i.qty })),
      };
      S.audit.phase = 'idle';
      S.audit.preview = null;
      toast('Inventory audit verified.');
    } catch (e) {
      S.audit.phase = 'error';
      S.audit.preview = null;
      S.audit.error = friendlyError(e).message;
    }
    draw();
  }

  // ── saving ──
  const chipText = () =>
    ({
      saved: ['Saved ✓', 'ok'],
      saving: ['Saving…', 'busy'],
      dirty: ['Not saved yet', 'busy'],
      offline: ['Offline, draft kept', 'warn'],
      failed: ['Failed, tap to retry', 'bad'],
      conflict: ['Changed elsewhere', 'bad'],
      invalid: ['Fix the marked fields', 'warn'],
    })[S.status];
  const paintChip = () => {
    const c = el.querySelector('#cls-chip');
    if (!c) return;
    const [text, tone] = chipText();
    c.textContent = text;
    c.className = `cls-chip cls-chip-${tone}`;
  };
  const keepLocal = () => saveLocal(S.key, { form: S.form, version: S.version, dirty: true });

  async function doSave() {
    clearTimeout(S.timer);
    if (S.saving) {
      S.again = true;
      return;
    }
    const { payload, invalid } = payloadFromForm(S.form, { isOpening: S.opening });
    S.invalid = invalid;
    if (invalid.length) {
      S.status = 'invalid';
      paintMarks();
      return paintChip();
    }
    S.saving = true;
    S.status = 'saving';
    paintChip();
    const sentForm = S.form;
    try {
      const res = await api.saveDraft({
        key: S.key,
        date: S.date,
        kind: S.kind,
        mode: S.mode,
        payload,
        handoverSeq: S.seq,
        expectedVersion: S.version,
      });
      S.version = res.version;
      if (S.form === sentForm && !S.again) {
        clearLocal(S.key);
        S.status = 'saved';
      } else {
        keepLocal();
        S.status = 'dirty';
      }
      refreshPreview();
    } catch (e) {
      const f = friendlyError(e);
      if (f.kind === 'offline') S.status = 'offline';
      else if (f.kind === 'conflict') {
        S.status = 'conflict';
        S.saving = false;
        return onConflict(e);
      } else {
        S.status = 'failed';
        toast(f.message, 'error');
      }
    }
    S.saving = false;
    paintChip();
    if (S.again) {
      S.again = false;
      queueSave(0);
    }
  }
  const queueSave = (ms = SAVE_DELAY) => {
    clearTimeout(S.timer);
    S.timer = setTimeout(doSave, ms);
  };

  async function onConflict(e) {
    saveLocal(`${S.key}.mine`, { form: S.form, version: conflictVersion(e), dirty: false });
    paintChip();
    const dlg = openDialog(
      html`<h3>This draft was changed on another device</h3>
        <p>Someone saved a newer version. Your typing is kept as a copy on this phone. Reload to see the latest saved draft.</p>
        <div class="actions"><button type="button" class="btn btn-primary" data-act="reload">Reload latest</button></div>`,
      { label: 'Draft changed' },
    );
    dlg.querySelector('[data-act="reload"]').addEventListener('click', async () => {
      dlg.close();
      try {
        adopt(await api.loadById(S.id));
        clearLocal(S.key);
        S.status = 'saved';
      } catch (err) {
        toast(friendlyError(err).message, 'error');
      }
      draw();
    });
  }

  async function refreshPreview() {
    try {
      S.preview = await api.computePreview(S.id);
      S.period = await api.periodFor(S.id).catch(() => S.period);
    } catch {
      return; // the preview is a convenience; typing and saving carry on without it
    }
    paintTotals();
  }

  // ── owner control for the inventory-audit requirement (CLS-8) ──
  function changeAudit(on) {
    const dlg = openDialog(
      html`<h3>${on ? 'Switch the audit requirement on' : 'Switch the audit requirement off'}</h3>
        <p>
          ${on ? 'Closings will again need a verified inventory audit.' : 'Closings can then be submitted without a verified inventory audit.'}
          The change is logged with your reason.
        </p>
        <label for="aud-why">Reason</label>
        <input id="aud-why" class="cls-in cls-text" autocomplete="off" />
        <div class="actions"><button type="button" class="btn btn-primary" data-act="ok">Save</button></div>`,
      { label: 'Inventory audit requirement' },
    );
    dlg.querySelector('[data-act="ok"]').addEventListener('click', async () => {
      const reason = dlg.querySelector('#aud-why').value.trim();
      if (reason.length < 3) return toast('Give a short reason (at least 3 letters).', 'error');
      try {
        await api.setAuditRequired(on, reason);
        S.auditRequired = on;
        dlg.close();
        toast('Saved.');
        draw();
      } catch (e) {
        toast(friendlyError(e).message, 'error');
      }
    });
  }

  // ── submit (B2) ──
  async function settle() {
    // wait for any save in flight, then save what is typed, so Submit always sends the latest draft
    for (let n = 0; n < 40 && S.saving; n++) await new Promise((r) => setTimeout(r, 100));
    if (S.status !== 'saved') await doSave();
    for (let n = 0; n < 40 && S.saving; n++) await new Promise((r) => setTimeout(r, 100));
    return S.status === 'saved';
  }
  // variance wording and tone, as the old review screen: up to Rs. 100 is fine, up to Rs. 1,000 a warning, above that bad (Plus is never bad)
  const varianceTone = (v) => {
    const a = Math.abs(v);
    return v >= 0 || a <= 100 ? 'ok' : a <= 1000 ? 'warn' : 'bad';
  };
  const unopened = () => SECTIONS.filter((s, i) => !S.seen.has(i) && !(S.opening && s.key === 'invaudit')).map((s) => s.label);
  function auditBlocks() {
    return !S.opening && S.auditRequired === true && !S.audit.snap;
  }
  function askSubmit() {
    if (auditBlocks()) {
      toast('Inventory Audit is not done. Tap Sync & audit, then Verify & confirm.', 'error');
      S.section = sectionIndex('invaudit');
      return draw();
    }
    if (!S.opening && !S.form.responsible_staff_id) {
      S.showWarn = true;
      toast('Choose the responsible staff member first.', 'error');
      draw();
      return el.querySelector('#cls-staff')?.focus();
    }
    const p = S.preview;
    const final = S.mode === 'final';
    const v = p ? Number(final ? p.final_net_cash : p.shift_variance) : null;
    const tone = v === null ? 'ok' : varianceTone(v);
    const who = staff.find((x) => x.id === S.form.responsible_staff_id)?.name;
    const skipped = unopened();
    const dlg = openDialog(
      html`<h3>Review closing</h3>
        <p>${slotLabel(S.kind, S.seq)} · ${longDate(S.date)}${who ? html` · ${who}` : ''}</p>
        ${
          p
            ? html`<div class="cls-review">
                <div class="cls-review-row">
                  <span>Target Net Sales</span><strong>${money(final ? p.final_net_sale : p.net_sale, { decimals: true })}</strong>
                </div>
                <div class="cls-review-row">
                  <span>Net Cash Available</span
                  ><strong>${money(final ? p.final_net_cash + p.final_net_sale : p.net_cash + p.net_sale, { decimals: true })}</strong>
                </div>
                <div class="cls-review-row cls-var-${tone}">
                  <span>${v === 0 ? '✓ Variance' : v > 0 ? '▲ Plus' : '▼ Less'}</span
                  ><strong>${money(Math.abs(v), { decimals: true })}</strong>
                </div>
              </div>`
            : html`<p class="cls-meta">The figures are still being worked out. You can submit; the saved closing will have them.</p>`
        }
        ${tone !== 'ok' ? html`<p class="cls-warn" role="alert">⚠ This is a ${tone === 'bad' ? 'large ' : ''}shortage. Recount the till and check credit and deposits before submitting.</p>` : ''}
        ${skipped.length ? html`<p class="cls-warn">Some sections were not opened: ${skipped.join(', ')}. You can still submit, but check them first.</p>` : ''}
        <p class="cls-meta">After submitting, the closing is locked and the next shift picks up its carried values.</p>
        <div class="actions">
          <button type="button" class="btn" data-close>Not yet</button>
          <button type="button" class="btn btn-primary" data-act="go">Submit</button>
        </div>`,
      { label: 'Submit closing' },
    );
    dlg.querySelector('[data-act="go"]').addEventListener('click', () => {
      dlg.close();
      doSubmit();
    });
  }
  async function doSubmit() {
    if (S.submitting) return;
    S.submitting = true;
    try {
      if (!(await settle())) {
        S.submitting = false;
        return toast(
          S.invalid.length ? 'Fix the marked fields first.' : 'Your draft is not saved yet. Check the connection and try again.',
          'error',
        );
      }
      const res = await api.submit(S.key);
      clearLocal(S.key);
      S.done = { already: Boolean(res?.already), preview: S.preview };
      S.submitting = false;
      draw();
    } catch (e) {
      S.submitting = false;
      const f = friendlyError(e);
      if (f.code === 'audit_not_verified') {
        S.section = sectionIndex('invaudit');
        draw();
      }
      if (f.code === 'carry_changed') {
        try {
          adopt(await api.loadById(S.id));
          await loadPrev();
          refreshPreview();
        } catch {
          /* the message below still tells them what to do */
        }
        draw();
      }
      toast(f.message, 'error');
    }
  }
  async function sheetPdf(open) {
    try {
      const pages = await api.ownBook({ closing: S.id, limit: 1 });
      if (!pages?.length) return toast('The sheet is not available yet. Find it later under Saved records.', 'error');
      const name = pdfFileName(pages);
      const blob = buildClosingBookPdf(pages, { title: name.replace(/\.pdf$/, '') }).toBlob();
      if (open) window.open(URL.createObjectURL(blob), '_blank');
      else saveBlob(blob, name);
    } catch (e) {
      toast(friendlyError(e).message, 'error');
    }
  }
  const successScreen = () =>
    html`<div class="cls">
      ${hero({ label: 'Closing', title: S.done.already ? 'Already submitted' : 'Closing submitted ✓', sub: `${slotLabel(S.kind, S.seq)} · ${longDate(S.date)}` })}
      <div class="card">
        <p>
          ${S.done.already ? 'This closing had already been submitted. Nothing was changed.' : 'Saved and locked. The next shift will pick up the carried card balance, credit, deposits and cash.'}
        </p>
        ${
          S.done.preview
            ? html`<p class="cls-meta">
                Net sale ${money(S.done.preview.net_sale, { decimals: true })} · Net cash
                ${money(S.done.preview.net_cash, { decimals: true })}
              </p>`
            : ''
        }
        <div class="actions">
          <button type="button" class="btn" data-act="pdf">Download PDF</button>
          <button type="button" class="btn" data-act="pdf-open">Open to print</button>
          <a class="btn btn-primary" href="#/closing">Back to Closing</a>
        </div>
      </div>
    </div>`;

  // ── typing ──
  const setPath = (path, value) => {
    const parts = path.split('.');
    let o = S.form;
    parts.slice(0, -1).forEach((p) => (o = o[p]));
    o[parts.at(-1)] = value;
  };
  const touched = () => {
    S.form = { ...S.form }; // a new object marks "typed since the last save"
    S.status = 'dirty';
    keepLocal();
    paintChip();
    paintTotals();
    queueSave();
  };
  const listOf = (path) => path.split('.').reduce((o, p) => o[p], S.form);
  const rowOf = (list, id) => listOf(list).find((r) => r.id === id);

  // ── drawing ──
  const field = (path, label, { note = '', cls = '' } = {}) => {
    const value = path.split('.').reduce((o, p) => o[p], S.form);
    return html`<div class="cls-row ${cls}">
      <label for="f-${path}">${label}${note ? html`<small>${note}</small>` : ''}</label>
      <input
        class="cls-in"
        id="f-${path}"
        data-f="${path}"
        inputmode="decimal"
        autocomplete="off"
        value="${value}"
        aria-invalid="${bad(S.invalid, path)}"
      />
    </div>`;
  };
  const total = (label, key, { net = false } = {}) =>
    html`<div class="cls-total ${net ? 'cls-total-net' : ''}"><span>${label}</span><strong data-total="${key}">–</strong></div>`;

  const sectionPos = () =>
    html`<h2>1 · POS</h2>
      ${field('sys_cash', 'System Cash Sales Total')} ${field('last_bill_no', 'Last Bill Number')}
      ${field('last_bill_amt', 'Last Bill Amount')} ${field('comp_sale', 'Computer Card Sale')}
      ${field('alfalah', 'Bank Alfalah Card Machine')} ${field('keenu', 'Keenu Card Machine')}
      <h3 class="sec-label">Returns / Refunds</h3>
      ${field('ret_manual.0', 'Return 1', { cls: 'cls-return' })} ${field('ret_manual.1', 'Return 2', { cls: 'cls-return' })}
      ${field('ret_manual.2', 'Return 3', { cls: 'cls-return' })} ${field('ret_system', 'System Return', { cls: 'cls-return' })}
      ${total('Total Returns', 'returns')}
      ${
        S.opening
          ? html`<h3 class="sec-label">Opening figures</h3>
              <p class="cls-meta">
                Typed once, for the opening closing only. The System Cash Sales Total and Last Bill Number above matter too: the next
                closing measures its shift sale and customers from them.
              </p>
              ${field('opening.cc', 'Card balance (cc)')} ${field('opening.credit', 'Credit')} ${field('opening.deposits', 'Deposits')}
              ${field('opening.cash', 'Cash')}`
          : ''
      }`;

  const textCell = (list, r, k, ph) =>
    html`<input class="cls-in cls-text" data-list="${list}" data-id="${r.id}" data-k="${k}" placeholder="${ph}" value="${r[k]}" />`;
  const numCell = (list, r, k, path) =>
    html`<input
      class="cls-in"
      inputmode="decimal"
      autocomplete="off"
      data-list="${list}"
      data-id="${r.id}"
      data-k="${k}"
      aria-invalid="${bad(S.invalid, `${list}.${listOf(list).indexOf(r)}.${k}`)}"
      value="${r[k]}"
      aria-label="${path}"
    />`;
  const strike = (list, r) =>
    html`<button
      type="button"
      class="icon-btn"
      data-act="strike"
      data-list="${list}"
      data-id="${r.id}"
      aria-label="${r.deleted ? 'Restore row' : 'Strike out row'}"
      title="${r.deleted ? 'Restore' : 'Strike out'}"
    >
      ${r.deleted ? '↺' : '✕'}
    </button>`;

  const sectionMediq = () =>
    html`<h2>2 · MEDIQ</h2>
      ${field('prev_mediq', 'Previous MEDIQ amount collected')}
      <div class="cls-table" style="--cols: 3">
        <div class="cls-trow is-head">
          <span>Bill Number</span><span>COD Collected</span><span>Pharmacy Bill</span><span>Extra</span><span></span>
        </div>
        ${S.form.mediq.map(
          (r) =>
            html`<div class="cls-trow ${r.deleted ? 'is-struck' : ''}" style="--cols: 3">
              ${textCell('mediq', r, 'bill_no', 'Bill no.')} ${numCell('mediq', r, 'collected', 'COD collected')}
              ${numCell('mediq', r, 'pharmacy_bill', 'Pharmacy bill')}
              <span class="cls-meta" data-extra="${r.id}">${money(rupees(rowExtra(r)))}</span> ${strike('mediq', r)}
            </div>`,
        )}
      </div>
      <div class="actions"><button type="button" class="btn btn-sm" data-act="add" data-list="mediq">＋ Add Row</button></div>
      ${total('Extra MEDIQ Collected', 'mediqExtra')}`;

  const sectionShift = () =>
    html`<h2>3 · Shift</h2>
      ${field('overrides.shift_sale', "This Shift's Sales (delta)", { note: 'Leave empty to use the calculated figure. A typed 0 counts.' })}
      ${field('book.0', 'Book Bill 1')} ${field('book.1', 'Book Bill 2')}
      ${field('overrides.customers', 'Customers This Shift (delta)', { note: 'Leave empty to use the calculated count.' })}
      <div class="cls-row"><span class="cls-meta">Calculated shift sale · customers</span><strong data-total="shiftInfo">–</strong></div>
      <div class="cls-total cls-total-net"><span>Net Sale (this shift)</span><strong data-total="netSale">–</strong></div>
      ${
        S.carry && !S.opening
          ? html`<h3 class="sec-label">Carried from the previous closing</h3>
              <div class="cls-row">
                <label>Card balance</label><input class="cls-in is-carried" readonly value="${money(S.carry.cc)}" />
              </div>
              <div class="cls-row"><label>Credit</label><input class="cls-in is-carried" readonly value="${money(S.carry.credit)}" /></div>
              <div class="cls-row">
                <label>Deposits</label><input class="cls-in is-carried" readonly value="${money(S.carry.deposits)}" />
              </div>
              <div class="cls-row"><label>Cash</label><input class="cls-in is-carried" readonly value="${money(S.carry.cash)}" /></div>`
          : ''
      }`;

  const sectionHs = () =>
    html`<h2>4 · HS</h2>
      <div class="cls-table" style="--cols: 1">
        ${S.form.hs.map(
          (r) =>
            html`<div class="cls-trow ${r.deleted ? 'is-struck' : ''}" style="--cols: 1">
              ${textCell('hs', r, 'label', 'Name')} ${numCell('hs', r, 'amount', 'Amount')} ${strike('hs', r)}
            </div>`,
        )}
      </div>
      <div class="actions"><button type="button" class="btn btn-sm" data-act="add" data-list="hs">＋ Add Row</button></div>
      ${total('Total HS (A)', 'hs')}`;

  const groupOf = (r) => (r.strip_id ? (strips.find((x) => x.id === r.strip_id)?.group_name ?? '') : '');
  const sectionStrips = () => {
    let lastGroup = null;
    return html`<h2>5 · Strips</h2>
      <p class="cls-meta">Item names and prices are fixed by the owner. Enter only the quantity sold.</p>
      <div class="cls-table" style="--cols: 3">
        <div class="cls-trow is-head"><span>Item</span><span>Price</span><span>Qty</span><span>Total</span><span></span></div>
        ${S.form.strips.map((r) => {
          const fixed = Boolean(r.strip_id);
          const g = groupOf(r);
          const header = fixed && g !== lastGroup && g ? html`<h3 class="sec-label cls-group">${g}</h3>` : '';
          if (fixed) lastGroup = g;
          return html`${header}
            <div class="cls-trow ${r.deleted ? 'is-struck' : ''}" style="--cols: 3">
              ${
                fixed
                  ? html`<span class="cls-name">${r.label}</span
                      ><span class="cls-fixed">${money(r.price === '' ? 0 : Number(r.price))}</span>`
                  : html`${textCell('strips', r, 'label', 'Extra item')} ${numCell('strips', r, 'price', 'Price')}`
              }
              ${numCell('strips', r, 'qty', 'Qty')}
              <span class="cls-meta" data-line="${r.id}">${money(rupees(stripLineTotal(r)))}</span>
              ${fixed ? html`<span></span>` : strike('strips', r)}
            </div>`;
        })}
      </div>
      <div class="actions"><button type="button" class="btn btn-sm" data-act="add" data-list="strips">＋ Add extra item</button></div>
      ${total('Total Inventory Revenue (B)', 'strips')}`;
  };

  const signedCell = (list, r, k, label) =>
    html`<div class="cls-signed">
      <button
        type="button"
        class="btn btn-sm"
        data-act="signrow"
        data-list="${list}"
        data-id="${r.id}"
        data-k="${k}"
        aria-label="Toggle positive or negative"
      >
        ±
      </button>
      ${numCell(list, r, k, label)}
    </div>`;

  const late = lateSections({
    S,
    field,
    total,
    textCell,
    numCell,
    signed: signedCell,
    strike,
    listOf,
    bad: (path) => bad(S.invalid, path),
    canManage: (ctx?.permissions ?? []).includes('settings.manage'),
  });
  const BUILT = [sectionPos, sectionMediq, sectionShift, sectionHs, sectionStrips, ...[5, 6, 7, 8, 9, 10, 11, 12, 13].map((i) => late[i])];

  const sectionBody = () => {
    const def = SECTIONS[S.section];
    return def.built
      ? BUILT[S.section]()
      : html`<h2>${S.section + 1} · ${def.title}</h2>
          <div class="cls-soon">This section is built in the next session. Nothing here is saved yet.</div>`;
  };

  const prevCard = () => {
    if (S.opening) return '';
    const def = SECTIONS[S.section];
    if (S.prevError) return html`<section class="card cls-prev" role="status"><div class="cls-meta">Previous closing preview could not be loaded: ${S.prevError}</div></section>`;
    if (!S.prev) return html`<section class="card cls-prev"><div class="cls-meta">No previous closing on record yet.</div></section>`;
    const rows = snapshotRows(def.key, S.prev);
    return html`<section class="card cls-prev" aria-label="Previous closing">
      <div class="cls-prev-head">📋 ${prevTitle(S.prev)}</div>
      <div class="cls-prev-rows">
        ${
          rows.length
            ? rows.map(([l, v]) => html`<div class="cls-prev-row"><span>${l}</span><span>${v}</span></div>`)
            : html`<div class="cls-meta">Nothing for this section.</div>`
        }
      </div>
    </section>`;
  };

  function viewAll() {
    const t = localTotals(S.form, S.carry ?? {});
    const dlg = openDialog(
      html`<h3>All sections</h3>
        <p class="cls-meta">Typed so far. Tap a section to go to it.</p>
        <ul class="cls-list cls-viewall">
          ${SECTIONS.map(
            (sec, i) =>
              html`<li>
                <button type="button" class="cls-va-row" data-go="${i}" aria-current="${i === S.section ? 'step' : 'false'}">
                  <span>${sec.icon} ${sec.label}</span><strong>${overviewValue(sec.key, t, S.form) || '—'}</strong>
                  <span class="cls-meta">${i === S.section ? 'you are here' : S.seen.has(i) ? '✓' : '›'}</span>
                </button>
              </li>`,
          )}
        </ul>
        <div class="actions"><button type="button" class="btn" data-close>Close</button></div>`,
      { label: 'All sections' },
    );
    dlg.querySelectorAll('[data-go]').forEach((b) =>
      b.addEventListener('click', () => {
        dlg.close();
        go(Number(b.dataset.go));
      }),
    );
  }

  function draw() {
    if (S.done) return render(el, successScreen());
    const pct = Math.round(((S.section + 1) / SECTIONS.length) * 100);
    render(
      el,
      html`<div class="cls cls-swipe">
        <p class="cls-backrow"><button type="button" class="btn btn-sm" data-act="leave">‹ Back to days</button></p>
        ${hero({
          label: 'Closing',
          title: `${slotLabel(S.kind, S.seq)} closing`,
          sub: `${longDate(S.date)} · ${S.opening ? 'Opening' : S.mode === 'final' ? 'Final' : 'Shift'}`,
          actions: html`<span id="cls-chip" class="cls-chip" role="status" tabindex="0"></span>`,
        })}
        <div class="cls-anchor" aria-hidden="true"></div>
        <div class="cls-bar">
          <div class="cls-progress" aria-hidden="true"><span style="width: ${pct}%"></span></div>
          <nav class="cls-jump" aria-label="Sections">
            ${SECTIONS.map(
              (s, i) =>
                html`<button
                  type="button"
                  data-jump="${i}"
                  aria-current="${i === S.section ? 'step' : 'false'}"
                  class="${s.built ? '' : 'is-later'}"
                >
                  ${i + 1} ${s.label}
                </button>`,
            )}
          </nav>
        </div>
        <div class="cls-grid">
          <section class="card">
            <div class="cls-row">
              <label for="cls-staff">Responsible staff</label>
              <select id="cls-staff" class="cls-in">
                <option value="">Choose…</option>
                ${staff.map((s) => html`<option value="${s.id}" ${s.id === S.form.responsible_staff_id ? 'selected' : ''}>${s.name}</option>`)}
              </select>
            </div>
            ${S.showWarn && !S.form.responsible_staff_id ? html`<p class="cls-warn" role="alert">Required before submitting.</p>` : ''}
          </section>
          <section class="card cls-sec">${sectionBody()}</section>
          ${prevCard()}
        </div>
        <div class="cls-tools">
          <button type="button" class="btn" data-act="draft">💾 Save as Draft</button>
          <button type="button" class="btn" data-act="viewall">⊞ View all</button>
        </div>
        <p class="cls-meta">Back to days saves your draft first. Continue it later from the calendar or Saved records.</p>
        <p class="cls-swipe-hint" aria-hidden="true">Swipe left for next section · Swipe right for previous</p>
        <div class="cls-nav">
          <button type="button" class="btn" data-act="prev" ${S.section === 0 ? 'disabled' : ''}>← Back</button>
          ${
            S.section === SECTIONS.length - 1
              ? html`<button type="button" class="btn btn-primary" data-act="submit" ${S.submitting ? 'disabled' : ''}>
                  Submit closing
                </button>`
              : html`<button type="button" class="btn btn-primary" data-act="next">Next →</button>`
          }
        </div>
      </div>`,
    );
    paintChip();
    paintTotals();
  }

  // Bring the section cards (progress bar, jump chips, card) to the top of the screen,
  // so the hero and the back link are scrolled past instead of the person landing on them.
  const scrollToCards = () => {
    const anchor = el.querySelector('.cls-anchor');
    if (anchor?.scrollIntoView) anchor.scrollIntoView({ block: 'start' });
    else window.scrollTo?.(0, 0);
  };
  const go = (i, scroll = true) => {
    S.section = clampSection(i);
    S.seen.add(S.section);
    draw();
    if (scroll) scrollToCards();
  };
  const moveSection = (direction) => {
    const next = clampSection(S.section + direction);
    if (next !== S.section) go(next);
  };

  // Swipe left / right anywhere on the cards moves one section, like the old Closing app.
  // An ordinary swipe is enough (40 px, clearly more sideways than up or down). It starts on any card,
  // row, label or field, but not on the jump chips (they scroll sideways on their own).
  let swipeStart = null;
  el.addEventListener(
    'touchstart',
    (e) => {
      const root = e.target.closest?.('.cls-swipe');
      if (e.touches.length !== 1 || !root || e.target.closest('.cls-jump')) {
        swipeStart = null;
        return;
      }
      swipeStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    },
    { passive: true },
  );
  el.addEventListener(
    'touchend',
    (e) => {
      if (!swipeStart) return;
      const start = swipeStart;
      swipeStart = null;
      const touch = e.changedTouches[0];
      if (!touch) return;
      const dx = touch.clientX - start.x;
      const dy = touch.clientY - start.y;
      if (Math.abs(dx) < 40 || Math.abs(dy) > Math.abs(dx) * 0.8) return;
      moveSection(dx < 0 ? 1 : -1);
    },
    { passive: true },
  );
  el.addEventListener(
    'touchcancel',
    () => {
      swipeStart = null;
    },
    { passive: true },
  );

  function paintMarks() {
    el.querySelectorAll('[data-f]').forEach((i) => i.setAttribute('aria-invalid', bad(S.invalid, i.dataset.f)));
    el.querySelectorAll('[data-list]').forEach((i) => {
      const list = i.dataset.list;
      const idx = listOf(list).findIndex((r) => r.id === i.dataset.id);
      i.setAttribute('aria-invalid', bad(S.invalid, `${list}.${idx}.${i.dataset.k}`));
    });
  }

  function paintTotals() {
    const t = localTotals(S.form, S.carry ?? {});
    const set = (k, text, neg = false) => {
      const n = el.querySelector(`[data-total="${k}"]`);
      if (!n) return;
      n.textContent = text;
      n.classList.toggle('cls-neg', neg);
    };
    set('hs', money(rupees(t.hs), { decimals: true }));
    set('strips', money(rupees(t.strips), { decimals: true }));
    set('mediqExtra', money(rupees(t.mediqExtra), { decimals: true }));
    set('returns', money(rupees(t.returns), { decimals: true }));
    set('misc', money(rupees(t.misc), { decimals: true }));
    set('ccTotal', money(rupees(t.ccTotal), { decimals: true }));
    set('currCC', money(rupees(t.ccCurr), { decimals: true }));
    const previous = S.prev?.inputs ?? {};
    const currentSysCash = parseAmount(S.form.sys_cash);
    const previousSysCash = Number(previous.sys_cash) || 0;
    const currentBill = parseAmount(S.form.last_bill_no);
    const previousBill = Number(previous.last_bill_no) || 0;
    const hasCurrentSysCash = currentSysCash !== null && !Number.isNaN(currentSysCash);
    const hasCurrentBill = currentBill !== null && !Number.isNaN(currentBill);
    const calculatedShiftSale = hasCurrentSysCash
      ? (S.mode === 'final' || !S.prev || S.prev.business_date !== S.date
          ? currentSysCash
          : currentSysCash - previousSysCash)
      : 0;
    const calculatedCustomers = S.prev && hasCurrentBill ? Math.max(0, currentBill - previousBill) : 0;
    const shiftSaleOverride = parseAmount(S.form.overrides.shift_sale);
    const customersOverride = parseAmount(S.form.overrides.customers);
    const shownShiftSale = shiftSaleOverride !== null && !Number.isNaN(shiftSaleOverride)
      ? shiftSaleOverride : calculatedShiftSale;
    const shownCustomers = customersOverride !== null && !Number.isNaN(customersOverride)
      ? customersOverride : calculatedCustomers;
    set('shiftInfo', `${money(shownShiftSale)} · ${shownCustomers}`);
    set('till', money(rupees(t.till), { decimals: true }));
    set('vault', money(rupees(t.vault), { decimals: true }));
    set('debt', money(rupees(t.debt), { decimals: true }));
    set('deposits', money(rupees(t.deposits), { decimals: true }));
    const p = S.preview;
    if (p && S.status === 'saved') {
      set('netSale', money(p.net_sale, { decimals: true }), p.net_sale < 0);
      set('shiftInfo', `${money(p.shift_sale, { decimals: true })} · ${p.customers}`);
    } else {
      set('netSale', S.status === 'saved' ? '–' : 'updates after saving');
      set('shiftInfo', '–');
    }
    if (p && S.status === 'saved') {
      const fig = previewFigures(p, S.period, S.form, S.mode);
      Object.entries(fig).forEach(([k, v]) => set(k, v.text, v.neg));
    } else {
      [
        'grand',
        'reserve',
        'liquid',
        'netCash',
        'bTarget',
        'bCash',
        'bVar',
        'fTarget',
        'fCash',
        'fVar',
        'shifts',
        'pSale',
        'pBooks',
        'pCust',
        'pMediq',
        'pManRet',
        'pSysRet',
        'finalNetSale',
        'finalNetCash',
        'pPre',
        'pExtra',
      ].forEach((k) => set(k, S.status === 'saved' ? '–' : 'updates after saving'));
    }
  }

  // ── events (delegated, so typing never redraws the page) ──
  el.addEventListener('input', (e) => {
    const i = e.target;
    if (i.dataset.f) setPath(i.dataset.f, i.value);
    else if (i.dataset.list) {
      const r = rowOf(i.dataset.list, i.dataset.id);
      if (!r) return;
      r[i.dataset.k] = i.value;
      const x = el.querySelector(`[data-extra="${r.id}"]`);
      if (x) x.textContent = money(rupees(rowExtra(r)));
      const l = el.querySelector(`[data-line="${r.id}"]`);
      if (l) l.textContent = money(rupees(stripLineTotal(r)));
    } else return;
    if (parseAmount(i.value) !== null && Number.isNaN(parseAmount(i.value)) && !i.classList.contains('cls-text'))
      i.setAttribute('aria-invalid', 'true');
    else if (!i.classList.contains('cls-text')) i.setAttribute('aria-invalid', 'false');
    touched();
  });
  // tapping a number box selects what is in it, so the first key replaces it (as in the old app)
  el.addEventListener('focusin', (e) => {
    const i = e.target;
    if (i.tagName === 'INPUT' && i.classList.contains('cls-in') && !i.readOnly && !i.classList.contains('cls-text'))
      setTimeout(() => i.select?.(), 0);
  });
  el.addEventListener('change', (e) => {
    if (e.target.id !== 'cls-staff') return;
    S.form.responsible_staff_id = e.target.value;
    touched();
  });
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button, #cls-chip');
    if (!b) return;
    if (b.id === 'cls-chip') {
      if (['failed', 'offline', 'dirty', 'invalid'].includes(S.status)) doSave();
      return;
    }
    if (b.dataset.jump !== undefined) return go(Number(b.dataset.jump), false);
    const act = b.dataset.act;
    if (act === 'prev' || act === 'next') {
      moveSection(act === 'next' ? 1 : -1);
      return;
    }
    if (act === 'sign') {
      const cur = String(S.form.credit_adj).trim();
      S.form.credit_adj = cur.startsWith('-') || cur.startsWith('−') ? cur.slice(1) : `-${cur}`;
      touched();
      return draw();
    }
    if (act === 'submit') return askSubmit();
    if (act === 'viewall') return viewAll();
    if (act === 'pdf' || act === 'pdf-open') return sheetPdf(act === 'pdf-open');
    if (act === 'leave') {
      return (S.status === 'saved' ? Promise.resolve() : doSave()).then(() => {
        const kept = S.status === 'saved' || S.status === 'offline';
        if (kept || globalThis.confirm('Your latest changes could not be saved. Leave anyway?')) location.hash = '#/closing';
      });
    }
    if (act === 'draft') {
      return doSave().then(() => {
        if (S.status === 'saved') toast('Draft saved ✓');
      });
    }
    if (act === 'signrow') {
      const r = rowOf(b.dataset.list, b.dataset.id);
      if (r) {
        const cur = String(r[b.dataset.k]).trim();
        r[b.dataset.k] = cur.startsWith('-') || cur.startsWith('−') ? cur.slice(1) : cur === '' ? '-' : `-${cur}`;
        touched();
        draw();
        el.querySelector(`input[data-id="${b.dataset.id}"][data-k="${b.dataset.k}"]`)?.focus();
      }
      return;
    }
    if (act === 'add-named') {
      const list = S.form.credit.named;
      const last = list.map((x) => x.account_id).lastIndexOf(b.dataset.acc);
      list.splice(last + 1, 0, namedEntry(b.dataset.acc, b.dataset.label));
      touched();
      return draw();
    }
    if (act === 'audit-toggle') return changeAudit(b.dataset.to === 'on');
    if (act === 'audit-sync') return auditSync();
    if (act === 'audit-verify') return auditVerify();
    if (act === 'add') {
      const list = b.dataset.list;
      listOf(list).push(
        emptyRow(
          list === 'mediq'
            ? { bill_no: '', collected: '', pharmacy_bill: '' }
            : list === 'strips'
              ? { strip_id: null, label: '', price: '', qty: '' }
              : list === 'credit.free'
                ? { line_id: null, label: '', amount: '' }
                : list === 'misc'
                  ? { charge_id: null, label: '', amount: '' }
                  : { label: '', amount: '' },
        ),
      );
      draw();
      return el.querySelector(`[data-list="${b.dataset.list}"]:last-of-type`)?.focus();
    }
    if (act === 'strike') {
      const r = rowOf(b.dataset.list, b.dataset.id);
      if (r) r.deleted = !r.deleted;
      touched();
      draw();
    }
  });
  window.addEventListener('online', () => {
    if (el.isConnected && S.status === 'offline') doSave();
  });

  draw();
  window.requestAnimationFrame?.(scrollToCards);
  if (S.status === 'dirty') queueSave(500);
  else refreshPreview();
}
