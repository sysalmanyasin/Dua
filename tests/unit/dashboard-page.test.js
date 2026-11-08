// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

function monthRows() {
  const rows = [];
  for (let i = 0; i < 25; i++) {
    const y = 2024 + Math.floor((10 + i) / 12);
    const m = ((10 + i) % 12) + 1;
    rows.push({
      month: `${y}-${String(m).padStart(2, '0')}-01`,
      total: String(1000 + 10 * i),
      comp_sale: String(990 + 10 * i),
      customers: 100 + i,
      days: 28,
      cash: String(600),
      banks: String(300),
      credit: String(100),
      monthly_only: false,
    });
  }
  return rows;
}
const day = (d, total) => ({
  business_date: d,
  total: String(total),
  comp_sale: String(total - 10),
  customers: 10,
  cash: String(total * 0.6),
  banks: String(total * 0.2),
  credit: String(total * 0.2),
});
const dayRows = () => [
  ...Array.from({ length: 9 }, (_, i) => day(`2026-11-0${i + 1}`, 40)),
  ...Array.from({ length: 28 }, (_, i) => day(`2026-10-${String(i + 1).padStart(2, '0')}`, 30)),
  ...Array.from({ length: 9 }, (_, i) => day(`2025-11-0${i + 1}`, 20)),
];
const api = {
  listMonthlyFull: vi.fn(async () => monthRows()),
  listDailyFull: vi.fn(async () => dayRows()),
  listTargets: vi.fn(async () => [{ month: '2026-11-01', target: '2000' }]),
  listClientTotals: vi.fn(async () => [
    { label: 'PSO', total: '500' },
    { label: 'LDA', total: '300' },
    { label: 'Zero', total: '0' },
  ]),
};
vi.mock('../../js/modules/sales/data/api.js', () => api);
const lib = {
  loadChartJs: vi.fn(),
  chartTheme: () => ({ text: '#444', grid: '#ddd', primary: '#0e8074', navy: '#101b2d', amber: '#f2b84b' }),
  PALETTE: ['#1', '#2', '#3'],
};
vi.mock('../../js/shared/chartjs.js', () => ({
  loadChartJs: (...a) => lib.loadChartJs(...a),
  chartTheme: () => lib.chartTheme(),
  PALETTE: lib.PALETTE,
}));

let made;
class FakeChart {
  constructor(canvas, config) {
    this.canvas = canvas;
    this.config = config;
    this.destroyed = false;
    made.push(this);
  }
  destroy() {
    this.destroyed = true;
  }
}
const tick = () => new Promise((r) => setTimeout(r, 15));
let el;
const q = (s) => el.querySelector(s);
const live = (id) => made.filter((c) => !c.destroyed && c.canvas.id === id).at(-1);

async function open() {
  const { mount } = await import('../../js/modules/sales/ui/dashboard.js');
  vi.setSystemTime(new Date('2026-11-10T08:00:00Z'));
  await mount(el);
  await tick();
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  made = [];
  document.body.innerHTML = '<div id="p"></div>';
  el = document.getElementById('p');
  sessionStorage.clear();
  lib.loadChartJs.mockImplementation(async () => FakeChart);
  Object.values(api).forEach((f) => f.mockClear());
  location.hash = '';
});

describe('Sales Dashboard page', () => {
  it('shows the headline cards for the running month, compared like for like', async () => {
    await open();
    const t = el.textContent.replace(/\s+/g, ' ');
    expect(t).toContain('November 2026 so far');
    expect(t).toContain('₨ 1,240');
    expect(t).toContain('days 1–9');
    expect(t).toContain('Branch score');
    expect(t).toContain('Growth per year (CAGR)');
    expect(t).toContain('target ₨ 2,000');
  });

  it('draws the five charts with the right kinds', async () => {
    await open();
    expect(made.map((c) => c.canvas.id)).toEqual(['ch-total', 'ch-cashbank', 'ch-clients', 'ch-cust', 'ch-yoy']);
    expect(made.map((c) => c.config.type)).toEqual(['bar', 'bar', 'doughnut', 'line', 'line']);
    expect(live('ch-total').config.data.labels).toHaveLength(12); // 12M by default
    expect(live('ch-clients').config.data.labels).toEqual(['PSO', 'LDA']); // zero client left out
    expect(live('ch-yoy').config.data.datasets).toHaveLength(3); // 2024, 2025, 2026
  });

  it('range buttons redraw the total chart and release the old one', async () => {
    await open();
    const before = live('ch-total');
    q('[data-preset="3M"]').click();
    await tick();
    expect(before.destroyed).toBe(true);
    expect(live('ch-total').config.data.labels).toEqual(['Sep 26', 'Oct 26', 'Nov 26']);
    expect(q('[data-preset="3M"]').getAttribute('aria-pressed')).toBe('true');
  });

  it('Compare adds the previous period as a second series', async () => {
    await open();
    q('[data-preset="3M"]').click();
    await tick();
    const box = q('#dash-compare');
    box.checked = true;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    await tick();
    expect(live('ch-total').config.data.datasets.map((d) => d.label)).toEqual(['Total', 'Previous period']);
  });

  it('the year filter narrows the cash/bank and customer charts', async () => {
    await open();
    const sel = q('#dash-year');
    sel.value = '2025';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    await tick();
    expect(live('ch-cashbank').config.data.labels).toHaveLength(12);
    expect(live('ch-cust').config.data.labels.every((l) => l.endsWith('25'))).toBe(true);
  });

  it('tapping a bar opens that month in Daily Data', async () => {
    await open();
    const total = live('ch-total');
    total.config.options.onClick({}, [{ index: 11, datasetIndex: 0 }]);
    expect(sessionStorage.getItem('sales.data.month')).toBe('2026-11');
    expect(location.hash).toBe('#/sales/data');
  });

  it('the calendar has one cell per day with positions set from script', async () => {
    await open();
    const cells = el.querySelectorAll('.heat .hm');
    expect(cells).toHaveLength(365);
    expect(cells[0].style.gridColumn).toBe('1');
    const sel = q('#heat-year');
    sel.value = '2024';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    await tick();
    expect(el.querySelectorAll('.heat .hm')).toHaveLength(366); // 2024 is a leap year
  });

  it('shows the race-the-forecast bar and the insights when a target exists', async () => {
    await open();
    expect(el.textContent).toContain('Race the forecast');
    expect(q('.race-fill').style.width).not.toBe('');
    expect(el.querySelectorAll('.insight').length).toBeGreaterThan(0);
  });

  it('still shows every number when the chart library cannot load', async () => {
    lib.loadChartJs.mockImplementation(async () => {
      throw new Error('blocked');
    });
    await open();
    expect(el.textContent).toContain('Charts could not be loaded');
    expect(el.textContent).toContain('November 2026 so far');
    expect(made).toHaveLength(0);
  });

  it('says so when there is not enough history', async () => {
    api.listMonthlyFull.mockImplementationOnce(async () => monthRows().slice(0, 1));
    await open();
    expect(el.textContent).toContain('at least two months');
  });

  it('shows an error card, not a blank page, when the data cannot be read', async () => {
    api.listMonthlyFull.mockImplementationOnce(async () => {
      throw new Error('offline');
    });
    await open();
    expect(el.textContent).toContain('Could not load the dashboard');
  });
});
