import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CallRefused,
  LIMITS,
  ReplicaOutOfSync,
  addLoadedCells,
  addLoadedStyles,
  applyOps,
  applyRemote,
  buildOp,
  buildSnapshot,
  cellLabel,
  colLabel,
  createSnapshot,
  createWorkbook,
  exportState,
  findSheet,
  getCell,
  idsAtLabel,
  jsonInt,
  liveSheets,
  loadWorkbook,
  newIds,
  parseCellInput,
  parseColLabel,
  pull,
  restoreSnapshot,
  sanitizeStyle,
  styleValid,
  stripIds,
  usedIds,
  uuidOrNull,
} from '../../js/modules/workspace/domain/spreadsheet.js';
import { OUTPUT, buildSql, expand, runCase } from '../../tools/workspace-sheet-cases.mjs';

const root = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const cases = JSON.parse(read('tests/fixtures/workspace-sheet-cases.json'));

// ids for hand-built tests
let counter = 0;
const uid = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;
const SHEET = '11111111-1111-4111-8111-111111111111';
const op = (type, payload) => ({ operation_id: uid(), operation_type: type, payload });
const withSheet = () => {
  const wb = createWorkbook();
  applyOps(wb, [op('add_sheet', { sheet_id: SHEET, name: 'Stock' })]);
  return wb;
};
const one = (wb, type, payload) => applyOps(wb, [op(type, payload)]).results[0];

describe('parity fixture: the model gives the answers the database gives', () => {
  cases.forEach((c, i) => {
    it(`case ${i + 1}: ${c.name}`, () => {
      const ran = runCase(c, i + 1);
      c.steps.forEach((s, k) => {
        if (s.refused !== undefined) expect(ran.steps[k].refused, `step ${k + 1}`).toContain(s.refused);
        else expect(ran.steps[k].expect, `step ${k + 1}`).toEqual(s.expect);
      });
      expect(ran.final.state).toEqual(c.final.state);
      expect(ran.final.conflicts).toEqual(c.final.conflicts);
    });
  });

  it('the generated database test is up to date (run: node tools/workspace-sheet-cases.mjs)', () => {
    expect(readFileSync(OUTPUT, 'utf8')).toBe(buildSql(cases));
  });

  it('the fixture covers every implemented operation type, conflicts, duplicates, refusals and restore', () => {
    const types = new Set();
    const statuses = new Set();
    cases.forEach((c, i) => {
      c.steps.forEach((s) => {
        (s.ops ?? []).forEach((o) => types.add(o.operation_type));
        (s.expect?.results ?? []).forEach((r) => statuses.add(r.status));
      });
      expect(expand(c.final.state, i + 1).sheets).toBeDefined();
    });
    for (const t of [
      'set_cells',
      'set_styles',
      'insert_rows',
      'delete_rows',
      'insert_cols',
      'delete_cols',
      'resize',
      'add_sheet',
      'rename_sheet',
      'delete_sheet',
      'reorder_sheets',
    ]) {
      expect(types.has(t), t).toBe(true);
    }
    expect([...statuses].sort()).toEqual(['applied', 'conflict', 'duplicate', 'rejected']);
    expect(cases.some((c) => c.steps.some((s) => s.restore))).toBe(true);
    expect(cases.some((c) => c.steps.some((s) => s.refused))).toBe(true);
  });
});

describe('a local copy follows the server by applying pulled operations', () => {
  // For every fixture case: replay it on a "server" model, and after each step bring a replica up to date from pull().
  cases.forEach((c, i) => {
    it(`case ${i + 1}: ${c.name}`, () => {
      const server = createWorkbook();
      let replica = createWorkbook();
      let seen = 0;
      let reloads = 0;
      const visible = (wb) => {
        const s = exportState(wb);
        return { head: s.head_seq, sheets: s.sheets };
      };
      for (const step of c.steps) {
        try {
          if (step.ops) applyOps(server, expand(step.ops, i + 1));
          else if (step.snapshot !== undefined) createSnapshot(server, step.snapshot);
          else restoreSnapshot(server, server.snapshots.find((x) => x.label === step.restore && x.kind === 'manual').id);
        } catch (e) {
          if (!(e instanceof CallRefused)) throw e;
        }
        for (const entry of pull(server, seen, 500)) {
          try {
            applyRemote(replica, entry);
          } catch (e) {
            if (!(e instanceof ReplicaOutOfSync)) throw e;
            // a restore: load the workbook again, as a screen would
            reloads += 1;
            replica = loadFrom(server);
          }
          seen = entry.seq;
        }
        // The head can be ahead of the last pulled operation (rejected and conflicting operations take a seq but are not pulled).
        replica.head_seq = Math.max(replica.head_seq, server.head_seq);
        expect(visible(replica)).toEqual(visible(server));
      }
      if (c.steps.some((s) => s.restore)) expect(reloads).toBeGreaterThan(0);
    });
  });
});

