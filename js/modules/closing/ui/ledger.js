// The guided closing ledger (Session A: sections 1-5; Submit is not built yet).
// One page, one section at a time. Typing is kept in the form object and a local copy at once; the server copy is
// saved a moment later and the save chip always says which of the two is current.
import { html, render } from '../../../shared/html.js';
import { hero } from '../../../shared/ui.js';
import { longDate, money, parseAmount, shortDate } from '../../../shared/format.js';
import * as api from '../data/api.js';
import { conflictVersion, friendlyError } from '../domain/errors.js';
import {
  emptyForm,
  emptyRow,
  formFromRow,
  getPath,
  isSimplePath,
  listPayload,
  localTotals,
  mergeSimple,
  namedEntry,
  patchFields,
  payloadFromForm,
  rowExtra,
  rupees,
  sameText,
  simpleDiff,
  simpleTexts,
  stripLineTotal,
  namedShown,
  tierJoin,
} from '../domain/form.js';
import { overviewValue, prevTitle, snapshotRows } from '../domain/snapshot.js';
import { buildClosingBookPdf, pdfFileName } from '../domain/sheet.js';
import { SECTIONS, clampSection, sectionIndex } from '../domain/sections.js';
import { kindLabel, slotLabel, suggestNext } from '../domain/slots.js';
import { clearLocal, getOpen, loadLocal, saveLocal } from '../domain/store.js';
import { errorCard, focusHeading, keepFocus, loadingCard, openDialog, toast } from './parts.js';
import { saveBlob } from './book.js';
import { lateSections, previewFigures } from './sections-late.js';

