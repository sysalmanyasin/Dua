import { describe, expect, it } from 'vitest';
import {
  axisLayout,
  cellCss,
  describeCell,
  displayCell,
  formatDate,
  generalNumber,
  GRID,
  indexAt,
  scrollToShow,
  sizeAt,
  visibleRange,
} from '../../js/modules/workspace/domain/grid.js';
import { applyOps, buildOp, createWorkbook, findSheet } from '../../js/modules/workspace/domain/spreadsheet.js';

describe('axis layout', () => {
  it('lays items end to end with the default size', () => {
    const l = axisLayout([1, 2, 3], null, 28);
    expect(l.starts).toEqual([0, 28, 56, 84]);
    expect(l.total).toBe(84);
    expect(sizeAt(l, 1)).toBe(28);
  });

  it('uses stored sizes keyed by id, and ignores anything that is not a whole number from 10 to 2000', () => {
    const l = axisLayout([5, 6, 7, 8, 9], { 5: 40, 6: 9, 7: 2001, 8: 'wide', 9: 1.5 }, 20);
    expect(l.starts).toEqual([0, 40, 60, 80, 100, 120]);
    expect(axisLayout([5], { 5: 10 }, 20).total).toBe(10);
    expect(axisLayout([5], { 5: 2000 }, 20).total).toBe(2000);
  });

  it('copes with an empty or missing axis and with odd size objects', () => {
    expect(axisLayout([], null, 28)).toEqual({ ids: [], starts: [0], total: 0 });
    expect(axisLayout(undefined, undefined, 28).total).toBe(0);
    expect(axisLayout([1], 'nope', 28).total).toBe(28);
    expect(axisLayout([1], [10], 28).total).toBe(28);
  });

  it('finds the item at an offset, clamped to the ends', () => {
    const l = axisLayout([1, 2, 3, 4], { 2: 100 }, 20); // starts 0,20,120,140,160
    expect([0, 19, 20, 119, 120, 139, 140, 159].map((o) => indexAt(l, o))).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
    expect(indexAt(l, -50)).toBe(0);
    expect(indexAt(l, 160)).toBe(3);
    expect(indexAt(l, 9999)).toBe(3);
    expect(indexAt(axisLayout([], null, 20), 5)).toBe(-1);
  });
});

describe('what is on screen', () => {
  const rows = axisLayout(
    Array.from({ length: 1000 }, (_, i) => i + 1),
    null,
    28,
  );

  it('draws the visible rows plus a little beyond each edge', () => {
    // body 280 tall at the top: rows 0..9 are visible
    expect(visibleRange(rows, 0, 280, { overscan: 0 })).toEqual({ from: 0, to: 10 });
    expect(visibleRange(rows, 0, 280)).toEqual({ from: 0, to: 13 });
    // scrolled by 5 rows and a bit
    expect(visibleRange(rows, 5 * 28 + 10, 280, { overscan: 0 })).toEqual({ from: 5, to: 16 });
    expect(visibleRange(rows, 5 * 28 + 10, 280)).toEqual({ from: 2, to: 19 });
  });

  it('never draws more than the viewport needs, however long the sheet is', () => {
    for (const scroll of [0, 1000, 12345, 27000]) {
      const r = visibleRange(rows, scroll, 300);
      expect(r.to - r.from).toBeLessThanOrEqual(Math.ceil(300 / 28) + 1 + 2 * GRID.overscan);
    }
  });

  it('stops at the ends', () => {
    expect(visibleRange(rows, 10 ** 9, 280).to).toBe(1000);
    expect(visibleRange(rows, -100, 280).from).toBe(0);
    expect(visibleRange(axisLayout([], null, 28), 0, 280)).toEqual({ from: 0, to: 0 });
    expect(visibleRange(rows, 0, 0)).toEqual({ from: 0, to: 0 });
  });

  it('leaves frozen items to the caller and starts after them', () => {
    // 2 frozen rows: they take 56 px of the body, so with a scroll of 0 the scrollable rows start at index 2
    expect(visibleRange(rows, 0, 280, { frozen: 2, overscan: 0 })).toEqual({ from: 2, to: 10 });
    expect(visibleRange(rows, 560, 280, { frozen: 2, overscan: 0 }).from).toBe(22);
    expect(visibleRange(rows, 0, 280, { frozen: 5000 })).toEqual({ from: 1000, to: 1000 });
  });

  it('scrolls only as far as needed to reveal an item', () => {
    // body 280 tall
    expect(scrollToShow(rows, 3, 0, 280)).toBe(0); // already visible
    expect(scrollToShow(rows, 20, 0, 280)).toBe(21 * 28 - 280); // below: bring its bottom edge in
    expect(scrollToShow(rows, 2, 500, 280)).toBe(2 * 28); // above: bring its top edge in
    expect(scrollToShow(rows, 5000, 77, 280)).toBe(77);
    expect(scrollToShow(rows, 1, 0, 280, 3)).toBe(0); // a frozen item is always visible
    // with 2 frozen rows (56 px) an item scrolled just under them is brought out from below them
    expect(scrollToShow(rows, 10, 10 * 28 - 20, 280, 2)).toBe(10 * 28 - 56);
  });
});