// What the screens do: open, then load cells and styles.
function loadFrom(server) {
  const open = {
    head_version: server.head_seq,
    sheets: liveSheets(server).map((s) => ({ ...s, row_order: s.row_order, col_order: s.col_order })),
  };
  const wb = loadWorkbook(open);
  for (const s of liveSheets(server)) {
    addLoadedCells(
      wb,
      s.id,
      [...s.cells.values()]
        .filter((x) => x.value !== null || x.formula !== null || x.style_id !== null)
        .map((x) => ({ row_id: x.r, col_id: x.c, value: x.value, formula: x.formula, style_id: x.style_id, last_seq: x.last_seq })),
    );
    addLoadedStyles(
      wb,
      s.id,
      [...s.styles.entries()].map(([style_id, style]) => ({ style_id, style })),
    );
  }
  return wb;
}

describe('limits (the same numbers the database enforces)', () => {
  it('20 sheets at most', () => {
    const wb = createWorkbook();
    for (let i = 0; i < 20; i += 1) expect(one(wb, 'add_sheet', { sheet_id: uid(), name: `S${i}` }).status).toBe('applied');
    const r = one(wb, 'add_sheet', { sheet_id: uid(), name: 'S20' });
    expect(r).toMatchObject({ status: 'rejected', reason: 'a workbook can have at most 20 sheets' });
  });

  it('100 columns and 10,000 rows at most', () => {
    const wb = withSheet();
    expect(one(wb, 'insert_cols', { sheet_id: SHEET, after: null, ids: Array.from({ length: 74 }, (_, i) => 1000 + i) }).status).toBe(
      'applied',
    );
    expect(one(wb, 'insert_cols', { sheet_id: SHEET, after: null, ids: [2000, 2001] })).toMatchObject({
      status: 'rejected',
      reason: 'that would be more than 100 columns',
    });
    expect(one(wb, 'insert_rows', { sheet_id: SHEET, after: null, ids: Array.from({ length: 1000 }, (_, i) => 1000 + i) }).status).toBe(
      'applied',
    );
    for (let k = 1; k < 9; k += 1)
      one(wb, 'insert_rows', { sheet_id: SHEET, after: null, ids: Array.from({ length: 1000 }, (_, i) => 1000 + k * 1000 + i) });
    expect(findSheet(wb, SHEET).row_order).toHaveLength(9100);
    expect(one(wb, 'insert_rows', { sheet_id: SHEET, after: null, ids: Array.from({ length: 1000 }, (_, i) => 20000 + i) })).toMatchObject({
      status: 'rejected',
      reason: 'that would be more than 10000 rows',
    });
  });

  it('text is limited to 32,767 characters, counted as characters and not as UTF-16 units', () => {
    const wb = withSheet();
    const set = (value) => one(wb, 'set_cells', { sheet_id: SHEET, base_seq: wb.head_seq, cells: [{ r: 1, c: 1, value }] }).status;
    expect(set('x'.repeat(32767))).toBe('applied');
    expect(set('x'.repeat(32768))).toBe('rejected');
    expect(set('😀'.repeat(32767))).toBe('applied'); // 65,534 UTF-16 units, 32,767 characters
    expect(set('😀'.repeat(32768))).toBe('rejected');
  });

  it('formulas: 1,000 characters at most, and they start with =', () => {
    const wb = withSheet();
    const set = (formula) => one(wb, 'set_cells', { sheet_id: SHEET, base_seq: wb.head_seq, cells: [{ r: 1, c: 1, formula }] }).status;
    expect(set(`=${'1'.repeat(999)}`)).toBe('applied');
    expect(set(`=${'1'.repeat(1000)}`)).toBe('rejected');
    expect(set('=')).toBe('rejected');
  });

  it('50,000 filled cells per workbook; clearing makes room', () => {
    const wb = withSheet();
    one(wb, 'insert_cols', { sheet_id: SHEET, after: null, ids: Array.from({ length: 74 }, (_, i) => 1000 + i) });
    one(wb, 'insert_rows', { sheet_id: SHEET, after: null, ids: Array.from({ length: 401 }, (_, i) => 1000 + i) });
    const sheet = findSheet(wb, SHEET);
    expect(sheet.col_order).toHaveLength(100);
    expect(sheet.row_order).toHaveLength(501);
    const fill = (rowIds) => rowIds.flatMap((r) => sheet.col_order.map((c) => ({ r, c, value: 1 })));
    for (let b = 0; b < 10; b += 1) {
      const out = one(wb, 'set_cells', { sheet_id: SHEET, base_seq: wb.head_seq, cells: fill(sheet.row_order.slice(b * 50, b * 50 + 50)) });
      expect(out.status).toBe('applied');
    }
    expect(sheet.filled).toBe(50000);
    const extra = { sheet_id: SHEET, base_seq: wb.head_seq, cells: [{ r: sheet.row_order[500], c: sheet.col_order[0], value: 1 }] };
    expect(one(wb, 'set_cells', extra)).toMatchObject({ status: 'rejected', reason: 'a workbook can hold at most 50,000 filled cells' });
    expect(sheet.filled).toBe(50000);
    expect(getCell(sheet, sheet.row_order[500], sheet.col_order[0])).toBeNull(); // nothing was written
    expect(
      one(wb, 'set_cells', { sheet_id: SHEET, base_seq: wb.head_seq, cells: [{ r: sheet.row_order[0], c: sheet.col_order[0] }] }).status,
    ).toBe('applied');
    expect(sheet.filled).toBe(49999);
    expect(one(wb, 'set_cells', { ...extra, base_seq: wb.head_seq }).status).toBe('applied');
    expect(sheet.filled).toBe(50000);
  });

  it('a workbook automatically takes a restore point every 200 operations', () => {
    const wb = withSheet();
    for (let i = 0; i < 198; i += 1) one(wb, 'rename_sheet', { sheet_id: SHEET, name: `N${i}` });
    expect(wb.snapshots.filter((s) => s.kind === 'checkpoint')).toHaveLength(0);
    one(wb, 'rename_sheet', { sheet_id: SHEET, name: 'Last' });
    expect(wb.snapshots.filter((s) => s.kind === 'checkpoint').map((s) => s.seq)).toEqual([200]);
    expect(wb.head_seq).toBe(200);
  });
});

