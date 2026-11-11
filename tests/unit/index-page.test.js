// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = {
  listMonthly: vi.fn(async () => [
    { month: '2026-11-01', total: '1600', days: 2, comp_sale: '800', customers: 16 },
    { month: '2025-11-01', total: '1000', days: 30, comp_sale: '900', customers: 100 },
  ]),
  listMonthlyHistory: vi.fn(async () => [{ month: '2021-04-01', total: '9000', comp_sale: null, customers: 300 }]),
  listTargets: vi.fn(async () => [{ month: '2026-11-01', target: '2000' }]),
};
vi.mock('../../js/modules/sales/data/api.js', () => api);
const tick = () => new Promise((r) => setTimeout(r, 15));
let el;
beforeEach(() => {
  document.body.innerHTML = '<div id="p"></div>';
  el = document.getElementById('p');
  sessionStorage.clear();
  location.hash = '';
  Object.values(api).forEach((f) => f.mockClear());
});
async function open() {
  const { mount } = await import('../../js/modules/sales/ui/index.js');
  await mount(el);
  await tick();
}

describe('Index page', () => {
  it('shows each month as a card, newest year first, with growth against last year and target progress', async () => {
    await open();
    const years = [...el.querySelectorAll('details.year summary .m-name')].map((n) => n.textContent);
    expect(years).toEqual(['2026', '2025', '2021']);
    const nov = el.querySelector('.month-card[data-month="2026-11"]');
    expect(nov.textContent).toContain('1,600');
    expect(nov.textContent).toContain('▲ 60.0% vs last year');
    expect(nov.textContent).toContain('80% of target');
    expect(nov.querySelector('.kpfill').style.width).toBe('80%');
  });
  it('a month with only monthly figures is marked and cannot be opened', async () => {
    await open();
    const a = el.querySelector('.month-card[data-month="2021-04"]');
    expect(a.textContent).toContain('Monthly figures only');
    expect(a.disabled).toBe(true);
  });
  it('tapping a month opens its days', async () => {
    await open();
    el.querySelector('.month-card[data-month="2026-11"]').click();
    expect(sessionStorage.getItem('sales.data.month')).toBe('2026-11');
    expect(location.hash).toBe('#/sales/data');
  });
  it('still works if the targets cannot be read', async () => {
    api.listTargets.mockImplementationOnce(async () => {
      throw new Error('x');
    });
    await open();
    expect(el.querySelector('.month-card[data-month="2026-11"]').textContent).not.toContain('of target');
  });
});
