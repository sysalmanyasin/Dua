// Sheet management rules (Phase 5, increment 6). Pure: no DOM, no network, no storage.
// The database is the judge (workspace_apply_ops: add_sheet, rename_sheet, delete_sheet, reorder_sheets) and the reference
// model mirrors it. These functions only let the screen say "no" early, in plain words, and build the operations.
import { buildOp, charLength, LIMITS } from './spreadsheet.js';
import { newId } from './documents.js';

export const MAX_SHEETS = LIMITS.sheets;
export const MAX_NAME = LIMITS.sheetName;

// PostgreSQL trim() removes spaces only, so the same is done here.
export const cleanSheetName = (raw) => (typeof raw === 'string' ? raw.replace(/^ +| +$/g, '') : '');

// Checks a name against the sheets that exist. `exceptId` is the sheet being renamed (it may keep its own name, even
// changing only the capital letters). Names are compared without regard to capitals, as the database does.
export function checkSheetName(raw, sheets, exceptId = null) {
  const name = cleanSheetName(raw);
  const length = charLength(name);
  if (length < 1) return { ok: false, reason: 'A sheet needs a name.' };
  if (length > MAX_NAME) return { ok: false, reason: `A sheet name can have at most ${MAX_NAME} characters.` };
  const clash = sheets.some((s) => s.id !== exceptId && s.name.toLowerCase() === name.toLowerCase());
  if (clash) return { ok: false, reason: 'Another sheet already has that name.' };
  return { ok: true, name };
}

// "Sheet2", "Sheet3"...: the first number above the count that is not taken.
export function suggestSheetName(sheets) {
  const taken = new Set(sheets.map((s) => s.name.toLowerCase()));
  for (let n = sheets.length + 1; n < sheets.length + 1000; n += 1) {
    if (!taken.has(`sheet${n}`)) return `Sheet${n}`;
  }
  return 'Sheet';
}

export function canAddSheet(sheets) {
  return sheets.length >= MAX_SHEETS
    ? { ok: false, reason: `A workbook can have at most ${MAX_SHEETS} sheets.` }
    : { ok: true, reason: '' };
}

export function canDeleteSheet(sheets) {
  return sheets.length <= 1
    ? { ok: false, reason: 'A workbook needs at least one sheet, so the last one cannot be deleted.' }
    : { ok: true, reason: '' };
}

// The ids in their new order after moving `id` one place (direction -1 earlier, +1 later), or null at the edge or for an
// unknown id. `sheets` must already be in display order.
export function moveSheet(sheets, id, direction) {
  const order = sheets.map((s) => s.id);
  const at = order.indexOf(id);
  const to = at + direction;
  if (at < 0 || (direction !== -1 && direction !== 1) || to < 0 || to >= order.length) return null;
  [order[at], order[to]] = [order[to], order[at]];
  return order;
}

// ───────── operations ─────────
export const addSheetOp = (name) => buildOp('add_sheet', { sheet_id: newId(), name: cleanSheetName(name) });
export const renameSheetOp = (sheetId, name) => buildOp('rename_sheet', { sheet_id: sheetId, name: cleanSheetName(name) });
export const deleteSheetOp = (sheetId) => buildOp('delete_sheet', { sheet_id: sheetId });
export const reorderSheetsOp = (order) => buildOp('reorder_sheets', { order: [...order] });

// What the person is told when the database says no (it can, when someone else changed the workbook a moment ago).
const WHY = [
  [/at most 20 sheets/, 'A workbook can have at most 20 sheets.'],
  [/already exists/, 'Another sheet already has that name.'],
  [/at least one sheet/, 'A workbook needs at least one sheet, so the last one cannot be deleted.'],
  [/sheet not found/, 'That sheet no longer exists. Someone else may have deleted it.'],
  [/every sheet of the workbook/, 'The sheets changed while you were reordering them. The list was refreshed, so try again.'],
  [/1 to 31 characters/, `A sheet name must be 1 to ${MAX_NAME} characters.`],
];
export function sheetReason(reason) {
  const text = typeof reason === 'string' ? reason : '';
  const hit = WHY.find(([re]) => re.test(text));
  return hit ? hit[1] : 'The change was not accepted.';
}

// Reads what a sender.flush() returned for ONE operation. kind is:
//  'applied'  the change is in; refresh to see it
//  'failed'   the database said no (message says why); refresh anyway, the workbook may have changed
//  'offline'  not answered: the same change stays queued and is resent with the same id
//  'refused'  the whole call was refused and will never work (message); the caller takes the refused batch
//  'other'    the answer did not include this operation (another change was in the same batch)
export function readAnswer(flushed, operationId) {
  if (!flushed || flushed.status === 'idle') return { kind: 'other', message: '' };
  if (flushed.status === 'offline') {
    return { kind: 'offline', message: 'You seem to be offline. The change is waiting and has not been made yet.' };
  }
  if (flushed.status === 'refused') {
    return { kind: 'refused', message: flushed.error?.message ?? 'The change was not accepted.' };
  }
  const mine = (flushed.results ?? []).find((r) => r.operation.operation_id === operationId);
  if (!mine) return { kind: 'other', message: '' };
  const res = mine.result;
  const outcome = res.status === 'duplicate' ? (res.original_status ?? 'applied') : res.status;
  if (outcome === 'applied') return { kind: 'applied', message: '' };
  return { kind: 'failed', message: sheetReason(res.reason) };
}
