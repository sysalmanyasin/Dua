// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  openWorkbookFull: vi.fn(),
  pullAndApply: vi.fn(),
  flush: vi.fn(),
  enqueue: vi.fn(),
  listDocuments: vi.fn(),
  createDocument: vi.fn(),
  listFolders: vi.fn(),
  listUserState: vi.fn(),
}));
vi.mock('../../js/modules/workspace/data/workbooks.js', () => ({
  openWorkbookFull: m.openWorkbookFull,
  pullAndApply: m.pullAndApply,
  createOperationSender: () => ({ enqueue: m.enqueue, flush: m.flush }),
}));
vi.mock('../../js/modules/workspace/data/documents.js', () => ({
  listDocuments: m.listDocuments,
  createDocument: m.createDocument,
  listFolders: m.listFolders,
  listUserState: m.listUserState,
  saveFolder: vi.fn(),
  setDocumentFlags: vi.fn(),
}));
vi.mock('../../js/modules/workspace/data/notes.js', () => ({ searchNotes: vi.fn().mockResolvedValue([]) }));

import { OPEN_KEY } from '../../js/modules/workspace/domain/documents.js';
import { applyOps, buildOp, createWorkbook, findSheet } from '../../js/modules/workspace/domain/spreadsheet.js';
import { createGridView } from '../../js/modules/workspace/ui/gridView.js';
import { mount as mountHome } from '../../js/modules/workspace/ui/home.js';
import { mount as mountSheet } from '../../js/modules/workspace/ui/sheet.js';

const S1 = '0a000000-0000-4000-8000-0000000000e1';
const S2 = '0a000000-0000-4000-8000-0000000000e2';
const VIEW = { width: 400, height: 300 };
const measure = () => VIEW;
const settle = () => new Promise((r) => setTimeout(r, 0));

// A workbook with two sheets, some styled cells and a formula.
function makeWorkbook() {
  const wb = createWorkbook();
  applyOps(wb, [
    buildOp('add_sheet', { sheet_id: S1, name: 'Stock' }),
    buildOp('add_sheet', { sheet_id: S2, name: 'Prices' }),
    buildOp('set_styles', {
      sheet_id: S1,
      styles: [{ style_id: 1, style: { weight: 'bold', bg: '#ffeecc', numfmt: { type: 'currency', currency: 'PKR' } } }],
    }),
  ]);
  applyOps(wb, [
    buildOp('set_cells', {
      sheet_id: S1,
      base_seq: wb.head_seq,
      cells: [
        { r: 1, c: 1, value: 'Item' },
        { r: 1, c: 2, value: 'Price' },
        { r: 2, c: 1, value: 'Panadol' },
        { r: 2, c: 2, value: 1500, style_id: 1 },
        { r: 3, c: 2, formula: '=B2*2' },
        { r: 4, c: 1, value: '<img src=x onerror=alert(1)>' },
      ],
    }),
    buildOp('set_cells', { sheet_id: S2, base_seq: wb.head_seq, cells: [{ r: 1, c: 1, value: 'Other sheet' }] }),
  ]);
  return wb;
}
const info = (over = {}) => ({
  id: 'wb1',
  title: 'Stock take',
  role: 'owner',
  archived: false,
  head_version: 9,
  history_visible_to_viewers: false,
  ...over,
});

let host;
// The grid keeps its own scroll offsets; jsdom has no layout, so give the scroll container plain writable ones.
function scrollerOf(root) {
  const sc = root.querySelector('.ws-grid-scroll');
  let top = 0;
  let left = 0;
  Object.defineProperty(sc, 'scrollTop', {
    configurable: true,
    get: () => top,
    set: (v) => {
      top = v;
    },
  });
  Object.defineProperty(sc, 'scrollLeft', {
    configurable: true,
    get: () => left,
    set: (v) => {
      left = v;
    },
  });
  return sc;
}
const cellsIn = (root) => [...root.querySelectorAll('.ws-cell')];
const at = (root, row, col) => root.querySelector(`.ws-cell[data-row="${row}"][data-col="${col}"]`);
const text = (node) => node?.textContent ?? null;

