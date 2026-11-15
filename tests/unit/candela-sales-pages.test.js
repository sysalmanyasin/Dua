// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import manifest from '../../js/modules/candela-sales/manifest.js';
import { todayPkt } from '../../js/shared/format.js';
import { addDays } from '../../js/modules/candela-sales/domain/summary.js';

const today = todayPkt();
const pay = (sale_day, c, k, cr, t, revision = 1) => ({
  sale_day,
  cash_sale: c,
  card_sale: k,
  credit_sale: cr,
  total_sale: t,
  revision,
  last_seen_at: `${sale_day}T10:00:00Z`,
});
const api = {
  paymentDays: vi.fn(async () => [
    pay(today, '400', '500', '100', '1000'),
    pay(addDays(today, -1), '10', '20', '30', '600', 2),
    pay('2026-01-05', '1', '2', '3', '6'),
  ]),
  creditRows: vi.fn(async () => [
    { sale_day: today, customer_key: 'a', customer_name: 'Test Customer A', credit_amount: '10.50', receipt_count: 1 },
    { sale_day: addDays(today, -1), customer_key: 'a', customer_name: 'Test Customer A', credit_amount: '4.50', receipt_count: 2 },
    { sale_day: today, customer_key: 'b', customer_name: 'Test Customer B', credit_amount: '100', receipt_count: 1 },
  ]),
  recentChanges: vi.fn(async () => [
    {
      kind: 'payment',
      sale_day: today,
      customer_key: null,
      old_values: { total_sale: 900 },
      new_values: { total_sale: 1000 },
      changed_at: `${today}T10:00:00Z`,
    },
  ]),
  todayTotal: vi.fn(async () => 1234.5),
};
vi.mock('../../js/modules/candela-sales/data/api.js', () => api);
const tick = () => new Promise((r) => setTimeout(r, 20));
let el;
beforeEach(() => {
  document.body.innerHTML = '<div id="p"></div>';
  el = document.getElementById('p');
  Object.values(api).forEach((f) => f.mockClear());
});
async function open(name) {
  const { mount } = await import(`../../js/modules/candela-sales/ui/${name}.js`);
  await mount(el);
  await tick();
}

describe('Candela manifest', () => {
  it('every page needs candela.view and the pill is for the two Candela permissions only', () => {
    for (const r of manifest.routes) {
      expect(r.permission).toBe('candela.view');
      expect(r.path.startsWith('/candela-sales')).toBe(true);
    }
    expect(manifest.status.anyOf).toEqual(['candela.today_total', 'candela.view']);
    expect(manifest.status.refreshMs).toBeGreaterThan(0);
  });
});

describe('Candela pages', () => {
  it('overview shows today, the day-on-day change and the month so far', async () => {
    await open('overview');
    expect(el.textContent).toContain('₨ 1,000');
    expect(el.textContent).toContain('vs yesterday');
    expect(el.textContent).toContain('Month so far');
    expect(el.textContent).toContain('Cash');
  });
  it('overview says plainly when nothing has arrived for today', async () => {
    api.paymentDays.mockResolvedValueOnce([]);
    await open('overview');
    expect(el.textContent).toContain('Nothing has arrived for today yet');
  });
  it('history lists days, marks a corrected day and totals the range', async () => {
    await open('history');
    expect(el.querySelectorAll('tbody tr').length).toBe(4);
    expect(el.textContent).toContain('Corrected');
    expect(el.querySelector('tr.sum').textContent).toContain('3 days');
  });
  it('history reloads when the date filter changes', async () => {
    await open('history');
    const from = el.querySelector('[data-f="from"]');
    from.value = '2026-01-01';
    from.dispatchEvent(new Event('change'));
    await tick();
    expect(api.paymentDays).toHaveBeenLastCalledWith('2026-01-01', today);
  });
  it('credit adds a customer across days and never calls it a balance', async () => {
    await open('credit');
    const rows = [...el.querySelectorAll('tbody tr')].map((r) => r.textContent);
    expect(rows[0]).toContain('Test Customer B');
    expect(rows.find((r) => r.includes('Test Customer A'))).toContain('15');
    expect(el.textContent).toContain('not an outstanding balance');
  });
  it('credit passes the search to the server', async () => {
    await open('credit');
    const s = el.querySelector('input[type="search"]');
    s.value = 'cust';
    s.dispatchEvent(new Event('change'));
    await tick();
    expect(api.creditRows.mock.calls.at(-1)[2]).toBe('cust');
  });
  it('reports show months and the corrections list', async () => {
    await open('reports');
    expect(el.textContent).toContain('Monthly summary');
    expect(el.textContent).toContain('Corrections from Candela');
    expect(el.textContent).toContain('900');
  });
  it('a failed load shows a calm message and a retry button, not a crash', async () => {
    api.paymentDays.mockRejectedValueOnce(new Error('boom'));
    await open('history');
    expect(el.textContent).toContain('Could not load');
    expect(el.querySelector('[data-act="retry"]')).not.toBeNull();
    expect(el.textContent).not.toContain('boom');
  });
});

describe('Candela status pill', () => {
  it('shows the one number, and a dash when there is no figure yet', async () => {
    const { pill } = await import('../../js/modules/candela-sales/status.js');
    expect((await pill({ permissions: ['candela.today_total'] })).value).toBe('₨ 1,235');
    api.todayTotal.mockResolvedValueOnce(null);
    expect((await pill({ permissions: ['candela.today_total'] })).value).toBe('—');
  });
  it('links the owner to the overview and gives staff no link into the module', async () => {
    const { pill } = await import('../../js/modules/candela-sales/status.js');
    expect((await pill({ permissions: ['candela.view'] })).href).toBe('#/candela-sales');
    expect((await pill({ permissions: ['candela.today_total'] })).href).toBe('#/home');
  });
});
