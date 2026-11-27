// The grid itself: a scrolling area that draws only the rows and columns on screen (a sheet can hold 10,000 rows and 100
// columns). Read-only: tap or arrow keys select a cell, nothing is edited here.
//
// How it works: a scroll container holds an invisible "sizer" as big as the whole sheet, so the browser scrolls natively
// (smooth on a phone), and a "stage" that stays in view (position: sticky). On every scroll the stage is redrawn with the
// cells that are visible. Frozen rows and columns and the A, B, C and 1, 2, 3 headers are drawn at fixed positions on top.
//
// Styles come from the database. The page's content security policy refuses inline style attributes, so every
// position and style is set through the DOM style API, and only values that passed sanitizeStyle ever get there. Cell text
// is always set with textContent.
import { colLabel } from '../domain/spreadsheet.js';
import { axisLayout, describeCell, GRID, indexAt, scrollToShow, visibleRange } from '../domain/grid.js';

const el = (tag, className, parent) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (parent) parent.append(node);
  return node;
};

function place(node, x, y, w, h) {
  node.style.left = `${x}px`;
  node.style.top = `${y}px`;
  node.style.width = `${w}px`;
  node.style.height = `${h}px`;
}

const range = (from, to) => Array.from({ length: Math.max(to - from, 0) }, (_, i) => from + i);
const clamp = (n, lo, hi) => Math.min(Math.max(n, lo), hi);
const schedule = (fn) => (globalThis.requestAnimationFrame ? globalThis.requestAnimationFrame(fn) : setTimeout(fn, 16));

