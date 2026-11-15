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

let root;
let stop;
afterEach(() => stop?.());
beforeEach(async () => {
  document.body.innerHTML = '<div id="app"></div>';
  root = document.getElementById('app');
  location.hash = '';
  await tick(); // let the previous test's hashchange fire before this test's shell starts listening
  Object.keys(loads).forEach((k) => (loads[k] = 0));
});

describe('app shell', () => {
  it('someone with a single module lands inside it and has no Home link', async () => {
    const one = manifests
      .filter((m) => m.id === 'home' || m.id === 'closing')
      .map((m) => ({ ...m, routes: m.routes.map((r) => ({ ...r, title: m.title })) }));
    stop = startShell(root, junior, one);
    await tick();
    expect(location.hash).toBe('#/closing');
    expect(root.querySelector('.nav-home')).toBeNull();
  });
  it('with several modules Home stays the landing page and the status bar shows only there', async () => {
    const titled = manifests.map((m) => ({ ...m, routes: m.routes.map((r) => ({ ...r, title: m.title })) }));
    stop = startShell(root, admin, titled);
    await tick();
    expect(location.hash).toBe('');
    expect(root.querySelector('#status-bar').hidden).toBe(false);
    location.hash = '#/closing';
    await tick();
    expect(root.querySelector('#status-bar').hidden).toBe(true);
  });

  it('a junior sees only permitted modules and the owner-only module is not routable', async () => {
    stop = startShell(root, junior, manifests);
    await tick();
    location.hash = '#/access';
    await tick();
    expect(root.querySelector('#content').textContent).toContain('Not found');
    expect(loads.access).toBe(0); // the module's code was never even requested
  });

  it('the owner sees the access module', async () => {
    stop = startShell(root, admin, manifests);
    await tick();
    location.hash = '#/access';
    await tick();
    expect(loads.access).toBe(1);
    expect(root.querySelector('.nav-home')).not.toBeNull(); // a way back to Home inside a module
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

  it('each page gets its own container, so old handlers cannot run on the next page', async () => {
    const hosts = [];
    const m = [
      {
        id: 'a',
        title: 'A',
        icon: 'home',
        core: true,
        nav: { order: 0 },
        permission: null,
        routes: [
          { path: '/home', load: async () => ({ mount: (el) => hosts.push(el) }) },
          { path: '/other', load: async () => ({ mount: (el) => hosts.push(el) }) },
        ],
      },
    ];
    stop = startShell(root, junior, m);
    await tick();
    location.hash = '#/other';
    await tick();
    expect(hosts.length).toBeGreaterThanOrEqual(2);
    expect(new Set(hosts).size).toBe(hosts.length); // never the same container twice
    expect(hosts.at(-1).isConnected).toBe(true);
    for (const old of hosts.slice(0, -1)) expect(old.isConnected).toBe(false);
  });

  it('user-supplied names are escaped in the shell', async () => {
    stop = startShell(root, { ...junior, full_name: '<img src=x onerror=alert(1)>' }, manifests);
    await tick();
    expect(root.querySelector('img:not(.hdr-logo)')).toBeNull();
    expect(root.querySelector('.who strong').textContent).toBe('<img src=x onerror=alert(1)>');
  });
});