const SAVE_DELAY = 2500;
// a single box is saved sooner, so what one person types shows up on the other device within a second or two
const SIMPLE_SAVE_DELAY = 800;
const SYNC_POLL_MS = 3000; // the safety-net check; with the live connection up it runs every SYNC_SLOW_EVERY ticks
const SYNC_SLOW_EVERY = 5;
let mountSeq = 0; // only the newest ledger screen keeps listening
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
  const myMount = ++mountSeq;
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
    staff, // active staff on the payroll list: the Name choices under every staff-credit group
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
    dirtySimple: new Set(), // single boxes typed here and not yet saved (closing_patch_draft)
    listDirty: false, // a list section (rows, cash counts, credit) typed here and not yet saved (closing_save_draft)
    listRev: 0,
    epoch: 0, // counts our own saves, so a check that started before one is never applied after it
    pendingPull: false,
    redraw: false,
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
    // Capture the local recovery snapshot before refreshing: the carry RPC may update
    // the row timestamp, but that must not make newer unsent typing look stale.
    const savedDraftUpdatedAt = row.updated_at;
    const local = loadLocal(S.key);
    // Reconcile carry-forward on every draft open. This is a server-side, idempotent
    // operation: it refreshes balances and merges outstanding misc charges without
    // replacing the cashier's saved fields or struck-through rows.
    if (!row.is_opening) {
      try {
        await api.refreshDraftCarry(row.id);
        row = await api.loadById(row.id);
      } catch (e) {
        return render(el, errorCard('this draft', friendlyError(e).message));
      }
    }
    adopt(row);
    // Typing that never reached the server (connection dropped) comes back if it is newer
    // than the saved draft. Merge in any newly carried misc rows from the refreshed server row.
    if (local?.dirty && local.version === S.version && local.form && local.savedAt > savedDraftUpdatedAt) {
      const localForm = local.form;
      const serverForm = S.form;
      const localMisc = Array.isArray(localForm.misc) ? localForm.misc : [];
      const haveCharges = new Set(localMisc.map((r) => r.charge_id).filter(Boolean));
      const newlyCarried = S.form.misc.filter((r) => r.charge_id && !haveCharges.has(r.charge_id));
      S.form = { ...localForm, misc: [...localMisc, ...newlyCarried] };
      // only the boxes that differ from the saved draft are re-sent, so boxes another device changed meanwhile are not overwritten
      S.dirtySimple = new Set(simpleDiff(S.form, serverForm));
      S.listDirty = true;
      S.status = 'dirty';
      toast('Restored your unsent typing and refreshed carried charges.');
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
    // only a state that can be retried is a working button; the rest are just the status text
    c.disabled = !['failed', 'offline', 'dirty', 'invalid', 'conflict'].includes(S.status);
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
    paintMarks();
    if (invalid.length) {
      S.status = 'invalid';
      return paintChip();
    }
    S.saving = true;
    S.status = 'saving';
    paintChip();
    try {
      // 1. the single boxes, one by one: no version check, so two people typing in different boxes never collide
      if (S.dirtySimple.size) {
        const paths = [...S.dirtySimple];
        const sent = Object.fromEntries(paths.map((path) => [path, getPath(S.form, path)]));
        const fields = patchFields(payload, paths);
        if (Object.keys(fields).length) await api.patchDraft({ key: S.key, fields });
        for (const path of paths) if (sameText(getPath(S.form, path), sent[path])) S.dirtySimple.delete(path);
        S.epoch += 1;
      }
      // 2. the list sections, whole, with the draft's version check (CLS-13)
      if (S.listDirty) {
        if (S.conflict) {
          S.saving = false;
          S.status = 'conflict';
          return onConflict(); // nothing more is sent on an old version until the person chooses
        }
        const rev = S.listRev;
        const res = await api.saveDraft({
          key: S.key,
          date: S.date,
          kind: S.kind,
          mode: S.mode,
          payload: listPayload(payload),
          handoverSeq: S.seq,
          expectedVersion: S.version,
        });
        S.version = res.version;
        if (S.listRev === rev) S.listDirty = false;
        S.epoch += 1;
      }
      if (!S.dirtySimple.size && !S.listDirty && !S.again) {
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
    if (S.pendingPull) {
      S.pendingPull = false;
      schedulePull(0);
    }
  }
  const queueSave = (ms = SAVE_DELAY) => {
    clearTimeout(S.timer);
    S.timer = setTimeout(doSave, ms);
  };

  function onConflict(e) {
    S.conflict = true;
    S.conflictErr = e ?? S.conflictErr;
    saveLocal(`${S.key}.mine`, { form: S.form, version: conflictVersion(S.conflictErr), dirty: false });
    paintChip();
    if (S.conflictDlg?.open) return; // one dialog at a time, however many saves were refused
    const dlg = openDialog(
      html`<h2>This draft was changed on another device</h2>
        <p>Someone saved a newer version. Choose which one to carry on with.</p>
        <div class="actions">
          <button type="button" class="btn" data-act="reload">Use the latest saved</button>
          <button type="button" class="btn btn-primary" data-act="keep">Keep what I typed</button>
        </div>
        <p class="cls-meta">“Keep what I typed” saves your version over the other one.</p>`,
      { label: 'Draft changed' },
    );
    S.conflictDlg = dlg;
    const resume = async (keepMine) => {
      const mine = S.form;
      dlg.close();
      try {
        const fresh = await api.loadById(S.id);
        adopt(fresh);
        S.epoch += 1;
        S.conflict = false;
        if (keepMine) {
          // the server row gives the new version and the carried figures; the typing stays as typed. Single boxes this device
          // did not type are taken from the server, so another device's newer figures are not overwritten by older ones.
          const have = new Set((mine.misc ?? []).map((r) => r.charge_id).filter(Boolean));
          const base = mergeSimple(mine, simpleTexts(fresh), { keep: S.dirtySimple }).form;
          S.form = { ...base, misc: [...(mine.misc ?? []), ...S.form.misc.filter((r) => r.charge_id && !have.has(r.charge_id))] };
          S.listDirty = true;
          S.status = 'dirty';
          keepLocal();
          queueSave(0);
        } else {
          S.dirtySimple.clear();
          S.listDirty = false;
          clearLocal(S.key);
          S.status = 'saved';
        }
      } catch (err) {
        toast(friendlyError(err).message, 'error');
      }
      draw();
      refreshPreview();
    };
    dlg.querySelector('[data-act="reload"]').addEventListener('click', () => resume(false));
    dlg.querySelector('[data-act="keep"]').addEventListener('click', () => resume(true));
  }

  let previewSeq = 0;
  async function refreshPreview() {
    const mine = ++previewSeq;
    try {
      const preview = await api.computePreview(S.id);
      const period = await api.periodFor(S.id).catch(() => S.period);
      if (mine !== previewSeq) return; // a newer request is on its way; never let an older answer overwrite it
      S.preview = preview;
      S.period = period;
    } catch {
      return; // the preview is a convenience; typing and saving carry on without it
    }
    paintTotals();
  }

  // ── live sync (migration 0217) ──
  // What another device types shows up here without a reload. A change heard live (or found by the safety-net check every few
  // seconds) makes this screen read the draft again: single boxes are laid over the form unless they were typed here and not
  // yet saved, or are the box the person is in; the list sections are replaced only when nothing in them was typed here.
  let stopWatch = null;
  let live = false;
  let tick = 0;
  let pollTimer = null;
  let pullTimer = null;
  let pulling = false;
  const schedulePull = (ms = 150) => {
    clearTimeout(pullTimer);
    pullTimer = setTimeout(pull, ms);
  };
  const onVisible = () => {
    if (document.visibilityState === 'visible') schedulePull(0);
  };
  const onOnline = () => schedulePull(0);
  function stopSync() {
    stopWatch?.();
    stopWatch = null;
    clearInterval(pollTimer);
    clearTimeout(pullTimer);
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('online', onOnline);
  }
  function startSync() {
    if (!S.id || S.opening) return; // the opening closing has one author at a time
    try {
      stopWatch = api.watchDraft(
        S.id,
        () => schedulePull(),
        (status) => {
          live = status === 'SUBSCRIBED';
          if (live) schedulePull(0);
        },
      );
    } catch {
      live = false;
    }
    pollTimer = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      tick += 1;
      if (!live || tick % SYNC_SLOW_EVERY === 0) pull();
    }, SYNC_POLL_MS);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
  }
  const stillHere = () => myMount === mountSeq && location.hash.startsWith('#/closing/ledger') && !S.done;
  // a redraw would drop the caret, so it waits until the person leaves the box they are typing in
  function redrawSoon() {
    const a = document.activeElement;
    if (el.contains(a) && a.tagName === 'INPUT') {
      S.redraw = true;
      return;
    }
    draw();
  }
  function remoteSubmitted() {
    if (S.submitting || S.done) return;
    stopSync();
    clearLocal(S.key);
    toast('This closing was submitted on another device.');
    location.hash = '#/closing';
  }
  function applySimple(row) {
    const a = document.activeElement;
    const skip = new Set();
    if (el.contains(a) && a.dataset?.f) skip.add(a.dataset.f);
    if (el.contains(a) && a.id === 'cls-staff') skip.add('responsible_staff_id');
    const { form, changed } = mergeSimple(S.form, simpleTexts(row), { keep: S.dirtySimple, skip });
    if (!changed.length) return;
    S.form = form;
    for (const path of changed) {
      const box = el.querySelector(path === 'responsible_staff_id' ? '#cls-staff' : `[data-f="${path}"]`);
      const text = getPath(form, path);
      if (box && box.value !== text) box.value = text;
    }
    if (S.status !== 'saved') keepLocal();
    paintTotals();
    refreshPreview();
  }
  async function applyLists(epoch) {
    const full = await api.loadById(S.id);
    if (!full || full.status !== 'draft' || S.saving || S.listDirty || epoch !== S.epoch || full.draft_version <= S.version) return;
    const fresh = formFromRow(full, strips, accounts);
    S.form = {
      ...S.form,
      mediq: fresh.mediq,
      hs: fresh.hs,
      strips: fresh.strips,
      till: fresh.till,
      vault: fresh.vault,
      misc: fresh.misc,
      deposits: fresh.deposits,
      credit: fresh.credit,
      opening: fresh.opening,
    };
    S.version = full.draft_version;
    S.carry = {
      cc: full.prev_cc,
      credit: full.prev_credit,
      deposits: full.prev_deposits,
      cash: full.prev_cash,
      from: full.source_closing_id,
    };
    if (S.status !== 'saved') keepLocal();
    redrawSoon();
    refreshPreview();
  }
  async function pull() {
    if (!stillHere()) return stopSync();
    if (pulling || S.saving) {
      S.pendingPull = true; // tried again when the save in flight (or the check in flight) is over
      return;
    }
    pulling = true;
    const epoch = S.epoch;
    try {
      const row = await api.loadSync(S.id);
      if (!row || !stillHere()) return;
      if (epoch !== S.epoch || S.saving) {
        S.pendingPull = true; // one of our own saves landed meanwhile: what was read may be older than it
        return;
      }
      if (row.status !== 'draft') return remoteSubmitted();
      applySimple(row);
      // a newer version means list sections changed elsewhere; if some were typed here, the next save asks which to keep (CLS-13)
      if (row.draft_version > S.version && !S.listDirty) await applyLists(epoch);
    } catch {
      /* offline or a blip: the next check tries again */
    } finally {
      pulling = false;
      if (S.pendingPull && !S.saving) {
        S.pendingPull = false;
        schedulePull(300);
      }
    }
  }
  el.addEventListener('focusout', (e) => {
    // catch up with whatever was skipped while the person was in a box
    if (e.target?.dataset?.f || e.target?.id === 'cls-staff') schedulePull(50);
    if (S.redraw) {
      setTimeout(() => {
        const a = document.activeElement;
        if (S.redraw && !(el.contains(a) && a.tagName === 'INPUT')) {
          S.redraw = false;
          draw();
        }
      }, 0);
    }
  });

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
  async function askSubmit() {
    if (S.submitting) return;
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
    // the review must show the figures of what is saved, not of the save before the last keystrokes
    if (S.status !== 'saved') {
      if (!(await settle())) {
        return toast(
          S.invalid.length ? 'Fix the marked fields first.' : 'Your draft is not saved yet. Check the connection and try again.',
          'error',
        );
      }
      await refreshPreview();
    }
    const p = S.preview;
    const final = S.mode === 'final';
    const v = p ? Number(final ? p.final_net_cash : p.shift_variance) : null;
    const tone = v === null ? 'ok' : varianceTone(v);
    const who = staff.find((x) => x.id === S.form.responsible_staff_id)?.name;
    const skipped = unopened();
    const dlg = openDialog(
      html`<h2>Review closing</h2>
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
        ${
          tone === 'bad'
            ? html`<p class="cls-warn cls-warn-bad" role="alert">
                <span aria-hidden="true">⛔</span> <strong>Large shortage. Stop and recount the till</strong>, then check credit and
                deposits. Submit only if the figure is confirmed.
              </p>`
            : tone === 'warn'
              ? html`<p class="cls-warn" role="alert">
                  <span aria-hidden="true">⚠</span> This is a shortage. Recount the till and check credit and deposits before submitting.
                </p>`
              : ''
        }
        ${skipped.length ? html`<p class="cls-warn">Some sections were not opened: ${skipped.join(', ')}. You can still submit, but check them first.</p>` : ''}
        <p class="cls-meta">After submitting, the closing is locked and the next shift picks up its carried values.</p>
        <div class="actions">
          <button type="button" class="btn" data-close>${tone === 'bad' ? 'Recount first' : 'Not yet'}</button>
          <button type="button" class="btn btn-primary" data-act="go">${tone === 'bad' ? 'Submit anyway' : 'Submit'}</button>
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
  // what the next person does, so the cashier can see the hand-over and stop
  const nextUp = () => {
    const n = suggestNext({ kind: S.kind, business_date: S.date });
    if (!n) return '';
    return html`<p class="cls-meta">Next up: ${kindLabel(n.kind)} closing${n.date !== S.date ? ` · ${shortDate(n.date)}` : ''}</p>`;
  };
  const successScreen = () =>
    html`<div class="cls">
      ${hero({ label: 'Closing', title: S.done.already ? 'Already submitted' : 'Closing submitted ✓', sub: `${slotLabel(S.kind, S.seq)} · ${longDate(S.date)}` })}
      <div class="card">
        <p>
          ${S.done.already ? 'This closing had already been submitted. Nothing was changed.' : 'Saved and locked. The next shift will pick up the carried card balance, credit, deposits and cash.'}
        </p>
        ${
          S.done.preview
            ? html`<div class="cls-done">
                <span class="cls-done-mark" aria-hidden="true">✓</span>
                <span class="cls-meta">Net cash</span>
                <span class="cls-done-figure">${money(S.done.preview.net_cash, { decimals: true })}</span>
                <p class="cls-meta">Net sale ${money(S.done.preview.net_sale, { decimals: true })}</p>
                ${nextUp()}
              </div>`
            : html`<div class="cls-done"><span class="cls-done-mark" aria-hidden="true">✓</span>${nextUp()}</div>`
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
  // `path` is the box typed in; a single box is saved on its own, anything else marks a list section as changed
  const touched = ({ path = null } = {}) => {
    const simple = path !== null && isSimplePath(path);
    if (simple) S.dirtySimple.add(path);
    else {
      S.listDirty = true;
      S.listRev += 1;
    }
    S.form = { ...S.form };
    S.status = S.conflict && S.listDirty ? 'conflict' : 'dirty';
    keepLocal();
    paintChip();
    paintTotals();
    queueSave(simple && !S.listDirty ? SIMPLE_SAVE_DELAY : SAVE_DELAY);
  };
  const listOf = (path) => path.split('.').reduce((o, p) => o[p], S.form);
  const rowOf = (list, id) => listOf(list).find((r) => r.id === id);

  // ── drawing ──
  const field = (path, label, { note = '', cls = '', placeholder = '' } = {}) => {
    const value = path.split('.').reduce((o, p) => o[p], S.form);
    return html`<div class="cls-row ${cls}">
      <label for="f-${path}">${label}${note ? html`<small>${note}</small>` : ''}</label>
      <input
        class="cls-in"
        id="f-${path}"
        data-f="${path}"
        inputmode="decimal"
        autocomplete="off"
        placeholder="${placeholder}"
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

  // "row 2" (or the item's own name for a fixed strip): what a screen reader says to tell the rows of a list apart
  const rowName = (list, r) => (list === 'strips' && r.strip_id ? r.label : `row ${listOf(list).indexOf(r) + 1}`);
  const textCell = (list, r, k, ph) =>
    html`<input
      class="cls-in cls-text"
      data-list="${list}"
      data-id="${r.id}"
      data-k="${k}"
      placeholder="${ph}"
      aria-label="${ph}, ${rowName(list, r)}"
      value="${r[k]}"
    />`;
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
      aria-label="${path}, ${rowName(list, r)}"
    />`;
  const strike = (list, r) =>
    html`<button
      type="button"
      class="icon-btn"
      data-act="strike"
      data-list="${list}"
      data-id="${r.id}"
      aria-label="${r.deleted ? 'Restore' : 'Strike out'} ${rowName(list, r)}"
      aria-pressed="${r.deleted ? 'true' : 'false'}"
      title="${r.deleted ? 'Restore' : 'Strike out'}"
    >
      <span aria-hidden="true">${r.deleted ? '↺' : '✕'}</span>
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

  const carried = (label, value) => {
    const id = `carried-${label.toLowerCase().replace(/[^a-z]+/g, '-')}`;
    return html`<div class="cls-row">
      <label for="${id}">${label}</label><input id="${id}" class="cls-in is-carried" readonly value="${money(value)}" />
    </div>`;
  };

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
              ${carried('Card balance', S.carry.cc)} ${carried('Credit', S.carry.credit)} ${carried('Deposits', S.carry.deposits)}
              ${carried('Cash', S.carry.cash)}`
          : ''
      }`;

  const sectionHs = () =>
    html`<h2>4 · HS</h2>
      <div class="cls-table" style="--cols: 1">
        ${S.form.hs.map(
          (r) =>
            html`<div class="cls-trow cls-trow-1 ${r.deleted ? 'is-struck' : ''}" style="--cols: 1">
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
      <div class="cls-table cls-table-strips" style="--cols: 3">
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
        aria-label="Reduction (negative) for ${label}, ${rowName(list, r)}"
        aria-pressed="${/^[-−]/.test(String(r[k]).trim()) ? 'true' : 'false'}"
      >
        <span aria-hidden="true">±</span>
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
    if (S.prevError)
      return html`<section class="card cls-prev">
        <div class="cls-meta">Previous closing preview could not be loaded: ${S.prevError}</div>
      </section>`;
    if (!S.prev) return html`<section class="card cls-prev"><div class="cls-meta">No previous closing on record yet.</div></section>`;
    const rows = snapshotRows(def.key, S.prev);
    return html`<section class="card cls-prev" aria-label="Previous closing">
      <div class="cls-prev-head" role="heading" aria-level="3"><span aria-hidden="true">📋</span> ${prevTitle(S.prev)}</div>
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
      html`<h2>All sections</h2>
        <p class="cls-meta">Typed so far. Tap a section to go to it.</p>
        <ul class="cls-list cls-viewall">
          ${SECTIONS.map(
            (sec, i) =>
              html`<li>
                <button type="button" class="cls-va-row" data-go="${i}" aria-current="${i === S.section ? 'step' : 'false'}">
                  <span><span aria-hidden="true">${sec.icon}</span> ${sec.label}</span
                  ><strong>${overviewValue(sec.key, t, S.form) || '—'}</strong>
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
    if (S.done) {
      render(el, successScreen());
      return focusHeading(el.querySelector('.htitle'));
    }
    return keepFocus(el, paint);
  }
  function paint() {
    const pct = Math.round(((S.section + 1) / SECTIONS.length) * 100);
    const last = S.section === SECTIONS.length - 1;
    render(
      el,
      html`<div class="cls cls-swipe">
        <div class="cls-titlebar">
          <button type="button" class="btn btn-sm" data-act="leave" aria-label="Back to days">
            <span aria-hidden="true">‹</span> Days
          </button>
          <div class="cls-tb-text">
            <h1 class="cls-tb-title">${slotLabel(S.kind, S.seq)} closing</h1>
            <p class="cls-tb-sub">${longDate(S.date)} · ${S.opening ? 'Opening' : S.mode === 'final' ? 'Final' : 'Shift'}</p>
          </div>
          <span class="cls-status" role="status" aria-live="polite"><button type="button" id="cls-chip" class="cls-chip"></button></span>
        </div>
        <div class="cls-anchor" aria-hidden="true"></div>
        <div class="cls-bar">
          <p class="cls-step">
            <span><strong>${S.section + 1} of ${SECTIONS.length}</strong> · ${SECTIONS[S.section].label}</span>
            ${S.section === 0 ? html`<span class="cls-swipe-hint" aria-hidden="true">‹ swipe ›</span>` : ''}
          </p>
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
          <p id="cls-errors" class="cls-warn" role="alert"></p>
          ${
            /* the responsible person is only needed at submit, so it sits with the Submit button instead of taking the top of all 14 screens */
            last
              ? html`<section class="card">
                  <div class="cls-row">
                    <label for="cls-staff">Responsible staff</label>
                    <select id="cls-staff" class="cls-in">
                      <option value="">Choose…</option>
                      ${staff.map((s) => html`<option value="${s.id}" ${s.id === S.form.responsible_staff_id ? 'selected' : ''}>${s.name}</option>`)}
                    </select>
                  </div>
                  ${S.showWarn && !S.form.responsible_staff_id ? html`<p class="cls-warn" role="alert">Required before submitting.</p>` : ''}
                </section>`
              : ''
          }
          <section class="card cls-sec">${sectionBody()}</section>
        </div>
        ${prevCard()}
        <div class="cls-tools">
          <button type="button" class="btn" data-act="draft"><span aria-hidden="true">💾</span> Save as Draft</button>
          <button type="button" class="btn" data-act="viewall"><span aria-hidden="true">⊞</span> View all</button>
        </div>
        <p class="cls-meta">Back to days saves your draft first. Continue it later from the calendar or Saved records.</p>
        <div class="cls-nav">
          <button type="button" class="btn" data-act="prev" ${S.section === 0 ? 'disabled' : ''}>
            <span aria-hidden="true">←</span> Back
          </button>
          ${
            S.section === SECTIONS.length - 1
              ? html`<button type="button" class="btn btn-primary" data-act="submit" ${S.submitting ? 'disabled' : ''}>
                  Submit closing
                </button>`
              : html`<button type="button" class="btn btn-primary" data-act="next">Next <span aria-hidden="true">→</span></button>`
          }
        </div>
      </div>`,
    );
    paintChip();
    paintTotals();
    paintMarks();
    paintOffsets();
  }

  // The progress bar and section pills are sticky: they must stop below the (also sticky) app header, whatever its height is on this
  // screen, and the pill of the current section must be inside the scrolling row.
  function paintOffsets() {
    const root = el.querySelector('.cls');
    const header = document.querySelector('.app-header');
    if (root && header) root.style.setProperty('--cls-hdr', `${header.offsetHeight}px`);
    const row = el.querySelector('.cls-jump');
    const now = row?.querySelector('[aria-current="step"]');
    if (row && now) row.scrollLeft = Math.max(0, now.offsetLeft - (row.clientWidth - now.offsetWidth) / 2);
  }
  const onResize = () => {
    // this page was left: stop listening
    if (!el.isConnected || !el.querySelector('.cls-bar')) return window.removeEventListener('resize', onResize);
    paintOffsets();
  };
  window.addEventListener('resize', onResize);

  // Bring the section cards (progress bar, jump chips, card) to the top of the screen,
  // so the hero and the back link are scrolled past instead of the person landing on them.
  const scrollToCards = () => {
    const anchor = el.querySelector('.cls-anchor');
    if (anchor?.scrollIntoView) anchor.scrollIntoView({ block: 'start' });
    else window.scrollTo?.(0, 0);
  };
  const go = (i, scroll = true) => {
    const changed = clampSection(i) !== S.section;
    S.section = clampSection(i);
    S.seen.add(S.section);
    draw();
    if (changed) focusHeading(el.querySelector('.cls-sec h2'));
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
    // red borders alone do not tell everyone which fields are wrong: say it in words too
    const box = el.querySelector('#cls-errors');
    if (!box) return;
    const names = [...el.querySelectorAll('[aria-invalid="true"]')]
      .map((n) => n.getAttribute('aria-label') || el.querySelector(`label[for="${n.id}"]`)?.firstChild?.textContent?.trim())
      .filter(Boolean);
    const elsewhere = S.invalid.length - names.length;
    box.textContent = S.invalid.length
      ? `Fix the marked fields${names.length ? `: ${names.join('; ')}` : ''}${elsewhere > 0 ? ` (${elsewhere} in other sections)` : ''}.`
      : '';
  }

  // Mirrors closing_calc: a Final, a new business day, or no previous closing uses the whole POS figure; otherwise the
  // difference from the previous closing. Customers are the bill-number difference (never below 0), 0 with no previous closing.
  // When the closing DOES have a previous one but its figures could not be read (S.prev is null), nothing is guessed:
  // the server's own calculation is used once the draft is saved, and until then the figure is simply not shown.
  function calculatedDeltas() {
    const hasPrev = Boolean(S.carry?.from);
    if (hasPrev && !S.prev) {
      const p = S.preview;
      return p && S.status === 'saved' && p.shift_sale !== undefined
        ? { sale: Number(p.shift_sale), customers: Number(p.customers) }
        : null;
    }
    const previous = S.prev?.inputs ?? {};
    const sys = parseAmount(S.form.sys_cash);
    const bill = parseAmount(S.form.last_bill_no);
    const has = (v) => v !== null && !Number.isNaN(v);
    const wholeFigure = S.mode === 'final' || !S.prev || S.prev.business_date !== S.date;
    return {
      sale: has(sys) ? (wholeFigure ? sys : sys - (Number(previous.sys_cash) || 0)) : 0,
      customers: S.prev && has(bill) ? Math.max(0, Math.trunc(bill) - Math.trunc(Number(previous.last_bill_no) || 0)) : 0,
    };
  }

  function paintTotals() {
    const t = localTotals(S.form, S.carry ?? {});
    const set = (k, text, neg = false) => {
      // a figure can appear twice on one page (the Final section repeats Net Final Sale): fill every one
      el.querySelectorAll(`[data-total="${k}"]`).forEach((n) => {
        n.textContent = text;
        n.classList.toggle('cls-neg', neg);
      });
    };
    set('hs', money(rupees(t.hs), { decimals: true }));
    set('strips', money(rupees(t.strips), { decimals: true }));
    set('mediqExtra', money(rupees(t.mediqExtra), { decimals: true }));
    set('returns', money(rupees(t.returns), { decimals: true }));
    set('misc', money(rupees(t.misc), { decimals: true }));
    set('ccTotal', money(rupees(t.ccTotal), { decimals: true }));
    set('currCC', money(rupees(t.ccCurr), { decimals: true }));
    // The calculated deltas (this shift's sale and customers). The override boxes show them as their placeholder, so the
    // figure is visible even while the box is empty ("empty = use the calculated figure").
    const d = calculatedDeltas();
    const shiftSaleOverride = parseAmount(S.form.overrides.shift_sale);
    const customersOverride = parseAmount(S.form.overrides.customers);
    const typed = (v) => v !== null && !Number.isNaN(v);
    const shownShiftSale = typed(shiftSaleOverride) ? shiftSaleOverride : (d?.sale ?? null);
    const shownCustomers = typed(customersOverride) ? customersOverride : (d?.customers ?? null);
    const hint = (k, text) => {
      const n = el.querySelector(`[data-f="overrides.${k}"]`);
      if (n) n.setAttribute('placeholder', text);
    };
    hint('shift_sale', d ? money(d.sale, { decimals: true }) : '');
    hint('customers', d ? String(d.customers) : '');
    set('till', money(rupees(t.till), { decimals: true }));
    set('vault', money(rupees(t.vault), { decimals: true }));
    set('debt', money(rupees(t.debt), { decimals: true }));
    set('deposits', money(rupees(t.deposits), { decimals: true }));
    const p = S.preview;
    if (p && S.status === 'saved') {
      set('netSale', money(p.net_sale, { decimals: true }), p.net_sale < 0);
    } else {
      set('netSale', S.status === 'saved' ? '–' : 'updates after saving');
    }
    set(
      'shiftInfo',
      shownShiftSale === null || shownCustomers === null
        ? 'updates after saving'
        : `${money(shownShiftSale, { decimals: true })} · ${shownCustomers}`,
    );
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
      if (i.dataset.list === 'credit.tier' && (i.dataset.k === 'group' || i.dataset.k === 'person')) r.label = tierJoin(r.group, r.person);
      const x = el.querySelector(`[data-extra="${r.id}"]`);
      if (x) x.textContent = money(rupees(rowExtra(r)));
      const l = el.querySelector(`[data-line="${r.id}"]`);
      if (l) l.textContent = money(rupees(stripLineTotal(r)));
    } else return;
    if (parseAmount(i.value) !== null && Number.isNaN(parseAmount(i.value)) && !i.classList.contains('cls-text'))
      i.setAttribute('aria-invalid', 'true');
    else if (!i.classList.contains('cls-text')) i.setAttribute('aria-invalid', 'false');
    touched(i.dataset.f ? { path: i.dataset.f } : {});
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
    touched({ path: 'responsible_staff_id' });
  });
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button, #cls-chip');
    if (!b) return;
    if (b.id === 'cls-chip') {
      if (S.status === 'conflict') onConflict();
      else if (['failed', 'offline', 'dirty', 'invalid'].includes(S.status)) doSave();
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
      touched({ path: 'credit_adj' });
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
        else if (S.status === 'invalid') toast('Fix the marked fields first.', 'error');
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
      // an account with nothing typed shows only its name: the first tap opens its (empty) first row, later taps add more
      const hidden = list.find((x) => x.account_id === b.dataset.acc && !namedShown(x));
      if (hidden) {
        hidden.shown = true;
        draw();
        return el.querySelector(`[data-list="credit.named"][data-id="${hidden.id}"]`)?.focus();
      }
      const last = list.map((x) => x.account_id).lastIndexOf(b.dataset.acc);
      const entry = { ...namedEntry(b.dataset.acc, b.dataset.label), shown: true };
      list.splice(last + 1, 0, entry);
      touched();
      draw();
      return el.querySelector(`[data-list="credit.named"][data-id="${entry.id}"]`)?.focus();
    }
    if (act === 'audit-toggle') return changeAudit(b.dataset.to === 'on');
    if (act === 'audit-sync') return auditSync();
    if (act === 'audit-verify') return auditVerify();
    if (act === 'add') {
      const list = b.dataset.list;
      const row = emptyRow(
        list === 'mediq'
          ? { bill_no: '', collected: '', pharmacy_bill: '' }
          : list === 'strips'
            ? { strip_id: null, label: '', price: '', qty: '' }
            : list === 'credit.free'
              ? { line_id: null, label: '', amount: '' }
              : list === 'misc'
                ? { charge_id: null, label: '', amount: '' }
                : { label: '', amount: '' },
      );
      listOf(list).push(row);
      draw();
      // focus the first box of the row just added (the old selector found the first row's last box instead)
      return el.querySelector(`[data-list="${list}"][data-id="${row.id}"]`)?.focus();
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
  startSync();
}
