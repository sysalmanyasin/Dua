// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startShell } from '../../js/core/shell.js';

const loads = { home: 0, closing: 0, access: 0, broken: 0 };
const page = (name) => async () => {
  loads[name]++;
  return { mount: (el) => (el.textContent = `page:${name}`) };
};
const manifests = [
  {
    id: 'home',
    title: 'Home',
    icon: 'home',
    core: true,
    nav: { order: 0 },
    permission: null,
    routes: [{ path: '/home', load: page('home') }],
  },
  {
    id: 'closing',
    title: 'Closing',
    icon: 'shield',
    nav: { order: 20 },
    permission: 'closing.enter_own',
    routes: [{ path: '/closing', load: page('closing') }],
  },
  {
    id: 'access',
    title: 'Users & Access',
    icon: 'users',
    nav: { order: 90 },
    permission: 'users.manage',
    routes: [{ path: '/access', load: page('access') }],
  },
  {
    id: 'broken',
    title: 'Broken',
    icon: 'shield',
    nav: { order: 50 },
    permission: null,
    routes: [
      {
        path: '/broken',
        load: async () => {
          loads.broken++;
          throw new Error('module exploded');
        },
      },
    ],
  },
];
const junior = { full_name: 'Ali Khan', username: 'ali', role: 'junior', permissions: ['closing.enter_own'], modules_disabled: [] };
const admin = {
  full_name: 'Owner',
  username: 'owner',
  role: 'admin',
  permissions: ['closing.enter_own', 'users.manage'],
  modules_disabled: [],
};
const tick = () => new Promise((r) => setTimeout(r, 20));
const navTitles = (root) => [...root.querySelectorAll('.nav-link span')].map((s) => s.textContent);

let root;
let stop;
afterEach(() => stop?.());
beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  root = document.getElementById('app');
  location.hash = '';
  Object.keys(loads).forEach((k) => (loads[k] = 0));
});

describe('app shell', () => {
  it('a junior sees only permitted modules and the owner-only module is not routable', async () => {
    stop = startShell(root, junior, manifests);
    await tick();
    expect(navTitles(root)).toEqual(['Home', 'Closing', 'Broken']);
    location.hash = '#/access';
    await tick();
    expect(root.querySelector('#content').textContent).toContain('Not found');
    expect(loads.access).toBe(0); // the module's code was never even requested
  });

  it('the owner sees the access module', async () => {
    stop = startShell(root, admin, manifests);
    await tick();
    expect(navTitles(root)).toContain('Users & Access');
  });

  it('module code loads only when its page is opened', async () => {
    stop = startShell(root, admin, manifests);
    await tick();
    expect(loads).toMatchObject({ home: 1, closing: 0, access: 0 });
    location.hash = '#/closing';
    await tick();
    expect(loads.closing).toBe(1);
    expect(root.querySelector('#content').textContent).toBe('page:closing');
  });

  it('a switched-off module disappears and cannot be opened', async () => {
    stop = startShell(root, { ...admin, modules_disabled: ['closing'] }, manifests);
    await tick();
    expect(navTitles(root)).not.toContain('Closing');
    location.hash = '#/closing';
    await tick();
    expect(loads.closing).toBe(0);
  });

  it('a module that crashes shows a message and the rest of the app keeps working', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    stop = startShell(root, admin, manifests);
    await tick();
    location.hash = '#/broken';
    await tick();
    expect(root.querySelector('#content').textContent).toContain('could not load');
    location.hash = '#/home';
    await tick();
    expect(root.querySelector('#content').textContent).toBe('page:home');
  });

  it('user-supplied names are escaped in the shell', async () => {
    stop = startShell(root, { ...junior, full_name: '<img src=x onerror=alert(1)>' }, manifests);
    await tick();
    expect(root.querySelector('img')).toBeNull();
    expect(root.querySelector('.who strong').textContent).toBe('<img src=x onerror=alert(1)>');
  });
});
