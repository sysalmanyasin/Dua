// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { navLinks, resolveModules } from '../../js/core/registry.js';
import { startBell } from '../../js/core/bell.js';
import { startShell } from '../../js/core/shell.js';
import tasks from '../../js/modules/tasks/manifest.js';
import inbox from '../../js/modules/inbox/manifest.js';
import { icon } from '../../js/shared/icons.js';

const home = {
  id: 'home',
  title: 'Home',
  core: true,
  nav: { order: 0 },
  permission: null,
  routes: [{ path: '/home', title: 'Home', load: async () => ({ mount: (el) => (el.textContent = 'home') }) }],
};
const stub = (m) => ({ ...m, routes: m.routes.map((r) => ({ ...r, load: async () => ({ mount: (el) => (el.textContent = r.path) }) })) });
const staff = ['tasks.view_own', 'ntf.view_own'];
const owner = [...staff, 'tasks.verify', 'tasks.manage'];

describe('menu links (pure)', () => {
  it('the Owner sees Tasks then Team; staff see Tasks only; Inbox is never in the menu', () => {
    const all = [home, tasks, inbox];
    const o = navLinks(resolveModules(all, { permissions: owner }));
    expect(o.map((l) => l.title)).toEqual(['Home', 'Tasks', 'Team']);
    expect(o.find((l) => l.title === 'Team').path).toBe('/tasks/team');
    const s = navLinks(resolveModules(all, { permissions: staff }));
    expect(s.map((l) => l.title)).toEqual(['Home', 'Tasks']);
  });
  it('Tasks and Inbox have their own icons, and the bell and tasks icons exist', () => {
    expect(tasks.icon).toBe('tasks');
    expect(inbox.icon).toBe('bell');
    expect(String(icon('bell'))).toContain('<svg');
    expect(String(icon('tasks'))).not.toBe(String(icon('menu')));
  });
});

describe('shell menu and bell slot', () => {
  let root, stop;
  const tick = () => new Promise((r) => setTimeout(r, 20));
  beforeEach(async () => {
    document.body.innerHTML = '<div id="app"></div>';
    root = document.getElementById('app');
    location.hash = '';
    await tick();
  });
  afterEach(() => stop?.());
  it('highlights Team, not Tasks, on the Team page', async () => {
    const bellless = { ...inbox, bell: undefined };
    stop = startShell(root, { full_name: 'O', role: 'admin', permissions: owner, modules_disabled: [] }, [
      stub(home),
      stub(tasks),
      stub(bellless),
    ]);
    await tick();
    location.hash = '#/tasks/team';
    await tick();
    expect(root.querySelector('[data-link="tasks:team"]').classList.contains('is-active')).toBe(true);
    expect(root.querySelector('[data-link="tasks"]').classList.contains('is-active')).toBe(false);
    location.hash = '#/tasks';
    await tick();
    expect(root.querySelector('[data-link="tasks"]').classList.contains('is-active')).toBe(true);
    expect(root.querySelector('[data-link="inbox"]')).toBeNull();
  });
});

describe('bell', () => {
  let slot, ctl;
  const make = (polls) => {
    const poll = vi.fn();
    polls.forEach((p) => poll.mockImplementationOnce(async () => (p instanceof Error ? Promise.reject(p) : p)));
    poll.mockImplementation(async () => polls.at(-1));
    return { poll, owner: { bell: { href: '/inbox', refreshMs: 60_000, load: async () => ({ poll }) } } };
  };
  const msg = (id, title) => ({ id, title, body: 'x', href: '/tasks' });
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '<span id="slot" hidden></span>';
    document.title = 'My Tasks · Dua';
    slot = document.getElementById('slot');
  });
  afterEach(() => {
    ctl?.stop();
    vi.useRealTimers();
  });
  const flush = async () => {
    await vi.advanceTimersByTimeAsync(5);
  };

  it('shows the unread number, puts it in the tab title, and says so once on opening', async () => {
    const { owner: o } = make([{ count: 3, items: [msg('a', 'One'), msg('b', 'Two'), msg('c', 'Three')] }]);
    ctl = startBell(slot, o);
    await flush();
    expect(slot.hidden).toBe(false);
    expect(slot.querySelector('.bell-count').textContent).toBe('3');
    expect(slot.querySelector('a').getAttribute('href')).toBe('#/inbox');
    expect(slot.querySelector('a').getAttribute('aria-label')).toBe('Inbox, 3 unread');
    expect(document.title).toBe('(3) My Tasks · Dua');
    expect(document.querySelectorAll('.bell-notice')).toHaveLength(1);
    expect(document.querySelector('.bell-notice').textContent).toBe('You have 3 new messages');
  });
  it('a message that arrives later pops a notice once, and the title follows page changes', async () => {
    const { owner: o } = make([
      { count: 1, items: [msg('a', 'One')] },
      { count: 2, items: [msg('a', 'One'), msg('b', 'Two')] },
    ]);
    ctl = startBell(slot, o);
    await flush();
    document.querySelectorAll('.bell-notice').forEach((n) => n.remove());
    await vi.advanceTimersByTimeAsync(60_000);
    const notes = [...document.querySelectorAll('.bell-notice')];
    expect(notes).toHaveLength(1);
    expect(notes[0].textContent).toBe('Two: x');
    expect(notes[0].getAttribute('href')).toBe('#/tasks');
    await vi.advanceTimersByTimeAsync(60_000); // the notice has faded; the same message is not announced again
    expect(document.querySelectorAll('.bell-notice')).toHaveLength(0);
    document.title = 'Requests · Dua';
    ctl.retitle();
    expect(document.title).toBe('(2) Requests · Dua');
  });
  it('clears the number when everything is read, and hides itself for someone with no inbox', async () => {
    const { owner: o } = make([
      { count: 1, items: [msg('a', 'One')] },
      { count: 0, items: [] },
    ]);
    ctl = startBell(slot, o);
    await flush();
    document.dispatchEvent(new CustomEvent('dua:inbox-changed'));
    await flush();
    expect(slot.querySelector('.bell-count')).toBeNull();
    expect(document.title).toBe('My Tasks · Dua');
    ctl.stop();
    const none = make([null]);
    slot.hidden = true;
    ctl = startBell(slot, none.owner);
    await flush();
    expect(slot.hidden).toBe(true);
  });
  it('a failed check clears the number instead of leaving an old one, and says nothing', async () => {
    const { owner: o } = make([{ count: 2, items: [msg('a', 'One'), msg('b', 'Two')] }, new Error('network')]);
    ctl = startBell(slot, o);
    await flush();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(slot.querySelector('.bell-count')).toBeNull();
    expect(document.title).toBe('My Tasks · Dua');
  });
  it('caps a long count at 99+ and shows at most three notices at a time', async () => {
    const many = Array.from({ length: 5 }, (_, i) => msg(`m${i}`, `T${i}`));
    const { owner: o } = make([
      { count: 0, items: [] },
      { count: 150, items: many },
    ]);
    ctl = startBell(slot, o);
    await flush();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(slot.querySelector('.bell-count').textContent).toBe('99+');
    expect([...document.querySelectorAll('.bell-notice')].map((n) => n.textContent).pop()).toBe('2 more new messages');
    expect(document.querySelectorAll('.bell-notice')).toHaveLength(4);
  });
  it('does nothing when no module offers a bell', () => {
    ctl = startBell(slot, undefined);
    expect(slot.hidden).toBe(true);
  });
});
