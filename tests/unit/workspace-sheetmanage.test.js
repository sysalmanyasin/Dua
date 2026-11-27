import { describe, expect, it } from 'vitest';
import {
  addSheetOp,
  canAddSheet,
  canDeleteSheet,
  checkSheetName,
  cleanSheetName,
  deleteSheetOp,
  MAX_NAME,
  MAX_SHEETS,
  moveSheet,
  readAnswer,
  renameSheetOp,
  reorderSheetsOp,
  sheetReason,
  suggestSheetName,
} from '../../js/modules/workspace/domain/sheetManage.js';
import { applyOps, buildOp, createWorkbook, liveSheets } from '../../js/modules/workspace/domain/spreadsheet.js';

const id = (n) => `0a000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sheets = (...names) => names.map((name, i) => ({ id: id(i + 1), name }));

describe('names', () => {
  it('trims spaces only, as the database does', () => {
    expect(cleanSheetName('  Stock  ')).toBe('Stock');
    expect(cleanSheetName('\tStock')).toBe('\tStock');
    expect(cleanSheetName(null)).toBe('');
  });

  it('accepts 1 to 31 characters (counted as characters, not UTF-16 units) and refuses the rest', () => {
    expect(checkSheetName('A', []).ok).toBe(true);
    expect(checkSheetName('x'.repeat(MAX_NAME), []).ok).toBe(true);
    expect(checkSheetName('x'.repeat(MAX_NAME + 1), []).ok).toBe(false);
    expect(checkSheetName('😀'.repeat(MAX_NAME), []).ok).toBe(true);
    expect(checkSheetName('😀'.repeat(MAX_NAME + 1), []).ok).toBe(false);
    expect(checkSheetName('   ', []).ok).toBe(false);
    expect(checkSheetName('', []).reason).toMatch(/needs a name/);
  });

  it('compares without regard to capitals, but lets a sheet keep its own name', () => {
    const list = sheets('Stock', 'Sales');
    expect(checkSheetName('STOCK', list).ok).toBe(false);
    expect(checkSheetName(' stock ', list).ok).toBe(false);
    expect(checkSheetName('STOCK', list, id(1)).ok).toBe(true);
    expect(checkSheetName('sales', list, id(1)).ok).toBe(false);
  });

  it('suggests the first free "SheetN"', () => {
    expect(suggestSheetName([])).toBe('Sheet1');
    expect(suggestSheetName(sheets('Sheet1'))).toBe('Sheet2');
    expect(suggestSheetName(sheets('Stock', 'Sales'))).toBe('Sheet3');
    expect(suggestSheetName(sheets('Sheet3', 'x'))).toBe('Sheet4');
    expect(suggestSheetName(sheets('SHEET3', 'x'))).toBe('Sheet4');
  });

  // The early check and the database must agree. The reference model is tied to the database by the parity test, so it
  // stands in for it here: for every name, "this check says yes" must equal "the model accepts add_sheet / rename_sheet".
  it('agrees with the reference model about every name, for add and for rename', () => {
    const names = [
      'Stock',
      'stock',
      'STOCK',
      ' Stock ',
      'Sales',
      'sales ',
      'Q1',
      '',
      ' ',
      '  ',
      'x'.repeat(31),
      'x'.repeat(32),
      '😀'.repeat(31),
      '😀'.repeat(32),
      'a b',
      '\tTab',
      'Ünï',
      'İstanbul',
      'ß',
      'SS',
      'Sheet 1',
      "O'Brien",
      '=A1',
      '1',
      ' 1',
      'a'.repeat(30) + ' ',
    ];
    for (const name of names) {
      const wb = createWorkbook();
      applyOps(wb, [buildOp('add_sheet', { sheet_id: id(1), name: 'Stock' }), buildOp('add_sheet', { sheet_id: id(2), name: 'Sales' })]);
      const list = liveSheets(wb).map((s) => ({ id: s.id, name: s.name }));
      const addOk = checkSheetName(name, list).ok;
      const addRes = applyOps(wb, [addSheetOp(name)]).results[0];
      expect([name, 'add', addRes.status === 'applied']).toEqual([name, 'add', addOk]);
      const after = liveSheets(wb).map((s) => ({ id: s.id, name: s.name })); // the add above may have changed the list
      const renOk = checkSheetName(name, after, id(1)).ok;
      const renRes = applyOps(wb, [renameSheetOp(id(1), name)]).results[0];
      expect([name, 'rename', renRes.status === 'applied']).toEqual([name, 'rename', renOk]);
    }
  });
});

describe('limits', () => {
  it('stops adding at 20 sheets and deleting at 1', () => {
    expect(MAX_SHEETS).toBe(20);
    expect(canAddSheet(sheets(...Array.from({ length: 19 }, (_, i) => `S${i}`))).ok).toBe(true);
    const full = sheets(...Array.from({ length: 20 }, (_, i) => `S${i}`));
    expect(canAddSheet(full).ok).toBe(false);
    expect(canAddSheet(full).reason).toMatch(/at most 20/);
    expect(canDeleteSheet(sheets('A')).ok).toBe(false);
    expect(canDeleteSheet(sheets('A')).reason).toMatch(/at least one sheet/);
    expect(canDeleteSheet(sheets('A', 'B')).ok).toBe(true);
  });

  it('agrees with the model at the edges', () => {
    const wb = createWorkbook();
    for (let i = 1; i <= 20; i += 1)
      expect(applyOps(wb, [buildOp('add_sheet', { sheet_id: id(i), name: `S${i}` })]).results[0].status).toBe('applied');
    expect(canAddSheet(liveSheets(wb)).ok).toBe(false);
    expect(applyOps(wb, [addSheetOp('One more')]).results[0].status).toBe('rejected');
    for (let i = 1; i <= 19; i += 1) applyOps(wb, [deleteSheetOp(id(i))]);
    expect(canDeleteSheet(liveSheets(wb)).ok).toBe(false);
    expect(applyOps(wb, [deleteSheetOp(id(20))]).results[0].status).toBe('rejected');
  });
});

describe('moving', () => {
  const list = sheets('A', 'B', 'C');
  it('swaps with the neighbour and returns the ids in the new order', () => {
    expect(moveSheet(list, id(2), -1)).toEqual([id(2), id(1), id(3)]);
    expect(moveSheet(list, id(2), 1)).toEqual([id(1), id(3), id(2)]);
  });
  it('returns null at an edge, for an unknown id and for a bad direction', () => {
    expect(moveSheet(list, id(1), -1)).toBeNull();
    expect(moveSheet(list, id(3), 1)).toBeNull();
    expect(moveSheet(list, id(9), 1)).toBeNull();
    expect(moveSheet(list, id(2), 2)).toBeNull();
    expect(moveSheet(list, id(2), 0)).toBeNull();
  });
  it('does not change the list it was given, and the model accepts the order it returns', () => {
    const before = JSON.stringify(list);
    const order = moveSheet(list, id(3), -1);
    expect(JSON.stringify(list)).toBe(before);
    const wb = createWorkbook();
    applyOps(
      wb,
      list.map((s) => buildOp('add_sheet', { sheet_id: s.id, name: s.name })),
    );
    expect(applyOps(wb, [reorderSheetsOp(order)]).results[0].status).toBe('applied');
    expect(liveSheets(wb).map((s) => s.id)).toEqual(order);
  });
});

describe('operations', () => {
  it('builds the payloads the database expects, each with its own operation id', () => {
    const a = addSheetOp('  Totals ');
    expect(a).toMatchObject({ operation_type: 'add_sheet', payload: { name: 'Totals' } });
    expect(a.payload.sheet_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(addSheetOp('x').payload.sheet_id).not.toBe(addSheetOp('x').payload.sheet_id);
    expect(renameSheetOp(id(1), ' New ')).toMatchObject({ operation_type: 'rename_sheet', payload: { sheet_id: id(1), name: 'New' } });
    expect(deleteSheetOp(id(1))).toMatchObject({ operation_type: 'delete_sheet', payload: { sheet_id: id(1) } });
    const order = [id(2), id(1)];
    const r = reorderSheetsOp(order);
    order.push(id(3));
    expect(r.payload.order).toEqual([id(2), id(1)]);
    expect(new Set([a.operation_id, r.operation_id]).size).toBe(2);
  });
});

describe('reading an answer', () => {
  const op = { operation_id: id(50) };
  const answered = (result) => ({ status: 'answered', results: [{ operation: op, result }] });
  it('applied, and a duplicate of an applied change, are both success', () => {
    expect(readAnswer(answered({ status: 'applied' }), id(50)).kind).toBe('applied');
    expect(readAnswer(answered({ status: 'duplicate', original_status: 'applied' }), id(50)).kind).toBe('applied');
  });
  it('a duplicate of a refused change is still a refusal', () => {
    const r = readAnswer(answered({ status: 'duplicate', original_status: 'rejected', reason: 'sheet not found' }), id(50));
    expect(r.kind).toBe('failed');
  });
  it('rejected and conflict are failures, with the reason in words', () => {
    expect(readAnswer(answered({ status: 'rejected', reason: 'a sheet with that name already exists' }), id(50))).toEqual({
      kind: 'failed',
      message: 'Another sheet already has that name.',
    });
    expect(readAnswer(answered({ status: 'conflict' }), id(50)).kind).toBe('failed');
  });
  it('offline and refused are reported as such; an answer for a different change is "other"', () => {
    expect(readAnswer({ status: 'offline', error: new Error('x') }, id(50)).kind).toBe('offline');
    expect(readAnswer({ status: 'refused', error: new Error('No access') }, id(50))).toEqual({ kind: 'refused', message: 'No access' });
    expect(readAnswer({ status: 'idle' }, id(50)).kind).toBe('other');
    expect(readAnswer(answered({ status: 'applied' }), id(51)).kind).toBe('other');
    expect(readAnswer(null, id(50)).kind).toBe('other');
  });
  it('turns every reason the model can give into a plain sentence', () => {
    for (const reason of [
      'a workbook can have at most 20 sheets',
      'a sheet with that name already exists',
      'a workbook needs at least one sheet',
      'sheet not found',
      'order must list every sheet of the workbook exactly once',
      'a sheet name must be 1 to 31 characters',
    ]) {
      expect(sheetReason(reason)).not.toBe('The change was not accepted.');
    }
    expect(sheetReason('something new')).toBe('The change was not accepted.');
    expect(sheetReason(undefined)).toBe('The change was not accepted.');
  });
});