describe('what a cell shows', () => {
  const c = (value, formula = null) => ({ value, formula, style_id: null, last_seq: 1 });

  it('numbers lose floating point noise', () => {
    expect(generalNumber(0.1 + 0.2)).toBe('0.3');
    expect(generalNumber(1 / 3)).toBe('0.333333333333333');
    expect(generalNumber(9007199254740991)).toBe('9007199254740991');
    expect(generalNumber(4005808123456)).toBe('4005808123456'); // a 13-digit barcode keeps every digit
    expect(generalNumber(1234567890123)).toBe('1234567890123');
    expect(generalNumber(-0.5)).toBe('-0.5');
    expect(generalNumber(Number.NaN)).toBe('');
    expect(generalNumber(Infinity)).toBe('');
  });

  it('shows text, booleans, empty cells and formulas', () => {
    expect(displayCell(c('Panadol'))).toEqual({ text: 'Panadol', kind: 'text' });
    expect(displayCell(c(true))).toEqual({ text: 'TRUE', kind: 'boolean' });
    expect(displayCell(c(false))).toEqual({ text: 'FALSE', kind: 'boolean' });
    expect(displayCell(c(null))).toEqual({ text: '', kind: 'empty' });
    expect(displayCell(null)).toEqual({ text: '', kind: 'empty' });
    expect(displayCell(c(null, '=A1+B1'))).toEqual({ text: '=A1+B1', kind: 'formula' });
    expect(displayCell(c(42))).toEqual({ text: '42', kind: 'number' });
  });

  it('applies number formats', () => {
    const n = (value, numfmt) => displayCell(c(value), { numfmt }).text;
    expect(n(1234.5, { type: 'number' })).toBe('1,234.50');
    expect(n(1234.5, { type: 'number', decimals: 0 })).toBe('1,235');
    expect(n(0.256, { type: 'percent' })).toBe('26%');
    expect(n(0.256, { type: 'percent', decimals: 1 })).toBe('25.6%');
    expect(n(1234.5, { type: 'currency', currency: 'PKR' })).toBe('PKR 1,234.50');
    expect(n(-1234.5, { type: 'currency', currency: 'PKR', decimals: 0 })).toBe('-PKR 1,235');
    expect(n(7, { type: 'currency' })).toBe('7.00');
    expect(n(1234.5, { type: 'general' })).toBe('1234.5');
    expect(n(1234.5, { type: 'unknown' })).toBe('1234.5');
    expect(n(1234.5, undefined)).toBe('1234.5');
  });

  it('dates (provisional: a number is days since 1899-12-30; yyyy-mm-dd text is reformatted)', () => {
    expect(formatDate(1)).toBe('31/12/1899');
    expect(formatDate(45000)).toBe('15/03/2023');
    expect(formatDate(45000, 'yyyy-mm-dd')).toBe('2023-03-15');
    expect(formatDate(45000, 'dd mmm yyyy')).toBe('15 Mar 2023');
    expect(formatDate('2026-11-22')).toBe('22/11/2026');
    expect(formatDate('2026-11-22', 'dd mmm yyyy')).toBe('22 Nov 2026');
    expect(formatDate('2026-13-40')).toBe('2026-13-40');
    expect(formatDate('next week')).toBe('next week');
    expect(formatDate(null)).toBe('');
    expect(formatDate(1e12)).toBe('1000000000000'); // not a plausible date: shown as a number
    expect(displayCell(c(45000), { numfmt: { type: 'date', pattern: 'yyyy-mm-dd' } }).text).toBe('2023-03-15');
    expect(displayCell(c('2026-11-22'), { numfmt: { type: 'date' } })).toEqual({ text: '22/11/2026', kind: 'text' });
  });
});

