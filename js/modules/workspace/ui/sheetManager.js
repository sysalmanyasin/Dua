// The "Sheets" panel: add, rename, move earlier or later, and delete sheets. It makes no network calls itself: every
// change is handed to `run(op)` (ui/sheet.js, which owns the operation sender) and the answer is shown in words.
// Buttons rather than dragging, so it works with a thumb, a keyboard and a screen reader.
import {
  addSheetOp,
  canAddSheet,
  canDeleteSheet,
  checkSheetName,
  deleteSheetOp,
  MAX_NAME,
  MAX_SHEETS,
  moveSheet,
  renameSheetOp,
  reorderSheetsOp,
  suggestSheetName,
} from '../domain/sheetManage.js';
import { askText, confirmAction, openPanel } from './panel.js';

function button(text, { label = null, act, id = null, disabled = false, danger = false } = {}) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = danger ? 'btn btn-sm ws-danger-text' : 'btn btn-sm';
  b.textContent = text;
  if (label) b.setAttribute('aria-label', label);
  b.dataset.act = act;
  if (id) b.dataset.sheet = id;
  b.disabled = disabled;
  return b;
}

// getSheets() -> live sheets in display order; getActiveId() -> id of the sheet on screen; canEdit() -> boolean.
// run(op) -> Promise<{ kind: 'applied' | 'failed' | 'offline' | 'refused' | 'blocked' | 'other', message }>.
// guardDelete(sheet) -> a reason the sheet cannot be deleted right now (for example unsaved text on it), or ''.
// notify(text) shows a message on the page behind the panel.
export function createSheetManager({ getSheets, getActiveId, canEdit, run, guardDelete = () => '', notify = () => {} }) {
  let panel = null;
  let status = '';
  let busy = false;
  let refocus = null;

  const say = (text) => {
    status = text;
    if (panel?.isOpen()) draw();
    else if (text) notify(text);
  };

  async function perform(op, doneText) {
    busy = true;
    if (panel?.isOpen()) draw();
    let r;
    try {
      r = await run(op);
    } catch (e) {
      r = { kind: 'failed', message: e.message };
    }
    busy = false;
    say(r.kind === 'applied' ? doneText : r.message);
    return r;
  }

  // Asks for a name until it is usable or the person cancels. Returns the clean name or null.
  async function askName({ title, confirmLabel, value, exceptId = null }) {
    let current = value;
    let label = 'Sheet name';
    for (;;) {
      const raw = await askText({ title, label, value: current, confirmLabel, maxLength: MAX_NAME });
      if (raw === null) return null;
      const checked = checkSheetName(raw, getSheets(), exceptId);
      if (checked.ok) return checked.name;
      current = raw;
      label = `${checked.reason} Sheet name`;
    }
  }

  async function addSheet() {
    if (!canEdit() || busy) return;
    const can = canAddSheet(getSheets());
    if (!can.ok) return say(can.reason);
    const name = await askName({ title: 'Add a sheet', confirmLabel: 'Add', value: suggestSheetName(getSheets()) });
    if (name === null) return;
    const again = canAddSheet(getSheets());
    if (!again.ok) return say(again.reason);
    await perform(addSheetOp(name), `Added the sheet ${name}.`);
  }

  async function renameSheet(id) {
    const sheet = getSheets().find((s) => s.id === id);
    if (!sheet || !canEdit() || busy) return;
    const name = await askName({ title: 'Rename sheet', confirmLabel: 'Rename', value: sheet.name, exceptId: id });
    if (name === null || name === sheet.name) return;
    await perform(renameSheetOp(id, name), `Renamed the sheet to ${name}.`);
  }

  async function moveOne(id, direction) {
    if (!canEdit() || busy) return;
    const order = moveSheet(getSheets(), id, direction);
    if (!order) return;
    const name = getSheets().find((s) => s.id === id)?.name ?? 'The sheet';
    refocus = { act: direction < 0 ? 'earlier' : 'later', id };
    await perform(reorderSheetsOp(order), `${name} moved ${direction < 0 ? 'earlier' : 'later'}.`);
  }

  async function deleteOne(id) {
    const sheet = getSheets().find((s) => s.id === id);
    if (!sheet || !canEdit() || busy) return;
    const can = canDeleteSheet(getSheets());
    if (!can.ok) return say(can.reason);
    const blocked = guardDelete(sheet);
    if (blocked) return say(blocked);
    const yes = await confirmAction({
      title: `Delete ${sheet.name}?`,
      message: `This removes the sheet ${sheet.name} and everything on it, for everyone who has this workbook. It cannot be undone from here.`,
      confirmLabel: 'Delete sheet',
      danger: true,
    });
    if (!yes) return;
    await perform(deleteSheetOp(id), `Deleted the sheet ${sheet.name}.`);
  }

  function draw() {
    if (!panel?.isOpen()) return;
    const sheets = getSheets();
    const editable = canEdit();
    const body = panel.body;
    const list = document.createElement('ol');
    list.className = 'ws-sheet-list';
    sheets.forEach((sheet, i) => {
      const item = document.createElement('li');
      item.className = 'ws-sheet-row';
      const name = document.createElement('span');
      name.className = 'ws-sheet-name ws-grow';
      name.textContent = sheet.name;
      if (sheet.id === getActiveId()) {
        const here = document.createElement('span');
        here.className = 'pill ws-role';
        here.textContent = 'Open';
        name.append(' ', here);
      }
      item.append(name);
      if (editable) {
        item.append(
          button('Rename', { act: 'rename', id: sheet.id, label: `Rename ${sheet.name}`, disabled: busy }),
          button('↑', { act: 'earlier', id: sheet.id, label: `Move ${sheet.name} earlier`, disabled: busy || i === 0 }),
          button('↓', { act: 'later', id: sheet.id, label: `Move ${sheet.name} later`, disabled: busy || i === sheets.length - 1 }),
          button('Delete', {
            act: 'delete',
            id: sheet.id,
            label: `Delete ${sheet.name}`,
            disabled: busy || sheets.length <= 1,
            danger: true,
          }),
        );
      }
      list.append(item);
    });
    const count = document.createElement('p');
    count.className = 'muted';
    count.textContent = `${sheets.length} of ${MAX_SHEETS} sheets.`;
    const note = document.createElement('p');
    note.className = 'ws-banner';
    note.setAttribute('role', 'status');
    note.hidden = !status;
    note.textContent = status;
    const parts = [note, list, count];
    if (editable) {
      const add = button('Add a sheet', { act: 'add', disabled: busy || sheets.length >= MAX_SHEETS });
      add.classList.add('btn-primary');
      parts.push(add);
    } else {
      const p = document.createElement('p');
      p.className = 'muted';
      p.textContent = 'You can view this workbook but not change its sheets.';
      parts.push(p);
    }
    body.replaceChildren(...parts);
    if (refocus && !busy) {
      const again = body.querySelector(`[data-act="${refocus.act}"][data-sheet="${refocus.id}"]:not(:disabled)`);
      (again ?? body.querySelector('.ws-sheet-row button:not(:disabled)') ?? body.querySelector('button'))?.focus();
      refocus = null;
    }
  }

  function open() {
    if (panel?.isOpen()) return;
    status = '';
    panel = openPanel({ title: 'Sheets', wide: true });
    panel.body.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-act]');
      if (!b || !panel.body.contains(b)) return;
      const { act, sheet } = b.dataset;
      if (act === 'add') addSheet();
      else if (act === 'rename') renameSheet(sheet);
      else if (act === 'earlier') moveOne(sheet, -1);
      else if (act === 'later') moveOne(sheet, 1);
      else if (act === 'delete') deleteOne(sheet);
    });
    draw();
    panel.focusFirst();
  }

  return { open, addSheet, redraw: draw, isOpen: () => panel?.isOpen() ?? false };
}
