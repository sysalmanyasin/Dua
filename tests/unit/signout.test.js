// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = { signOut: vi.fn(async () => ({ error: null })) };
vi.mock('../../js/core/supabase.js', () => ({ db: () => ({ auth }), callFunction: vi.fn() }));
import { clearLocalWork, signOut } from '../../js/core/auth.js';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  auth.signOut.mockClear();
});

describe('signing out', () => {
  it('removes unsent drafts and page hand-offs from the phone, but leaves unrelated storage alone', async () => {
    localStorage.setItem('dua.checklist.draft.2026-11-07', '{"fields":{"s_cashsale":"300000"}}');
    localStorage.setItem('dua.anything', '1');
    localStorage.setItem('theme', 'dark');
    sessionStorage.setItem('sales.entry.date', '2026-11-03');
    sessionStorage.setItem('sales.data.month', '2026-11');
    sessionStorage.setItem('other', 'x');
    await signOut();
    expect(auth.signOut).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('dua.checklist.draft.2026-11-07')).toBeNull();
    expect(localStorage.getItem('dua.anything')).toBeNull();
    expect(sessionStorage.getItem('sales.entry.date')).toBeNull();
    expect(localStorage.getItem('theme')).toBe('dark');
    expect(sessionStorage.getItem('other')).toBe('x');
  });
  it('still signs out if storage is unavailable', async () => {
    expect(() => clearLocalWork([null, undefined])).not.toThrow();
  });
});