describe('a refused batch changes nothing', () => {
  it('an id outside the integer range refuses the whole call and undoes the batch', () => {
    const wb = withSheet();
    const before = JSON.stringify(exportState(wb));
    const write = op('set_cells', { sheet_id: SHEET, base_seq: 1, cells: [{ r: 1, c: 1, value: 'must not survive' }] });
    const big = op('insert_rows', { sheet_id: SHEET, after: null, ids: [1000, 3000000000] });
    expect(() => applyOps(wb, [write, big])).toThrow(CallRefused);
    expect(JSON.stringify(exportState(wb))).toBe(before);
    // the same operation ids can be used again afterwards: nothing was recorded
    expect(applyOps(wb, [write]).results[0].status).toBe('applied');
  });

  it('bad envelopes are refused before anything is applied', () => {
    const wb = withSheet();
    const good = op('set_cells', { sheet_id: SHEET, base_seq: 1, cells: [{ r: 1, c: 1, value: 1 }] });
    for (const bad of [
      { operation_type: 'set_cells', payload: {} },
      { operation_id: uid(), operation_type: 'explode' },
      { operation_id: uid(), operation_type: 'restore_snapshot' },
      5,
    ]) {
      expect(() => applyOps(wb, [good, bad])).toThrow(CallRefused);
    }
    expect(() => applyOps(wb, [])).toThrow(CallRefused);
    expect(wb.head_seq).toBe(1);
  });
});

