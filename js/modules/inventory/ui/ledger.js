// Stock Ledger: the lists the owner acts on. Everything is computed on this phone from its own copy of the products, so
// changing the window or the search is instant. Rules live in domain/ledger.js (ported from the old app, whole packs only).
import { html, render } from '../../../shared/html.js';
import { loadSettings, saveSettings } from '../data/prefs.js';
import { computeLedger, DEFAULT_WINDOW_DAYS, sumValue } from '../domain/ledger.js';
import { filterAndRank, SEARCH_FIELDS } from '../domain/search.js';
import { exportReport, KINDS } from './export.js';
import { days, qty, rs } from './fmt.js';
import { openReport } from './frame.js';

const PAGE = 50;
const WINDOWS = [30, 60, 90, 180, 365];

const TABS = {
  neverSold: {
    label: 'Never sold',
    note: (w) => `No sale on record and received more than ${w} days ago. Whole packs only.`,
    value: 'value',
    sorts: { value: 'Value, highest', recDays: 'Longest on shelf', name: 'Name' },
    sortKey: { value: (r) => -r.value, recDays: (r) => -(r.recDays ?? 0), name: (r) => r.name.toLowerCase() },
    head: ['Code', 'Name', 'Supplier', 'Stock', 'Pack', 'Whole packs', 'Loose', 'Price', 'Value', 'Days since received'],
    line: (r) => [r.code, r.name, r.supplier, r.qty, r.pack, r.packs, r.loose, r.unitPrice, r.value, r.recDays],
  },
  deadStock: {
    label: 'Dead stock',
    note: (w) => `Last sale and last receipt both more than ${w} days ago. Whole packs only.`,
    value: 'value',
    sorts: { value: 'Value, highest', saleDays: 'Longest since sale', name: 'Name' },
    sortKey: { value: (r) => -r.value, saleDays: (r) => -(r.saleDays ?? 0), name: (r) => r.name.toLowerCase() },
    head: ['Code', 'Name', 'Supplier', 'Stock', 'Pack', 'Whole packs', 'Loose', 'Price', 'Value', 'Days since sale', 'Days since received'],
    line: (r) => [r.code, r.name, r.supplier, r.qty, r.pack, r.packs, r.loose, r.unitPrice, r.value, r.saleDays, r.recDays],
  },
  excess: {
    label: 'Excess',
    note: () => 'Stock above 100 days of what sold in the last 90 days. Standard view: at least 90 days old and 200 days of cover.',
    value: 'excessValue',
    sorts: { excessValue: 'Value, highest', stockDays: 'Most days of cover', name: 'Name' },
    sortKey: { excessValue: (r) => -r.excessValue, stockDays: (r) => -(r.stockDays ?? 0), name: (r) => r.name.toLowerCase() },
    head: ['Code', 'Name', 'Supplier', 'Stock', '100-day target', 'Excess units', 'Price', 'Excess value', 'Days of cover'],
    line: (r) => [r.code, r.name, r.supplier, r.qty, r.target100, r.excessQty, r.unitPrice, r.excessValue, r.stockDays],
  },
  zeroStock: {
    label: 'Zero stock',
    note: () => 'Nothing on the shelf. Listed for reference.',
    value: null,
    sorts: { name: 'Name', saleDays: 'Longest since sale' },
    sortKey: { name: (r) => r.name.toLowerCase(), saleDays: (r) => -(r.saleDays ?? 1e9) },
    head: ['Code', 'Name', 'Supplier', 'Days since sale', 'Days since received'],
    line: (r) => [r.code, r.name, r.supplier, r.saleDays, r.recDays],
  },
  packIssues: {
    label: 'Pack issues',
    note: () =>
      'The pack size in the stock file is missing or unusable, so these cannot be rounded to whole packs and are left out of Never sold and Dead stock.',
    value: 'stockValue',
    sorts: { stockValue: 'Value, highest', name: 'Name' },
    sortKey: { stockValue: (r) => -r.stockValue, name: (r) => r.name.toLowerCase() },
    head: ['Code', 'Name', 'Supplier', 'Stock', 'Price', 'Stock value'],
    line: (r) => [r.code, r.name, r.supplier, r.qty, r.unitPrice, r.stockValue],
  },
};

