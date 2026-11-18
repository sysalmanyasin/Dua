// The PIN check used when there is no connection. The server never sends its PIN hash to a device; instead, after the person has
// typed their PIN correctly ONLINE, this device keeps a salted PBKDF2 verifier of it. Offline, the typed PIN is checked against
// that verifier. The server still decides at sync time (see migration 0612): it accepts the invoice only with the device's grant.
const ITER = 150_000;
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const unhex = (s) => new Uint8Array(s.match(/../g).map((h) => parseInt(h, 16)));

async function derive(pin, salt, iter) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(pin)), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, key, 256));
}

export async function makeVerifier(pin, iter = ITER) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { salt: hex(salt), iter, hash: await derive(pin, salt, iter) };
}

export async function checkVerifier(pin, v) {
  if (!v?.salt || !v?.hash) return false;
  const got = await derive(pin, unhex(v.salt), v.iter);
  // compare every character so timing does not reveal how many matched
  let diff = got.length ^ v.hash.length;
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ (v.hash.charCodeAt(i) || 0);
  return diff === 0;
}