describe('answers and the log', () => {
  it('a conflict keeps both sides and is not pulled; a partly applied operation pulls only what was written', () => {
    const wb = withSheet();
    one(wb, 'set_cells', { sheet_id: SHEET, base_seq: 1, cells: [{ r: 1, c: 1, value: 'mine' }] });
    const r = one(wb, 'set_cells', {
      sheet_id: SHEET,
      base_seq: 1,
      cells: [
        { r: 1, c: 1, value: 'theirs' },
        { r: 2, c: 2, value: 'fresh' },
      ],
    });
    expect(r).toMatchObject({ status: 'conflict', applied_cells: 1 });
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts[0]).toMatchObject({ r: 1, c: 1, kind: 'cell' });
    const kept = wb.conflicts.find((c) => c.id === r.conflicts[0].conflict_id);
    expect(kept.server_state).toMatchObject({ value: 'mine', last_seq: 2 });
    expect(kept.local_state).toEqual({ value: 'theirs', formula: null, style_id: null });
    const pulled = pull(wb, 2).find((p) => p.seq === 3);
    expect(pulled.payload.cells).toEqual([{ r: 2, c: 2, value: 'fresh', formula: null, style_id: null }]);
    const lost = one(wb, 'set_cells', { sheet_id: SHEET, base_seq: 1, cells: [{ r: 1, c: 1, value: 'again' }] });
    expect(lost.status).toBe('conflict');
    expect(pull(wb, 3).map((p) => p.seq)).toEqual([]); // an all-conflict operation is not pulled
  });

  it('keeping my version: the same edit sent again with the current seq wins', () => {
    const wb = withSheet();
    one(wb, 'set_cells', { sheet_id: SHEET, base_seq: 1, cells: [{ r: 1, c: 1, value: 'theirs' }] });
    expect(one(wb, 'set_cells', { sheet_id: SHEET, base_seq: 1, cells: [{ r: 1, c: 1, value: 'mine' }] }).status).toBe('conflict');
    expect(one(wb, 'set_cells', { sheet_id: SHEET, base_seq: wb.head_seq, cells: [{ r: 1, c: 1, value: 'mine' }] }).status).toBe('applied');
    expect(getCell(findSheet(wb, SHEET), 1, 1).value).toBe('mine');
  });

  it('a resent operation id returns the first answer and changes nothing', () => {
    const wb = withSheet();
    const o = op('set_cells', { sheet_id: SHEET, base_seq: 1, cells: [{ r: 1, c: 1, value: 'a' }] });
    const first = applyOps(wb, [o]).results[0];
    const again = applyOps(wb, [{ ...o, payload: { sheet_id: SHEET, base_seq: 1, cells: [{ r: 1, c: 1, value: 'b' }] } }]).results[0];
    expect(again).toMatchObject({ status: 'duplicate', seq: first.seq, original_status: 'applied' });
    expect(getCell(findSheet(wb, SHEET), 1, 1).value).toBe('a');
    expect(wb.head_seq).toBe(2);
  });

  it('a deleted row stays recognisable: a stale edit becomes a conflict and the id is never reused', () => {
    const wb = withSheet();
    one(wb, 'insert_rows', { sheet_id: SHEET, after: null, ids: [1000] });
    one(wb, 'set_cells', { sheet_id: SHEET, base_seq: 2, cells: [{ r: 1000, c: 1, value: 'x' }] });
    one(wb, 'delete_rows', { sheet_id: SHEET, ids: [1000] });
    const stale = one(wb, 'set_cells', { sheet_id: SHEET, base_seq: 3, cells: [{ r: 1000, c: 1, value: 'late' }] });
    expect(stale.conflicts[0].kind).toBe('target_deleted');
    expect(one(wb, 'insert_rows', { sheet_id: SHEET, after: null, ids: [1000] })).toMatchObject({ status: 'rejected' });
    expect(findSheet(wb, SHEET).filled).toBe(0);
  });

  it('operations the database has not built yet are rejected, not lost', () => {
    const wb = withSheet();
    for (const type of ['move_rows', 'move_cols', 'duplicate_sheet', 'sort_range']) {
      expect(one(wb, type, { sheet_id: SHEET })).toMatchObject({
        status: 'rejected',
        reason: `the operation ${type} is not available yet`,
      });
    }
  });
});

