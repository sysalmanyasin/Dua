// Firebase Cloud Messaging (HTTP v1) helpers for the owner/staff push sender. No Deno-only APIs, so they are unit tested in Node.
// Free, no message limit, no extra app on the phone (it replaces ntfy). The service-account JSON is an Edge Function secret
// (FCM_SERVICE_ACCOUNT) and never goes in Git.
import type { PushMessage } from './ntfy.ts';

export type ServiceAccount = { client_email: string; private_key: string; project_id: string };

const TOKEN_URI = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const enc = new TextEncoder();

// The secret is the JSON file Firebase gives you ("Generate new private key"). Returns null when it is missing or not usable.
export function parseServiceAccount(text: string | undefined | null): ServiceAccount | null {
  try {
    const o = JSON.parse(String(text ?? ''));
    if (typeof o?.client_email !== 'string' || typeof o?.private_key !== 'string' || typeof o?.project_id !== 'string') return null;
    if (!/^[a-z0-9-]{4,40}$/.test(o.project_id) || !o.private_key.includes('BEGIN PRIVATE KEY') || !o.client_email.includes('@')) return null;
    return { client_email: o.client_email, private_key: o.private_key, project_id: o.project_id };
  } catch {
    return null;
  }
}

export const b64url = (data: Uint8Array | string): string => {
  const bytes = typeof data === 'string' ? enc.encode(data) : data;
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

function pemToDer(pem: string): Uint8Array<ArrayBuffer> {
  const body = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\s+/g, '');
  const bin = atob(body);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

// The signed assertion Google exchanges for an access token (RS256, valid for one hour).
export async function signJwt(sa: ServiceAccount, nowSec: number): Promise<string> {
  const key = await crypto.subtle.importKey('pkcs8', pemToDer(sa.private_key), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud: TOKEN_URI, iat: nowSec, exp: nowSec + 3600 }));
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(`${head}.${claims}`)));
  return `${head}.${claims}.${b64url(sig)}`;
}

type Fetch = typeof fetch;
let cached: { token: string; exp: number; email: string } | null = null;

export async function getAccessToken(sa: ServiceAccount, fetchFn: Fetch = fetch, nowMs: number = Date.now()): Promise<string> {
  if (cached && cached.email === sa.client_email && cached.exp - 60_000 > nowMs) return cached.token;
  const assertion = await signJwt(sa, Math.floor(nowMs / 1000));
  const res = await fetchFn(TOKEN_URI, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
    signal: AbortSignal.timeout(8000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || typeof body?.access_token !== 'string') {
    throw new Error(`Google sign-in for FCM failed (${res.status}${body?.error ? ` ${String(body.error).slice(0, 60)}` : ''})`);
  }
  cached = { token: body.access_token, exp: nowMs + Number(body.expires_in ?? 3600) * 1000, email: sa.client_email };
  return cached.token;
}
export const forgetAccessToken = (): void => {
  cached = null;
};

// ---- message building -----------------------------------------------------------------------------------------------
// Firebase refuses a message over 4096 bytes in total. Keep the visible text well inside that.
export function fitBytes(s: string, max: number): string {
  if (enc.encode(s).length <= max) return s;
  let out = s;
  while (out.length > 0 && enc.encode(`${out}…`).length > max) out = out.slice(0, Math.max(0, out.length - Math.ceil(out.length / 20)));
  return `${out.trimEnd()}…`;
}

// The audit alert is written in Markdown for ntfy; a phone notification shows plain text.
export const plainText = (md: string): string => md.replace(/\*\*/g, '').replace(/\\([\\`*_~[\]<>#|])/g, '$1');

// Urgent alerts (backup failed, priority 5, and 4) use the loud channel; the rest use the normal one. The app creates both.
export const channelFor = (priority: number): 'dua_urgent' | 'dua_alerts' => (priority >= 4 ? 'dua_urgent' : 'dua_alerts');

// Where tapping the notification opens inside the app (a hash route of this site, never an address typed by anyone else).
export function hrefFor(kind: string): string {
  if (kind.startsWith('attendance.')) return '#/manager/attendance';
  if (/^(backup|restore_drill|inventory\.sync)/.test(kind)) return '#/tools';
  return '#/home';
}

// The exact words the phone shows. Also what is saved in the notifications table, so the Tools tab shows what was really sent.
export const notificationText = (push: PushMessage): { title: string; body: string } => ({
  title: fitBytes(plainText(push.title), 120),
  body: fitBytes(plainText(push.message), 3200),
});

export function buildFcmMessage(token: string, push: PushMessage, kind: string) {
  const text = notificationText(push);
  return {
    message: {
      token,
      notification: { title: text.title, body: text.body },
      data: { kind, href: hrefFor(kind) },
      android: {
        priority: 'HIGH',
        ttl: '86400s',
        notification: { channel_id: channelFor(push.priority), tag: kind },
      },
    },
  };
}

// ---- reading Firebase's answer --------------------------------------------------------------------------------------
export type FcmOutcome = { kind: 'ok' } | { kind: 'dead' } | { kind: 'retry'; detail: string } | { kind: 'config'; detail: string };

export function classifyFcmResponse(status: number, body: unknown): FcmOutcome {
  if (status >= 200 && status < 300) return { kind: 'ok' };
  const err = (body as { error?: { status?: string; message?: string; details?: { errorCode?: string }[] } } | null)?.error;
  const code = err?.details?.find((d) => d?.errorCode)?.errorCode ?? '';
  const label = `FCM ${status}${err?.status ? ` ${err.status}` : ''}${err?.message ? `: ${String(err.message).slice(0, 120)}` : ''}`;
  if (status === 404 || code === 'UNREGISTERED') return { kind: 'dead' };
  if (status === 400 && /registration token/i.test(err?.message ?? '')) return { kind: 'dead' };
  if (status === 401 || status === 403 || code === 'SENDER_ID_MISMATCH') return { kind: 'config', detail: label };
  return { kind: 'retry', detail: label };
}

export async function sendFcm(projectId: string, accessToken: string, message: object, fetchFn: Fetch = fetch): Promise<FcmOutcome> {
  try {
    const res = await fetchFn(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(8000),
    });
    const body = await res.json().catch(() => ({}));
    return classifyFcmResponse(res.status, body);
  } catch (e) {
    return { kind: 'retry', detail: `FCM request failed: ${e instanceof Error ? e.name : 'error'}` };
  }
}
