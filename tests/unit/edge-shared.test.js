import { describe, expect, it } from 'vitest';
import {
  generateSetupCode,
  hashCode,
  ipHash,
  newSalt,
  normalizeCode,
  randomPassword,
  safeEqual,
  validCodeShape,
} from '../../supabase/functions/_shared/codes.ts';
import { isLocked, isWeakPin, normalizeUsername, staffEmail, validPin, validUsername } from '../../supabase/functions/_shared/validate.ts';

describe('usernames and PINs', () => {
  it('accepts only safe usernames', () => {
    expect(validUsername(normalizeUsername('  Ali.Khan '))).toBe(true);
    for (const bad of ['ab', '1ali', 'ali khan', 'ali@x', 'a'.repeat(25), '', "ali'--"]) expect(validUsername(bad)).toBe(false);
  });
  it('requires exactly six digits', () => {
    expect(validPin('482913')).toBe(true);
    for (const bad of ['12345', '1234567', 'abcdef', '12 456', 123456, null]) expect(validPin(bad)).toBe(false);
  });
  it('rejects repeated and sequential PINs', () => {
    for (const weak of ['111111', '000000', '123456', '234567', '654321', '098765']) expect(isWeakPin(weak)).toBe(true);
    expect(isWeakPin('482913')).toBe(false);
  });
  it('builds the hidden staff email', () => {
    expect(staffEmail('ali', 'staff.dua.invalid')).toBe('ali@staff.dua.invalid');
  });
});

describe('lockout', () => {
  it('locks after 5 failures for a user or 30 for an IP', () => {
    expect(isLocked(4, 0)).toBe(false);
    expect(isLocked(5, 0)).toBe(true);
    expect(isLocked(0, 29)).toBe(false);
    expect(isLocked(0, 30)).toBe(true);
  });
});

describe('setup codes', () => {
  it('generates 10 unambiguous characters in XXXXX-XXXXX form', () => {
    for (let i = 0; i < 200; i++) {
      const c = generateSetupCode();
      expect(c).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}$/);
      expect(validCodeShape(c)).toBe(true);
    }
  });
  it('codes are not repeated', () => {
    const set = new Set(Array.from({ length: 500 }, generateSetupCode));
    expect(set.size).toBe(500);
  });
  it('is forgiving about case, spaces and dashes when typed', async () => {
    const salt = newSalt();
    const h = await hashCode('ABCDE-FGHJK', salt);
    expect(await hashCode('abcde fghjk', salt)).toBe(h);
    expect(normalizeCode('ab-cd')).toBe('ABCD');
    expect(await hashCode('ABCDE-FGHJM', salt)).not.toBe(h);
  });
  it('the same code hashes differently with a different salt', async () => {
    expect(await hashCode('ABCDE-FGHJK', 'a')).not.toBe(await hashCode('ABCDE-FGHJK', 'b'));
  });
  it('compares in a length-safe way', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
  it('random passwords are long and unique; IP hashes are stable and not the IP', async () => {
    expect(randomPassword()).toHaveLength(48);
    expect(randomPassword()).not.toBe(randomPassword());
    const h = await ipHash('203.0.113.5', 'secret');
    expect(h).toBe(await ipHash('203.0.113.5', 'secret'));
    expect(h).not.toContain('203');
    expect(h).not.toBe(await ipHash('203.0.113.6', 'secret'));
  });
});
