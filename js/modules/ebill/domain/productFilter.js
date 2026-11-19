// Product Help: three filters, kept apart from the screen so they can be tested on thousands of rows (Candela's Product Code Help has the same three).
//   Filter 1: the CODE box. Starts with what is typed; a leading * means "contains".
//   Filter 2: ONE global search. Every word typed must appear somewhere in the searchable fields (a leading * is allowed and changes nothing).
//   Filter 3: a filter on EVERY visible column (text, number, date or pick-list), like Candela's "Search here..." row.
// All active filters combine with AND. Sorting and paging come after filtering and never change what matches.
import { score } from '../../inventory/domain/search.js';

// The visible columns, matched to what the product copy really holds (no barcode, batch or expiry exists in the feed yet).
export const COLUMNS = [
  { key: 'code', label: 'Product code', type: 'text' },
  { key: 'name', label: 'Product name', type: 'text' },
  { key: 'price', label: 'Price', type: 'number' },
  { key: 'qty', label: 'Stock', type: 'number' },
  { key: 'generic', label: 'Generic', type: 'text' },
  { key: 'company', label: 'Manufacturer', type: 'enum' },
  { key: 'pack', label: 'Pack', type: 'number' },
  { key: 'supplier', label: 'Supplier', type: 'enum' },
  { key: 'received', label: 'Last received', type: 'date' },
  { key: 'sold', label: 'Last sold', type: 'date' },
  { key: 'created', label: 'Created', type: 'date' },
];
export const GLOBAL_FIELDS = ['name', 'generic', 'code', 'company', 'supplier'];
export const TEXT_OPS = ['contains', 'starts', 'exact'];
export const NUMBER_OPS = ['has', 'eq', 'gt', 'lt', 'range', 'in', 'out']; // `has` = the digits appear in the number (Candela: "4" finds 475 and 8,044); `in` / `out` = in stock / out of stock
export const DATE_OPS = ['on', 'between'];
export const PAGE_SIZE = 50;

export const emptyState = () => ({ code: '', global: '', columns: {}, sort: null, page: 0 });

const norm = (s) =>
  String(s ?? '')
    .toLowerCase()
    .trim();
const day = (v) => (v ? String(v).slice(0, 10) : '');
const has = (v) => v !== '' && v !== null && v !== undefined && Number.isFinite(Number(v));
const shown = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 }); // the way the screen shows a number: 8044 -> "8,044"

/** Does a row satisfy ONE column filter? A filter with nothing to compare against is inactive and passes. */
export function matchColumn(row, col, f) {
  const v = row[col.key];
  if (col.type === 'text') {
    const q = norm(f.value);
    if (!q) return true;
    const t = norm(v);
    return f.op === 'exact' ? t === q : f.op === 'starts' ? t.startsWith(q) : t.includes(q);
  }
  if (col.type === 'enum') {
    const picked = f.values || [];
    return !picked.length || picked.includes(String(v ?? ''));
  }
  if (col.type === 'number') {
    const n = Number(v);
    if (f.op === 'has') {
      const q = String(f.value ?? '')
        .replace(/,/g, '')
        .trim();
      return !q || String(v ?? '').includes(q) || shown(n).replace(/,/g, '').includes(q);
    }
    if (f.op === 'in') return n > 0;
    if (f.op === 'out') return !(n > 0);
    if (f.op === 'range') return (!has(f.min) || n >= Number(f.min)) && (!has(f.max) || n <= Number(f.max));
    if (!has(f.value)) return true;
    return f.op === 'gt' ? n > Number(f.value) : f.op === 'lt' ? n < Number(f.value) : n === Number(f.value);
  }
  // date: compare calendar days (YYYY-MM-DD) as text, which orders correctly
  const d = day(v);
  if (f.op === 'between') return (!f.from || (!!d && d >= f.from)) && (!f.to || (!!d && d <= f.to));
  return !f.value || d === f.value;
}

const isActive = (col, f) => {
  if (!f) return false;
  if (col.type === 'text') return !!norm(f.value);
  if (col.type === 'enum') return !!f.values?.length;
  if (col.type === 'number')
    return (
      f.op === 'in' ||
      f.op === 'out' ||
      (f.op === 'range' ? has(f.min) || has(f.max) : f.op === 'has' ? !!String(f.value ?? '').trim() : has(f.value))
    );
  return f.op === 'between' ? !!(f.from || f.to) : !!f.value;
};

/** Filter 1: the code box. Starts with what is typed; a leading * makes it "contains". Case does not matter. */
const matchCode = (row, raw) => {
  const q = norm(raw);
  if (!q) return true;
  const contains = q.startsWith('*');
  const t = contains ? q.slice(1) : q;
  if (!t) return true;
  return [row.code, row.barcode].some((v) => (contains ? norm(v).includes(t) : norm(v).startsWith(t)));
};

