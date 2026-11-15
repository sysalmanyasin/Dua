// Excess Working: how much of the stock is genuinely too much, in whole packs, after the owner's retain list and the misc
// amount. The retain list and the two amounts are shared business facts kept in the database (migration 0306), so every
// owner device sees the same ones. Rules live in domain/excess.js (ported from the old app and checked against it).
import { html, render } from '../../../shared/html.js';
import { excessState, saveExcessSettings, setRetained } from '../data/feed.js';
import { loadSettings, saveSettings } from '../data/prefs.js';
import { applyRecalcFilters, computeExcessRows, retainKey, summarizeExcess } from '../domain/excess.js';
import { computeLedger } from '../domain/ledger.js';
import { filterAndRank } from '../domain/search.js';
import { downloadCsv, stamp } from './download.js';
import { days, qty, rs } from './fmt.js';
import { openReport } from './frame.js';

const PAGE = 50;
const DEFAULTS = { minAgeOn: true, minAgeDays: 90, minStockDaysOn: true, minStockDays: 200 };
const STATUSES = ['All', 'Excess', 'Retained', 'Loose'];

export async function mount(el, { ctx }) {
  await openReport(el, ctx, {
    title: 'Excess Working',
    sub: 'Whole packs of stock you do not need',
    build: async (body, api) => {
      const filters = await loadSettings('excess', DEFAULTS);
      let status = 'All';
      let query = '';
      let shown = PAGE;
      let retained = new Map(); // key -> name
      let misc = 0;
      let hoValue = null;
      let ledgerKey = '';
      let rawExcess = [];

      const compute = () => {
        const st = api.state();
        const key = `${st.meta?.syncedAt}|${st.rows.length}`;
        if (key !== ledgerKey) {
          rawExcess = computeLedger(st.rows, { today: new Date() }).excess;
          ledgerKey = key;
        }
        const computed = computeExcessRows(applyRecalcFilters(rawExcess, filters), new Set(retained.keys()));
        return { computed, summary: summarizeExcess(computed, misc, hoValue) };
      };
      const visible = (computed) => {
        const byStatus = status === 'All' ? computed : computed.filter((r) => r.status === status);
        const found = query.trim()
          ? filterAndRank(byStatus, query.trim(), ['code', 'name', 'company'])
          : [...byStatus].sort((a, b) => b.correctedValue - a.correctedValue);
        return found;
      };

      render(
        body,
        html`<div id="ex-summary"></div>
          <section class="card">
            <h3>Filters</h3>
            <label class="inv-check"
              ><input id="ex-age-on" type="checkbox" ${filters.minAgeOn ? 'checked' : ''} /> Only products at least
              <input id="ex-age" class="inv-num" type="number" inputmode="numeric" min="0" max="3650" value="${filters.minAgeDays}" />
              days old</label
            >
            <label class="inv-check"
              ><input id="ex-cover-on" type="checkbox" ${filters.minStockDaysOn ? 'checked' : ''} /> Only with at least
              <input id="ex-cover" class="inv-num" type="number" inputmode="numeric" min="0" max="3650" value="${filters.minStockDays}" />
              days of cover</label
            >
            <div class="inv-chips" id="ex-status" role="tablist">
              ${STATUSES.map((x) => html`<button type="button" role="tab" class="inv-chip ${x === status ? 'on' : ''}" data-status="${x}">${x}</button>`)}
            </div>
            <label class="field"
              ><span>Search</span><input id="ex-q" type="search" inputmode="search" autocomplete="off" placeholder="Name, code or company…"
            /></label>
          </section>
          <section class="card">
            <h3>Adjustments</h3>
            <p class="muted">Shared with every owner device.</p>
            <label class="field"
              ><span>Misc (subtracted from the excess)</span><input id="ex-misc" type="number" inputmode="decimal" min="0" step="any"
            /></label>
            <label class="field"
              ><span>Head-office stock value (optional, for the variance line)</span
              ><input id="ex-ho" type="number" inputmode="decimal" min="0" step="any"
            /></label>
            <button type="button" class="btn btn-sm" data-act="save">Save adjustments</button>
            <p id="ex-note" class="note" role="status" hidden></p>
          </section>
          <div id="ex-out"></div>`,
      );
      const $ = (id) => body.querySelector(id);
      const say = (text, kind = 'info') => {
        const n = $('#ex-note');
        n.hidden = !text;
        n.textContent = text;
        n.className = `note note-${kind}`;
      };

      function drawSummary(summary, count) {
        const card = (label, value, tone = '') => html`<div class="inv-kpi ${tone}"><b>${value}</b><span>${label}</span></div>`;
        render(
          $('#ex-summary'),
          html`<section class="card inv-kpis">
            ${card('Excess (whole packs)', rs(summary.totalExcess))} ${card('After misc', rs(summary.correctedExcessStockValue))}
            ${card('Retained', rs(summary.totalRetained))} ${card('Loose / small', rs(summary.totalLoose))}
            ${card('Top 10 products', rs(summary.top10))}
            ${summary.variance === null ? '' : card('Head office minus this list', rs(summary.variance))}
            <p class="muted">${qty(count)} products in the working list, ${rs(summary.totalRawValue)} before pack correction.</p>
          </section>`,
        );
      }

      function draw() {
        const st = api.state();
        if (!st.rows.length) {
          render($('#ex-summary'), html``);
          return render($('#ex-out'), api.empty());
        }
        if (!st.hasSales) return render($('#ex-out'), html`<p class="muted inv-hint">Sales figures are not on this phone yet.</p>`);
        const { computed, summary } = compute();
        drawSummary(summary, computed.length);
        const list = visible(computed);
        const page = list.slice(0, shown);
        render(
          $('#ex-out'),
          html`<section class="card inv-total">
              <div><b>${qty(list.length)}</b><span>shown</span></div>
              <button type="button" class="btn btn-sm" data-act="csv" ${list.length ? '' : 'disabled'}>Download CSV</button>
            </section>
            ${
              list.length
                ? html`<ul class="inv-list">
                      ${page.map(
                        (r) =>
                          html`<li class="inv-row">
                            <div class="inv-main">
                              <strong>${r.name}</strong>
                              <span class="muted">${r.code}${r.company ? ` · ${r.company}` : ''}</span>
                              <span class="muted"
                                >${qty(r.qty)} too many · ${qty(r.packQty)} whole pack${r.packQty === 1 ? '' : 's'} (pack of
                                ${qty(r.factor)})${r.packUnreliable ? ' · pack size unknown' : ''} · ${days(r.stockDays)} days of
                                cover</span
                              >
                              <span
                                ><span class="inv-badge inv-badge-${r.status.toLowerCase()}">${r.status}</span>
                                <button
                                  type="button"
                                  class="btn btn-sm"
                                  data-retain="${r.name}"
                                  data-on="${r.status === 'Retained' ? '0' : '1'}"
                                >
                                  ${r.status === 'Retained' ? 'Stop retaining' : 'Retain'}
                                </button></span
                              >
                            </div>
                            <div class="inv-qty">
                              <b>${rs(r.correctedValue)}</b><span>${r.status === 'Excess' ? 'counts' : 'not counted'}</span>
                            </div>
                          </li>`,
                      )}
                    </ul>
                    ${list.length > page.length ? html`<button type="button" class="btn" data-act="more">Show more (${qty(list.length - page.length)} left)</button>` : ''}`
                : html`<p class="muted inv-hint">Nothing matches.</p>`
            }`,
        );
      }

      function fillAdjustments() {
        $('#ex-misc').value = misc || misc === 0 ? String(misc) : '';
        $('#ex-ho').value = hoValue === null ? '' : String(hoValue);
      }
      async function loadShared() {
        try {
          const s = await excessState();
          retained = new Map(s.retained.map((r) => [r.name_key, r.name]));
          misc = Number(s.settings?.misc) || 0;
          hoValue = s.settings?.ho_value === null || s.settings?.ho_value === undefined ? null : Number(s.settings.ho_value);
          fillAdjustments();
          say('');
        } catch {
          say('The retain list and adjustments could not be loaded, so they are not applied.', 'error');
        }
      }

      body.addEventListener('click', async (e) => {
        const st = e.target.closest('[data-status]');
        if (st) {
          status = st.dataset.status;
          shown = PAGE;
          body.querySelectorAll('[data-status]').forEach((b) => b.classList.toggle('on', b.dataset.status === status));
          draw();
          return;
        }
        const retain = e.target.closest('[data-retain]');
        if (retain) {
          const name = retain.dataset.retain;
          const on = retain.dataset.on === '1';
          const key = retainKey(name);
          const before = new Map(retained);
          if (on) retained.set(key, name);
          else retained.delete(key);
          draw();
          try {
            await setRetained(name, on);
          } catch {
            retained = before; // the change did not reach the database: put the screen back
            draw();
            say('Could not save that change. Check the connection and try again.', 'error');
          }
          return;
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
            'Company',
            'Excess units',
            'Pack size',
            'Whole packs',
            'Pack size unknown',
            'Value before correction',
            'Corrected value',
            'Status',
            'Counts toward excess',
            'Days of cover',
          ];
          const rows = visible(compute().computed).map((r) => [
            r.code,
            r.name,
            r.company,
            r.qty,
            r.factor,
            r.packQty,
            r.packUnreliable ? 'yes' : '',
            r.value,
            r.correctedValue,
            r.status,
            r.excessContribution,
            r.stockDays === null ? '' : Math.round(r.stockDays),
          ]);
          downloadCsv(stamp('excess-working'), [head, ...rows]);
        }
        if (act === 'save') {
          const m = Number($('#ex-misc').value || 0);
          const hoRaw = $('#ex-ho').value.trim();
          const ho = hoRaw === '' ? null : Number(hoRaw);
          if (!Number.isFinite(m) || m < 0 || (ho !== null && (!Number.isFinite(ho) || ho < 0)))
            return say('Enter amounts of zero or more.', 'error');
          try {
            await saveExcessSettings(m, ho);
            misc = m;
            hoValue = ho;
            say('Saved.', 'info');
            draw();
          } catch {
            say('Could not save. You may not have permission, or the connection is down.', 'error');
          }
        }
      });
      body.addEventListener('change', (e) => {
        const id = e.target.id;
        if (id === 'ex-age-on') filters.minAgeOn = e.target.checked;
        else if (id === 'ex-cover-on') filters.minStockDaysOn = e.target.checked;
        else if (id === 'ex-age') filters.minAgeDays = Math.max(0, Math.round(Number(e.target.value) || 0));
        else if (id === 'ex-cover') filters.minStockDays = Math.max(0, Math.round(Number(e.target.value) || 0));
        else return;
        shown = PAGE;
        saveSettings('excess', filters);
        draw();
      });
      body.addEventListener('input', (e) => {
        if (e.target.id !== 'ex-q') return;
        query = e.target.value;
        shown = PAGE;
        draw();
      });

      api.onData(async () => {
        await loadShared();
        draw();
      });
      draw();
    },
  });
}
