// Pure helpers shared by Edge Functions (and unit tested from Node). No Deno APIs here.
export const USERNAME_RE = /^[a-z][a-z0-9._-]{2,23}$/;
export const PIN_RE = /^\d{4}$/; // every new PIN is 4 digits
export const LEGACY_PIN_RE = /^\d{6}$/; // PINs set before the 4-digit change still sign in until the owner resets them
export const MAX_FAILS_PER_USER = 5;
export const MAX_FAILS_PER_IP = 30;
export const LOCK_WINDOW_MIN = 60; // 5 wrong PINs lock the username for 1 hour (or until the owner unlocks it)

export const normalizeUsername = (v: unknown): string => String(v ?? '').trim().toLowerCase();
export const validUsername = (v: string): boolean => USERNAME_RE.test(v);
export const validPin = (v: unknown): v is string => typeof v === 'string' && PIN_RE.test(v);
// Sign-in accepts the new 4-digit PIN or an older 6-digit one.
export const validLoginPin = (v: unknown): v is string => typeof v === 'string' && (PIN_RE.test(v) || LEGACY_PIN_RE.test(v));
export const validFullName = (v: unknown): v is string =>
  typeof v === 'string' && v.trim().length >= 2 && v.trim().length <= 80;

// Weak 4-digit PINs, refused when the owner sets one: 0000, runs like 1234 / 4321 / 7890, pairs like 1212 and 1122,
// years 1940-2030 (birth years), and a few keypad favourites.
const KEYPAD_FAVOURITES = new Set(['2580', '0852', '1357', '2468', '1004', '6969', '1313', '2323', '1230', '0007']);
export function isWeakPin(pin: string): boolean {
  if (!/^\d{4}$/.test(pin)) return true;
  const [a, b, c, d] = pin;
  if (a === b && b === c && c === d) return true; // 0000, 1111 ...
  if (a === c && b === d) return true; // 1212, 6969 ...
  if (a === b && c === d) return true; // 1122, 5566 ...
  const asc = '01234567890123456789';
  const desc = '98765432109876543210';
  if (asc.includes(pin) || desc.includes(pin)) return true; // 1234, 7890, 4321, 3210 ...
  const year = Number(pin);
  if (year >= 1940 && year <= 2030) return true;
  return KEYPAD_FAVOURITES.has(pin);
}

export function staffEmail(username: string, domain: string): string {
  return `${username}@${domain}`;
}

export function isLocked(userFails: number, ipFails: number): boolean {
  return userFails >= MAX_FAILS_PER_USER || ipFails >= MAX_FAILS_PER_IP;
}
