import { describe, expect, it } from 'vitest';
import { buildCellEdit, editState, parseCellInput } from '../../js/modules/workspace/domain/cellInput.js';
import { applyOps, buildOp, createWorkbook, findSheet } from '../../js/modules/workspace/domain/spreadsheet.js';

const value = (v) => ({ kind: 'value', value: v });

describe('what typing becomes', () => {
  it('plain numbers become numbers', () => {
    expect(parseCellInput('42')).toEqual(value(42));
    expect(parseCellInput('-3.5')).toEqual(value(-3.5));
    expect(parseCellInput('0.25')).toEqual(value(0.25));
    expect(parseCellInput('0')).toEqual(value(0));
    expect(parseCellInput('  42  ')).toEqual(value(42));
    expect(Object.is(parseCellInput('-0').value, 0)).toBe(true);
  });

  it('keeps as text anything that is not exactly a plain number, so nothing typed is silently changed', () => {
    for (const t of [
      '00123',
      '007',
      '1e5',
      '1,200',
      '1.',
      '.5',
      '+5',
      '0x1F',
      '12 34',
      'NaN',
      'Infinity',
      '٣',
      '1234567890123456',
      '0.1234567890123456',
    ]) {
      expect(parseCellInput(t), t).toEqual(value(t));
    }
    expect(parseCellInput('123456789012345')).toEqual(value(123456789012345)); // 15 digits still exact
  });

  it('reads true and false in any case', () => {
    expect(parseCellInput('TRUE')).toEqual(value(true));
    expect(parseCellInput(' false ')).toEqual(value(false));
    expect(parseCellInput('True')).toEqual(value(true));
    expect(parseCellInput('truely')).toEqual(value('truely'));
  });

  it('a leading apostrophe forces text and is not stored', () => {
    expect(parseCellInput("'42")).toEqual(value('42'));
    expect(parseCellInput("'TRUE")).toEqual(value('TRUE'));
    expect(parseCellInput("'=SUM(A1)")).toEqual(value('=SUM(A1)'));
    expect(parseCellInput("''abc")).toEqual(value("'abc"));
    expect(parseCellInput("'")).toEqual({ kind: 'clear' });
  });

  it('empty or blank clears the cell', () => {
    expect(parseCellInput('')).toEqual({ kind: 'clear' });
    expect(parseCellInput('   ')).toEqual({ kind: 'clear' });
    expect(parseCellInput(null)).toEqual({ kind: 'clear' });
    expect(parseCellInput(undefined)).toEqual({ kind: 'clear' });
  });

  it('reads a formula that parses, and keeps its text as typed (spaces around it are trimmed)', () => {
    expect(parseCellInput('=A1+B1')).toEqual({ kind: 'formula', formula: '=A1+B1' });
    expect(parseCellInput('  =1  ')).toEqual({ kind: 'formula', formula: '=1' });
    expect(parseCellInput('=sum(a1:a3) * 2')).toEqual({ kind: 'formula', formula: '=sum(a1:a3) * 2' }); // stored as typed
    expect(parseCellInput('=FOO(1)')).toEqual({ kind: 'formula', formula: '=FOO(1)' }); // unknown names show #NAME?, as elsewhere
  });

  it('refuses a formula that cannot be read, with a plain reason and where it went wrong, instead of storing an error', () => {
    for (const [typed, reason, pos] of [
      ['=1+', 'ends too soon', 3],
      ['=(1', 'Expected )', 3],
      ['=SUM(1,)', 'Unexpected', 7],
      ['=Sheet2!A1', 'other sheets', 7],
      ['=', 'Type something', 1],
      ['="abc', 'closing quote', 1],
    ]) {
      const r = parseCellInput(typed);
      expect(r.kind, typed).toBe('invalid');
      expect(r.reason, typed).toMatch(/^This formula cannot be read: /);
      expect(r.reason, typed).toContain(reason);
      expect(r.pos, typed).toBe(pos);
    }
    expect(parseCellInput('=' + '1+'.repeat(600) + '1').reason).toContain('at most 1,000 characters');
  });

  it('a leading apostrophe stores formula-looking text as text', () => {
    expect(parseCellInput("'=A1+B1")).toEqual({ kind: 'value', value: '=A1+B1' });
  });

  it('keeps ordinary text exactly as typed, including spaces, other languages and markup characters', () => {
    for (const t of ['Panadol 500mg', '  padded ', 'دوا', 'a=b', '<b>x</b>', 'line1\nline2', '12/03/2026', '٣٤']) {
      expect(parseCellInput(t), t).toEqual(value(t));
    }
  });

  it('refuses text longer than a cell can hold, counting characters not bytes', () => {
    expect(parseCellInput('x'.repeat(32767))).toEqual(value('x'.repeat(32767)));
    expect(parseCellInput('x'.repeat(32768)).kind).toBe('invalid');
    expect(parseCellInput('😀'.repeat(32767)).kind).toBe('value'); // 65,534 UTF-16 units but 32,767 characters
    expect(parseCellInput('😀'.repeat(32768)).kind).toBe('invalid');
  });
});

