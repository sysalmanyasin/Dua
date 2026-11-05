// Pure helpers shared by Edge Functions (and unit tested from Node). No Deno APIs here.
export const USERNAME_RE = /^[a-z][a-z0-9._-]{2,23}$/;
export const PIN_RE = /^\d{6}$/;
export const MAX_FAILS_PER_USER = 5;
export const MAX_FAILS_PER_IP = 30;
export const LOCK_WINDOW_MIN = 15;

export const normalizeUsername = (v: unknown): string => String(v ?? '').trim().toLowerCase();
export const validUsername = (v: string): boolean => USERNAME_RE.test(v);
export const validPin = (v: unknown): v is string => typeof v === 'string' && PIN_RE.test(v);
export const validFullName = (v: unknown): v is string =>
  typeof v === 'string' && v.trim().length >= 2 && v.trim().length <= 80;

// Weak PINs people choose first; refused when a PIN is set.
export function isWeakPin(pin: string): boolean {
  if (/^(\d)\1{5}$/.test(pin)) return true; // 111111
  const asc = '01234567890123456789';
  const desc = '98765432109876543210';
  return asc.includes(pin) || desc.includes(pin);
}

export function staffEmail(username: string, domain: string): string {
  return `${username}@${domain}`;
}

export function isLocked(userFails: number, ipFails: number): boolean {
  return userFails >= MAX_FAILS_PER_USER || ipFails >= MAX_FAILS_PER_IP;
}
