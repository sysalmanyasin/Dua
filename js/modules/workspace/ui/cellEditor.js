// The edit bar above the grid: shows the selected cell's content and, for people who may edit, lets them change it.
// It owns the draft and the save, and follows these rules (they exist so nothing is lost or overwritten without the person
// knowing):
//  * A draft is never dropped silently. Moving to another cell with unsaved text is refused (the screen says why).
//  * The base for a save is the version the edit STARTED from, not the newest one. If someone else changes the cell while
//    the draft is open and it is pulled in, saving still meets their change as a conflict instead of overwriting it.
//  * A save that got no answer is kept and sent again with the same operation id (D-45) and the box is locked until it is
//    answered, because a reply lost after the server applied the change would otherwise make the person conflict with
//    their own edit. "Discard" is explicit and says what that means.
//  * A conflict shows the other person's value and lets the person choose: use mine (sent again from a current copy) or
//    keep theirs.
// All text is set with textContent / .value, never as markup.
import { buildCellEdit, editState, parseCellInput } from '../domain/cellInput.js';

const make = (tag, className, parent, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  if (parent) parent.append(node);
  return node;
};
const norm = (t) => t.replace(/\r\n?/g, '\n');
// What a formula cell currently shows (its calculated result), or null for any other cell.
const shownOf = (info) => (info.formula !== null && info.formula !== undefined ? info.text : null);
const shorten = (t) => ([...t].length > 80 ? `${[...t].slice(0, 80).join('')}…` : t);

