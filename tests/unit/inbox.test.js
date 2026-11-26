// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ago, normaliseMessages, unreadOf, unreadText } from '../../js/modules/inbox/domain/inbox.js';
import manifest from '../../js/modules/inbox/manifest.js';
import { flush } from './tasks-fixtures.js';

vi.mock('../../js/modules/inbox/data/api.js', () => ({ listMine: vi.fn(), unreadCount: vi.fn(), markRead: vi.fn(), markAllRead: vi.fn() }));
const api = await import('../../js/modules/inbox/data/api.js');
const page = await import('../../js/modules/inbox/ui/page.js');

const M = (n, o = {}) => ({
  id: `51000000-0000-0000-0000-${String(n).padStart(12, '0')}`,
  kind: 'task.assigned',
  title: `Message ${n}`,
  body: `Body ${n}`,
  href: '/tasks',
  at: new Date(Date.now() - n * 3_600_000).toISOString(),
  read: false,
  ...o,
});

describe('inbox domain', () => {
  it('hides the screen (null) when the database says it is not for you', () => {
    expect(normaliseMessages(null)).toBeNull();
    expect(normaliseMessages(undefined)).toBeNull();
  });
  it('drops malformed rows, clamps text and allows only in-app links', () => {
    const rows = normaliseMessages([
      M(1),
      { id: 'bad', title: 'x', at: new Date().toISOString() },
      M(2, { href: 'https://evil.example/x' }),
      M(3, { href: '/tasks/verify' }),
      M(4, { title: 'T'.repeat(500) }),
      M(5, { at: 'not a date' }),
    ]);
    expect(rows.map((r) => r.title.slice(0, 9))).toEqual(['Message 1', 'Message 2', 'Message 3', 'TTTTTTTTT']);
    expect(rows[1].href).toBeNull();
    expect(rows[2].href).toBe('/tasks/verify');
    expect(rows[3].title).toHaveLength(120);
  });
  it('counts unread and words it', () => {
    const rows = normaliseMessages([M(1), M(2, { read: true })]);
    expect(unreadOf(rows)).toHaveLength(1);
    expect(unreadText(0)).toBe('No new messages');
    expect(unreadText(1)).toBe('1 new message');
    expect(unreadText(4)).toBe('4 new messages');
  });
  it('words the time', () => {
    const now = Date.parse('2026-11-25T10:00:00Z');
    const at = (s) => new Date(now - s * 1000).toISOString();
    expect(ago(at(20), now)).toBe('Just now');
    expect(ago(at(300), now)).toBe('5 min ago');
    expect(ago(at(3600), now)).toBe('1 hour ago');
    expect(ago(at(7200), now)).toBe('2 hours ago');
    expect(ago(at(90_000), now)).toBe('Yesterday');
    expect(ago(at(3 * 86_400), now)).toBe('3 days ago');
    expect(ago(at(30 * 86_400), now)).toMatch(/2026/);
  });
});

describe('inbox manifest', () => {
  it('is gated by ntf.view_own and loads its page', async () => {
    expect(manifest.permission).toBe('ntf.view_own');
    expect(manifest.routes.map((r) => [r.path, r.permission])).toEqual([['/inbox', 'ntf.view_own']]);
    expect(typeof (await manifest.routes[0].load()).mount).toBe('function');
  });
});

describe('Inbox page', () => {
  let el;
  const open = async () => {
    await page.mount(el);
    await flush(vi);
  };
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '<div id="root"></div>';
    el = document.getElementById('root');
    for (const f of Object.values(api)) f.mockReset();
    api.listMine.mockResolvedValue([M(1), M(2, { read: true }), M(3, { href: null })]);
    api.markRead.mockResolvedValue(1);
    api.markAllRead.mockResolvedValue(2);
    location.hash = '';
  });
  afterEach(() => {
    el.remove();
    vi.useRealTimers();
  });

  it('shows unread first-class: a New label, the count, and a link button only where there is a link', async () => {
    await open();
    expect(el.textContent).toContain('2 new messages');
    expect(el.querySelectorAll('.ib-unread')).toHaveLength(2);
    expect(el.querySelectorAll('[data-act="open"]')).toHaveLength(2); // message 3 has no link
    expect(el.querySelectorAll('[data-act="read"]')).toHaveLength(2); // message 2 is already read
  });
  it('opening a message marks it read and goes to what it is about', async () => {
    await open();
    el.querySelector('[data-act="open"]').click();
    await flush(vi);
    expect(api.markRead).toHaveBeenCalledWith(['51000000-0000-0000-0000-000000000001']);
    expect(location.hash).toBe('#/tasks');
  });
  it('marks one read, and all read', async () => {
    await open();
    el.querySelector('[data-act="read"]').click();
    await flush(vi);
    expect(api.markRead).toHaveBeenCalledTimes(1);
    el.querySelector('[data-act="read-all"]').click();
    await flush(vi);
    expect(api.markAllRead).toHaveBeenCalled();
    expect(el.querySelector('.tk-message').textContent).toContain('All messages marked as read');
  });
  it('filters to new messages only and says when you are up to date', async () => {
    await open();
    el.querySelector('[data-filter="unread"]').click();
    await flush(vi);
    expect(el.querySelectorAll('.tk-card')).toHaveLength(2);
    api.listMine.mockResolvedValue([M(2, { read: true })]);
    el.querySelector('[data-tk-refresh]').click();
    await flush(vi);
    expect(el.textContent).toContain('Nothing new. You are up to date.');
    expect(el.querySelector('[data-act="read-all"]').disabled).toBe(true);
  });
  it('says so for an empty inbox and for a login with no inbox', async () => {
    api.listMine.mockResolvedValue([]);
    await open();
    expect(el.textContent).toContain('No messages yet.');
    api.listMine.mockResolvedValue(null);
    await open();
    expect(el.textContent).toContain('not set up for your login');
  });
  it('shows the real reason when clearing fails, and keeps the list', async () => {
    api.markAllRead.mockRejectedValue(new TypeError('Failed to fetch'));
    await open();
    el.querySelector('[data-act="read-all"]').click();
    await flush(vi);
    expect(el.querySelector('.tk-message .note-error').textContent).toContain('did not work');
    expect(el.querySelectorAll('.tk-card')).toHaveLength(3);
  });
  it('keeps the old list and warns when a refresh fails', async () => {
    await open();
    api.listMine.mockRejectedValue(new Error('offline'));
    el.querySelector('[data-tk-refresh]').click();
    await flush(vi);
    expect(el.querySelectorAll('.tk-card')).toHaveLength(3);
  });
  it('every action is a real button with text', async () => {
    await open();
    for (const b of el.querySelectorAll('[data-act]')) {
      expect(b.tagName).toBe('BUTTON');
      expect(b.textContent.trim().length).toBeGreaterThan(1);
    }
  });
});
