// @vitest-environment jsdom
// The Owner's Action Centre and Recent Activity on Home, with the database mocked.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../js/modules/home/data/api.js', () => ({ opsActionItems: vi.fn(), opsRecentActivity: vi.fn() }));
const api = await import('../../js/modules/home/data/api.js');
const { startOpsSections } = await import('../../js/modules/home/ui/ops.js');

const issue = (o = {}) => ({
  rule_key: 'sales_missing',
  category: 'sales',
  severity: 'critical',
  title: 'Daily sales not entered',
  detail: 'No sales entered for: 20 Nov.',
  responsible: 'Owner',
  deadline: null,
  href: '/sales',
  ref: '',
  ...o,
});
const event = (o = {}) => ({
  at: new Date().toISOString(),
  category: 'closing_done',
  title: 'Closing submitted',
  detail: '21 Nov · Evening',
  href: '/closing',
  ref: 'c1',
  ...o,
});

let actionHost, activityHost, refresher;
const flush = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
  await vi.advanceTimersByTimeAsync(0);
};
const start = async () => {
  refresher = startOpsSections({ actionHost, activityHost });
  await flush();
};

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '<div id="a"></div><div id="b"></div>';
  actionHost = document.getElementById('a');
  activityHost = document.getElementById('b');
  api.opsActionItems.mockReset();
  api.opsRecentActivity.mockReset();
});
afterEach(() => {
  refresher?.stop();
  vi.useRealTimers();
});

describe('Home Action Centre', () => {
  it('lists issues with priority, person, explanation and an Open link into the module', async () => {
    api.opsActionItems.mockResolvedValue({
      items: [
        issue(),
        issue({ severity: 'info', title: 'Low stock', category: 'inventory', href: '/inventory', rule_key: 'stock_reorder' }),
      ],
    });
    api.opsRecentActivity.mockResolvedValue({ events: [] });
    await start();
    const rows = actionHost.querySelectorAll('.ops-issue');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('Critical');
    expect(rows[0].textContent).toContain('Responsible: Owner');
    expect(rows[0].textContent).toContain('No sales entered');
    expect(rows[0].querySelector('a').getAttribute('href')).toBe('#/sales');
    expect(actionHost.textContent).toContain('2 open');
  });

  it('has no dismiss control: an issue can only be fixed in its own page', async () => {
    api.opsActionItems.mockResolvedValue({ items: [issue()] });
    api.opsRecentActivity.mockResolvedValue({ events: [] });
    await start();
    const labels = [...actionHost.querySelectorAll('button')].map((b) => b.textContent.trim().toLowerCase());
    expect(labels).toEqual(['refresh']);
  });

  it('filters by priority and area', async () => {
    api.opsActionItems.mockResolvedValue({
      items: [issue(), issue({ severity: 'info', title: 'Low stock', category: 'inventory', rule_key: 'stock_reorder' })],
    });
    api.opsRecentActivity.mockResolvedValue({ events: [] });
    await start();
    const sel = actionHost.querySelector('[data-ops-filter="priority"]');
    sel.value = 'info';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    const rows = actionHost.querySelectorAll('.ops-issue');
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain('Low stock');
    const area = actionHost.querySelector('[data-ops-filter="category"]');
    area.value = 'sales';
    area.dispatchEvent(new Event('change', { bubbles: true }));
    expect(actionHost.textContent).toContain('No issues match these filters.');
  });

  it('says all clear when nothing is open', async () => {
    api.opsActionItems.mockResolvedValue({ items: [] });
    api.opsRecentActivity.mockResolvedValue({ events: [] });
    await start();
    expect(actionHost.textContent).toContain('Nothing needs your action');
  });

  it('shows nothing at all for a person the database does not allow (null result)', async () => {
    api.opsActionItems.mockResolvedValue(null);
    api.opsRecentActivity.mockResolvedValue(null);
    await start();
    expect(actionHost.querySelector('.ops-section')).toBeNull();
    expect(activityHost.querySelector('.ops-section')).toBeNull();
  });

  it('keeps the old list and warns that it may be out of date when a refresh fails', async () => {
    api.opsActionItems.mockResolvedValueOnce({ items: [issue()] }).mockRejectedValue(new Error('network'));
    api.opsRecentActivity.mockResolvedValueOnce({ events: [event()] }).mockRejectedValue(new Error('network'));
    await start();
    expect(actionHost.querySelectorAll('.ops-issue')).toHaveLength(1);
    actionHost.querySelector('[data-ops-refresh]').click();
    await flush();
    expect(actionHost.querySelectorAll('.ops-issue')).toHaveLength(1);
    expect(actionHost.querySelector('.ops-status').textContent).toMatch(/out of date/);
    expect(activityHost.querySelectorAll('li')).toHaveLength(1);
  });

  it('one failing list does not hide the other', async () => {
    api.opsActionItems.mockRejectedValue(new Error('boom'));
    api.opsRecentActivity.mockResolvedValue({ events: [event()] });
    await start();
    expect(actionHost.textContent).toContain('The issue list could not be loaded');
    expect(activityHost.querySelectorAll('li')).toHaveLength(1);
  });

  it('refreshes by itself every minute and stops once the page is gone', async () => {
    api.opsActionItems.mockResolvedValue({ items: [] });
    api.opsRecentActivity.mockResolvedValue({ events: [] });
    await start();
    expect(api.opsActionItems).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(api.opsActionItems).toHaveBeenCalledTimes(2);
    document.body.innerHTML = '';
    await vi.advanceTimersByTimeAsync(120_000);
    expect(api.opsActionItems).toHaveBeenCalledTimes(2);
  });
});

describe('Home Recent Activity', () => {
  it('shows at most the ten latest events, newest first, with a link', async () => {
    api.opsActionItems.mockResolvedValue({ items: [] });
    const events = Array.from({ length: 12 }, (_, i) =>
      event({ at: new Date(Date.now() - i * 3_600_000).toISOString(), ref: `c${i}`, title: `Event ${i}` }),
    );
    api.opsRecentActivity.mockResolvedValue({ events });
    await start();
    const rows = activityHost.querySelectorAll('li');
    expect(rows).toHaveLength(10);
    expect(rows[0].textContent).toContain('Event 0');
    expect(rows[0].querySelector('a').getAttribute('href')).toBe('#/closing');
  });

  it('explains an empty list in plain words', async () => {
    api.opsActionItems.mockResolvedValue({ items: [] });
    api.opsRecentActivity.mockResolvedValue({ events: [] });
    await start();
    expect(activityHost.textContent).toContain('No recent activity');
  });

  it('escapes anything a database text could contain', async () => {
    api.opsActionItems.mockResolvedValue({
      items: [issue({ title: '<img src=x onerror=alert(1)>', detail: '<script>alert(2)</script>' })],
    });
    api.opsRecentActivity.mockResolvedValue({ events: [] });
    await start();
    expect(actionHost.querySelector('img')).toBeNull();
    expect(actionHost.querySelector('script')).toBeNull();
    expect(actionHost.textContent).toContain('<img src=x');
  });
});