beforeEach(async () => {
  host = document.createElement('div');
  document.body.append(host);
  sessionStorage.clear();
  vi.clearAllMocks();
  location.hash = '#/workspace/sheet';
  await settle(); // jsdom reports a hash change a moment later; let it pass before the test mounts anything
});
afterEach(() => {
  window.dispatchEvent(new HashChangeEvent('hashchange')); // as leaving the page does: releases listeners
  host.remove();
  document.title = '';
});

describe('the grid view', () => {
  function gridFor(sheet, extra = {}) {
    const selections = [];
    const grid = createGridView(host, { measure, onSelect: (s) => selections.push(s), ...extra });
    const sc = scrollerOf(host);
    grid.setSheet(sheet);
    return { grid, sc, selections };
  }

  it('draws headers, values, formatted numbers and styles', () => {
    const { grid } = gridFor(findSheet(makeWorkbook(), S1));
    expect([...host.querySelectorAll('.ws-head-col')].slice(0, 3).map(text)).toEqual(['A', 'B', 'C']);
    expect([...host.querySelectorAll('.ws-head-row')].slice(0, 3).map(text)).toEqual(['1', '2', '3']);
    expect(text(at(host, 0, 0))).toBe('Item');
    const price = at(host, 1, 1);
    expect(text(price)).toBe('PKR 1,500.00');
    expect(price.style.fontWeight).toBe('700');
    expect(price.style.backgroundColor).toBe('rgb(255, 238, 204)');
    expect(price.style.justifyContent).toBe('flex-end');
    expect(at(host, 2, 1).classList.contains('is-formula')).toBe(true);
    expect(text(at(host, 2, 1))).toBe('=B2*2'); // formulas are not calculated yet
    grid.destroy();
  });

  it('draws only what is on screen, however big the sheet is', () => {
    const sheet = findSheet(makeWorkbook(), S1); // 100 rows x 26 columns = 2,600 cells
    gridFor(sheet);
    const n = cellsIn(host).length;
    expect(n).toBeGreaterThan(20);
    expect(n).toBeLessThan(150);
    // a taller phone draws a few more, still far from all of them
    host.replaceChildren();
    createGridView(host, { measure: () => ({ width: 400, height: 800 }) }).setSheet(sheet);
    expect(cellsIn(host).length).toBeLessThan(300);
  });

  it('follows the scroll position', () => {
    const { grid, sc } = gridFor(findSheet(makeWorkbook(), S1));
    sc.scrollTop = 28 * 50;
    grid.redraw();
    const rowNumbers = [...host.querySelectorAll('.ws-head-row')].map((h) => Number(h.textContent));
    expect(rowNumbers).toContain(51);
    expect(rowNumbers).not.toContain(1);
    expect(at(host, 50, 0)).not.toBeNull();
    expect(at(host, 0, 0)).toBeNull();
    // scrolling right moves the columns the same way
    sc.scrollLeft = 96 * 10;
    grid.redraw();
    expect([...host.querySelectorAll('.ws-head-col')].map(text)).toContain('K');
    expect([...host.querySelectorAll('.ws-head-col')].map(text)).not.toContain('A');
  });

  it('redraws when the browser reports a scroll, once per frame', () => {
    const frames = [];
    vi.stubGlobal('requestAnimationFrame', (fn) => (frames.push(fn), frames.length));
    try {
      const { sc } = gridFor(findSheet(makeWorkbook(), S1));
      sc.scrollTop = 28 * 30;
      sc.dispatchEvent(new Event('scroll'));
      sc.dispatchEvent(new Event('scroll'));
      sc.dispatchEvent(new Event('scroll'));
      expect(frames).toHaveLength(1);
      expect(at(host, 30, 0)).toBeNull(); // not yet
      frames[0]();
      expect(at(host, 30, 0)).not.toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('keeps frozen rows and columns on screen while the rest scrolls', () => {
    const sheet = findSheet(makeWorkbook(), S1);
    sheet.frozen_rows = 1;
    sheet.frozen_cols = 1;
    const { grid, sc } = gridFor(sheet);
    sc.scrollTop = 28 * 60;
    sc.scrollLeft = 96 * 12;
    grid.redraw();
    expect(text(at(host, 0, 0))).toBe('Item'); // corner
    expect(at(host, 0, 14)).not.toBeNull(); // frozen row, scrolled columns
    expect(at(host, 61, 0)).not.toBeNull(); // frozen column, scrolled rows
    expect(at(host, 1, 1)).toBeNull(); // everything else has scrolled away
    const corner = at(host, 0, 0);
    expect(corner.style.left).toBe('44px'); // header width: it did not move
    expect(corner.style.top).toBe('28px');
  });

  it('paints frozen headers above scrolled ones, so a scrolled header slides under the frozen one', () => {
    const sheet = findSheet(makeWorkbook(), S1);
    sheet.frozen_rows = 1;
    sheet.frozen_cols = 1;
    const { grid, sc } = gridFor(sheet);
    sc.scrollTop = 28 * 60;
    sc.scrollLeft = 96 * 3;
    grid.redraw();
    const order = (selector) => [...host.querySelectorAll(selector)].map((h) => h.textContent);
    const cols = order('.ws-head-col'); // later in the list = painted on top
    expect(cols.at(-1)).toBe('A');
    expect(cols.indexOf('D')).toBeLessThan(cols.indexOf('A'));
    const rows = order('.ws-head-row');
    expect(rows.at(-1)).toBe('1');
    expect(rows.indexOf('61')).toBeLessThan(rows.indexOf('1'));
    // and the corner is last of all
    expect(host.querySelector('.ws-layer-head').lastElementChild.classList.contains('ws-head-corner')).toBe(true);
  });

  it('uses stored row heights and column widths', () => {
    const sheet = findSheet(makeWorkbook(), S1);
    sheet.col_sizes = { 1: 200 };
    sheet.row_sizes = { 2: 60 };
    gridFor(sheet);
    expect(at(host, 0, 0).style.width).toBe('200px');
    expect(at(host, 0, 1).style.left).toBe('244px'); // 44 header + 200
    expect(at(host, 1, 0).style.height).toBe('60px');
    expect(at(host, 2, 0).style.top).toBe(`${28 + 28 + 60}px`);
  });

  it('selects on tap and tells the screen what the cell holds', () => {
    const { selections } = gridFor(findSheet(makeWorkbook(), S1));
    at(host, 1, 1).click();
    const sel = selections.at(-1);
    expect(sel).toMatchObject({ label: 'B2', rowIndex: 1, colIndex: 1, text: 'PKR 1,500.00', value: 1500, formula: null });
    expect(at(host, 1, 1).classList.contains('is-selected')).toBe(true);
    expect(at(host, 1, 1).getAttribute('aria-selected')).toBe('true');
    expect(host.querySelector('.ws-head-col.is-active').textContent).toBe('B');
    expect(host.querySelector('.ws-head-row.is-active').textContent).toBe('2');
    at(host, 2, 1).click();
    expect(selections.at(-1)).toMatchObject({ label: 'B3', formula: '=B2*2' });
    expect(host.querySelectorAll('.is-selected')).toHaveLength(1);
  });

  it('moves the selection with the arrow keys and scrolls to keep it in view', () => {
    const { sc, selections } = gridFor(findSheet(makeWorkbook(), S1));
    const key = (k) => host.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
    key('ArrowDown'); // nothing selected yet: selects the first cell
    expect(selections.at(-1).label).toBe('A1');
    key('ArrowDown');
    key('ArrowRight');
    expect(selections.at(-1).label).toBe('B2');
    key('ArrowUp');
    key('ArrowUp'); // stops at the top
    key('ArrowLeft');
    key('ArrowLeft'); // and at the left edge
    expect(selections.at(-1).label).toBe('A1');
    key('End');
    expect(selections.at(-1).label).toBe('Z1');
    expect(sc.scrollLeft).toBeGreaterThan(0);
    key('Home');
    expect(selections.at(-1).label).toBe('A1');
    for (let i = 0; i < 20; i += 1) key('PageDown');
    expect(selections.at(-1).label).toBe('A100'); // stops at the last row
    expect(sc.scrollTop).toBeGreaterThan(0);
    expect(at(host, 99, 0).classList.contains('is-selected')).toBe(true);
    const e = new KeyboardEvent('keydown', { key: 'x', bubbles: true, cancelable: true });
    host.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false); // other keys are left alone
  });

  it('keeps the scroll position on a refresh of the same sheet but starts at the top for another sheet', () => {
    const wb = makeWorkbook();
    const { grid, sc } = gridFor(findSheet(wb, S1));
    sc.scrollTop = 28 * 40;
    grid.setSheet(findSheet(wb, S1));
    expect(sc.scrollTop).toBe(28 * 40);
    grid.setSheet(findSheet(wb, S2));
    expect(sc.scrollTop).toBe(0);
    expect(text(at(host, 0, 0))).toBe('Other sheet');
  });

  it('drops the selection when its row or column no longer exists', () => {
    const wb = makeWorkbook();
    const { grid, selections } = gridFor(findSheet(wb, S1));
    at(host, 1, 1).click();
    applyOps(wb, [buildOp('delete_cols', { sheet_id: S1, ids: [2] })]);
    grid.setSheet(findSheet(wb, S1));
    expect(selections.at(-1)).toBeNull();
    expect(host.querySelector('.is-selected')).toBeNull();
  });

  it('shows cell text as text, never as markup', () => {
    gridFor(findSheet(makeWorkbook(), S1));
    expect(text(at(host, 3, 0))).toBe('<img src=x onerror=alert(1)>');
    expect(host.querySelector('img')).toBeNull();
  });

  it('shows #### for a number wider than its column, never a cut-off number, and the bar still has the full value', () => {
    // jsdom has no layout, so say which texts are too wide: the price (a number) overflows, the long text would only be cut with an ellipsis
    const spy = vi.spyOn(Element.prototype, 'scrollWidth', 'get').mockImplementation(function () {
      return this.classList?.contains('ws-cell-text') ? 500 : 0;
    });
    try {
      const { selections } = gridFor(findSheet(makeWorkbook(), S1));
      expect(text(at(host, 1, 1))).toBe('####'); // PKR 1,500.00
      expect(text(at(host, 1, 0))).toBe('Panadol'); // text is not turned into ####
      at(host, 1, 1).click();
      expect(selections.at(-1)).toMatchObject({ text: 'PKR 1,500.00', value: 1500 });
    } finally {
      spy.mockRestore();
    }
  });

  it('draws nothing from a style that is not exactly valid', () => {
    const sheet = findSheet(makeWorkbook(), S1);
    sheet.styles.set(7, { color: 'red; background: url(//evil.example/x)', bg: 'url(x)', size: '14px; position: fixed', weight: 'bolder' });
    sheet.cells.set('5:1', { r: 5, c: 1, value: 'odd', formula: null, style_id: 7, last_seq: 1 });
    gridFor(sheet);
    const cell = at(host, 4, 0);
    expect(text(cell)).toBe('odd');
    expect(cell.style.color).toBe('');
    expect(cell.style.backgroundColor).toBe('');
    expect(cell.style.fontSize).toBe('');
    expect(cell.style.left).toMatch(/px$/); // its place, set by the grid
    expect(cell.getAttribute('style')).not.toMatch(/evil|url/);
  });

  it('copes with a sheet with no rows or columns, and with none at all', () => {
    const { grid } = gridFor(null);
    expect(cellsIn(host)).toHaveLength(0);
    grid.setSheet({
      id: 'x',
      row_order: [],
      col_order: [],
      row_sizes: {},
      col_sizes: {},
      frozen_rows: 0,
      frozen_cols: 0,
      cells: new Map(),
      styles: new Map(),
    });
    host.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(cellsIn(host)).toHaveLength(0);
  });

  it('sets the ARIA grid size and stops drawing after destroy', () => {
    const { grid } = gridFor(findSheet(makeWorkbook(), S1));
    expect(host.getAttribute('role')).toBe('grid');
    expect(host.getAttribute('aria-readonly')).toBe('true');
    expect(host.getAttribute('aria-rowcount')).toBe('101');
    expect(host.getAttribute('aria-colcount')).toBe('27');
    expect(at(host, 0, 0).getAttribute('role')).toBe('gridcell');
    grid.destroy();
    expect(host.querySelector('.ws-grid-scroll')).toBeNull();
  });
});

describe('the workbook screen', () => {
  const open = (wb = makeWorkbook(), over = {}) => m.openWorkbookFull.mockResolvedValue({ wb, info: info(over), applied: 0 });
  const go = async () => {
    sessionStorage.setItem(OPEN_KEY, 'wb1');
    await mountSheet(host, { measure });
    scrollerOf(host);
  };
  const click = (selector) => host.querySelector(selector).click();

  it('asks which workbook when none is open, and says so plainly when it cannot be opened', async () => {
    await mountSheet(host, { measure });
    expect(host.textContent).toContain('No workbook is open');
    expect(m.openWorkbookFull).not.toHaveBeenCalled();
    sessionStorage.setItem(OPEN_KEY, 'wb1');
    m.openWorkbookFull.mockRejectedValue(new Error('You do not have access to this.'));
    await mountSheet(host, { measure });
    expect(host.textContent).toContain('This workbook could not be opened');
    expect(host.textContent).toContain('You do not have access to this.');
    expect(host.querySelector('a[href="#/workspace"]')).not.toBeNull();
  });

  it('opens the workbook that home chose and shows title, role, sheets and grid', async () => {
    open();
    await go();
    expect(m.openWorkbookFull).toHaveBeenCalledWith('wb1', expect.any(Object));
    expect(text(host.querySelector('#ws-sheet-title'))).toBe('Stock take');
    expect(text(host.querySelector('#ws-role'))).toBe('Owner');
    expect(document.title).toBe('Stock take · Dua');
    expect([...host.querySelectorAll('.ws-tab')].map(text)).toEqual(['Stock', 'Prices']);
    expect(host.querySelector('.ws-tab.is-active').textContent).toBe('Stock');
    expect(text(at(host, 0, 0))).toBe('Item');
    expect(host.textContent).toContain('Tap a cell, type, then Save');
    expect(host.querySelector('[data-act="add-sheet"]')).toBeNull();
  });

  it('shows the content of the tapped cell above the grid, a formula as its text with what it shows', async () => {
    open();
    await go();
    const box = () => host.querySelector('.ws-edit-input');
    expect(box().placeholder).toContain('Tap a cell');
    expect(box().disabled).toBe(true);
    at(host, 1, 0).click();
    expect(text(host.querySelector('.ws-formula-label'))).toBe('A2');
    expect(box().value).toBe('Panadol');
    expect(host.querySelector('.ws-edit-result').hidden).toBe(true); // not a formula
    at(host, 2, 1).click();
    expect(text(host.querySelector('.ws-formula-label'))).toBe('B3');
    expect(box().value).toBe('=B2*2');
    expect(box().readOnly).toBe(false);
    expect(host.querySelector('.ws-edit-result').hidden).toBe(false);
    expect(host.querySelector('.ws-edit-result').textContent).toBe('Shows: 3000'); // B2 holds 1500 (PKR format); B3 has no format
  });

  it('switches sheets from the tabs', async () => {
    open();
    await go();
    click('[data-sheet="' + S2 + '"]');
    expect(host.querySelector('.ws-tab.is-active').textContent).toBe('Prices');
    expect(text(at(host, 0, 0))).toBe('Other sheet');
    expect(host.querySelector('.ws-formula-label').textContent).toBe('—'); // selection cleared
  });

  it('refreshes by pulling what changed, keeping the sheet and showing the new value', async () => {
    const wb = makeWorkbook();
    open(wb);
    await go();
    click('[data-sheet="' + S2 + '"]');
    m.pullAndApply.mockImplementation(async () => {
      applyOps(wb, [buildOp('set_cells', { sheet_id: S2, base_seq: wb.head_seq, cells: [{ r: 1, c: 1, value: 'Edited by Bob' }] })]);
      return { status: 'ok', applied: 1 };
    });
    click('[data-act="refresh"]');
    expect(host.querySelector('[data-act="refresh"]').disabled).toBe(true); // busy while it works
    await settle();
    expect(m.pullAndApply).toHaveBeenCalledWith(wb, 'wb1');
    expect(text(at(host, 0, 0))).toBe('Edited by Bob');
    expect(host.querySelector('.ws-tab.is-active').textContent).toBe('Prices');
    expect(host.querySelector('[data-act="refresh"]').disabled).toBe(false);
  });

  it('opens the workbook again when the copy cannot follow (a restore)', async () => {
    open();
    await go();
    const fresh = makeWorkbook();
    applyOps(fresh, [buildOp('set_cells', { sheet_id: S1, base_seq: fresh.head_seq, cells: [{ r: 1, c: 1, value: 'Restored' }] })]);
    m.openWorkbookFull.mockResolvedValue({ wb: fresh, info: info({ title: 'Stock take (restored)' }), applied: 0 });
    m.pullAndApply.mockResolvedValue({ status: 'reload', reason: 'restored' });
    click('[data-act="refresh"]');
    await settle();
    expect(m.openWorkbookFull).toHaveBeenCalledTimes(2);
    expect(text(at(host, 0, 0))).toBe('Restored');
    expect(text(host.querySelector('#ws-sheet-title'))).toBe('Stock take (restored)');
    expect(host.querySelector('#ws-banner').textContent).toContain('loaded again');
  });

  it('a failed refresh shows a message and keeps the grid', async () => {
    open();
    await go();
    m.pullAndApply.mockRejectedValue(new Error('Something went wrong. Please try again.'));
    click('[data-act="refresh"]');
    await settle();
    expect(host.querySelector('.ws-banner-warn').textContent).toContain('Something went wrong');
    expect(text(at(host, 0, 0))).toBe('Item');
    expect(host.querySelector('[data-act="refresh"]').disabled).toBe(false);
  });

  it('refreshes quietly when the person comes back after a while, and not before', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      open();
      await go();
      m.pullAndApply.mockResolvedValue({ status: 'ok', applied: 0 });
      document.dispatchEvent(new Event('visibilitychange'));
      await settle();
      expect(m.pullAndApply).not.toHaveBeenCalled(); // only just loaded
      vi.setSystemTime(Date.now() + 61000);
      document.dispatchEvent(new Event('visibilitychange'));
      await settle();
      expect(m.pullAndApply).toHaveBeenCalledTimes(1);
      m.pullAndApply.mockRejectedValue(new Error('x'));
      vi.setSystemTime(Date.now() + 61000);
      document.dispatchEvent(new Event('visibilitychange'));
      await settle();
      expect(host.querySelector('#ws-banner').textContent).toContain('Could not refresh'); // a quiet note, not an error
      expect(host.querySelector('.ws-banner-warn')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a workbook with no sheet offers the owner "Add a sheet", which adds one and reloads', async () => {
    const wb = createWorkbook();
    open(wb);
    await go();
    expect(host.textContent).toContain('no sheet yet');
    expect(host.querySelector('#ws-grid').hidden).toBe(true);
    m.flush.mockResolvedValue({ status: 'answered', results: [{ result: { status: 'applied' } }] });
    m.pullAndApply.mockImplementation(async () => {
      applyOps(wb, [buildOp('add_sheet', { sheet_id: S1, name: 'Sheet1' })]);
      return { status: 'ok', applied: 1 };
    });
    click('[data-act="add-sheet"]');
    await settle();
    const op = m.enqueue.mock.calls[0][0];
    expect(op).toMatchObject({ operation_type: 'add_sheet', payload: { name: 'Sheet1' } });
    expect(op.payload.sheet_id).toMatch(/^[0-9a-f-]{36}$/);
    expect([...host.querySelectorAll('.ws-tab')].map(text)).toEqual(['Sheet1']);
    expect(host.querySelector('[data-act="add-sheet"]')).toBeNull();
    expect(host.querySelector('#ws-grid').hidden).toBe(false);
  });

  it('says why a sheet could not be added', async () => {
    open(createWorkbook());
    await go();
    m.flush.mockResolvedValue({ status: 'offline', error: new Error('x') });
    m.pullAndApply.mockResolvedValue({ status: 'ok', applied: 0 });
    click('[data-act="add-sheet"]');
    await settle();
    expect(host.querySelector('.ws-banner-warn').textContent).toContain('offline');
    m.flush.mockResolvedValue({
      status: 'answered',
      results: [{ result: { status: 'rejected', reason: 'a workbook can have at most 20 sheets' } }],
    });
    click('[data-act="add-sheet"]');
    await settle();
    expect(host.querySelector('.ws-banner-warn').textContent).toContain('at most 20 sheets');
  });

  it('shows no write button to someone who can only view, or on an archived workbook', async () => {
    open(createWorkbook(), { role: 'viewer' });
    await go();
    expect(text(host.querySelector('#ws-role'))).toBe('Can view');
    expect(host.textContent).toContain('no sheet yet');
    expect(host.querySelector('[data-act="add-sheet"]')).toBeNull();
    open(createWorkbook(), { role: 'owner', archived: true });
    await go();
    expect(host.textContent).toContain('archived');
    expect(host.querySelector('[data-act="add-sheet"]')).toBeNull();
  });

  it('stops listening and releases the grid when the person leaves the page', async () => {
    open();
    await go();
    expect(host.querySelector('.ws-grid-scroll')).not.toBeNull();
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(host.querySelector('.ws-grid-scroll')).toBeNull();
  });
});

describe('home', () => {
  const ctx = { permissions: ['workspace.use', 'workspace.create'] };
  const wbDoc = {
    id: 'w9',
    kind: 'workbook',
    title: 'Stock take',
    my_role: 'owner',
    owner_name: 'Ayesha',
    updated_at: new Date().toISOString(),
    deleted_at: null,
  };
  beforeEach(() => {
    m.listDocuments.mockResolvedValue([]);
    m.listFolders.mockResolvedValue([]);
    m.listUserState.mockResolvedValue([]);
  });

  it('opens a workbook from the list in the grid screen', async () => {
    m.listDocuments.mockResolvedValue([wbDoc]);
    await mountHome(host, { ctx });
    host.querySelector('[data-open="w9"]').click();
    expect(sessionStorage.getItem(OPEN_KEY)).toBe('w9');
    expect(location.hash).toBe('#/workspace/sheet');
  });

  it('creates a workbook, adds its first sheet and opens it', async () => {
    m.createDocument.mockResolvedValue({ id: 'new9', kind: 'workbook', title: 'Untitled workbook', head_version: 0 });
    m.flush.mockResolvedValue({ status: 'answered', results: [{ result: { status: 'applied' } }] });
    await mountHome(host, { ctx });
    const btn = host.querySelector('[data-act="new-workbook"]');
    expect(btn.disabled).toBe(false);
    btn.click();
    await settle();
    expect(m.createDocument.mock.calls[0][0]).toMatchObject({ kind: 'workbook', title: 'Untitled workbook' });
    expect(m.enqueue.mock.calls[0][0]).toMatchObject({ operation_type: 'add_sheet' });
    expect(m.flush).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(OPEN_KEY)).toBe('new9');
    expect(location.hash).toBe('#/workspace/sheet');
  });

  it('still opens the new workbook when the first sheet could not be added (the page offers it)', async () => {
    m.createDocument.mockResolvedValue({ id: 'new9', kind: 'workbook', title: 'Untitled workbook', head_version: 0 });
    m.flush.mockRejectedValue(new Error('network'));
    await mountHome(host, { ctx });
    host.querySelector('[data-act="new-workbook"]').click();
    await settle();
    expect(location.hash).toBe('#/workspace/sheet');
  });

  it('says so when the workbook cannot be created, and only people who may create get the button', async () => {
    m.createDocument.mockRejectedValue(new Error('You do not have access to this.'));
    await mountHome(host, { ctx });
    host.querySelector('[data-act="new-workbook"]').click();
    await settle();
    expect(host.querySelector('.note-error').textContent).toContain('You do not have access');
    expect(host.querySelector('[data-act="new-workbook"]').disabled).toBe(false);
    await mountHome(host, { ctx: { permissions: ['workspace.use'] } });
    expect(host.querySelector('[data-act="new-workbook"]').disabled).toBe(true);
  });
});

describe('what the sheet files must never do', () => {
  const files = ['gridView.js', 'sheet.js'].map((f) => [f, readFileSync(`js/modules/workspace/ui/${f}`, 'utf8')]);
  it.each(files)('%s builds nothing from strings: no innerHTML, no cssText, no style attribute, no eval', (_name, src) => {
    expect(src).not.toMatch(
      /innerHTML|outerHTML|insertAdjacentHTML|cssText|setAttribute\(\s*['"]style|\beval\b|new Function|document\.write/,
    );
  });
  it('the grid never writes a value into the page except as text', () => {
    const src = readFileSync('js/modules/workspace/ui/gridView.js', 'utf8');
    expect(src).toMatch(/\.textContent = /);
    expect(src).not.toMatch(/\.innerText|\.append\(\s*d\.text|\.html\(/);
  });
  it('is registered as a route that needs workspace.use and has no tab of its own', () => {
    const src = readFileSync('js/modules/workspace/manifest.js', 'utf8');
    expect(src).toMatch(/path: '\/workspace\/sheet',\s*permission: 'workspace\.use',\s*load: \(\) => import\('\.\/ui\/sheet\.js'\)/);
  });
});
