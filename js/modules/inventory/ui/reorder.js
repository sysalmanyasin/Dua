// Reorder Report: what to buy. Computed on this phone from its own copy of the products (domain/reorder.js, ported from
// the old app and checked against it). Units already on their way to this branch come from the database
// (inventory_in_transit) and are shown beside each product; they do not change the buy quantity, as in the old app.
import { html, render } from '../../../shared/html.js';
import { inTransit } from '../data/feed.js';
import { loadSettings, saveSettings } from '../data/prefs.js';
import { reorderLists, sortRows, WINDOWS } from '../domain/reorder.js';
import { filterAndRank } from '../domain/search.js';
import { downloadCsv, stamp } from './download.js';
import { days, qty, rs } from './fmt.js';
import { openReport } from './frame.js';

const PAGE = 50;
const SORTS = {
  cover: { label: 'Least cover first', key: 'daysCoverP', dir: 1 },
  value: { label: 'Buy value, highest', key: 'demandValueP', dir: -1 },
  sales: { label: 'Sales, highest', key: 'saleValueP', dir: -1 },
  name: { label: 'Name', key: 'name', dir: 1 },
};
const DEFAULTS = { window: 60, coverDays: 30, includeToday: true, tab: 'top', topN: 50, group: true, sort: 'cover' };