const editText = (c) => editState(c).text;

describe('what the edit box shows', () => {
  const cell = (v, formula = null) => ({ value: v, formula, style_id: null, last_seq: 1 });

  it('shows the plain content of numbers, booleans, text and empty cells', () => {
    expect(editText(null)).toBe('');
    expect(editText(cell(null))).toBe('');
    expect(editText(cell(1500))).toBe('1500');
    expect(editText(cell(0.1 + 0.2))).toBe('0.3');
    expect(editText(cell(true))).toBe('TRUE');
    expect(editText(cell(false))).toBe('FALSE');
    expect(editText(cell('Panadol'))).toBe('Panadol');
    expect(editText(cell(null, '=A1*2'))).toBe('=A1*2');
  });

  it('adds the apostrophe where the text would otherwise change type', () => {
    expect(editText(cell('42'))).toBe("'42");
    expect(editText(cell('TRUE'))).toBe("'TRUE");
    expect(editText(cell('=A1'))).toBe("'=A1");
    expect(editText(cell("'abc"))).toBe("''abc");
    expect(editText(cell(' 42 '))).toBe("' 42 ");
    expect(editText(cell('   '))).toBe("'   ");
    expect(editText(cell('00123'))).toBe('00123'); // already stays text
  });

  it('round trip: whatever is editable shows text that parses back to the very same cell', () => {
    const samples = [
      0,
      1,
      -1,
      0.5,
      123456789012345,
      4005808123456,
      true,
      false,
      '',
      'x',
      '42',
      '-3.5',
      'true',
      'FALSE',
      '=A1',
      "'",
      "''",
      "'42",
      ' ',
      '  42',
      '00123',
      'a b',
      '1e5',
      'دوا',
      '😀',
      'line1\nline2',
    ];
    for (const v of samples) {
      const st = editState(cell(v));
      expect(st.editable, JSON.stringify(v)).toBe(true);
      const back = parseCellInput(st.text);
      if (v === '') expect(back.kind).toBe('clear');
      else expect(back, JSON.stringify(v)).toEqual(value(v));
    }
  });

  it('shows a formula as its text, editable, and shows what typing cannot reproduce (unrepresentable numbers) as read-only', () => {
    expect(editState(cell(null, '=A1*2'))).toEqual({ text: '=A1*2', editable: true });
    expect(parseCellInput(editState(cell(null, '=SUM(A1:A3) + 1')).text)).toEqual({ kind: 'formula', formula: '=SUM(A1:A3) + 1' }); // round trip
    for (const n of [1e21, 1.5e-7, 1234567890123456, 0.1234567890123456, 2 ** 60]) {
      const st = editState(cell(n));
      expect(st.editable, String(n)).toBe(false);
      expect(st.reason).toMatch(/too large or too precise/);
    }
    expect(editState(cell(123456789012345)).editable).toBe(true);
    expect(editState(null)).toEqual({ text: '', editable: true });
  });

  it('text that looks like a formula or a broken formula is shown with an apostrophe so saving it does not change it', () => {
    expect(editState(cell('=A1+1'))).toEqual({ text: "'=A1+1", editable: true });
    expect(editState(cell('=oops('))).toEqual({ text: "'=oops(", editable: true });
    expect(parseCellInput("'=oops(")).toEqual({ kind: 'value', value: '=oops(' });
  });
});

