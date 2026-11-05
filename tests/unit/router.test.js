import { describe, expect, it } from 'vitest';
import { matchRoute, pathFromHash } from '../../js/core/router.js';

const routes = [{ path: '/home' }, { path: '/access' }];
describe('router', () => {
  it('maps hashes to paths', () => {
    expect(pathFromHash('')).toBe('/home');
    expect(pathFromHash('#/')).toBe('/home');
    expect(pathFromHash('#/access')).toBe('/access');
    expect(pathFromHash('#access')).toBe('/access');
    expect(pathFromHash('#/access/')).toBe('/access');
  });
  it('rejects odd or hostile hashes', () => {
    expect(pathFromHash('#/a b')).toBeNull();
    expect(pathFromHash('#/<script>')).toBeNull();
    expect(pathFromHash('#//evil.com')).toBeNull();
  });
  it('finds only registered routes', () => {
    expect(matchRoute('#/access', routes)).toBe(routes[1]);
    expect(matchRoute('#/closing', routes)).toBeNull();
    expect(matchRoute('#/<x>', routes)).toBeNull();
  });
});
