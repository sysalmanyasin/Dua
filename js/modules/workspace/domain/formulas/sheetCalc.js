// Connects a sheet (cells keyed by stable row and column ids) to the calculation engine (positions). Build one per sheet
// whenever the sheet's content or structure may have changed; it reads the sheet and holds nothing the sheet does not.
//   const calc = createSheetCalc(sheet);
//   calc.get(rowId, colId)        the value to show (null when empty); a formula gives its calculated value
//   calc.isFormula(rowId, colId)
import { MAX_COLS, MAX_ROWS } from './a1.js';
import { createEngine } from './engine.js';

export function createSheetCalc(sheet) {
  const rowIds = (sheet.row_order ?? []).slice(0, MAX_ROWS);
  const colIds = (sheet.col_order ?? []).slice(0, MAX_COLS);
  const rowPos = new Map(rowIds.map((id, i) => [id, i]));
  const colPos = new Map(colIds.map((id, i) => [id, i]));
  const cells = [];
  for (const c of sheet.cells.values()) {
    const row = rowPos.get(c.r);
    const col = colPos.get(c.c);
    if (row === undefined || col === undefined) continue; // a cell of a deleted row or column
    const hasFormula = typeof c.formula === 'string';
    if (!hasFormula && (c.value === null || c.value === undefined)) continue; // style only: empty for calculation
    cells.push({ row, col, value: hasFormula ? null : c.value, formula: hasFormula ? c.formula : null });
  }
  const engine = createEngine({ rows: rowIds.length, cols: colIds.length, cells });
  const at = (rowId, colId) => {
    const row = rowPos.get(rowId);
    const col = colPos.get(colId);
    return row === undefined || col === undefined ? null : { row, col };
  };
  return {
    engine,
    get(rowId, colId) {
      const p = at(rowId, colId);
      return p ? engine.get(p.row, p.col) : null;
    },
    isFormula(rowId, colId) {
      const p = at(rowId, colId);
      return p ? engine.isFormula(p.row, p.col) : false;
    },
  };
}