describe('the edit operation', () => {
  const SHEET = '0a000000-0000-4000-8000-0000000000e1';
  function setup() {
    const wb = createWorkbook();
    applyOps(wb, [
      buildOp('add_sheet', { sheet_id: SHEET, name: 'S' }),
      buildOp('set_styles', { sheet_id: SHEET, styles: [{ style_id: 4, style: { weight: 'bold' } }] }),
    ]);
    applyOps(wb, [
      buildOp('set_cells', {
        sheet_id: SHEET,
        base_seq: wb.head_seq,
        cells: [
          { r: 1, c: 1, value: 'old', style_id: 4 },
          { r: 2, c: 1, value: 'plain' },
        ],
      }),
    ]);
    return wb;
  }

  it('builds a one-cell set_cells carrying the base seq', () => {
    const wb = setup();
    const op = buildCellEdit(findSheet(wb, SHEET), 2, 1, value('new'), wb.head_seq);
    expect(op.operation_type).toBe('set_cells');
    expect(op.payload).toEqual({ sheet_id: SHEET, base_seq: wb.head_seq, cells: [{ r: 2, c: 1, value: 'new' }] });
    expect(op.operation_id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('keeps the existing style so editing text never strips formatting', () => {
    const wb = setup();
    const sheet = findSheet(wb, SHEET);
    const op = buildCellEdit(sheet, 1, 1, value('changed'), wb.head_seq);
    expect(op.payload.cells[0]).toEqual({ r: 1, c: 1, value: 'changed', style_id: 4 });
    expect(applyOps(wb, [op]).results[0].status).toBe('applied');
    expect(sheet.cells.get('1:1')).toMatchObject({ value: 'changed', style_id: 4 });
  });

  it('clearing removes the content but keeps the style; clearing an unstyled cell empties it', () => {
    const wb = setup();
    const sheet = findSheet(wb, SHEET);
    applyOps(wb, [buildCellEdit(sheet, 1, 1, { kind: 'clear' }, wb.head_seq)]);
    expect(sheet.cells.get('1:1')).toMatchObject({ value: null, formula: null, style_id: 4 });
    applyOps(wb, [buildCellEdit(sheet, 2, 1, { kind: 'clear' }, wb.head_seq)]);
    const gone = sheet.cells.get('2:1');
    expect(!gone || (gone.value === null && gone.formula === null && gone.style_id === null)).toBe(true);
  });

  it('a stale base seq meets the database rule: someone else changed the cell, so it is a conflict, not an overwrite', () => {
    const wb = setup();
    const sheet = findSheet(wb, SHEET);
    const seen = wb.head_seq;
    applyOps(wb, [buildCellEdit(sheet, 2, 1, value('theirs'), seen)]); // another person edits first
    const mine = buildCellEdit(sheet, 2, 1, value('mine'), seen); // made from the copy that did not have it
    const answer = applyOps(wb, [mine]).results[0];
    expect(answer.status).toBe('conflict');
    expect(answer.conflicts[0]).toMatchObject({ r: 2, c: 1, kind: 'cell' });
    expect(sheet.cells.get('2:1').value).toBe('theirs');
    // choosing "use mine" sends it again from a current copy: now it is accepted
    expect(applyOps(wb, [buildCellEdit(sheet, 2, 1, value('mine'), wb.head_seq)]).results[0].status).toBe('applied');
    expect(sheet.cells.get('2:1').value).toBe('mine');
  });

  it('writing the same content that is already there is not a conflict', () => {
    const wb = setup();
    const sheet = findSheet(wb, SHEET);
    const seen = wb.head_seq;
    applyOps(wb, [buildCellEdit(sheet, 2, 1, value('same'), seen)]);
    expect(applyOps(wb, [buildCellEdit(sheet, 2, 1, value('same'), seen)]).results[0].status).toBe('applied');
  });
});
