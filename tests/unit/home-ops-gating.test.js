// @vitest-environment jsdom
// Home shows the Action Centre and Recent Activity only to people who hold ops.view, and never asks the database otherwise.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../js/modules/home/data/api.js', () => ({
  coverSummary: vi.fn(async () => ({ sales: { last_day: { date: '2026-11-20', total: 1000 } } })),
  inventoryCover: vi.fn(async () => null),
  lifetimeSalesMonths: vi.fn(async () => null),
  notificationsAttention: vi.fn(async () => null),
  opsActionItems: vi.fn(async () => ({ items: [] })),
  opsRecentActivity: vi.fn(async () => ({ events: [] })),
}));
const api = await import('../../js/modules/home/data/api.js');
const { mount } = await import('../../js/modules/home/ui/page.js');

let el;
const open = async (permissions) => {
  await mount(el, { ctx: { permissions, username: 'u', full_name: 'Test Person' }, modules: [] });
  for (let i = 0; i < 8; i++) await Promise.resolve();
  await vi.advanceTimersByTimeAsync(0);
};

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '<div id="home"></div>';
  el = document.getElementById('home');
  api.opsActionItems.mockClear();
  api.opsRecentActivity.mockClear();
});
afterEach(() => {
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('Home: Operations sections are for ops.view only', () => {
  it('does not render or request them for ordinary staff', async () => {
    await open(['sales.view_last_day']);
    expect(el.querySelector('#home-ops-actions')).toBeNull();
    expect(el.querySelector('#home-ops-activity')).toBeNull();
    expect(api.opsActionItems).not.toHaveBeenCalled();
    expect(api.opsRecentActivity).not.toHaveBeenCalled();
  });

  it('renders them in the agreed order for the Owner: snapshot, Action Centre, then Recent Activity', async () => {
    await open(['ops.view', 'sales.view_last_day', 'sales.view_history']);
    expect(api.opsActionItems).toHaveBeenCalledTimes(1);
    expect(el.querySelector('#home-ops-actions .ops-section')).not.toBeNull();
    expect(el.querySelector('#home-ops-activity .ops-section')).not.toBeNull();
    const order = [...el.querySelectorAll('h2')].map((h) => h.textContent.trim());
    expect(order.indexOf('Business snapshot')).toBeGreaterThanOrEqual(0);
    expect(order.indexOf('Action Centre')).toBeGreaterThan(order.indexOf('Business snapshot'));
    expect(order.indexOf('Recent activity')).toBeGreaterThan(order.indexOf('Action Centre'));
    expect(order.indexOf('Favourites')).toBeGreaterThan(order.indexOf('Recent activity'));
  });
});