describe('restore points', () => {
  it('restoring writes a NEW state: every restored cell gets the new seq, so older edits conflict', () => {
    const wb = withSheet();
    one(wb, 'set_cells', { sheet_id: SHEET, base_seq: 1, cells: [{ r: 1, c: 1, value: 'kept' }] });
    createSnapshot(wb, 'A');
    one(wb, 'set_cells', { sheet_id: SHEET, base_seq: 2, cells: [{ r: 1, c: 1, value: 'changed' }] });
    const out = restoreSnapshot(wb, wb.snapshots.find((s) => s.label === 'A').id);
    expect(out).toEqual({ status: 'restored', seq: 4, restored_from_seq: 2 });
    expect(getCell(findSheet(wb, SHEET), 1, 1)).toMatchObject({ value: 'kept', last_seq: 4 });
    expect(wb.snapshots.some((s) => s.kind === 'pre_restore' && s.seq === 3)).toBe(true);
    const stale = one(wb, 'set_cells', { sheet_id: SHEET, base_seq: 2, cells: [{ r: 1, c: 1, value: 'offline edit' }] });
    expect(stale.status).toBe('conflict');
  });

  it('a snapshot is a restore point of exactly the visible state', () => {
    const wb = withSheet();
    one(wb, 'set_cells', {
      sheet_id: SHEET,
      base_seq: 1,
      cells: [
        { r: 2, c: 3, formula: '=A1' },
        { r: 1, c: 1 },
      ],
    });
    const snap = buildSnapshot(wb);
    expect(snap.v).toBe(1);
    expect(snap.sheets[0].cells).toEqual([[2, 3, null, '=A1', null]]);
  });

  it('the same restore point is not taken twice at one seq', () => {
    const wb = withSheet();
    expect(createSnapshot(wb, 'A').snapshot_id).toBe(createSnapshot(wb, 'B').snapshot_id);
    expect(() => createSnapshot(wb, 'x'.repeat(101))).toThrow(CallRefused);
  });
});

describe('opening a workbook and following it', () => {
  it('builds a copy from what the open and load functions return, then follows pulled operations', () => {
    const server = withSheet();
    one(server, 'set_cells', { sheet_id: SHEET, base_seq: 1, cells: [{ r: 1, c: 1, value: 'a' }] });
    const open = { head_version: server.head_seq, sheets: liveSheets(server) };
    const local = loadWorkbook(open);
    addLoadedCells(local, SHEET, [{ row_id: 1, col_id: 1, value: 'a', formula: null, style_id: null, last_seq: 2 }]);
    expect(getCell(findSheet(local, SHEET), 1, 1).value).toBe('a');
    one(server, 'set_cells', { sheet_id: SHEET, base_seq: 2, cells: [{ r: 1, c: 2, value: 'b' }] });
    for (const entry of pull(server, local.head_seq)) applyRemote(local, entry);
    expect(local.head_seq).toBe(3);
    expect(exportState(local).sheets).toEqual(exportState(server).sheets);
  });

  it('an operation already seen is skipped; one that does not fit says the copy has drifted', () => {
    const server = withSheet();
    const local = createWorkbook();
    const entries = pull(server, 0);
    applyRemote(local, entries[0]);
    applyRemote(local, entries[0]); // again: ignored
    expect(local.sheets).toHaveLength(1);
    expect(() =>
      applyRemote(local, { seq: 9, op_type: 'set_cells', payload: { sheet_id: SHEET, cells: [{ r: 5000, c: 1, value: 1 }] } }),
    ).toThrow(ReplicaOutOfSync);
    expect(() => applyRemote(local, { seq: 10, op_type: 'rename_sheet', payload: { sheet_id: uid(), name: 'x' } })).toThrow(
      ReplicaOutOfSync,
    );
    expect(() => applyRemote(local, { seq: 11, op_type: 'restore_snapshot', payload: {} })).toThrow(ReplicaOutOfSync);
  });
});

