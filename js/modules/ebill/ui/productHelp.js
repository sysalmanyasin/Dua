// Product Help popup. Opens over the bill without touching it; closing returns to the same bill with every line,
// customer and payment figure unchanged. The filter state lives in `holder.state`, owned by the page, so it survives a
// close and reopen. Rows come from the local copy only, so everything works offline.
import { html, render } from '../../../shared/html.js';
import {
  COLUMNS,
  DATE_OPS,
  NUMBER_OPS,
  TEXT_OPS,
  activeFilters,
  clearAll,
  clearOne,
  distinct,
  setColumn,
  setGlobal,
  setPage,
  setSort,
  view,
} from '../domain/productFilter.js';
import { clock } from '../data/products.js';

const LABEL = {
  contains: 'Contains',
  starts: 'Starts with',
  exact: 'Exactly',
  eq: '=',
  gt: '>',
  lt: '<',
  range: 'Between',
  in: 'In stock',
  out: 'Out of stock',
  on: 'On',
  between: 'Between',
};
// render() parses in a <body> context, which drops bare <tr>/<td>; so rows are rendered inside a full table and the new body moved in.
function renderBody(table, rows) {
  const tmp = document.createElement('div');
  render(
    tmp,
    html`<table>
      <tbody>
        ${rows}
      </tbody>
    </table>`,
  );
  table.tBodies[0].replaceWith(tmp.querySelector('tbody'));
}
const fmt = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
const opts = (list, cur) => list.map((o) => html`<option value="${o}" ${o === cur ? 'selected' : ''}>${LABEL[o]}</option>`);

function filterCell(c, f, rows) {
  const k = c.key;
  if (c.type === 'text') {
    return html`<select data-f="${k}" data-part="op" aria-label="${c.label} filter type">
        ${opts(TEXT_OPS, f?.op || 'contains')}</select
      ><input data-f="${k}" data-part="value" type="search" autocomplete="off" aria-label="Filter ${c.label}" value="${f?.value ?? ''}" />`;
  }
  if (c.type === 'enum') {
    const cur = f?.values?.[0] ?? '';
    return html`<select data-f="${k}" data-part="pick" aria-label="Filter ${c.label}">
      <option value="">All</option>
      ${distinct(rows, k).map((v) => html`<option value="${v}" ${v === cur ? 'selected' : ''}>${v}</option>`)}
    </select>`;
  }
  if (c.type === 'number') {
    const list = k === 'qty' ? NUMBER_OPS : NUMBER_OPS.filter((o) => o !== 'in' && o !== 'out');
    const op = f?.op || 'eq';
    const range = op === 'range';
    const none = op === 'in' || op === 'out';
    return html`<select data-f="${k}" data-part="op" aria-label="${c.label} filter type">
        ${opts(list, op)}</select
      >${
        none
          ? ''
          : range
            ? html`<input
                  data-f="${k}"
                  data-part="min"
                  type="number"
                  step="any"
                  placeholder="from"
                  aria-label="${c.label} from"
                  value="${f?.min ?? ''}"
                /><input
                  data-f="${k}"
                  data-part="max"
                  type="number"
                  step="any"
                  placeholder="to"
                  aria-label="${c.label} to"
                  value="${f?.max ?? ''}"
                />`
            : html`<input
                data-f="${k}"
                data-part="value"
                type="number"
                step="any"
                aria-label="Filter ${c.label}"
                value="${f?.value ?? ''}"
              />`
      }`;
  }
  const op = f?.op || 'on';
  return html`<select data-f="${k}" data-part="op" aria-label="${c.label} filter type">
      ${opts(DATE_OPS, op)}</select
    >${
      op === 'between'
        ? html`<input data-f="${k}" data-part="from" type="date" aria-label="${c.label} from" value="${f?.from ?? ''}" /><input
              data-f="${k}"
              data-part="to"
              type="date"
              aria-label="${c.label} to"
              value="${f?.to ?? ''}"
            />`
        : html`<input data-f="${k}" data-part="value" type="date" aria-label="Filter ${c.label}" value="${f?.value ?? ''}" />`
    }`;
}

/** Read one column's controls back into a filter object. */
function readCell(root, c) {
  const get = (part) => root.querySelector(`[data-f="${c.key}"][data-part="${part}"]`)?.value ?? '';
  if (c.type === 'text') return { op: get('op'), value: get('value') };
  if (c.type === 'enum') return { values: get('pick') ? [get('pick')] : [] };
  if (c.type === 'number') return { op: get('op'), value: get('value'), min: get('min'), max: get('max') };
  return { op: get('op'), value: get('value'), from: get('from'), to: get('to') };
}