// onSelect receives { label, rowIndex, colIndex, rowId, colId, text, value, formula } or null.
// measure() may be passed to override the size of the viewport (tests; a hidden tab reports 0).
export function createGridView(host, { onSelect = () => {}, onActivate = () => {}, measure = null } = {}) {
  host.classList.add('ws-grid');
  host.setAttribute('role', 'grid');
  host.setAttribute('aria-readonly', 'true');
  host.tabIndex = 0;
  const scroller = el('div', 'ws-grid-scroll');
  const sizer = el('div', 'ws-grid-sizer', scroller);
  const stage = el('div', 'ws-grid-stage', scroller);
  host.replaceChildren(scroller);

  let sheet = null;
  let calc = null; // calculated results for formula cells (domain/formulas/sheetCalc.js), or null
  let rows = axisLayout([], null, GRID.rowHeight);
  let cols = axisLayout([], null, GRID.colWidth);
  let sel = null; // { row: rowId, col: colId }
  let queued = false;
  let alive = true;

  const viewport = () => {
    const m = measure ? measure() : { width: scroller.clientWidth, height: scroller.clientHeight };
    return { width: m.width, height: m.height };
  };
  const frozenRows = () => clamp(sheet?.frozen_rows ?? 0, 0, rows.ids.length);
  const frozenCols = () => clamp(sheet?.frozen_cols ?? 0, 0, cols.ids.length);

  function selectionInfo() {
    if (!sheet || !sel) return null;
    const rowIndex = rows.ids.indexOf(sel.row);
    const colIndex = cols.ids.indexOf(sel.col);
    if (rowIndex < 0 || colIndex < 0) return null;
    const d = describeCell(sheet, sel.row, sel.col, calc);
    return {
      label: `${colLabel(colIndex)}${rowIndex + 1}`,
      rowIndex,
      colIndex,
      rowId: sel.row,
      colId: sel.col,
      text: d.text,
      value: d.value,
      formula: d.formula,
    };
  }

  function draw() {
    queued = false;
    if (!alive) return;
    if (!sheet) {
      stage.replaceChildren();
      return;
    }
    const { width, height } = viewport();
    const HW = GRID.headerWidth;
    const HH = GRID.headerHeight;
    const bodyW = Math.max(width - HW, 0);
    const bodyH = Math.max(height - HH, 0);
    const sx = scroller.scrollLeft;
    const sy = scroller.scrollTop;
    const fr = frozenRows();
    const fc = frozenCols();
    const rr = visibleRange(rows, sy, bodyH, { frozen: fr });
    const cr = visibleRange(cols, sx, bodyW, { frozen: fc });
    const rowIdx = [...range(0, fr), ...range(rr.from, rr.to)];
    const colIdx = [...range(0, fc), ...range(cr.from, cr.to)];
    const X = (i) => HW + cols.starts[i] - (i < fc ? 0 : sx);
    const Y = (j) => HH + rows.starts[j] - (j < fr ? 0 : sy);
    const W = (i) => cols.starts[i + 1] - cols.starts[i];
    const H = (j) => rows.starts[j + 1] - rows.starts[j];

    const layers = {
      body: el('div', 'ws-layer ws-layer-body'),
      rows: el('div', 'ws-layer ws-layer-frozen'),
      cols: el('div', 'ws-layer ws-layer-frozen'),
      corner: el('div', 'ws-layer ws-layer-corner'),
      head: el('div', 'ws-layer ws-layer-head'),
    };
    for (const j of rowIdx) {
      for (const i of colIdx) {
        const layer = j < fr && i < fc ? layers.corner : j < fr ? layers.rows : i < fc ? layers.cols : layers.body;
        const d = describeCell(sheet, rows.ids[j], cols.ids[i], calc);
        const cell = el('div', 'ws-cell', layer);
        place(cell, X(i), Y(j), W(i), H(j));
        cell.setAttribute('role', 'gridcell');
        cell.setAttribute('aria-rowindex', String(j + 2));
        cell.setAttribute('aria-colindex', String(i + 2));
        cell.dataset.row = String(j);
        cell.dataset.col = String(i);
        if (d.kind === 'formula') cell.classList.add('is-formula');
        if (d.kind === 'error') cell.classList.add('is-error');
        if (d.kind === 'number') cell.classList.add('is-number');
        if (sel && sel.row === rows.ids[j] && sel.col === cols.ids[i]) {
          cell.classList.add('is-selected');
          cell.setAttribute('aria-selected', 'true');
        }
        for (const [prop, value] of Object.entries(d.css)) cell.style[prop] = value;
        if (d.text !== '') el('span', 'ws-cell-text', cell).textContent = d.text;
      }
    }
    // headers, drawn last so they sit on top
    // Scrolled headers first, frozen ones after them: later siblings paint on top, so a scrolled header slides under a frozen one.
    const scrolledFirst = (list, frozen) => [...list.filter((n) => n >= frozen), ...list.filter((n) => n < frozen)];
    for (const i of scrolledFirst(colIdx, fc)) {
      const h = el('div', 'ws-head ws-head-col', layers.head);
      place(h, X(i), 0, W(i), HH);
      h.setAttribute('role', 'columnheader');
      h.setAttribute('aria-colindex', String(i + 2));
      h.textContent = colLabel(i);
      if (sel && sel.col === cols.ids[i]) h.classList.add('is-active');
    }
    for (const j of scrolledFirst(rowIdx, fr)) {
      const h = el('div', 'ws-head ws-head-row', layers.head);
      place(h, 0, Y(j), HW, H(j));
      h.setAttribute('role', 'rowheader');
      h.setAttribute('aria-rowindex', String(j + 2));
      h.textContent = String(j + 1);
      if (sel && sel.row === rows.ids[j]) h.classList.add('is-active');
    }
    place(el('div', 'ws-head ws-head-corner', layers.head), 0, 0, HW, HH);
    stage.replaceChildren(layers.body, layers.rows, layers.cols, layers.corner, layers.head);
    // A number that does not fit its column is shown as #### (as spreadsheets do), never cut short: "170,0..." would look like
    // a different number. The full value is in the bar when the cell is selected. All reads happen after all writes, so the
    // browser measures once.
    for (const span of stage.querySelectorAll('.ws-cell.is-number .ws-cell-text')) {
      if (span.scrollWidth > span.clientWidth) span.textContent = '####';
    }
  }

  function queue() {
    if (queued || !alive) return;
    queued = true;
    schedule(draw);
  }

  function layout() {
    rows = axisLayout(sheet?.row_order, sheet?.row_sizes, GRID.rowHeight);
    cols = axisLayout(sheet?.col_order, sheet?.col_sizes, GRID.colWidth);
    sizer.style.width = `${GRID.headerWidth + cols.total}px`;
    sizer.style.height = `${GRID.headerHeight + rows.total}px`;
    host.setAttribute('aria-rowcount', String(rows.ids.length + 1));
    host.setAttribute('aria-colcount', String(cols.ids.length + 1));
  }

  function select(rowId, colId, { reveal = true } = {}) {
    sel = rowId === null ? null : { row: rowId, col: colId };
    if (sel && reveal) {
      const { height, width } = viewport();
      const j = rows.ids.indexOf(rowId);
      const i = cols.ids.indexOf(colId);
      scroller.scrollTop = scrollToShow(rows, j, scroller.scrollTop, Math.max(height - GRID.headerHeight, 0), frozenRows());
      scroller.scrollLeft = scrollToShow(cols, i, scroller.scrollLeft, Math.max(width - GRID.headerWidth, 0), frozenCols());
    }
    draw();
    onSelect(selectionInfo());
  }

  scroller.addEventListener('scroll', queue, { passive: true });
  stage.addEventListener('click', (e) => {
    const cell = e.target.closest?.('.ws-cell');
    if (!cell || !sheet) return;
    const j = Number(cell.dataset.row);
    const i = Number(cell.dataset.col);
    const again = sel !== null && sel.row === rows.ids[j] && sel.col === cols.ids[i];
    select(rows.ids[j], cols.ids[i], { reveal: false });
    host.focus({ preventScroll: true });
    if (again) onActivate(); // tapping the selected cell again starts editing it, as in a spreadsheet
  });
  host.addEventListener('keydown', (e) => {
    if (!sheet || rows.ids.length === 0 || cols.ids.length === 0) return;
    const cur = selectionInfo();
    if (cur && (e.key === 'Enter' || e.key === 'F2')) {
      e.preventDefault();
      onActivate();
      return;
    }
    if (cur && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      onActivate(e.key); // typing on a selected cell replaces its content
      return;
    }
    let j = cur ? cur.rowIndex : 0;
    let i = cur ? cur.colIndex : 0;
    const page = Math.max(Math.floor((viewport().height - GRID.headerHeight) / GRID.rowHeight) - 1, 1);
    const moves = {
      ArrowUp: () => (j -= 1),
      ArrowDown: () => (j += 1),
      ArrowLeft: () => (i -= 1),
      ArrowRight: () => (i += 1),
      PageUp: () => (j -= page),
      PageDown: () => (j += page),
      Home: () => (i = 0),
      End: () => (i = cols.ids.length - 1),
    };
    if (!moves[e.key]) return;
    e.preventDefault();
    if (cur) moves[e.key]();
    select(rows.ids[clamp(j, 0, rows.ids.length - 1)], cols.ids[clamp(i, 0, cols.ids.length - 1)]);
  });
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(queue) : null;
  observer?.observe(scroller);

  return {
    // Show a sheet. Keeps the scroll position when it is the same sheet (a refresh); starts at the top for another one.
    // `nextCalc` gives formula cells their calculated results.
    setSheet(next, nextCalc = null) {
      const same = sheet && next && sheet.id === next.id;
      sheet = next;
      calc = nextCalc;
      layout();
      if (!same) {
        scroller.scrollTop = 0;
        scroller.scrollLeft = 0;
        sel = null;
      }
      draw();
      onSelect(selectionInfo());
    },
    select,
    // Select the cell `dRow` rows and `dCol` columns away (stays put at the edge).
    move(dRow, dCol) {
      const cur = selectionInfo();
      if (!cur || rows.ids.length === 0 || cols.ids.length === 0) return;
      select(rows.ids[clamp(cur.rowIndex + dRow, 0, rows.ids.length - 1)], cols.ids[clamp(cur.colIndex + dCol, 0, cols.ids.length - 1)]);
    },
    getSelection: selectionInfo,
    redraw: draw,
    // Where a cell would be drawn; used by tests and by "scroll to".
    indexAt: (axis, offset) => indexAt(axis === 'rows' ? rows : cols, offset),
    destroy() {
      alive = false;
      observer?.disconnect();
      host.replaceChildren();
    },
  };
}
