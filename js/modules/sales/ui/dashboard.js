// Sales Dashboard: headline numbers, insights, charts, tables and a calendar of the year.
import { html, render } from '../../../shared/html.js';
import { money, monthLabel, shortDate, signed, todayPkt, weekday } from '../../../shared/format.js';
import { PALETTE, chartTheme, loadChartJs } from '../../../shared/chartjs.js';
import { hero } from '../../../shared/ui.js';
import * as api from '../data/api.js';
import {
  PRESETS,
  bestWorst,
  buildInsights,
  cashBankChart,
  clientsChart,
  computeKpis,
  customersChart,
  dayOfWeek,
  filterYear,
  heatmapYear,
  normalizeDays,
  normalizeMonths,
  raceData,
  summaryRows,
  topDays,
  totalChart,
  yearsOf,
  yoyChart,
} from '../domain/dashboard.js';
import { errorCard, loadingCard } from './parts.js';

const arrow = (v) => (v === null ? '' : `${v >= 0 ? '▲' : '▼'} ${Math.abs(v).toFixed(1)}%`);
const tone = (v) => (v === null ? '' : v > 0 ? 'pos' : v < 0 ? 'neg' : '');
const MONTH_WORD = (key) => monthLabel(`${key}-01`);

export async function mount(el) {
  render(el, loadingCard());
  let months;
  let days;
  let targets;
  let clients;
  let Chart;
  try {
    const [m, d, t, c, lib] = await Promise.all([
      api.listMonthlyFull(),
      api.listDailyFull(),
      api.listTargets(),
      api.listClientTotals(),
      loadChartJs().catch(() => null),
    ]);
    months = normalizeMonths(m);
    days = normalizeDays(d);
    targets = Object.fromEntries(t.map((r) => [String(r.month).slice(0, 7), Number(r.target)]));
    clients = c;
    Chart = lib;
  } catch {
    return render(el, errorCard('the dashboard'));
  }

  const today = todayPkt();
  const kpi = computeKpis(months, days, targets, today);
  const years = yearsOf(months);
  const state = { preset: '12M', compare: false, year: 'all', heatYear: years.at(-1) };
  let charts = [];

  const kpiCard = (label, value, sub, vs, vsLabel) =>
    html`<div class="dk">
      <span class="kl">${label}</span
      ><strong class="kv">${value}</strong
      >${sub ? html`<span class="ks">${sub}</span>` : ''}${vs === undefined || vs === null ? '' : html`<span class="kchip ${tone(vs)}">${arrow(vs)} ${vsLabel ?? ''}</span>`}
    </div>`;

  function kpiRow() {
    if (!kpi) return html`<section class="card"><p class="muted">The dashboard needs at least two months of sales.</p></section>`;
    const live = kpi.isLive;
    const vsPrev = live ? `vs previous month (days 1–${kpi.D})` : 'vs previous month';
    return html`<section class="dgrid">
      ${kpiCard(live ? `${MONTH_WORD(kpi.lat.key)} so far` : `${MONTH_WORD(kpi.lat.key)} (closed)`, `₨ ${money(kpi.lat.total)}`, live ? `${kpi.D} of ${kpi.daysInMonth} days` : `${kpi.latDays} days`, kpi.vs.total, vsPrev)}
      ${kpiCard('Cash + banks', `₨ ${money(kpi.mtd.cash)}`, '', kpi.vs.cash, 'vs previous')}
      ${kpiCard('Credit sales', `₨ ${money(kpi.mtd.credit)}`, '', kpi.vs.credit, 'vs previous')}
      ${kpiCard('Customers', money(kpi.lat.customers), '', kpi.vs.customers, 'vs previous')}
      ${kpiCard('Average bill', `₨ ${money(kpi.avgBill)}`, '', kpi.vs.avgBill, 'vs previous')}
      ${kpiCard(`Year to date ${kpi.year}`, `₨ ${money(kpi.ytd)}`, `last year ₨ ${money(kpi.pYtd)}`, kpi.vs.ytd, `vs ${kpi.year - 1}`)}
      ${kpi.target ? kpiCard('Forecast vs target', `₨ ${money(kpi.forecastTotal)}`, `target ₨ ${money(kpi.target)}`, kpi.forecastVsTarget, 'of target') : kpiCard('Forecast', `₨ ${money(kpi.forecastTotal)}`, 'no target set for this month')}
      ${kpiCard('Growth per year (CAGR)', kpi.cagr === null ? '–' : `${kpi.cagr.toFixed(1)}%`, 'first 12 months to latest 12')}
      ${kpiCard('Branch score', `${kpi.score}/100`, 'target, last year and customers')}
      ${kpiCard('Cumulative difference', signed(kpi.cumDiff), 'Total − COMP SALE, all months')}
      ${kpiCard('All-time sales', `₨ ${money(kpi.grandTotal)}`, `${kpi.recordedDays.toLocaleString('en-US')} recorded days`)}
    </section>`;
  }

  const insightsBlock = () => {
    const list = buildInsights(kpi, days, today);
    const race = raceData(kpi);
    return html`${
      race
        ? html`<section class="card">
            <h2>Race the forecast</h2>
            <div class="race">
              <div class="race-fill" data-w="${race.actualPct}"></div>
              <div class="race-mark target" data-l="${race.targetPct}" title="Target"></div>
              <div class="race-mark pace ${race.onTrack ? 'ok' : 'low'}" data-l="${race.forecastPct}" title="Forecast"></div>
            </div>
            <p class="small muted">
              So far ₨ ${money(race.actual)} · target ₨ ${money(race.target)} · at this pace ₨ ${money(race.forecast)} —
              <strong class="${race.onTrack ? 'pos' : 'neg'}">${race.onTrack ? 'on track' : 'behind target'}</strong>
            </p>
          </section>`
        : ''
    }
    ${list.length ? html`<section class="insights">${list.map((i) => html`<div class="insight ${i.tone}"><strong>${i.title}</strong><span>${i.text}</span></div>`)}</section>` : ''}`;
  };

  const chartCard = (id, title, extra = '') =>
    html`<section class="card">
      <div class="chead">
        <h2>${title}</h2>
        ${extra}
      </div>
      <div class="chart-box"><canvas id="${id}" role="img" aria-label="${title}"></canvas></div>
    </section>`;

  const summaryTable = (rows) =>
    html`<div class="month-body">
      <table class="table">
        <thead>
          <tr>
            <th>Month</th>
            <th class="num">Total</th>
            <th class="num">Cash</th>
            <th class="num">Banks</th>
            <th class="num">Credit</th>
            <th class="num">COMP</th>
            <th class="num">Diff</th>
            <th class="num">Cust.</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(
            (m) =>
              html`<tr>
                <td>${MONTH_WORD(m.key)}${m.monthlyOnly ? html` <span class="chip">monthly</span>` : ''}</td>
                <td class="num">${money(m.total)}</td>
                <td class="num">${money(m.cash)}</td>
                <td class="num">${money(m.banks)}</td>
                <td class="num">${money(m.credit)}</td>
                <td class="num">${money(m.comp)}</td>
                <td class="num ${tone(m.diff)}">${m.diff === null ? '–' : signed(m.diff)}</td>
                <td class="num">${money(m.customers)}</td>
              </tr>`,
          )}
        </tbody>
      </table>
    </div>`;

  function heat() {
    const h = heatmapYear(days, state.heatYear);
    return html`<div class="heat-wrap">
        <div class="heat" role="img" aria-label="Calendar of daily sales for ${state.heatYear}">
          ${h.cells.map((c) => html`<i class="hm l${c.level}" data-c="${c.col}" data-r="${c.row}" title="${shortDate(c.date)}${c.total ? `: ₨ ${money(c.total)}` : ': no sale'}"></i>`)}
        </div>
      </div>
      <p class="small muted">
        ${h.saleDays} sale days in ${state.heatYear}. Darker means a stronger day compared with that year's own days.
        <span class="heat-key"
          ><i class="hm l1"></i><i class="hm l2"></i><i class="hm l3"></i><i class="hm l4"></i> weakest → strongest</span
        >
      </p>`;
  }

  function draw() {
    const yMonths = filterYear(months, state.year);
    const yearOpts = html`<select id="dash-year" aria-label="Year">
      ${[html`<option value="all" ${state.year === 'all' ? 'selected' : ''}>All years</option>`, ...years.map((y) => html`<option value="${y}" ${String(state.year) === String(y) ? 'selected' : ''}>${y}</option>`)]}
    </select>`;
    const rangeBar = html`<div class="seg" role="group" aria-label="Range">
      ${PRESETS.map((p) => html`<button class="seg-b" data-preset="${p}" aria-pressed="${state.preset === p}">${p === 'ALL' ? 'All' : p}</button>`)}<label
        class="seg-c"
        ><input type="checkbox" id="dash-compare" ${state.compare ? 'checked' : ''} /> Compare</label
      >
    </div>`;
    const dow = dayOfWeek(days);
    const bw = bestWorst(months, today);
    render(
      el,
      html` ${hero({ label: 'Sales dashboard', title: 'Branch Overview', sub: kpi ? (kpi.isLive ? `${MONTH_WORD(kpi.lat.key)} is running: days 1–${kpi.D} have sales.` : `Latest month on record: ${MONTH_WORD(kpi.lat.key)}.`) : 'Not enough history yet.' })}
        ${kpiRow()}${insightsBlock()} ${chartCard('ch-total', 'Monthly total', rangeBar)}
        <div class="dgrid2">
          ${chartCard('ch-cashbank', 'Cash vs banks', yearOpts)}${chartCard('ch-clients', 'Top credit clients (all time)')}
        </div>
        <div class="dgrid2">${chartCard('ch-cust', 'Customers by month')}${chartCard('ch-yoy', 'Year on year')}</div>
        <section class="card">
          <h2>Last 12 months</h2>
          ${summaryTable(summaryRows(yMonths.length ? yMonths : months, 12))}
        </section>
        <div class="dgrid2">
          <section class="card">
            <h2>Top 10 days</h2>
            <table class="table">
              <tbody>
                ${topDays(days, 10).map(
                  (d, i) =>
                    html`<tr>
                      <td>${i + 1}</td>
                      <td>${weekday(d.date)} ${shortDate(d.date)}</td>
                      <td class="num">${money(d.total)}</td>
                    </tr>`,
                )}
              </tbody>
            </table>
          </section>
          <section class="card">
            <h2>Day of week (average)</h2>
            ${dow.map(
              (r) =>
                html`<div class="dow">
                  <span>${r.name.slice(0, 3)}</span>
                  <div class="dow-bar"><i data-w="${Math.round(r.share * 100)}"></i></div>
                  <b>${money(r.avg)}</b>
                </div>`,
            )}
          </section>
        </div>
        <section class="card">
          <h2>Best and worst month of each year</h2>
          <table class="table">
            <thead>
              <tr>
                <th>Year</th>
                <th>Best</th>
                <th class="num">Total</th>
                <th>Worst</th>
                <th class="num">Total</th>
              </tr>
            </thead>
            <tbody>
              ${bw.map(
                (r) =>
                  html`<tr>
                    <td>${r.year}</td>
                    <td>${MONTH_WORD(r.best.key).split(' ')[0]}</td>
                    <td class="num pos">${money(r.best.total)}</td>
                    <td>${MONTH_WORD(r.worst.key).split(' ')[0]}</td>
                    <td class="num neg">${money(r.worst.total)}</td>
                  </tr>`,
              )}
            </tbody>
          </table>
        </section>
        <section class="card">
          <div class="chead">
            <h2>Calendar</h2>
            <select id="heat-year" aria-label="Calendar year">
              ${years.map((y) => html`<option value="${y}" ${y === state.heatYear ? 'selected' : ''}>${y}</option>`)}
            </select>
          </div>
          ${heat()}
        </section>`,
    );
    place();
    drawCharts(yMonths);
  }

  // The page's security policy blocks inline style attributes, so positions and widths are set from here.
  function place() {
    el.querySelectorAll('[data-w]').forEach((n) => (n.style.width = `${n.dataset.w}%`));
    el.querySelectorAll('[data-l]').forEach((n) => (n.style.left = `${n.dataset.l}%`));
    el.querySelectorAll('.hm[data-c]').forEach((n) => {
      n.style.gridColumn = String(Number(n.dataset.c) + 1);
      n.style.gridRow = String(Number(n.dataset.r) + 1);
    });
  }

  const drill = (key) => {
    sessionStorage.setItem('sales.data.month', key);
    location.hash = '#/sales/data';
  };

  function drawCharts(yMonths) {
    charts.forEach((c) => c.destroy());
    charts = [];
    if (!Chart || !kpi) {
      if (!Chart) el.querySelectorAll('.chart-box').forEach((b) => (b.textContent = 'Charts could not be loaded.'));
      return;
    }
    const th = chartTheme();
    const scales = (stacked = false, money$ = true) => ({
      x: { stacked, ticks: { color: th.text, font: { size: 10 } }, grid: { color: 'transparent' } },
      y: {
        stacked,
        ticks: { color: th.text, font: { size: 10 }, callback: (v) => (money$ ? `₨${Number(v).toLocaleString('en-US')}` : v) },
        grid: { color: th.grid },
      },
    });
    const base = { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: th.text, font: { size: 11 } } } } };
    const make = (id, config) => charts.push(new Chart(el.querySelector(`#${id}`), config));

    const t = totalChart(months, state.preset, state.compare);
    make('ch-total', {
      type: 'bar',
      data: {
        labels: t.labels,
        datasets: t.datasets.map((d, i) => ({
          label: d.label,
          data: d.data,
          backgroundColor: i ? 'rgba(148,163,184,.55)' : 'rgba(14,128,116,.7)',
          borderColor: i ? '#94a3b8' : '#0e8074',
          borderWidth: 1.5,
          borderRadius: 3,
        })),
      },
      options: {
        ...base,
        scales: scales(),
        plugins: {
          legend: { display: t.datasets.length > 1, labels: { color: th.text } },
          tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ₨${Number(c.raw).toLocaleString('en-US')}` } },
        },
        onClick: (_e, els) => {
          const i = els?.[0]?.index;
          const key = t.datasets[0].keys?.[i - (t.labels.length - t.datasets[0].keys.length)];
          if (key && els[0].datasetIndex === 0) drill(key);
        },
      },
    });
    const cb = cashBankChart(yMonths);
    make('ch-cashbank', {
      type: 'bar',
      data: {
        labels: cb.labels,
        datasets: [
          { ...cb.datasets[0], backgroundColor: 'rgba(217,119,6,.7)', borderRadius: 3 },
          { ...cb.datasets[1], backgroundColor: 'rgba(37,99,235,.7)', borderRadius: 3 },
        ],
      },
      options: { ...base, scales: scales(true) },
    });
    const cl = clientsChart(clients, 10);
    make('ch-clients', {
      type: 'doughnut',
      data: {
        labels: cl.labels,
        datasets: [
          {
            data: cl.data,
            backgroundColor: PALETTE,
            borderWidth: 2,
            borderColor: getComputedStyle(document.documentElement).getPropertyValue('--surface').trim() || '#fff',
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'right', labels: { color: th.text, font: { size: 10 }, boxWidth: 10 } } },
      },
    });
    const cu = customersChart(yMonths);
    make('ch-cust', {
      type: 'line',
      data: {
        labels: cu.labels,
        datasets: [
          { ...cu.datasets[0], borderColor: '#7c3aed', backgroundColor: 'rgba(124,58,237,.1)', tension: 0.4, fill: true, pointRadius: 2 },
        ],
      },
      options: {
        ...base,
        plugins: { legend: { display: false } },
        scales: scales(false, false),
        onClick: (_e, els) => els?.[0] && drill(yMonths[els[0].index].key),
      },
    });
    const yoy = yoyChart(months);
    make('ch-yoy', {
      type: 'line',
      data: {
        labels: yoy.labels,
        datasets: yoy.datasets.map((d, i) => ({
          ...d,
          borderColor: PALETTE[i % PALETTE.length],
          tension: 0.4,
          pointRadius: 2,
          spanGaps: true,
        })),
      },
      options: { ...base, scales: scales() },
    });
  }

  el.addEventListener('click', (e) => {
    const p = e.target.closest('[data-preset]');
    if (p) {
      state.preset = p.dataset.preset;
      draw();
    }
  });
  el.addEventListener('change', (e) => {
    if (e.target.id === 'dash-year') state.year = e.target.value;
    else if (e.target.id === 'dash-compare') state.compare = e.target.checked;
    else if (e.target.id === 'heat-year') state.heatYear = Number(e.target.value);
    else return;
    draw();
  });

  draw();
}
