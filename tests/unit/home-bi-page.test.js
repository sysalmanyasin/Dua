// @vitest-environment jsdom
// The Owner's Business Intelligence section on Home, with the database mocked.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../js/modules/home/data/api.js', () => ({
  opsActionItems: vi.fn(),
  opsRecentActivity: vi.fn(),
  opsBiSummary: vi.fn(),
  watchClosings: vi.fn(),
}));
const api = await import('../../js/modules/home/data/api.js');
const { startOpsSections } = await import('../../js/modules/home/ui/ops.js');

const bi = (days = 30, o = {}) => ({
  days,
  from: '2026-10-23',
  to: '2026-11-21',
  previous_from: '2026-09-23',
  previous_to: '2026-10-22',
  sales: {
    total: 600000,
    recorded_days: 28,
    avg_per_day: 21428.57,
    previous_total: 500000,
    previous_recorded_days: 30,
    previous_avg_per_day: 16666.67,
    series: [{ date: '2026-11-20', total: 30000 }],
  },
  transactions: {
    total: 3000,
    counted_days: 28,
    avg_per_day: 107.1,
    previous_total: 2500,
    previous_counted_days: 30,
    previous_avg_per_day: 83.3,
  },
  inventory: {
    stockValue: 9000000,
    reorder: { count: 12, value: 400000 },
    notSold: { count: 5, value: 90000 },
    excess: { count: 3, value: 70000 },
  },
  inventory_failed: false,
  operations: { days_in_period: days, days_with_sales: 28, days_with_closing: 20, closings_submitted: 25, open_drafts: 1 },
  ...o,
});

let actionHost, biHost, activityHost, refresher, closingsChanged;
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await vi.advanceTimersByTimeAsync(0);
};
const start = async () => {
  refresher = startOpsSections({ actionHost, biHost, activityHost });
  await flush();
};

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '<div id="a"></div><div id="b"></div><div id="c"></div>';
  [actionHost, biHost, activityHost] = ['a', 'b', 'c'].map((id) => document.getElementById(id));
  Object.values(api).forEach((f) => f.mockReset());
  api.opsActionItems.mockResolvedValue({ items: [] });
  api.opsRecentActivity.mockResolvedValue({ events: [] });
  api.opsBiSummary.mockImplementation(async (d) => bi(d));
  closingsChanged = null;
  api.watchClosings.mockImplementation((cb) => {
    closingsChanged = cb;
    return () => {};
  });
});
afterEach(() => {
  refresher?.stop();
  vi.useRealTimers();
});

describe('Business intelligence', () => {
  it('defaults to 30 days and shows sales, transactions, inventory health and operations', async () => {
    await start();
    expect(api.opsBiSummary).toHaveBeenCalledWith(30);
    const t = biHost.textContent;
    expect(t).toContain('Sales');
    expect(t).toContain('Rs 600,000');
    expect(t).toContain('Transactions');
    expect(t).toContain('3,000');
    expect(t).toContain('Inventory health');
    expect(t).toContain('To reorder 12');
    expect(t).toContain('Operations');
    expect(t).toContain('Sales entered for 28 of 30 days');
    expect(biHost.querySelector('[data-bi-period="30"]').getAttribute('aria-pressed')).toBe('true');
  });

  it('compares with the previous period in plain words', async () => {
    await start();
    expect(biHost.textContent).toMatch(/▲ 28\.6% above the previous 30 days/);
  });

  it('offers 7, 30 and 90 days and reloads when the period changes', async () => {
    await start();
    const labels = [...biHost.querySelectorAll('[data-bi-period]')].map((b) => b.textContent.trim());
    expect(labels).toEqual(['7 days', '30 days', '90 days']);
    biHost.querySelector('[data-bi-period="90"]').click();
    await flush();
    expect(api.opsBiSummary).toHaveBeenLastCalledWith(90);
    expect(biHost.querySelector('[data-bi-period="90"]').getAttribute('aria-pressed')).toBe('true');
    expect(biHost.querySelector('[data-bi-period="30"]').getAttribute('aria-pressed')).toBe('false');
  });

  it('draws a trend with a text alternative', async () => {
    await start();
    const svg = biHost.querySelector('svg.bi-trend');
    expect(svg.getAttribute('role')).toBe('img');
    expect(svg.getAttribute('aria-label')).toContain('30 days');
  });

  it('shows nothing for a person the database does not allow', async () => {
    api.opsBiSummary.mockResolvedValue(null);
    await start();
    expect(biHost.querySelector('.ops-section')).toBeNull();
  });

  it('says so when stock figures could not be read, and still shows the rest', async () => {
    api.opsBiSummary.mockResolvedValue(bi(30, { inventory: null, inventory_failed: true }));
    await start();
    expect(biHost.textContent).toContain('Stock figures could not be loaded');
    expect(biHost.textContent).toContain('Rs 600,000');
  });

  it('is honest when nothing was entered', async () => {
    api.opsBiSummary.mockResolvedValue(
      bi(30, {
        sales: {
          total: 0,
          recorded_days: 0,
          avg_per_day: null,
          previous_total: 0,
          previous_recorded_days: 0,
          previous_avg_per_day: null,
          series: [],
        },
      }),
    );
    await start();
    expect(biHost.textContent).toContain('No sales entered in this period');
    expect(biHost.textContent).toContain('No earlier period to compare with');
    expect(biHost.querySelector('svg.bi-trend')).toBeNull();
  });

  it('keeps the last good figures and warns when only the business figures fail to refresh', async () => {
    await start();
    api.opsBiSummary.mockRejectedValue(new Error('network'));
    actionHost.querySelector('[data-ops-refresh]').click();
    await flush();
    expect(biHost.textContent).toContain('Rs 600,000');
    expect(actionHost.querySelector('.ops-status').textContent).toMatch(/out of date/);
  });

  it('refreshes at once when a closing changes, without waiting for the timer', async () => {
    await start();
    expect(api.opsActionItems).toHaveBeenCalledTimes(1);
    closingsChanged();
    closingsChanged();
    await vi.advanceTimersByTimeAsync(1500);
    await flush();
    expect(api.opsActionItems).toHaveBeenCalledTimes(2);
  });
});
