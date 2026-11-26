// What a Sheets grid needs to know, with no DOM: where each row and column sits, which ones are on screen, what text a cell
// shows and how a stored style becomes CSS. Pure functions, so they are tested exactly.
//
// Rows and columns are drawn in the order of sheet.row_order / sheet.col_order (lists of stable ids). A person sees "A1",
// "B2": those are positions in those lists, never ids.
import { sanitizeStyle } from './spreadsheet.js';

export const GRID = Object.freeze({
  rowHeight: 28,
  colWidth: 96,
  headerHeight: 28,
  headerWidth: 44,
  minSize: 10, // the database accepts 10 to 2000 for a stored size
  maxSize: 2000,
  overscan: 3, // extra rows and columns drawn beyond the edge so a fast swipe does not show blanks
});

const validSize = (v) => (Number.isInteger(v) && v >= GRID.minSize && v <= GRID.maxSize ? v : null);

// Where each item of one axis starts. `sizes` is the stored object keyed by id (as text); anything not a whole number from
// 10 to 2000 falls back to the default. starts has one more entry than ids: starts[n] is the total.
export function axisLayout(order, sizes, fallback) {
  const ids = Array.isArray(order) ? order : [];
  const starts = new Array(ids.length + 1);
  starts[0] = 0;
  for (let i = 0; i < ids.length; i += 1) {
    const stored = sizes && typeof sizes === 'object' ? validSize(sizes[String(ids[i])]) : null;
    starts[i + 1] = starts[i] + (stored ?? fallback);
  }
  return { ids, starts, total: starts[ids.length] };
}

export const sizeAt = (layout, index) => layout.starts[index + 1] - layout.starts[index];

// The index whose span holds `offset`, clamped to the ends. -1 when the axis is empty.
export function indexAt(layout, offset) {
  const n = layout.ids.length;
  if (n === 0) return -1;
  if (offset <= 0) return 0;
  if (offset >= layout.total) return n - 1;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (layout.starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

// Which scrollable items to draw: indexes from <= i < to, never below `frozen` (frozen items are always drawn).
// `scroll` is how far the body is scrolled; `extent` is the size of the body area (without the header).
export function visibleRange(layout, scroll, extent, { frozen = 0, overscan = GRID.overscan } = {}) {
  const n = layout.ids.length;
  const f = Math.min(Math.max(frozen, 0), n);
  if (n === 0 || f >= n || extent <= 0) return { from: f, to: f };
  const frozenSize = layout.starts[f];
  const first = indexAt(layout, Math.max(scroll, 0) + frozenSize);
  const last = indexAt(layout, Math.max(scroll, 0) + extent - 1);
  return { from: Math.max(f, first - overscan), to: Math.min(n, last + 1 + overscan) };
}

// The scroll position that brings item `index` fully into view (or leaves `scroll` as it is if it already is).
export function scrollToShow(layout, index, scroll, extent, frozen = 0) {
  if (index < 0 || index >= layout.ids.length || index < frozen) return scroll;
  const frozenSize = layout.starts[Math.min(frozen, layout.ids.length)];
  const start = layout.starts[index];
  const end = layout.starts[index + 1];
  if (start - scroll < frozenSize) return Math.max(start - frozenSize, 0);
  if (end - scroll > extent) return Math.max(end - extent, 0);
  return scroll;
}

// ───────── what a cell shows ─────────
function groupFormat(n, decimals) {
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(n);
}

// A number with no format. Whole numbers are shown exactly (a barcode must not lose digits). Other numbers keep 15
// significant digits, as spreadsheets do, so 0.1 + 0.2 shows 0.3.
export function generalNumber(n) {
  if (!Number.isFinite(n)) return '';
  if (Number.isInteger(n) && Math.abs(n) <= Number.MAX_SAFE_INTEGER) return String(n);
  return String(Number.parseFloat(n.toPrecision(15)));
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n) => String(n).padStart(2, '0');

// PROVISIONAL (to be settled with CSV import, Phase 7): a number is read as days since 1899-12-30, as spreadsheets do;
// text that already reads yyyy-mm-dd is reformatted; anything else is shown as it is.
export function formatDate(value, pattern = 'dd/mm/yyyy') {
  let y;
  let m;
  let d;
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value < -657000 || value > 2958465) return generalNumber(value);
    const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86400000);
    [y, m, d] = [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()];
  } else if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    [y, m, d] = value.split('-').map(Number);
    if (m < 1 || m > 12 || d < 1 || d > 31) return value;
  } else {
    return value === null || value === undefined ? '' : String(value);
  }
  if (pattern === 'yyyy-mm-dd') return `${y}-${pad(m)}-${pad(d)}`;
  if (pattern === 'dd mmm yyyy') return `${pad(d)} ${MONTHS[m - 1]} ${y}`;
  return `${pad(d)}/${pad(m)}/${y}`;
}

