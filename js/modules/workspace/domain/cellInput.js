// What a person types into a cell, and the operation that stores it. No DOM, no network.
//
// Rules (they protect data, not convenience):
//  * Only a plain number becomes a number: 42, -3.5, 0.25. "00123" (a batch code or phone number), "1e5", "1,200" and "٣" stay
//    text, because turning them into numbers would silently change what was typed.
//  * TRUE and FALSE (any case) become true/false.
//  * A leading apostrophe forces text: '42 is the text 42. The apostrophe itself is not stored.
//  * Text that starts with = is a formula. Formulas are calculated in a later phase, so for now it is refused with a clear
//    message instead of being stored as something that does nothing.
//  * Empty (or only spaces) clears the cell's content. Its formatting stays.
import { buildOp, LIMITS } from './spreadsheet.js';
import { generalNumber } from './grid.js';

const NUMBER = /^-?(0|[1-9]\d*)(\.\d+)?$/;
const MAX_DIGITS = 15; // beyond this a double cannot hold what was typed exactly

const digits = (t) => t.replace(/[^0-9]/g, '').length;

// -> { kind: 'clear' } | { kind: 'value', value } | { kind: 'formula' } | { kind: 'invalid', reason }
export function parseCellInput(raw) {
  const typed = String(raw ?? '');
  if (typed.trim() === '') return { kind: 'clear' };
  let text = typed;
  let forcedText = false;
  if (text.startsWith("'")) {
    text = text.slice(1);
    forcedText = true;
    if (text === '') return { kind: 'clear' };
  } else if (text.trimStart().startsWith('=')) {
    return { kind: 'formula' };
  }
  if (!forcedText) {
    const t = text.trim();
    if (/^(true|false)$/i.test(t)) return { kind: 'value', value: t.toLowerCase() === 'true' };
    if (NUMBER.test(t) && digits(t) <= MAX_DIGITS) {
      const n = Number(t);
      return { kind: 'value', value: n === 0 ? 0 : n }; // no negative zero
    }
  }
  if ([...text].length > LIMITS.textLength) return { kind: 'invalid', reason: 'A cell can hold at most 32,767 characters.' };
  return { kind: 'value', value: text };
}

// What the edit box shows for a stored cell, and whether it may be edited: { text, editable, reason }. The text is chosen so
// that parsing it gives back the very same cell (text that would otherwise be read as a number, true/false or a formula gets
// the apostrophe). A cell that cannot be reproduced from typed text is shown but not editable, because saving it would
// change it: a formula (calculated in a later phase) and a number too large or too precise to type as a plain number.
export function editState(cell) {
  if (!cell) return { text: '', editable: true };
  if (cell.formula !== null && cell.formula !== undefined) {
    return { text: cell.formula, editable: false, reason: 'Formulas can be edited in a later update.' };
  }
  const v = cell.value;
  if (v === null || v === undefined) return { text: '', editable: true };
  if (typeof v === 'boolean') return { text: v ? 'TRUE' : 'FALSE', editable: true };
  if (typeof v === 'number') {
    const text = generalNumber(v);
    const back = parseCellInput(text);
    return back.kind === 'value' && back.value === v
      ? { text, editable: true }
      : { text, editable: false, reason: 'This number is too large or too precise to edit here yet.' };
  }
  const back = parseCellInput(v);
  return { text: back.kind === 'value' && back.value === v ? v : `'${v}`, editable: true };
}

// The set_cells operation for one edited cell. A cell write replaces the cell's whole state, so the cell keeps its existing
// style (leaving style_id out would strip its formatting). baseSeq is the seq the person's copy is current to: if someone
// else changed the cell after it, the database answers "conflict" instead of overwriting.
export function buildCellEdit(sheet, rowId, colId, parsed, baseSeq) {
  const existing = sheet.cells.get(`${rowId}:${colId}`) ?? null;
  const cell = { r: rowId, c: colId };
  if (existing && existing.style_id !== null && existing.style_id !== undefined) cell.style_id = existing.style_id;
  if (parsed.kind === 'value') cell.value = parsed.value;
  return buildOp('set_cells', { sheet_id: sheet.id, base_seq: baseSeq, cells: [cell] });
}