describe('helpers for screens', () => {
  it('column labels', () => {
    expect([0, 1, 25, 26, 27, 51, 52, 701, 702].map(colLabel)).toEqual(['A', 'B', 'Z', 'AA', 'AB', 'AZ', 'BA', 'ZZ', 'AAA']);
    expect(['A', 'z', 'AA', 'ZZ', 'AAA', '', 'A1', 'AAAA'].map(parseColLabel)).toEqual([0, 25, 26, 701, 702, -1, -1, -1]);
  });

  it('labels follow the CURRENT position of stable ids', () => {
    const wb = withSheet();
    const sheet = findSheet(wb, SHEET);
    expect(cellLabel(sheet, 3, 2)).toBe('B3');
    one(wb, 'insert_rows', { sheet_id: SHEET, after: null, ids: [1000] });
    expect(cellLabel(sheet, 3, 2)).toBe('B4');
    expect(cellLabel(sheet, 1000, 1)).toBe('A1');
    expect(idsAtLabel(sheet, 'B4')).toEqual({ r: 3, c: 2 });
    expect(idsAtLabel(sheet, 'A9999')).toBeNull();
    expect(idsAtLabel(sheet, '7')).toBeNull();
    one(wb, 'delete_rows', { sheet_id: SHEET, ids: [3] });
    expect(cellLabel(sheet, 3, 2)).toBeNull();
  });

  it('new ids are 31-bit, 1000 or more, and never one already used', () => {
    const wb = withSheet();
    one(wb, 'insert_rows', { sheet_id: SHEET, after: null, ids: [1000] });
    one(wb, 'set_cells', { sheet_id: SHEET, base_seq: 2, cells: [{ r: 1000, c: 1, value: 1 }] });
    one(wb, 'delete_rows', { sheet_id: SHEET, ids: [1000] });
    const used = usedIds(findSheet(wb, SHEET), false);
    expect(used.has(1000)).toBe(true); // a deleted row's id is still "used"
    const ids = newIds(500, used);
    expect(new Set(ids).size).toBe(500);
    expect(ids.every((x) => x >= 1000 && x <= 2147483647 && !used.has(x))).toBe(true);
    const rigged = [0, 0, 0.5];
    let k = 0;
    expect(newIds(2, new Set(), () => rigged[k++])).toHaveLength(2); // a repeated draw is skipped
    expect(applyOps(wb, [buildOp('insert_rows', { sheet_id: SHEET, after: null, ids: ids.slice(0, 5) })]).results[0].status).toBe(
      'applied',
    );
  });

  it('typing into a cell', () => {
    expect(parseCellInput('')).toEqual({ value: null, formula: null });
    expect(parseCellInput('   ')).toEqual({ value: null, formula: null });
    expect(parseCellInput(' 42 ')).toEqual({ value: 42, formula: null });
    expect(parseCellInput('-2.5')).toEqual({ value: -2.5, formula: null });
    expect(parseCellInput('.5')).toEqual({ value: 0.5, formula: null });
    expect(parseCellInput('1e3')).toEqual({ value: 1000, formula: null });
    expect(parseCellInput('1,000')).toEqual({ value: '1,000', formula: null });
    expect(parseCellInput('007 pills')).toEqual({ value: '007 pills', formula: null });
    expect(parseCellInput('TRUE')).toEqual({ value: true, formula: null });
    expect(parseCellInput('false')).toEqual({ value: false, formula: null });
    expect(parseCellInput(' =SUM(A1:A3) ')).toEqual({ value: null, formula: '=SUM(A1:A3)' });
    expect(parseCellInput('=')).toEqual({ value: '=', formula: null });
    expect(parseCellInput(`=${'1'.repeat(1000)}`).error).toMatch(/1,000/);
    expect(parseCellInput('x'.repeat(32768)).error).toMatch(/32,767/);
    expect(parseCellInput(null)).toEqual({ value: null, formula: null });
  });

  it('small validators', () => {
    expect([5, -3, 0, 5.5, '5', null, NaN, 1e19].map(jsonInt)).toEqual([5, -3, 0, null, null, null, null, null]);
    expect(uuidOrNull('AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA')).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    expect(uuidOrNull(5)).toBeNull();
    expect(uuidOrNull('nope')).toBeNull();
    expect(stripIds({ a: [{ conflict_id: 1, b: 2 }], snapshot_id: 3 })).toEqual({ a: [{ b: 2 }] });
    expect(LIMITS.checkpointEvery).toBe(200);
  });
});

describe('styles: the database is looser than it looks, so drawing must be strict', () => {
  const loose = [
    { size: 'big' },
    { size: 8.5 },
    { weight: null },
    { numfmt: { type: 'number', decimals: 2.5 } },
    { numfmt: {} },
    { borders: { top: null } },
    { halign: null },
  ];
  it('the model accepts exactly what the live database accepts (see the "known looseness" fixture case)', () => {
    for (const s of loose) expect(styleValid(s), JSON.stringify(s)).toBe(true);
    for (const s of [{ size: 100 }, { color: null }, { borders: null }, { numfmt: null }, { weight: 'heavy' }, { font: 'x' }, []])
      expect(styleValid(s), JSON.stringify(s)).toBe(false);
  });

  it('sanitizeStyle keeps only well-formed parts', () => {
    expect(
      sanitizeStyle({
        size: 'big',
        weight: null,
        halign: 'left',
        color: '#ff0000',
        numfmt: { type: 'number', decimals: 2.5 },
        borders: { top: 'thin', left: null },
      }),
    ).toEqual({
      halign: 'left',
      color: '#ff0000',
      numfmt: { type: 'number' },
      borders: { top: 'thin' },
    });
    expect(sanitizeStyle(null)).toEqual({});
    expect(sanitizeStyle({ size: 12, bg: '#00ff00' })).toEqual({ size: 12, bg: '#00ff00' });
  });
});