/** Filter 2: all words must appear in at least one searchable field of the row (any field, any word order). */
const matchGlobal = (row, words) => {
  const hay = GLOBAL_FIELDS.map((k) => norm(row[k])).join('\u0001');
  return words.every((w) => hay.includes(w));
};

/** Everything that matches, sorted. No paging here. */
export function filterRows(rows, state) {
  const words = norm(state.global)
    .split(/\s+/)
    .map((w) => w.replace(/^\*+/, ''))
    .filter(Boolean);
  const active = COLUMNS.filter((c) => isActive(c, state.columns[c.key]));
  let out = rows.filter(
    (r) =>
      matchCode(r, state.code) && (!words.length || matchGlobal(r, words)) && active.every((c) => matchColumn(r, c, state.columns[c.key])),
  );
  const s = state.sort;
  if (s?.key) {
    const col = COLUMNS.find((c) => c.key === s.key);
    const dir = s.dir === 'desc' ? -1 : 1;
    const val = (r) => (col?.type === 'number' ? Number(r[s.key]) || 0 : norm(r[s.key]));
    out = [...out].sort((a, b) => (val(a) < val(b) ? -dir : val(a) > val(b) ? dir : 0));
  } else if (words.length) {
    // no sort chosen: best name/code match first, same ranking as the Inventory search
    const q = words.join(' ');
    out = out
      .map((r) => ({ r, s: Math.max(...GLOBAL_FIELDS.map((k) => score(r[k], q))) }))
      .sort((a, b) => b.s - a.s)
      .map((x) => x.r);
  }
  return out;
}

/** One page of the filtered rows plus the facts the screen needs. The page is clamped, so filters can never strand you. */
export function view(rows, state, pageSize = PAGE_SIZE) {
  const all = filterRows(rows, state);
  const pages = Math.max(1, Math.ceil(all.length / pageSize));
  const page = Math.min(Math.max(0, state.page || 0), pages - 1);
  return { total: all.length, pages, page, rows: all.slice(page * pageSize, (page + 1) * pageSize) };
}

/** Chips for the "active filters" strip: [{ id, label }]. `id` is 'global' or the column key. */
export function activeFilters(state) {
  const chips = [];
  if (norm(state.code)) chips.push({ id: 'code', label: `Code: ${state.code.trim()}` });
  if (norm(state.global)) chips.push({ id: 'global', label: `Search: ${state.global.trim()}` });
  for (const c of COLUMNS) {
    const f = state.columns[c.key];
    if (!isActive(c, f)) continue;
    let txt;
    if (c.type === 'text') txt = `${f.op === 'exact' ? '=' : f.op === 'starts' ? 'starts' : 'has'} “${f.value}”`;
    else if (c.type === 'enum') txt = f.values.join(', ');
    else if (c.type === 'number')
      txt =
        f.op === 'has'
          ? `has ${f.value}`
          : f.op === 'in'
            ? 'in stock'
            : f.op === 'out'
              ? 'out of stock'
              : f.op === 'range'
                ? `${f.min ?? ''}–${f.max ?? ''}`
                : `${f.op === 'gt' ? '>' : f.op === 'lt' ? '<' : '='} ${f.value}`;
    else txt = f.op === 'between' ? `${f.from || '…'} to ${f.to || '…'}` : f.value;
    chips.push({ id: c.key, label: `${c.label}: ${txt}` });
  }
  return chips;
}

/** Set one column filter (resetting to page 0). An inactive filter is removed so it never lingers. */
export function setColumn(state, key, f) {
  const columns = { ...state.columns };
  const col = COLUMNS.find((c) => c.key === key);
  if (col && isActive(col, f)) columns[key] = f;
  else delete columns[key];
  return { ...state, columns, page: 0 };
}
export const setCode = (state, text) => ({ ...state, code: String(text ?? ''), page: 0 });
export const setGlobal = (state, text) => ({ ...state, global: String(text ?? ''), page: 0 });
export const clearOne = (state, id) =>
  id === 'code' ? setCode(state, '') : id === 'global' ? setGlobal(state, '') : setColumn(state, id, null);
export const clearAll = (state) => ({ ...state, code: '', global: '', columns: {}, page: 0 }); // the sort is a preference, not a filter
export const setSort = (state, key) => ({
  ...state,
  page: 0,
  sort: state.sort?.key === key ? (state.sort.dir === 'asc' ? { key, dir: 'desc' } : null) : { key, dir: 'asc' },
});
export const setPage = (state, page) => ({ ...state, page: Math.max(0, page) });

/** Distinct non-blank values of one column, for a pick-list. */
export const distinct = (rows, key, cap = 500) =>
  [...new Set(rows.map((r) => String(r[key] ?? '')).filter(Boolean))].sort((a, b) => a.localeCompare(b)).slice(0, cap);
