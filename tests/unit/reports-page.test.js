// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const methods = [
  { code: 'cash_sale', label: 'Cash Sale', section: 'Cash', sign: 'add', sort: 10 },
  { code: 'cash_returns', label: 'Cash Returns', section: 'Cash', sign: 'sub', sort: 20 },
  { code: 'pso', label: 'PSO', section: 'Credit Clients', sign: 'add', sort: 40 },
];
const api = {
  listAllMethods: vi.fn(async () => methods),
  listMonthlyFull: vi.fn(async () => [
    { month: '2026-10-01', total: '1500', comp_sale: '1400', customers: 15, days: 2, monthly_only: false },
    { month: '2026-11-01', total: '1600', comp_sale: '800', customers: 16, days: 2, monthly_only: false },
  ]),
  latestDay: vi.fn(async () => ({ business_date: '2026-11-02' })),
  listDaysBetween: vi.fn(async () => [
    { business_date: '2026-11-01', total: '700', comp_sale: null, customers: 7 },
    { business_date: '2026-11-02', total: '900', comp_sale: '800', customers: 9 },
  ]),
  listLinesBetween: vi.fn(async () => [
    { business_date: '2026-11-01', method_code: 'cash_sale', amount: '700' },
    { business_date: '2026-11-02', method_code: 'cash_sale', amount: '1000' },
    { business_date: '2026-11-02', method_code: 'cash_returns', amount: '150' },
    { business_date: '2026-11-02', method_code: 'pso', amount: '50' },
  ]),
  getTarget: vi.fn(async () => 2000),
  listMonthlyMethods: vi.fn(async () => [
    { month: '2026-10-01', method_code: 'cash_sale', amount: '1500' },
    { month: '2026-11-01', method_code: 'cash_sale', amount: '1600' },
  ]),
};
vi.mock('../../js/modules/sales/data/api.js', () => api);

const tick = () => new Promise((r) => setTimeout(r, 15));
let el;
const q = (s) => el.querySelector(s);
async function open() {
  const { mount } = await import('../../js/modules/sales/ui/reports.js');
  await mount(el);
  await tick();
}
beforeEach(() => {
  document.body.innerHTML = '<div id="p"></div>';
  el = document.getElementById('p');
  window.print = vi.fn();
  Object.values(api).forEach((f) => f.mockClear());
});

describe('Reports page', () => {
  it('builds the monthly report for the latest month with summary and day-by-day table', async () => {
    await open();
    expect(q('#rp-month').value).toBe('2026-11');
    q('[data-act="build"]').click();
    await tick();
    const t = q('#bk-preview').textContent.replace(/\s+/g, ' ');
    expect(t).toContain('Monthly report · November 2026');
    expect(t).toContain('Total sale');
    expect(t).toContain('₨ 1,600');
    expect(t).toContain('₨ 2,000 (80%)');
    expect(t).toContain('Cash Returns');
    expect(t).toContain('−150');
    expect(el.querySelectorAll('.bk-table tbody tr')).toHaveLength(3); // two days and the total row
    expect(api.listDaysBetween).toHaveBeenCalledWith('2026-11-01', '2026-11-30');
  });

  it('prints through the browser and cleans up afterwards', async () => {
    await open();
    expect(q('[data-act="print"]').disabled).toBe(true);
    q('[data-act="build"]').click();
    await tick();
    q('[data-act="print"]').click();
    expect(window.print).toHaveBeenCalledTimes(1);
    expect(document.getElementById('print-root').className).toBe('book');
    expect(document.body.classList.contains('printing-report')).toBe(true);
    window.dispatchEvent(new Event('afterprint'));
    expect(document.getElementById('print-root')).toBeNull();
    expect(document.body.classList.contains('printing-report')).toBe(false);
  });

  it('Sale Book for a year and for all time lists the months with year totals', async () => {
    await open();
    q('[data-kind="all"]').click();
    await tick();
    q('[data-act="build"]').click();
    await tick();
    const t = q('#bk-preview').textContent.replace(/\s+/g, ' ');
    expect(t).toContain('Sale Book — all time');
    expect(t).toContain('October 2026');
    expect(t).toContain('3,100'); // grand total
    q('[data-kind="year"]').click();
    await tick();
    expect(q('#rp-year')).not.toBeNull();
  });

  it('says so when there is nothing for the chosen month', async () => {
    api.listDaysBetween.mockImplementationOnce(async () => []);
    await open();
    q('[data-act="build"]').click();
    await tick();
    expect(q('#bk-preview').textContent).toContain('Nothing is recorded');
    expect(q('[data-act="print"]').disabled).toBe(true);
  });

  it('shows an error card if the lists cannot be read', async () => {
    api.listAllMethods.mockImplementationOnce(async () => {
      throw new Error('x');
    });
    await open();
    expect(el.textContent).toContain('Could not load the reports');
  });
});