describe('how a style is drawn', () => {
  it('turns a valid style into CSS properties', () => {
    const { css } = cellCss(
      {
        weight: 'bold',
        size: 14,
        color: '#112233',
        bg: '#ffeecc',
        halign: 'center',
        valign: 'top',
        borders: { top: 'thin', left: 'thick' },
      },
      'text',
    );
    expect(css).toMatchObject({
      fontWeight: '700',
      fontSize: '14px',
      color: '#112233',
      backgroundColor: '#ffeecc',
      justifyContent: 'center',
      alignItems: 'flex-start',
      borderTop: '1px solid #1f2933',
      borderLeft: '3px solid #1f2933',
    });
  });

  it('aligns by kind unless the style says otherwise', () => {
    expect(cellCss({}, 'number').css.justifyContent).toBe('flex-end');
    expect(cellCss({}, 'boolean').css.justifyContent).toBe('center');
    expect(cellCss({}, 'text').css.justifyContent).toBe('flex-start');
    expect(cellCss({ halign: 'right' }, 'text').css.justifyContent).toBe('flex-end');
    expect(cellCss({}, 'text').css.alignItems).toBe('center');
  });

  it('lets nothing through that is not on the whitelist (a stored style may be older than the validator)', () => {
    const hostile = {
      color: 'red; background: url(//evil.example/x)',
      bg: 'url(x)',
      size: '14px; position: fixed',
      weight: 'bolder',
      halign: 'justify',
      borders: { top: 'dashed 9px red', bottom: 'thin', front: 'thin' },
      numfmt: { type: 'general', currency: 'PKR; x' },
      position: 'fixed',
      'font-family': 'x',
    };
    const { css, style } = cellCss(hostile, 'text');
    expect(style).toEqual({ borders: { bottom: 'thin' }, numfmt: { type: 'general' } });
    expect(Object.keys(css).sort()).toEqual(['alignItems', 'borderBottom', 'justifyContent']);
    expect(JSON.stringify(css)).not.toMatch(/url|evil|fixed|red/);
    expect(cellCss(null).css).toMatchObject({ justifyContent: 'flex-start' });
    expect(cellCss('x').style).toEqual({});
  });
});

describe('describing a cell from a sheet', () => {
  const SHEET = '0a000000-0000-4000-8000-0000000000e1';
  function sheetWith() {
    const wb = createWorkbook();
    applyOps(wb, [
      buildOp('add_sheet', { sheet_id: SHEET, name: 'S' }),
      buildOp('set_styles', {
        sheet_id: SHEET,
        styles: [{ style_id: 3, style: { weight: 'bold', numfmt: { type: 'currency', currency: 'PKR' } } }],
      }),
    ]);
    applyOps(wb, [
      buildOp('set_cells', {
        sheet_id: SHEET,
        base_seq: wb.head_seq,
        cells: [
          { r: 1, c: 1, value: 1500, style_id: 3 },
          { r: 2, c: 1, formula: '=A1*2' },
          { r: 3, c: 1, value: 'x' },
        ],
      }),
    ]);
    // cleared in a later operation: leaves an empty marker
    applyOps(wb, [buildOp('set_cells', { sheet_id: SHEET, base_seq: wb.head_seq, cells: [{ r: 3, c: 1 }] })]);
    return findSheet(wb, SHEET);
  }

  it('uses the stored style and format', () => {
    const d = describeCell(sheetWith(), 1, 1);
    expect(d).toMatchObject({ text: 'PKR 1,500.00', kind: 'number', value: 1500, formula: null });
    expect(d.css.fontWeight).toBe('700');
    expect(d.css.justifyContent).toBe('flex-end');
  });

  it('shows a formula as its text, and never shows markers or missing cells', () => {
    const sh = sheetWith();
    expect(describeCell(sh, 2, 1)).toMatchObject({ text: '=A1*2', kind: 'formula', formula: '=A1*2' });
    expect(describeCell(sh, 3, 1)).toMatchObject({ text: '', kind: 'empty', css: {} });
    expect(describeCell(sh, 99, 99)).toMatchObject({ text: '', kind: 'empty' });
  });

  it('survives a cell that names a style the sheet does not have', () => {
    const sh = sheetWith();
    sh.cells.set('5:5', { r: 5, c: 5, value: 'orphan', formula: null, style_id: 999, last_seq: 1 });
    expect(describeCell(sh, 5, 5)).toMatchObject({ text: 'orphan', kind: 'text' });
  });
});
