import { describe, expect, it } from 'vitest';
import { environmentName, getConfig } from '../../js/core/config.js';
import { scrub } from '../../js/core/logger.js';

describe('environment selection', () => {
  it('uses staging on localhost and staging paths, production otherwise', () => {
    expect(environmentName({ hostname: 'localhost', pathname: '/' })).toBe('staging');
    expect(environmentName({ hostname: 'sysalmanyasin.github.io', pathname: '/Dua-staging/' })).toBe('staging');
    expect(environmentName({ hostname: 'sysalmanyasin.github.io', pathname: '/Dua/' })).toBe('production');
  });
  it('is configured with a Supabase URL and a publishable (never secret) key', () => {
    const cfg = getConfig({ hostname: 'localhost', pathname: '/' });
    expect(cfg.configured).toBe(true);
    expect(cfg.url).toMatch(/^https:\/\/[a-z0-9]+\.supabase\.co$/);
    expect(cfg.publishableKey).toMatch(/^sb_publishable_/);
    expect(cfg.functionsUrl).toBe(`${cfg.url}/functions/v1`);
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
