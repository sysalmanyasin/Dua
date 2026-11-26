// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import manifest from '../../js/modules/sales/manifest.js';

const METHODS = [
  { code: 'cash_sale', label: 'Cash Sale', section: 'Cash', sign: 'add', sort: 10 },
  { code: 'bank_alfalah', label: 'Bank Alfalah', section: 'Banks', sign: 'add', sort: 30 },
];
const MONTHS = [
  { month: '2025-12-01', total: '500', comp_sale: '450', customers: 5, days: 30, monthly_only: false },
  { month: '2026-02-01', total: '1000', comp_sale: '900', customers: 10, days: 28, monthly_only: false },
];
const api = {
  listAllMethods: vi.fn(async () => METHODS),
  listMonthlyFull: vi.fn(async () => MONTHS),
  latestDay: vi.fn(async () => ({ business_date: '2026-02-28' })),
  listDaysBetween: vi.fn(async () => [{ business_date: '2026-02-01', total: 1000, comp_sale: 900, customers: 10 }]),
  listLinesBetween: vi.fn(async () => [{ business_date: '2026-02-01', method_code: 'cash_sale', amount: 1000 }]),
  getTarget: vi.fn(async () => 5000),
  listMonthlyMethods: vi.fn(async () => [
    { month: '2025-12-01', method_code: 'cash_sale', amount: '500' },
    { month: '2026-02-01', method_code: 'bank_alfalah', amount: '1000' },
  ]),
};
vi.mock('../../js/modules/sales/data/api.js', () => api);

const tick = () => new Promise((r) => setTimeout(r, 15));
let el;

beforeEach(() => {
  document.body.innerHTML = '<div id="page"></div>';
  el = document.getElementById('page');
  Object.values(api).forEach((f) => f.mockClear());
  api.listMonthlyFull.mockImplementation(async () => MONTHS);
});

async function open() {
  const { mount } = await import('../../js/modules/sales/ui/reports.js');
  await mount(el, { ctx: { permissions: ['sales.view_history'] } });
  await tick();
}
const click = async (sel) => {
  el.querySelector(sel).click();
  await tick();
};

describe('Sale Book route', () => {
  it('is registered under Sales and needs the history permission', () => {
    const r = manifest.routes.find((x) => x.path === '/sales/reports');
    expect(r).toBeTruthy();
    expect(r.title).toBe('Sale Book');
    expect(r.permission).toBe('sales.view_history');
    expect(typeof r.load).toBe('function');
  });
  it('the route loads a module that has mount()', async () => {
    const mod = await manifest.routes.find((x) => x.path === '/sales/reports').load();
    expect(typeof mod.mount).toBe('function');
  });
});

describe('Sale Book page', () => {
  it('opens on the latest month and builds the monthly report with totals', async () => {
    await open();
    await click('[data-act="build"]');
    const text = el.textContent;
    expect(text).toContain('Monthly report');
    expect(text).toContain('Total (1 days)');
    expect(api.listDaysBetween).toHaveBeenCalledWith('2026-02-01', '2026-02-28');
  });
  it('builds a year and the all-time book from the months', async () => {
    await open();
    await click('[data-kind="year"]');
    await click('[data-act="build"]');
    expect(el.textContent).toContain('Sale Book 2026');
    expect(el.textContent).not.toContain('Dec 2025');
    await click('[data-kind="all"]');
    await click('[data-act="build"]');
    expect(el.textContent).toContain('Sale Book — all time');
  });
  it('says plainly when nothing is recorded for the period', async () => {
    api.listDaysBetween.mockImplementationOnce(async () => []);
    await open();
    await click('[data-act="build"]');
    expect(el.textContent).toContain('Nothing is recorded for that period yet');
    expect(el.querySelector('[data-act="print"]').disabled).toBe(true);
  });
  it('shows "Could not load" when the source fails, never a blank or an old number', async () => {
    api.listMonthlyFull.mockImplementationOnce(async () => {
      throw new Error('offline');
    });
    await open();
    expect(el.textContent).toContain('Could not load the reports');
  });
  it('a failed build shows an error and no report', async () => {
    api.listDaysBetween.mockImplementationOnce(async () => {
      throw new Error('offline');
    });
    await open();
    await click('[data-act="build"]');
    expect(el.querySelector('.bk-table')).toBeNull();
    expect(document.getElementById('toasts').textContent).toContain('Could not build the report');
  });
});