/**
 * @param {{ host: HTMLElement, holder: {state: object}, products: object[], meta: object|null, online: boolean,
 *           initialText?: string, onPick: (p: object) => void, onClose: () => void }} o
 * @returns {() => void} close
 */
export function openProductHelp({ host, holder, products, meta, online, initialText, onPick, onClose }) {
  if (initialText !== undefined) holder.state = setGlobal(holder.state, initialText);
  let cursor = 0;
  let current = view(products, holder.state);
  let timer = null;

  const stockNote = meta?.syncedAt
    ? `Stock is from this device’s saved copy, updated ${clock(meta.syncedAt)}. It is not live stock.`
    : 'No product copy has been saved on this device yet.';

  render(
    host,
    html`<div class="eb-modal" role="dialog" aria-modal="true" aria-label="Product Help">
      <div class="eb-dlg">
        <div class="eb-dlg-head">
          <h2>Product Help</h2>
          <span class="pill ${online ? '' : 'eb-pill-off'}">${online ? 'Online' : 'Offline'}</span>
          <span class="muted eb-grow">${stockNote}</span>
          <button type="button" class="btn btn-sm" data-act="close" aria-label="Close Product Help">Close (Esc)</button>
        </div>
        <label class="field">
          <span>Search everything (name, generic, code, manufacturer, supplier)</span>
          <input id="ph-global" type="search" autocomplete="off" spellcheck="false" value="${holder.state.global}" />
        </label>
        <div class="eb-chips" id="ph-chips"></div>
        <div class="eb-table-wrap">
          <table class="eb-table" id="ph-table">
            <thead>
              <tr>
                ${COLUMNS.map(
                  (c) =>
                    html`<th scope="col" class="${c.type === 'number' ? 'num' : ''}">
                      <button type="button" class="eb-sort" data-sort="${c.key}">${c.label}<span id="ph-s-${c.key}"></span></button>
                    </th>`,
                )}
              </tr>
              <tr class="eb-filter-row" id="ph-filters">
                ${COLUMNS.map((c) => html`<th data-col="${c.key}">${filterCell(c, holder.state.columns[c.key], products)}</th>`)}
              </tr>
            </thead>
            <tbody></tbody>
          </table>
        </div>
        <div class="eb-dlg-foot">
          <div id="ph-pager"></div>
          <span class="muted">↑ ↓ choose · Enter add to bill · double-click add · PgUp/PgDn pages · Esc close</span>
        </div>
      </div>
    </div>`,
  );
  const root = host.querySelector('.eb-modal');
  const q = (s) => root.querySelector(s);

  function draw() {
    current = view(products, holder.state);
    if (cursor >= current.rows.length) cursor = Math.max(0, current.rows.length - 1);
    const chips = activeFilters(holder.state);
    render(
      q('#ph-chips'),
      html`<strong>${current.total.toLocaleString('en-US')} ${current.total === 1 ? 'match' : 'matches'}</strong>
        ${chips.map((c) => html`<button type="button" class="eb-chip" data-clear="${c.id}" title="Remove this filter">${c.label} ×</button>`)}
        ${chips.length ? html`<button type="button" class="btn btn-sm" data-act="clear-all">Clear all filters</button>` : ''}`,
    );
    for (const c of COLUMNS) {
      const s = holder.state.sort;
      q(`#ph-s-${c.key}`).textContent = s?.key === c.key ? (s.dir === 'asc' ? ' ▲' : ' ▼') : '';
    }
    renderBody(
      q('#ph-table'),
      current.rows.length
        ? html`${current.rows.map(
            (p, i) =>
              html`<tr class="${i === cursor ? 'sel' : ''}" data-i="${i}" aria-selected="${i === cursor}">
                <td>${p.name}</td>
                <td>${p.generic}</td>
                <td>${p.code}</td>
                <td>${p.company}</td>
                <td>${p.supplier}</td>
                <td class="num ${p.qty <= 0 ? 'neg' : ''}">
                  ${fmt(p.qty)}${p.qty <= 0 ? html` <span class="eb-tag">no stock</span>` : ''}
                </td>
                <td class="num">${p.packValid === false ? '?' : fmt(p.pack)}</td>
                <td class="num">${fmt(p.price)}</td>
                <td>${(p.received || '').slice(0, 10)}</td>
                <td>${(p.sold || '').slice(0, 10)}</td>
                <td>${(p.created || '').slice(0, 10)}</td>
              </tr>`,
          )}`
        : html`<tr>
            <td colspan="${COLUMNS.length}" class="muted eb-empty">
              ${products.length ? 'No product matches these filters.' : 'No product copy on this device yet. Connect to the internet once to download it.'}
            </td>
          </tr>`,
    );
    render(
      q('#ph-pager'),
      html`<button type="button" class="btn btn-sm" data-page="${current.page - 1}" ${current.page === 0 ? 'disabled' : ''}>
          Previous
        </button>
        <span>Page ${current.page + 1} of ${current.pages}</span>
        <button type="button" class="btn btn-sm" data-page="${current.page + 1}" ${current.page >= current.pages - 1 ? 'disabled' : ''}>
          Next
        </button>`,
    );
    q('.sel')?.scrollIntoView?.({ block: 'nearest' });
  }

  // Re-drawing the filter row would steal focus, so it is rebuilt only after Clear (values reset) and never while typing.
  function redrawFilterRow() {
    for (const c of COLUMNS) render(q(`#ph-filters th[data-col="${c.key}"]`), filterCell(c, holder.state.columns[c.key], products));
    q('#ph-global').value = holder.state.global;
  }

  let pending = null;
  const later = (fn) => {
    clearTimeout(timer);
    pending = fn;
    timer = setTimeout(() => {
      pending = null;
      fn();
    }, 150); // short debounce while typing
  };
  const flush = () => {
    // Enter right after typing must act on what was typed, not on the results from before the debounce
    clearTimeout(timer);
    const fn = pending;
    pending = null;
    if (fn) fn();
  };
  const colFromEvent = (e) => COLUMNS.find((c) => c.key === e.target.dataset?.f);

  q('#ph-global').addEventListener('input', (e) =>
    later(() => {
      cursor = 0;
      holder.state = setGlobal(holder.state, e.target.value);
      draw();
    }),
  );
  q('#ph-filters').addEventListener('input', (e) => {
    const c = colFromEvent(e);
    if (!c || e.target.dataset.part === 'op') return;
    later(() => {
      cursor = 0;
      holder.state = setColumn(holder.state, c.key, readCell(root, c));
      draw();
    });
  });
  q('#ph-filters').addEventListener('change', (e) => {
    const c = colFromEvent(e);
    if (!c) return;
    cursor = 0;
    holder.state = setColumn(holder.state, c.key, readCell(root, c));
    if (e.target.dataset.part === 'op') render(q(`#ph-filters th[data-col="${c.key}"]`), filterCell(c, readCell(root, c), products)); // the controls change with the type (range shows two boxes)
    draw();
  });

  const pick = (i) => {
    const p = current.rows[i];
    if (p) onPick(p);
  };
  const close = () => {
    clearTimeout(timer);
    host.replaceChildren();
    document.removeEventListener('keydown', onKey, true);
    onClose();
  };

  root.addEventListener('click', (e) => {
    const t = e.target.closest('[data-act],[data-sort],[data-clear],[data-page],tr[data-i]');
    if (!t) return;
    if (t.dataset.act === 'close') return close();
    if (t.dataset.act === 'clear-all') {
      cursor = 0;
      holder.state = clearAll(holder.state);
      redrawFilterRow();
      return draw();
    }
    if (t.dataset.clear) {
      cursor = 0;
      holder.state = clearOne(holder.state, t.dataset.clear);
      redrawFilterRow();
      return draw();
    }
    if (t.dataset.sort) {
      holder.state = setSort(holder.state, t.dataset.sort);
      return draw();
    }
    if (t.dataset.page) {
      cursor = 0;
      holder.state = setPage(holder.state, Number(t.dataset.page));
      return draw();
    }
    if (t.dataset.i !== undefined) {
      cursor = Number(t.dataset.i);
      draw();
    }
  });
  root.addEventListener('dblclick', (e) => {
    const tr = e.target.closest('tr[data-i]');
    if (tr) pick(Number(tr.dataset.i));
  });

  function onKey(e) {
    if (!root.isConnected) return document.removeEventListener('keydown', onKey, true);
    if (e.key === 'Escape') {
      e.preventDefault();
      return close();
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      cursor = Math.min(cursor + 1, current.rows.length - 1);
      return draw();
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      cursor = Math.max(cursor - 1, 0);
      return draw();
    }
    if (e.key === 'PageDown' && current.page < current.pages - 1) {
      e.preventDefault();
      cursor = 0;
      holder.state = setPage(holder.state, current.page + 1);
      return draw();
    }
    if (e.key === 'PageUp' && current.page > 0) {
      e.preventDefault();
      cursor = 0;
      holder.state = setPage(holder.state, current.page - 1);
      return draw();
    }
    if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') {
      e.preventDefault();
      const had = !!pending;
      flush();
      if (!had) pick(cursor);
    }
  }
  document.addEventListener('keydown', onKey, true);

  draw();
  q('#ph-global').focus();
  return close;
}
