import { describe, expect, it } from 'vitest';
import { authPasswordFor, derivePinPassword, ipHash } from '../../supabase/functions/_shared/codes.ts';
import {
  LOCK_WINDOW_MIN,
  isLocked,
  isWeakPin,
  normalizeUsername,
  staffEmail,
  validLoginPin,
  validPin,
  validUsername,
} from '../../supabase/functions/_shared/validate.ts';

describe('usernames and PINs', () => {
  it('accepts only safe usernames', () => {
    expect(validUsername(normalizeUsername('  Ali.Khan '))).toBe(true);
    for (const bad of ['ab', '1ali', 'ali khan', 'ali@x', 'a'.repeat(25), '', "ali'--"]) expect(validUsername(bad)).toBe(false);
  });
  it('requires exactly four digits for a new PIN', () => {
    expect(validPin('4829')).toBe(true);
    for (const bad of ['123', '12345', '482913', 'abcd', '12 4', 4829, null, '']) expect(validPin(bad)).toBe(false);
  });
  it('still lets an older six-digit PIN sign in, but nothing else', () => {
    expect(validLoginPin('4829')).toBe(true);
    expect(validLoginPin('482913')).toBe(true);
    for (const bad of ['12345', '1234567', 'abcd', 4829, null]) expect(validLoginPin(bad)).toBe(false);
  });
  it('blocks repeats, runs, pairs, years and keypad favourites', () => {
    const weak = [
      '0000',
      '1111',
      '9999',
      '1234',
      '2345',
      '6789',
      '7890',
      '4321',
      '9876',
      '3210',
      '1212',
      '6969',
      '1122',
      '5566',
      '1990',
      '2005',
      '1940',
      '2030',
      '2580',
      '1357',
    ];
    for (const pin of weak) expect(isWeakPin(pin), pin).toBe(true);
  });
  it('allows ordinary PINs, including just outside the year range', () => {
    for (const pin of ['4829', '7316', '0482', '1939', '2031', '5093']) expect(isWeakPin(pin), pin).toBe(false);
  });
  it('treats a malformed PIN as weak', () => {
    for (const pin of ['123', '12345', 'abcd', '']) expect(isWeakPin(pin)).toBe(true);
  });
  it('builds the hidden staff email', () => {
    expect(staffEmail('ali', 'staff.dua.invalid')).toBe('ali@staff.dua.invalid');
  });
});

describe('lockout', () => {
  it('counts failures over one hour', () => {
    expect(LOCK_WINDOW_MIN).toBe(60);
  });
  it('locks after 5 failures for a user or 30 for an IP', () => {
    expect(isLocked(4, 0)).toBe(false);
    expect(isLocked(5, 0)).toBe(true);
    expect(isLocked(0, 29)).toBe(false);
    expect(isLocked(0, 30)).toBe(true);
  });
});

describe('PIN passwords', () => {
  const pepper = 'p'.repeat(40);
  it('derives a long, stable password that is not the PIN', async () => {
    const a = await derivePinPassword(pepper, 'ali', '4829');
    expect(a).toHaveLength(64);
    expect(a).toBe(await derivePinPassword(pepper, 'ali', '4829'));
    expect(a).not.toContain('4829');
  });
  it('differs by PIN, by username and by secret', async () => {
    const a = await derivePinPassword(pepper, 'ali', '4829');
    expect(await derivePinPassword(pepper, 'ali', '4830')).not.toBe(a);
    expect(await derivePinPassword(pepper, 'sara', '4829')).not.toBe(a);
    expect(await derivePinPassword('q'.repeat(40), 'ali', '4829')).not.toBe(a);
  });
  it('refuses to work without a proper secret', async () => {
    await expect(derivePinPassword('', 'ali', '4829')).rejects.toThrow();
    await expect(derivePinPassword('short', 'ali', '4829')).rejects.toThrow();
  });
  it('keeps an older six-digit PIN as typed and derives a four-digit one', async () => {
    expect(await authPasswordFor(pepper, 'ali', '482913')).toBe('482913');
    expect(await authPasswordFor(pepper, 'ali', '4829')).toBe(await derivePinPassword(pepper, 'ali', '4829'));
  });
});

describe('IP hashes', () => {
  it('are stable and do not reveal the address', async () => {
    const h = await ipHash('203.0.113.5', 'secret');
    expect(h).toBe(await ipHash('203.0.113.5', 'secret'));
    expect(h).not.toContain('203');
    expect(h).not.toBe(await ipHash('203.0.113.6', 'secret'));
  });
});
