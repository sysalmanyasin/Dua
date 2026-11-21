// Random passwords, PIN password derivation and IP hashing. Web Crypto only (works in Deno and Node 20+).
const bytesToHex = (b: Uint8Array): string => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

// A 4-digit PIN is shorter than the 6 characters Supabase Auth requires, so the stored Auth password is derived from
// the PIN + username with a server-only secret (PIN_PEPPER). Older 6-digit PINs were stored as they are.
export const MIN_PEPPER_LENGTH = 32;
export async function derivePinPassword(pepper: string, username: string, pin: string): Promise<string> {
  if (typeof pepper !== 'string' || pepper.length < MIN_PEPPER_LENGTH) throw new Error('PIN_PEPPER is missing or too short');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pepper), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`pin:${username}:${pin}`));
  return bytesToHex(new Uint8Array(sig)); // 64 hex characters
}
// The password Supabase Auth holds for a PIN: 6-digit (older) PINs as typed, 4-digit PINs derived.
export const authPasswordFor = (pepper: string, username: string, pin: string): Promise<string> | string =>
  pin.length === 6 ? pin : derivePinPassword(pepper, username, pin);
export async function ipHash(ip: string, secret: string): Promise<string> {
  const data = new TextEncoder().encode(`${secret}:${ip}`);
  return bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', data))).slice(0, 32);
}
