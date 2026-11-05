import { describe, expect, it } from 'vitest';
import { environmentName, getConfig } from '../../js/core/config.js';
import { scrub } from '../../js/core/logger.js';

describe('environment selection', () => {
  it('uses staging on localhost and staging paths, production otherwise', () => {
    expect(environmentName({ hostname: 'localhost', pathname: '/' })).toBe('staging');
    expect(environmentName({ hostname: 'sysalmanyasin.github.io', pathname: '/Dua-staging/' })).toBe('staging');
    expect(environmentName({ hostname: 'sysalmanyasin.github.io', pathname: '/Dua/' })).toBe('production');
  });
  it('reports "not configured" until URL and key are set', () => {
    expect(getConfig({ hostname: 'localhost', pathname: '/' }).configured).toBe(false);
  });
});

describe('logger', () => {
  it('hides credentials in logged data, including nested', () => {
    expect(scrub({ pin: '123456', user: 'a', nested: { access_token: 'x', ok: 1 }, setup_code: 'ABC' })).toEqual({
      pin: '[hidden]',
      user: 'a',
      nested: { access_token: '[hidden]', ok: 1 },
      setup_code: '[hidden]',
    });
  });
});
