import { describe, expect, it } from 'vitest';
import { loadManifests, resolveModules, routesFor, setBrokenHandler } from '../../js/core/registry.js';

const home = { id: 'home', title: 'Home', core: true, nav: { order: 0 }, permission: null, routes: [{ path: '/home' }] };
const access = { id: 'access', title: 'Access', nav: { order: 90 }, permission: 'users.manage', routes: [{ path: '/access' }] };
const closing = { id: 'closing', title: 'Closing', nav: { order: 20 }, permission: 'closing.enter_own', routes: [{ path: '/closing' }] };
const all = [access, closing, home];
const ids = (list) => list.map((m) => m.id);

describe('module visibility', () => {
  it('shows each person only the modules their permissions allow', () => {
    expect(ids(resolveModules(all, { permissions: [] }))).toEqual(['home']);
    expect(ids(resolveModules(all, { permissions: ['closing.enter_own'] }))).toEqual(['home', 'closing']);
    expect(ids(resolveModules(all, { permissions: ['closing.enter_own', 'users.manage'] }))).toEqual(['home', 'closing', 'access']);
  });
  it('a module switched off disappears without affecting the others', () => {
    const perms = ['closing.enter_own', 'users.manage'];
    expect(ids(resolveModules(all, { permissions: perms, disabled: ['closing'] }))).toEqual(['home', 'access']);
  });
  it('core modules cannot be switched off', () => {
    expect(ids(resolveModules(all, { permissions: [], disabled: ['home'] }))).toEqual(['home']);
  });
  it('routes of hidden modules are not routable', () => {
    const routes = routesFor(resolveModules(all, { permissions: [] }));
    expect(routes.map((r) => r.path)).toEqual(['/home']);
  });
  it('orders by nav.order', () => {
    expect(ids(resolveModules(all, { permissions: ['users.manage', 'closing.enter_own'] }))).toEqual(['home', 'closing', 'access']);
  });
});

describe('page-level permissions', () => {
  const sales = {
    id: 'sales',
    title: 'Sales',
    nav: { order: 10 },
    permission: null,
    routes: [
      { path: '/sales', title: 'Index', permission: 'sales.view_history' },
      { path: '/sales/entry', title: 'Add Entry', anyOf: ['sales.enter', 'sales.edit'] },
      { path: '/sales/yesterday', title: 'Last Day', permission: 'sales.view_last_day' },
    ],
  };
  const pages = (perms) =>
    resolveModules([home, sales], { permissions: perms })
      .find((m) => m.id === 'sales')
      ?.routes.map((r) => r.path);
  it('shows only the pages a person may use, and hides the module when none apply', () => {
    expect(pages(['sales.view_last_day'])).toEqual(['/sales/yesterday']);
    expect(pages(['sales.enter'])).toEqual(['/sales/entry']);
    expect(pages(['sales.edit', 'sales.view_history'])).toEqual(['/sales', '/sales/entry']);
    expect(pages([])).toBeUndefined();
  });
  it('a page that is not allowed is not routable', () => {
    const routes = routesFor(resolveModules([home, sales], { permissions: ['sales.view_last_day'] })).map((r) => r.path);
    expect(routes).not.toContain('/sales');
    expect(routes).toContain('/sales/yesterday');
  });
});

describe('manifest loading', () => {
  it('one module failing to load does not stop the others', async () => {
    const broken = [];
    setBrokenHandler((id) => broken.push(id));
    const importer = async (id) => {
      if (id === 'bad') throw new Error('boom');
      return { default: { id } };
    };
    const result = await loadManifests(['a', 'bad', 'b'], importer);
    expect(result.map((m) => m.id)).toEqual(['a', 'b']);
    expect(broken).toEqual(['bad']);
  });
});
