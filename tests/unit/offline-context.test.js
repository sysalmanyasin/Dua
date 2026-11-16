// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { isNetworkDown, loadOfflineContext, saveOfflineContext } from '../../js/core/offlineContext.js';
import { clearLocalWork } from '../../js/core/auth.js';

const ctx = {
  user_id: 'u1',
  username: 'ali',
  full_name: 'Ali',
  role: 'junior',
  mfa_ok: true,
  permissions: ['ebill.use', 'sales.view_last_day', 'closing.enter_own'],
  modules_disabled: ['str'],
};
const NOW = Date.UTC(2026, 10, 15);
beforeEach(() => localStorage.clear());

describe('offline context', () => {
  it('keeps only who the person is and the Emergency Billing right', () => {
    saveOfflineContext(ctx, localStorage, NOW);
    const got = loadOfflineContext(localStorage, NOW + 1000);
    expect(got).toMatchObject({ user_id: 'u1', full_name: 'Ali', offline: true, permissions: ['ebill.use'], modules_disabled: [] });
    expect(JSON.stringify(localStorage.getItem('dua.offline.ctx'))).not.toMatch(/sales|closing|str/);
  });
  it('keeps nothing for someone who cannot bill, or has not passed MFA', () => {
    saveOfflineContext({ ...ctx, permissions: ['sales.view_last_day'] }, localStorage, NOW);
    expect(loadOfflineContext(localStorage, NOW)).toBeNull();
    saveOfflineContext({ ...ctx, mfa_ok: false }, localStorage, NOW);
    expect(loadOfflineContext(localStorage, NOW)).toBeNull();
  });
  it('removes an old copy when the person loses the right', () => {
    saveOfflineContext(ctx, localStorage, NOW);
    saveOfflineContext({ ...ctx, permissions: [] }, localStorage, NOW + 1);
    expect(loadOfflineContext(localStorage, NOW + 2)).toBeNull();
  });
  it('expires after 30 days and ignores a clock set far in the past', () => {
    saveOfflineContext(ctx, localStorage, NOW);
    expect(loadOfflineContext(localStorage, NOW + 29 * 86_400_000)).not.toBeNull();
    expect(loadOfflineContext(localStorage, NOW + 31 * 86_400_000)).toBeNull();
    expect(loadOfflineContext(localStorage, NOW - 10 * 86_400_000)).toBeNull();
  });
  it('treats damaged data as nothing', () => {
    localStorage.setItem('dua.offline.ctx', '{not json');
    expect(loadOfflineContext(localStorage, NOW)).toBeNull();
    localStorage.setItem('dua.offline.ctx', JSON.stringify({ savedAt: NOW, ctx: {} }));
    expect(loadOfflineContext(localStorage, NOW)).toBeNull();
  });
  it('is removed when someone signs out', () => {
    saveOfflineContext(ctx, localStorage, NOW);
    clearLocalWork();
    expect(loadOfflineContext(localStorage, NOW)).toBeNull();
  });
  it('recognises a lost connection but not a server refusal', () => {
    expect(isNetworkDown(new Error('TypeError: Failed to fetch'), true)).toBe(true);
    expect(isNetworkDown({ message: 'x' }, false)).toBe(true);
    expect(isNetworkDown({ code: '42501', message: 'permission denied' }, true)).toBe(false);
  });
});
