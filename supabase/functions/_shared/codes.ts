// One-time setup codes and random passwords. Web Crypto only (works in Deno and Node 20+).
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 31 chars, no 0/O/1/I/L
const bytesToHex = (b: Uint8Array): string => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

function randomIndexes(count: number, modulo: number): number[] {
  const out: number[] = [];
  const limit = 256 - (256 % modulo); // rejection sampling: no modulo bias
  while (out.length < count) {
    const buf = crypto.getRandomValues(new Uint8Array(count * 2));
    for (const v of buf) if (v < limit && out.length < count) out.push(v % modulo);
  }
  return out;
}

export function generateSetupCode(): string {
  const chars = randomIndexes(10, ALPHABET.length).map((i) => ALPHABET[i]);
  return `${chars.slice(0, 5).join('')}-${chars.slice(5).join('')}`;
}
export const normalizeCode = (c: string): string => String(c ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
export const validCodeShape = (c: string): boolean => new RegExp(`^[${ALPHABET}]{10}$`).test(normalizeCode(c));

export function newSalt(): string {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
}
export async function hashCode(code: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${normalizeCode(code)}`);
  return bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', data)));
}
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
export function randomPassword(): string {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(24)));
}
export async function ipHash(ip: string, secret: string): Promise<string> {
  const data = new TextEncoder().encode(`${secret}:${ip}`);
  return bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', data))).slice(0, 32);
}
