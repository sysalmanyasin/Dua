// The home-screen widget asks for today's sale with a per-device secret (never the web login; see migration 1401).
// Pure helpers so they are unit tested in Node. The secret is 64 hex characters made by the database; only its SHA-256 is stored.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SECRET = /^[0-9a-f]{64}$/;

export function parseWidgetRequest(body: Record<string, unknown> | null): { deviceId: string; secret: string } | null {
  const id = body?.device_id;
  const secret = body?.secret;
  if (typeof id !== 'string' || !UUID.test(id) || typeof secret !== 'string' || !SECRET.test(secret)) return null;
  return { deviceId: id.toLowerCase(), secret };
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
}
