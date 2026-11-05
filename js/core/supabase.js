// Single Supabase client. The library is vendored (vendor/, pinned 2.45.4) and loaded by index.html,
// so nothing third-party is fetched at runtime and the CSP can stay 'self'.
import { getConfig } from './config.js';

let client = null;
export function db() {
  if (client) return client;
  const cfg = getConfig();
  if (!cfg.configured) throw new Error('Supabase is not configured for this environment.');
  const { createClient } = globalThis.supabase;
  client = createClient(cfg.url, cfg.publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });
  return client;
}

// Call a public Edge Function (login, request, claim). Returns {ok, status, body}.
export async function callFunction(name, payload) {
  const cfg = getConfig();
  try {
    const res = await fetch(`${cfg.functionsUrl}/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: cfg.publishableKey },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, body };
  } catch {
    return { ok: false, status: 0, body: { message: 'No connection. Check your internet and try again.' } };
  }
}

// Same, for admin actions: sends the signed-in user's token.
export async function callAdminFunction(name, payload) {
  const { data } = await db().auth.getSession();
  const cfg = getConfig();
  try {
    const res = await fetch(`${cfg.functionsUrl}/${name}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: cfg.publishableKey,
        Authorization: `Bearer ${data.session?.access_token ?? ''}`,
      },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, body };
  } catch {
    return { ok: false, status: 0, body: { message: 'No connection.' } };
  }
}