export async function mount(el, { ctx }) {
  await openReport(el, ctx, {
    title: 'Reorder Report',
    sub: 'What to buy, by days of cover',
    build: async (body, api) => {
      const s = await loadSettings('reorder', DEFAULTS);
      let { window: win, coverDays, includeToday, tab, topN, group, sort } = s;
      let query = '';
      let shown = PAGE;
      let transit = {};
      let transitNote = '';
      let lists = null;
      let listsKey = '';

      const remember = () => saveSettings('reorder', { window: win, coverDays, includeToday, tab, topN, group, sort });
      const compute = () => {
        const st = api.state();
        const key = [st.meta?.syncedAt, st.rows.length, win, coverDays, includeToday, topN, Object.keys(transit).length].join('|');
        if (key !== listsKey) {
          lists = reorderLists(st.rows, { window: win, coverDays, includeToday, topN, now: new Date(), inTransit: transit });
          listsKey = key;
        }
        return lists;
      };
      const view = () => {
        const l = compute();
        const base = tab === 'all' ? l.flagged : l.topN;
        const found = query.trim() ? filterAndRank(base, query.trim(), ['code', 'name', 'supplier']) : base;
        const sorter = SORTS[sort] ?? SORTS.cover;
        const sorted = query.trim() ? found : sortRows(found, sorter.key, sorter.dir);
        return { sorted, total: sorted.reduce((sum, r) => sum + r.demandValueP, 0) };
      };

      render(
        body,
        html`<section class="card">
            <div class="inv-chips" role="tablist">
              <button type="button" role="tab" class="inv-chip" data-tab="top" id="ro-t-top">Top sellers</button>
              <button type="button" role="tab" class="inv-chip" data-tab="all" id="ro-t-all">All low cover</button>
            </div>
            <div class="inv-controls">
              <label class="field"
                ><span>Sales window</span
                ><select id="ro-win">
                  ${WINDOWS.map((w) => html`<option value="${w}" ${w === win ? 'selected' : ''}>${w} days</option>`)}
                </select></label
              >
              <label class="field"
                ><span>Days of cover wanted</span
                ><input id="ro-cover" type="number" inputmode="numeric" min="1" max="365" value="${coverDays}"
              /></label>
              <label class="field" id="ro-topn-box"
                ><span>Top N by sales</span><input id="ro-topn" type="number" inputmode="numeric" min="1" max="500" value="${topN}"
              /></label>
              <label class="field"
                ><span>Sort</span
                ><select id="ro-sort">
                  ${Object.entries(SORTS).map(([k, x]) => html`<option value="${k}" ${k === sort ? 'selected' : ''}>${x.label}</option>`)}
                </select></label
              >
            </div>
            <label class="inv-check"
              ><input id="ro-today" type="checkbox" ${includeToday ? 'checked' : ''} /> Include today's sales so far</label
            >
            <label class="inv-check"><input id="ro-group" type="checkbox" ${group ? 'checked' : ''} /> Group by supplier</label>
            <label class="field"
              ><span>Search</span
              ><input id="ro-q" type="search" inputmode="search" autocomplete="off" placeholder="Name, code or supplier…"
            /></label>
          </section>
          <div id="ro-out"></div>`,
      );
      const $ = (id) => body.querySelector(id);

      function card(r) {
        return html`<li class="inv-row">
          <div class="inv-main">
            <strong>${r.name}</strong>
            <span class="muted">${r.code} · ${r.supplier}</span>
            <span class="muted"
              >In stock ${qty(r.stock)} · sold ${qty(r.saleQtyP)} in ${win} days · ${days(r.daysCoverP)} days of cover</span
            >
            ${r.inTransitQty ? html`<span class="muted">On the way: ${qty(r.inTransitQty)} pack${r.inTransitQty === 1 ? '' : 's'}</span>` : ''}
            <details>
              <summary class="muted">Other windows</summary>
              ${WINDOWS.map((w) => html`<span class="muted">${w} days: sold ${qty(r['saleQty' + w])} · ${days(r['daysCover' + w])} days of cover · buy ${qty(r['demandQty' + w])}</span>`)}
            </details>
          </div>
          <div class="inv-qty"><b>Buy ${qty(r.demandQtyP)}</b><span>${rs(r.demandValueP)}</span></div>
        </li>`;
      }

      function draw() {
        const st = api.state();
        $('#ro-t-top').classList.toggle('on', tab === 'top');
        $('#ro-t-all').classList.toggle('on', tab === 'all');
        $('#ro-topn-box').hidden = tab !== 'top';
        if (!st.rows.length) return render($('#ro-out'), api.empty());
        if (!st.hasSales) return render($('#ro-out'), html`<p class="muted inv-hint">Sales figures are not on this phone yet.</p>`);
        const { sorted, total } = view();
        const page = sorted.slice(0, shown);
        let listHtml;
        if (group) {
          const groups = new Map();
          for (const r of page) groups.set(r.supplier, [...(groups.get(r.supplier) ?? []), r]);
          const all = new Map();
          for (const r of sorted) all.set(r.supplier, (all.get(r.supplier) ?? 0) + r.demandValueP);
          const ordered = [...groups.entries()].sort((a, b) => all.get(b[0]) - all.get(a[0]));
          listHtml = html`${ordered.map(
            ([sup, rs2]) =>
              html`<h3 class="inv-group">
                  ${sup} <span class="muted">${qty(sorted.filter((r) => r.supplier === sup).length)} · ${rs(all.get(sup))}</span>
                </h3>
                <ul class="inv-list">
                  ${rs2.map(card)}
                </ul>`,
          )}`;
        } else {
          listHtml = html`<ul class="inv-list">
            ${page.map(card)}
          </ul>`;
        }
        render(
          $('#ro-out'),
          html`${transitNote ? html`<p class="note note-info" role="status">${transitNote}</p>` : ''}
            <section class="card inv-total">
              <div><b>${qty(sorted.length)}</b><span>${sorted.length === 1 ? 'product' : 'products'} to reorder</span></div>
              <div><b>${rs(total)}</b><span>to buy</span></div>
              <button type="button" class="btn btn-sm" data-act="csv" ${sorted.length ? '' : 'disabled'}>Download CSV</button>
            </section>
            ${sorted.length ? listHtml : html`<p class="muted inv-hint">Nothing needs reordering with these settings.</p>`}
            ${sorted.length > page.length ? html`<button type="button" class="btn" data-act="more">Show more (${qty(sorted.length - page.length)} left)</button>` : ''}`,
        );
      }

      async function loadTransit() {
        try {
          transit = await inTransit();
          transitNote = '';
        } catch {
          transitNote = 'Units on the way could not be loaded, so they are not shown.';
        }
      }

      body.addEventListener('click', (e) => {
        const t = e.target.closest('[data-tab]');
        if (t) {
          tab = t.dataset.tab;
          shown = PAGE;
          remember();
          draw();
        }
        const act = e.target.closest('[data-act]')?.dataset.act;
        if (act === 'more') {
          shown += PAGE;
          draw();
        }
        if (act === 'csv') {
          const head = [
            'Code',
            'Name',
            'Supplier',
            'In stock',
            `Sold ${win}d`,
            `Days of cover (${win}d)`,
            'Buy qty',
            'Unit price',
            'Buy value',
            'On the way (packs)',
            'Sold 30d',
            'Sold 60d',
            'Sold 90d',
          ];
          const rows = view().sorted.map((r) => [
            r.code,
            r.name,
            r.supplier,
            r.stock,
            r.saleQtyP,
            r.daysCoverP === null ? '' : Math.round(r.daysCoverP * 10) / 10,
            r.demandQtyP,
            r.unitPrice,
            r.demandValueP,
            r.inTransitQty,
            r.saleQty30,
            r.saleQty60,
            r.saleQty90,
          ]);
          downloadCsv(stamp(`reorder-${win}d-cover${coverDays}`), [head, ...rows]);
        }
      });
      body.addEventListener('change', (e) => {
        const id = e.target.id;
        if (id === 'ro-win') win = Number(e.target.value);
        else if (id === 'ro-cover') coverDays = Math.min(365, Math.max(1, Math.round(Number(e.target.value) || DEFAULTS.coverDays)));
        else if (id === 'ro-topn') topN = Math.min(500, Math.max(1, Math.round(Number(e.target.value) || DEFAULTS.topN)));
        else if (id === 'ro-sort') sort = e.target.value;
        else if (id === 'ro-today') includeToday = e.target.checked;
        else if (id === 'ro-group') group = e.target.checked;
        else return;
        shown = PAGE;
        remember();
        draw();
      });
      body.addEventListener('input', (e) => {
        if (e.target.id !== 'ro-q') return;
        query = e.target.value;
        shown = PAGE;
        draw();
      });

      api.onData(async () => {
        await loadTransit();
        draw();
      });
      draw();
    },
  });
}