function detail(tab, r) {
  if (tab === 'neverSold')
    return `${qty(r.qty)} in stock · ${qty(r.packs)} whole pack${r.packs === 1 ? '' : 's'}${r.loose ? ` + ${qty(r.loose)} loose` : ''} (pack of ${qty(r.pack)}) · received ${days(r.recDays)} days ago`;
  if (tab === 'deadStock')
    return `${qty(r.qty)} in stock · ${qty(r.packs)} whole pack${r.packs === 1 ? '' : 's'}${r.loose ? ` + ${qty(r.loose)} loose` : ''} · last sale ${days(r.saleDays)} days ago · received ${days(r.recDays)} days ago`;
  if (tab === 'excess')
    return `${qty(r.qty)} in stock · target ${qty(r.target100)} · ${qty(r.excessQty)} too many · ${days(r.stockDays)} days of cover`;
  if (tab === 'zeroStock')
    return `last sale ${r.saleDays === null ? 'never' : `${days(r.saleDays)} days ago`} · received ${r.recDays === null ? 'unknown' : `${days(r.recDays)} days ago`}`;
  return `${qty(r.qty)} in stock · pack size missing or unusable`;
}

export async function mount(el, { ctx }) {
  await openReport(el, ctx, {
    title: 'Stock Ledger',
    sub: 'Never sold, dead stock, excess',
    build: async (body, api) => {
      const s = await loadSettings('ledger', { tab: 'neverSold', windowDays: DEFAULT_WINDOW_DAYS, excessAll: false, sort: 'value' });
      let { tab, windowDays, excessAll } = s;
      let sort = s.sort;
      let query = '';
      let shown = PAGE;
      let ledger = null;
      let ledgerKey = '';

      const compute = () => {
        const key = `${api.state().meta?.syncedAt}|${api.state().rows.length}|${windowDays}`;
        if (ledgerKey !== key) {
          ledger = computeLedger(api.state().rows, { today: new Date(), neverSoldDays: windowDays, deadDays: windowDays });
          ledgerKey = key;
        }
        return ledger;
      };
      const current = () => {
        const l = compute();
        const list = tab === 'excess' ? (excessAll ? l.excess : l.excessDefault) : l[tab];
        const t = TABS[tab];
        const key = t.sortKey[sort] ?? t.sortKey[Object.keys(t.sorts)[0]];
        const ranked = query.trim()
          ? filterAndRank(list, query.trim(), SEARCH_FIELDS)
          : [...list].sort((a, b) => (key(a) > key(b) ? 1 : key(a) < key(b) ? -1 : 0));
        return { list, ranked };
      };
      const remember = () => saveSettings('ledger', { tab, windowDays, excessAll, sort });

      render(
        body,
        html`<section class="card">
            <div class="inv-chips" role="tablist" id="led-tabs"></div>
            <div class="inv-controls" id="led-controls"></div>
            <label class="field"
              ><span>Search</span>
              <input id="led-q" type="search" inputmode="search" autocomplete="off" placeholder="Name, code, supplier…"
            /></label>
          </section>
          <div id="led-out"></div>`,
      );
      const $ = (id) => body.querySelector(id);

      function drawControls() {
        const t = TABS[tab];
        render(
          $('#led-tabs'),
          html`${Object.entries(TABS).map(([id, x]) => html`<button type="button" role="tab" class="inv-chip ${id === tab ? 'on' : ''}" aria-selected="${id === tab}" data-tab="${id}">${x.label}</button>`)}`,
        );
        render(
          $('#led-controls'),
          html`${
              tab === 'neverSold' || tab === 'deadStock'
                ? html`<label class="field"
                    ><span>Window</span
                    ><select id="led-win">
                      ${WINDOWS.map((w) => html`<option value="${w}" ${w === windowDays ? 'selected' : ''}>${w} days</option>`)}
                    </select></label
                  >`
                : ''
            }
            ${
              tab === 'excess'
                ? html`<label class="field"
                    ><span>Show</span
                    ><select id="led-ex">
                      <option value="std" ${excessAll ? '' : 'selected'}>Standard (90 days old, 200 days of cover)</option>
                      <option value="all" ${excessAll ? 'selected' : ''}>Everything above target</option>
                    </select></label
                  >`
                : ''
            }
            <label class="field"
              ><span>Sort</span
              ><select id="led-sort">
                ${Object.entries(t.sorts).map(([k, label]) => html`<option value="${k}" ${k === sort ? 'selected' : ''}>${label}</option>`)}
              </select></label
            >`,
        );
      }

      function drawResults() {
        const st = api.state();
        if (!st.rows.length) return render($('#led-out'), api.empty());
        if (!st.hasSales) return render($('#led-out'), html`<p class="muted inv-hint">Sales figures are not on this phone yet.</p>`);
        const t = TABS[tab];
        const { list, ranked } = current();
        const shownRows = ranked.slice(0, shown);
        const total = t.value ? sumValue(list, t.value) : null;
        render(
          $('#led-out'),
          html`<p class="muted inv-hint">${t.note(windowDays)}</p>
            <section class="card inv-total">
              <div><b>${qty(list.length)}</b><span>${list.length === 1 ? 'product' : 'products'}</span></div>
              ${total === null ? '' : html`<div><b>${rs(total)}</b><span>value</span></div>`}
              <span class="inv-exports"
                ><button type="button" class="btn btn-sm" data-act="xlsx" ${ranked.length ? '' : 'disabled'}>Excel</button
                ><button type="button" class="btn btn-sm" data-act="pdf" ${ranked.length ? '' : 'disabled'}>PDF</button
                ><button type="button" class="btn btn-sm" data-act="csv" ${ranked.length ? '' : 'disabled'}>CSV</button></span
              >
            </section>
            ${query.trim() ? html`<p class="muted inv-hint">${qty(ranked.length)} match “${query.trim()}”</p>` : ''}
            ${
              ranked.length
                ? html`<ul class="inv-list">
                      ${shownRows.map(
                        (r) =>
                          html`<li class="inv-row">
                            <div class="inv-main">
                              <strong>${r.name}</strong>
                              <span class="muted">${r.code}${r.supplier ? ` · ${r.supplier}` : ''}</span>
                              <span class="muted">${detail(tab, r)}</span>
                            </div>
                            ${t.value ? html`<div class="inv-qty"><b>${rs(r[t.value])}</b><span>value</span></div>` : ''}
                          </li>`,
                      )}
                    </ul>
                    ${ranked.length > shownRows.length ? html`<button type="button" class="btn" data-act="more">Show more (${qty(ranked.length - shownRows.length)} left)</button>` : ''}`
                : html`<p class="muted inv-hint">Nothing in this list.</p>`
            }`,
        );
      }

      body.addEventListener('click', (e) => {
        const tabBtn = e.target.closest('[data-tab]');
        if (tabBtn) {
          tab = tabBtn.dataset.tab;
          sort = Object.keys(TABS[tab].sorts)[0];
          shown = PAGE;
          remember();
          drawControls();
          drawResults();
        }
        const act = e.target.closest('[data-act]')?.dataset.act;
        if (act === 'more') {
          shown += PAGE;
          drawResults();
        }
        if (KINDS.includes(act)) {
          const t = TABS[tab];
          exportReport(act, {
            name: `ledger-${tab}`,
            title: `Stock Ledger: ${t.label}`,
            filters: `${windowDays}-day window${query.trim() ? `, search "${query.trim()}"` : ''}`,
            asOf: api.state().meta?.syncedAt ?? null,
            table: [t.head, ...current().ranked.map(t.line)],
          });
        }
      });
      body.addEventListener('change', (e) => {
        if (e.target.id === 'led-win') windowDays = Number(e.target.value);
        else if (e.target.id === 'led-ex') excessAll = e.target.value === 'all';
        else if (e.target.id === 'led-sort') sort = e.target.value;
        else return;
        shown = PAGE;
        remember();
        drawResults();
      });
      body.addEventListener('input', (e) => {
        if (e.target.id !== 'led-q') return;
        query = e.target.value;
        shown = PAGE;
        drawResults();
      });

      api.onData(() => drawResults());
      drawControls();
      drawResults();
    },
  });
}