// deps: getSheet() -> the sheet shown; getHeadSeq() -> how far the local copy is current; sender -> createOperationSender;
// canEdit() -> boolean; refresh() -> pulls and redraws (async); notify(text) -> a message for the screen;
// blocked() -> a reason a NEW save cannot start now (a sheet change is still waiting in the shared sender), or '';
// afterEnter() -> called after Enter saved the cell (the screen moves down one row).
export function createCellEditor(
  bar,
  { getSheet, getHeadSeq, sender, canEdit, refresh, notify = () => {}, blocked = () => '', afterEnter = () => {} },
) {
  bar.classList.add('ws-formula');
  const label = make('span', 'ws-formula-label', bar, '—');
  const box = make('textarea', 'ws-edit-input', bar);
  box.rows = 1;
  box.autocomplete = 'off';
  box.autocapitalize = 'off';
  box.spellcheck = false;
  box.setAttribute('aria-label', 'Cell content');
  const actions = make('div', 'ws-edit-actions', bar);
  const save = make('button', 'btn btn-primary btn-sm', actions, 'Save');
  save.type = 'button';
  save.dataset.edit = 'save';
  const cancel = make('button', 'btn btn-sm', actions, 'Cancel');
  cancel.type = 'button';
  cancel.dataset.edit = 'cancel';
  const result = make('p', 'ws-edit-result', bar); // what a formula cell currently shows
  const msg = make('p', 'ws-edit-msg', bar);
  msg.setAttribute('role', 'status');
  const choice = make('div', 'ws-edit-choice', bar);
  const mine = make('button', 'btn btn-primary btn-sm', choice, 'Use mine');
  mine.type = 'button';
  mine.dataset.edit = 'use-mine';
  const theirs = make('button', 'btn btn-sm', choice, 'Keep theirs');
  theirs.type = 'button';
  theirs.dataset.edit = 'keep-theirs';

  let cell = null; // { rowId, colId, label }
  let ed = null; // { original, draft, editable, reason, baseSeq, locked, conflict, busy, message }

  const key = () => `${cell.rowId}:${cell.colId}`;
  const stored = () => getSheet()?.cells.get(key()) ?? null;
  const dirty = () => ed !== null && ed.draft !== ed.original;
  const unsaved = () => ed !== null && (dirty() || ed.locked || ed.conflict !== null || ed.busy);

  function begin() {
    const st = editState(stored());
    ed = {
      original: norm(st.text),
      draft: norm(st.text),
      editable: st.editable && canEdit(),
      reason: canEdit() && !st.editable ? st.reason : '',
      baseSeq: getHeadSeq(),
      locked: false,
      conflict: null,
      busy: false,
      message: '',
    };
    box.value = ed.draft;
  }

  function paint() {
    if (!cell || !ed) {
      label.textContent = '—';
      box.value = '';
      box.placeholder = 'Tap a cell to see what it holds';
      box.disabled = true;
      box.readOnly = false;
      actions.hidden = true;
      msg.textContent = '';
      msg.hidden = true;
      result.hidden = true;
      choice.hidden = true;
      box.rows = 1;
      return;
    }
    label.textContent = cell.label;
    box.disabled = false;
    box.placeholder = '';
    box.readOnly = !ed.editable || ed.locked || ed.busy || ed.conflict !== null;
    box.rows = Math.min(Math.max(box.value.split('\n').length, 1), 4);
    // in a conflict the choice buttons below replace Save and Cancel
    const showActions = ed.editable && (dirty() || ed.locked || ed.conflict !== null) && ed.conflict?.kind !== 'cell';
    actions.hidden = !showActions;
    save.disabled = ed.busy || ed.conflict !== null || (!dirty() && !ed.locked);
    save.textContent = ed.locked ? 'Try again' : ed.busy ? 'Saving…' : 'Save';
    cancel.disabled = ed.busy;
    cancel.textContent = ed.locked ? 'Discard' : 'Cancel';
    msg.textContent = ed.message || ed.reason;
    msg.hidden = msg.textContent === '';
    result.hidden = cell.shown === null || cell.shown === undefined;
    if (!result.hidden) result.textContent = `Shows: ${cell.shown === '' ? '(empty)' : cell.shown}`;
    choice.hidden = ed.conflict === null || ed.conflict.kind !== 'cell';
    mine.disabled = ed.busy;
    theirs.disabled = ed.busy;
  }

  // The screen tells the editor which cell is selected (info = null for none). Returns false when it must stay on the cell
  // being edited because there is unsaved text.
  function select(info) {
    const same = info && cell && info.rowId === cell.rowId && info.colId === cell.colId;
    if (unsaved() && !same) {
      if (info) return false;
      const lost = ed.draft;
      const where = cell.label;
      ed = null;
      cell = null;
      paint();
      notify(`Your change to ${where} was not saved because that cell no longer exists. You had typed: ${shorten(lost)}`);
      return true;
    }
    if (!info) {
      cell = null;
      ed = null;
    } else if (!same) {
      cell = { rowId: info.rowId, colId: info.colId, label: info.label, shown: shownOf(info) };
      begin();
    } else {
      cell.label = info.label;
      cell.shown = shownOf(info);
      if (ed) refreshContent();
      else begin(); // the same cell again after its change was saved: show what it holds now
    }
    paint();
    return true;
  }

  // The cell's stored content may have changed (a refresh). Untouched drafts follow it; a draft in progress is left alone.
  function refreshContent() {
    if (!ed || unsaved()) return;
    const was = ed.original;
    begin();
    if (ed.original === was) box.value = ed.draft;
  }

  // Resolves true when the change was applied, false for anything else (the reason is shown in the bar).
  async function doSave() {
    if (!ed || ed.busy) return false;
    if (!ed.locked) {
      const why = blocked();
      if (why) {
        ed.message = why;
        paint();
        return false;
      }
      const parsed = parseCellInput(ed.draft);
      if (parsed.kind === 'invalid') {
        ed.message = parsed.reason;
        paint();
        return false;
      }
      const sheet = getSheet();
      if (!sheet) return false;
      try {
        sender.enqueue(buildCellEdit(sheet, cell.rowId, cell.colId, parsed, ed.baseSeq));
      } catch (e) {
        ed.message = e.message;
        paint();
        return false;
      }
    }
    ed.busy = true;
    ed.message = '';
    paint();
    let r;
    try {
      r = await sender.flush();
    } catch (e) {
      r = { status: 'refused', error: e };
    }
    ed.busy = false;

    if (r.status === 'answered') {
      const res = r.results[0].result;
      const outcome = res.status === 'duplicate' ? res.original_status : res.status;
      ed.locked = false;
      if (outcome === 'applied') {
        ed = null;
        await refresh(); // pulls the person's own change like anyone else's and redraws (which re-selects this cell)
        if (ed === null && cell) {
          begin();
          paint();
        }
        return true;
      }
      if (outcome === 'conflict') {
        const kind = res.conflicts?.[0]?.kind ?? 'cell';
        await refresh(); // brings in what the other person did
        if (!ed) return false; // the cell is gone: select() already told the person and kept their text in the message
        if (kind === 'structure') {
          // Rows or columns changed since this copy was current, so a formula typed here may point at the wrong cells. The copy was
          // just refreshed: keep what was typed, rebase on the new version, and let the person check it and save again.
          ed.baseSeq = getHeadSeq();
          ed.conflict = null;
          ed.message =
            'Rows or columns of this sheet changed while you were typing, so your formula was not saved: it could point at the wrong cells. The sheet was refreshed. Check the formula against it, then save again.';
          paint();
          return false;
        }
        if (kind === 'cell') {
          const their = shorten(editState(stored()).text) || 'nothing (the cell is empty)';
          ed.conflict = { kind };
          ed.message = `Someone else changed ${cell.label} while you were editing. Their version: ${their}. Your version: ${shorten(ed.draft) || 'nothing'}.`;
        } else {
          ed.conflict = { kind };
          ed.message = 'Someone deleted this row or column, so your change was not saved. Cancel to continue.';
        }
        paint();
        return false;
      }
      ed.message = res.reason ?? 'The change was not accepted.';
      paint();
      return false;
    }
    if (r.status === 'offline') {
      ed.locked = true; // the same change is resent when the person taps Try again
      ed.message = 'You seem to be offline, so your change is not saved yet. Try again when you are back online.';
      paint();
      return false;
    }
    sender.takeRefused();
    ed.locked = false;
    ed.message = r.error?.message ?? 'Your change was not saved.';
    paint();
    return false;
  }

  // True when there is typed text that can be saved right now (moving to another cell saves it, as in Excel).
  const canCommit = () => ed !== null && ed.editable && dirty() && !ed.locked && ed.conflict === null && !ed.busy;

  // Puts the cursor in the box (the keyboard opens on a phone). `replaceWith` starts the text afresh: typing on a
  // selected cell replaces what it held.
  function focusBox(replaceWith) {
    if (!cell || !ed) return;
    if (replaceWith !== undefined && ed.editable && !ed.locked && !ed.busy && ed.conflict === null) {
      ed.draft = replaceWith;
      ed.message = '';
      box.value = replaceWith;
    }
    paint();
    box.focus();
    if (!box.readOnly) box.setSelectionRange(box.value.length, box.value.length);
  }

  function doCancel() {
    if (!ed || ed.busy) return;
    const wasLocked = ed.locked;
    if (wasLocked) {
      sender.discardAll();
      notify('Discarded. If that change had already reached the server, Refresh will show it.');
    }
    ed = null;
    begin();
    paint();
  }

  function useMine() {
    if (!ed || ed.conflict?.kind !== 'cell') return;
    ed.conflict = null;
    ed.baseSeq = getHeadSeq(); // they have now seen the other person's version and chose to replace it
    ed.message = '';
    doSave();
  }

  box.addEventListener('input', () => {
    if (!ed) return;
    ed.draft = norm(box.value);
    ed.message = '';
    paint();
  });
  box.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      if (!dirty() && !ed?.locked) return afterEnter(); // nothing typed: Enter just moves down
      doSave().then((ok) => {
        if (ok) afterEnter();
      });
    } else if (e.key === 'Escape' && ed && ed.editable) {
      e.preventDefault();
      doCancel();
    }
    return undefined;
  });
  bar.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-edit]');
    if (!b) return;
    if (b.dataset.edit === 'save') doSave();
    else if (b.dataset.edit === 'cancel') doCancel();
    else if (b.dataset.edit === 'use-mine') useMine();
    else if (b.dataset.edit === 'keep-theirs') doCancel();
  });

  paint();
  return {
    select,
    hasUnsaved: unsaved,
    canCommit,
    commit: () => (canCommit() ? doSave() : Promise.resolve(false)),
    focus: focusBox,
    where: () => cell?.label ?? '',
    cell: () => (cell ? { ...cell } : null),
  };
}
