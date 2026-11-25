// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flush } from './tasks-fixtures.js';

vi.mock('../../js/modules/home/data/api.js', () => ({ myInboxList: vi.fn(), myInboxUnread: vi.fn() }));
const api = await import('../../js/modules/home/data/api.js');
const { startMessages } = await import('../../js/modules/home/ui/messages.js');

const M = (n, o = {}) => ({
  id: `51000000-0000-0000-0000-${String(n).padStart(12, '0')}`,
  kind: 'task.assigned',
  title: `Message ${n}`,
  body: '',
  href: '/tasks',
  at: new Date(Date.now() - n * 60_000).toISOString(),
  read: false,
  ...o,
});
let host;
beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '<div id="h"></div>';
  host = document.getElementById('h');
  api.myInboxList.mockReset().mockResolvedValue([M(1), M(2), M(3), M(4), M(5, { read: true })]);
  api.myInboxUnread.mockReset().mockResolvedValue(4);
});
afterEach(() => {
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('Home Messages', () => {
  it('shows the count, the newest three unread, and a link for the rest', async () => {
    startMessages({ host, perms: ['ntf.view_own'] });
    await flush(vi);
    expect(host.textContent).toContain('4 new messages');
    expect(host.querySelectorAll('.tk-card')).toHaveLength(3);
    expect(host.textContent).toContain('1 more');
    expect(host.querySelector('a[href="#/inbox"]')).not.toBeNull();
  });
  it('says you are up to date when nothing is unread', async () => {
    api.myInboxList.mockResolvedValue([M(1, { read: true })]);
    api.myInboxUnread.mockResolvedValue(0);
    startMessages({ host, perms: ['ntf.view_own'] });
    await flush(vi);
    expect(host.textContent).toContain('You are up to date');
  });
  it('asks the database for nothing without the permission', () => {
    expect(startMessages({ host, perms: ['sales.view_last_day'] })).toBeNull();
    expect(api.myInboxList).not.toHaveBeenCalled();
  });
  it('shows nothing when the database says the inbox is not for this person', async () => {
    api.myInboxList.mockResolvedValue(null);
    api.myInboxUnread.mockResolvedValue(null);
    startMessages({ host, perms: ['ntf.view_own'] });
    await flush(vi);
    expect(host.textContent.trim()).toBe('');
  });
  it('says plainly when it could not load, and keeps the last list when a refresh fails', async () => {
    api.myInboxList.mockRejectedValue(new Error('offline'));
    startMessages({ host, perms: ['ntf.view_own'] });
    await flush(vi);
    expect(host.textContent).toContain('could not be loaded');
  });
});