function formatNumber(n, nf) {
  const type = nf?.type ?? 'general';
  const decimals = Number.isInteger(nf?.decimals) ? nf.decimals : null;
  if (type === 'number') return groupFormat(n, decimals ?? 2);
  if (type === 'percent') return `${groupFormat(n * 100, decimals ?? 0)}%`;
  if (type === 'currency') {
    const code = nf?.currency ?? '';
    const body = groupFormat(Math.abs(n), decimals ?? 2);
    return `${n < 0 ? '-' : ''}${code ? `${code} ` : ''}${body}`;
  }
  if (type === 'date') return formatDate(n, nf?.pattern);
  return generalNumber(n);
}

const isErrorValue = (v) => v !== null && typeof v === 'object' && typeof v.error === 'string';

// { text, kind } for a stored cell (or null) and its already-sanitized style. kind is 'number', 'boolean', 'text', 'error',
// 'formula' or 'empty'; it only decides the default alignment. `computed` is the calculated result of a formula cell (from
// domain/formulas); without it a formula cell shows its formula text.
export function displayCell(cell, style = {}, computed = undefined) {
  if (!cell) return { text: '', kind: 'empty' };
  let v = cell.value;
  if (cell.formula !== null && cell.formula !== undefined) {
    if (computed === undefined) return { text: String(cell.formula), kind: 'formula' };
    v = computed;
  }
  if (isErrorValue(v)) return { text: v.error, kind: 'error' };
  if (v === null || v === undefined) return { text: '', kind: 'empty' };
  if (typeof v === 'boolean') return { text: v ? 'TRUE' : 'FALSE', kind: 'boolean' };
  if (typeof v === 'number') return { text: formatNumber(v, style.numfmt), kind: 'number' };
  if (style.numfmt?.type === 'date') return { text: formatDate(v, style.numfmt.pattern), kind: 'text' };
  return { text: String(v), kind: 'text' };
}

// ───────── how a stored style is drawn ─────────
const BORDER_PX = { thin: 1, medium: 2, thick: 3 };
const ALIGN = { left: 'flex-start', center: 'center', right: 'flex-end' };
const VALIGN = { top: 'flex-start', middle: 'center', bottom: 'flex-end' };
const DEFAULT_ALIGN = { number: 'right', boolean: 'center', text: 'left', error: 'center', formula: 'left', empty: 'left' };

// CSS properties (camelCase, for element.style) for one cell. Always goes through sanitizeStyle, because the database can
// hold older styles that are not exactly valid. Only values that passed the whitelist ever reach CSS.
export function cellCss(rawStyle, kind = 'text') {
  const s = sanitizeStyle(rawStyle);
  const css = {};
  if (s.weight === 'bold') css.fontWeight = '700';
  if (s.size) css.fontSize = `${s.size}px`;
  if (s.color) css.color = s.color;
  if (s.bg) css.backgroundColor = s.bg;
  css.justifyContent = ALIGN[s.halign ?? DEFAULT_ALIGN[kind] ?? 'left'];
  css.alignItems = VALIGN[s.valign ?? 'middle'];
  for (const [side, weight] of Object.entries(s.borders ?? {})) {
    css[`border${side[0].toUpperCase()}${side.slice(1)}`] = `${BORDER_PX[weight]}px solid #1f2933`;
  }
  return { css, style: s };
}

// Everything needed to draw one cell, from the sheet and the row and column ids. `calc` (optional, from
// domain/formulas/sheetCalc.js) supplies calculated results for formula cells.
export function describeCell(sheet, rowId, colId, calc = null) {
  const cell = sheet.cells.get(`${rowId}:${colId}`) ?? null;
  const filled = cell && (cell.value !== null || cell.formula !== null || cell.style_id !== null);
  if (!filled) return { text: '', kind: 'empty', css: {}, formula: null, value: null };
  const style = cell.style_id === null ? {} : (sheet.styles.get(cell.style_id) ?? {});
  const computed = cell.formula !== null && cell.formula !== undefined && calc ? calc.get(rowId, colId) : undefined;
  const shown = displayCell(cell, sanitizeStyle(style), computed);
  return { ...shown, css: cellCss(style, shown.kind).css, formula: cell.formula, value: cell.value };
}
