// Inventory Health: the four headline numbers, where the stock sits (reorder, excess, dead, never sold), and which
// suppliers and products matter most. Charts are drawn only on this page (Chart.js is loaded here, not at start-up).
// The trend over time from the old dashboard is dropped (decision INV-3).
import { PALETTE, chartTheme, loadChartJs } from '../../../shared/chartjs.js';
import { html, render } from '../../../shared/html.js';
import { computeHealth, FLAGS, healthKpis, supplierBreakdown, topMovers } from '../domain/health.js';
import { filterAndRank } from '../domain/search.js';
import { days, qty, rs } from './fmt.js';
import { openReport } from './frame.js';

const PAGE = 50;
const FLAG_LABEL = {
  reorder: 'Reorder',
  excess: 'Excess',
  dead: 'Dead stock',
  neverSold: 'Never sold',
  zeroStock: 'Zero stock',
  healthy: 'Healthy',
};
const FLAG_COLOR = {
  reorder: '#dc2626',
  excess: '#d97706',
  dead: '#7c3aed',
  neverSold: '#475569',
  zeroStock: '#94a3b8',
  healthy: '#0e8074',
};

export async function mount(el, { ctx }) {
  let charts = [];
  await openReport(el, ctx, {
    title: 'Inventory Health',
    sub: 'Where the stock stands',
    build: async (body, api) => {
      let flag = 'all';
      let query = '';
      let shown = PAGE;
      let model = null;
      let modelKey = '';

      render(
        body,
        html`<div id="hl-kpis"></div>
          <section class="card">
            <h3>Stock by class</h3>
            <div class="inv-chart"><canvas id="hl-flags" aria-label="Products by class"></canvas></div>
          </section>
          <section class="card">
            <h3>Stock value by supplier</h3>
            <div class="inv-chart"><canvas id="hl-suppliers" aria-label="Stock value by supplier"></canvas></div>
          </section>
          <section class="card">
            <h3>Best sellers, last 30 days</h3>
            <div class="inv-chart"><canvas id="hl-movers" aria-label="Best sellers"></canvas></div>
          </section>
          <section class="card">
            <h3>Products</h3>
            <div class="inv-chips" id="hl-chips" role="tablist"></div>
            <label class="field"
              ><span>Search</span
              ><input id="hl-q" type="search" inputmode="search" autocomplete="off" placeholder="Name, code or supplier…"
            /></label>
          </section>
          <div id="hl-list"></div>`,
      );
      const $ = (id) => body.querySelector(id);

      function compute() {
        const st = api.state();
        const key = `${st.meta?.syncedAt}|${st.rows.length}`;
        if (key !== modelKey) {
          const now = new Date();
          const health = computeHealth(st.rows, { now });
          model = { health, kpis: healthKpis(st.rows, health, now), suppliers: supplierBreakdown(health), movers: topMovers(health) };
          modelKey = key;
        }
        return model;
      }

      function drawKpis(m) {
        const k = (label, value, sub = '') =>
          html`<div class="inv-kpi"><b>${value}</b><span>${label}</span>${sub ? html`<small class="muted">${sub}</small>` : ''}</div>`;
        render(
          $('#hl-kpis'),
          html`<section class="card inv-kpis">
            ${k('Stock value', rs(m.kpis.stockValue), `${qty(m.kpis.skus)} products`)}
            ${k('To reorder', rs(m.kpis.reorder.value), `${qty(m.kpis.reorder.count)} products`)}
            ${k('Not sold (whole packs)', rs(m.kpis.notSold.value), `${qty(m.kpis.notSold.count)} products, 60 days`)}
            ${k('Excess', rs(m.kpis.excess.value), `${qty(m.kpis.excess.count)} products`)}
          </section>`,
        );
      }

      async function drawCharts(m) {
        charts.forEach((c) => c.destroy());
        charts = [];
        const Chart = await loadChartJs().catch(() => null);
        if (!Chart) return body.querySelectorAll('.inv-chart').forEach((b) => (b.textContent = 'Charts could not be loaded.'));
        if (!el.isConnected) return;
        const th = chartTheme();
        const base = {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { labels: { color: th.text, font: { size: 11 } } } },
        };
        const axis = { ticks: { color: th.text, font: { size: 10 } }, grid: { color: th.grid } };
        const counts = m.kpis.counts;
        charts.push(
          new Chart($('#hl-flags'), {
            type: 'doughnut',
            data: {
              labels: FLAGS.map((f) => `${FLAG_LABEL[f]} (${counts[f]})`),
              datasets: [{ data: FLAGS.map((f) => counts[f]), backgroundColor: FLAGS.map((f) => FLAG_COLOR[f]) }],
            },
            options: { ...base, plugins: { legend: { position: 'bottom', labels: { color: th.text, font: { size: 11 } } } } },
          }),
          new Chart($('#hl-suppliers'), {
            type: 'bar',
            data: {
              labels: m.suppliers.map(([s]) => (s.length > 22 ? `${s.slice(0, 21)}…` : s)),
              datasets: [{ data: m.suppliers.map(([, v]) => Math.round(v)), backgroundColor: PALETTE[0] }],
            },
            options: {
              ...base,
              indexAxis: 'y',
              plugins: { legend: { display: false } },
              scales: { x: axis, y: { ...axis, grid: { color: 'transparent' } } },
            },
          }),
          new Chart($('#hl-movers'), {
            type: 'bar',
            data: {
              labels: m.movers.map((r) => (r.name.length > 22 ? `${r.name.slice(0, 21)}…` : r.name)),
              datasets: [{ data: m.movers.map((r) => Math.round(r.saleValue30)), backgroundColor: PALETTE[1] }],
            },
            options: {
              ...base,
              indexAxis: 'y',
              plugins: { legend: { display: false } },
              scales: { x: axis, y: { ...axis, grid: { color: 'transparent' } } },
            },
          }),
        );
      }

      function drawList(m) {
        render(
          $('#hl-chips'),
          html`${['all', ...FLAGS].map((f) => html`<button type="button" role="tab" class="inv-chip ${f === flag ? 'on' : ''}" data-flag="${f}">${f === 'all' ? 'All' : `${FLAG_LABEL[f]} (${m.kpis.counts[f]})`}</button>`)}`,
        );
        const byFlag = flag === 'all' ? m.health : m.health.filter((r) => r.flag === flag);
        const found = query.trim()
          ? filterAndRank(byFlag, query.trim(), ['code', 'name', 'supplier'])
          : [...byFlag].sort((a, b) => b.stockValue - a.stockValue);
        const page = found.slice(0, shown);
        render(
          $('#hl-list'),
          found.length
            ? html`<p class="muted inv-hint">${qty(found.length)} products</p>
                <ul class="inv-list">
                  ${page.map(
                    (r) =>
                      html`<li class="inv-row">
                        <div class="inv-main">
                          <strong>${r.name}</strong>
                          <span class="muted">${r.code} · ${r.supplier}</span>
                          <span class="muted"
                            >${qty(r.stock)} in stock · sold ${qty(r.qty60)} in 60 days ·
                            ${r.coverDays === Infinity ? 'no sales' : `${days(r.coverDays)} days of cover`}</span
                          >
                          <span
                            ><span class="inv-badge" style="background:${FLAG_COLOR[r.flag]};color:#fff">${FLAG_LABEL[r.flag]}</span></span
                          >
                        </div>
                        <div class="inv-qty"><b>${rs(r.stockValue)}</b><span>stock value</span></div>
                      </li>`,
                  )}
                </ul>
                ${found.length > page.length ? html`<button type="button" class="btn" data-act="more">Show more (${qty(found.length - page.length)} left)</button>` : ''}`
            : html`<p class="muted inv-hint">Nothing matches.</p>`,
        );
      }

      function draw(withCharts = true) {
        const st = api.state();
        if (!st.rows.length) {
          render($('#hl-kpis'), api.empty());
          return;
        }
        if (!st.hasSales) return render($('#hl-kpis'), html`<p class="muted inv-hint">Sales figures are not on this phone yet.</p>`);
        const m = compute();
        drawKpis(m);
        drawList(m);
        if (withCharts) drawCharts(m);
      }

      body.addEventListener('click', (e) => {
        const f = e.target.closest('[data-flag]');
        if (f) {
          flag = f.dataset.flag;
          shown = PAGE;
          return draw(false);
        }
        if (e.target.closest('[data-act="more"]')) {
          shown += PAGE;
          draw(false);
        }
      });
      body.addEventListener('input', (e) => {
        if (e.target.id !== 'hl-q') return;
        query = e.target.value;
        shown = PAGE;
        draw(false);
      });
      api.onData(() => draw(true));
      draw(true);
    },
  });
}
