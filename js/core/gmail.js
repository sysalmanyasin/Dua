// Sends e-mail from the signed-in person's own Gmail account. Only the "send" permission is requested,
// so the app can never read anyone's mail. The Google sign-in script is loaded only when someone presses Send.
import { GMAIL_SCOPE, GOOGLE_CLIENT_ID } from './config.js';

const GSI = 'https://accounts.google.com/gsi/client';
const SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';

// ── message building (pure) ──
export function toBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
export const b64url = (str) => toBase64(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const wrap = (s) => s.replace(/(.{76})/g, '$1\r\n');

// A header value with no line breaks, and non-ASCII text encoded so every mail program shows it right.
export function encodeHeader(value) {
  const clean = String(value ?? '')
    .replace(/[\r\n]+/g, ' ')
    .trim();
  if (/^[\x20-\x7e]*$/.test(clean)) return clean;
  const words = [];
  let cur = '';
  for (const ch of clean) {
    if (new TextEncoder().encode(cur + ch).length > 36) {
      words.push(cur);
      cur = '';
    }
    cur += ch;
  }
  if (cur) words.push(cur);
  return words.map((w) => `=?UTF-8?B?${toBase64(w)}?=`).join('\r\n ');
}

const EMAIL = /^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]{2,}$/;
export function parseRecipients(text) {
  const parts = String(text ?? '')
    .split(/[\s,;]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  const good = [...new Set(parts.filter((p) => EMAIL.test(p)))];
  const bad = parts.filter((p) => !EMAIL.test(p));
  return { ok: good.length > 0 && bad.length === 0 && good.length <= 10, list: good, bad };
}

export function buildMime({ to, subject, html, text }, boundary = `dua_${crypto.randomUUID().replace(/-/g, '')}`) {
  const rec = parseRecipients(to);
  if (!rec.ok) throw new Error('Check the e-mail address.');
  return [
    'MIME-Version: 1.0',
    `To: ${rec.list.join(', ')}`,
    `Subject: ${encodeHeader(subject)}`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    wrap(toBase64(text ?? '')),
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    wrap(toBase64(html ?? '')),
    `--${boundary}--`,
    '',
  ].join('\r\n');
}

// ── Google sign-in and sending ──
let scriptLoading = null;
export function loadGoogle() {
  if (globalThis.google?.accounts?.oauth2) return Promise.resolve();
  scriptLoading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = GSI;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      scriptLoading = null;
      reject(new Error('Google sign-in could not be loaded. Check your connection.'));
    };
    document.head.append(s);
  });
  return scriptLoading;
}

let cached = null; // { token, expires }
export function getAccessToken({ hint } = {}) {
  if (cached && cached.expires > Date.now() + 30_000) return Promise.resolve(cached.token);
  return loadGoogle().then(
    () =>
      new Promise((resolve, reject) => {
        const client = globalThis.google.accounts.oauth2.initTokenClient({
          client_id: GOOGLE_CLIENT_ID,
          scope: GMAIL_SCOPE,
          hint,
          callback: (r) => {
            if (r.error || !r.access_token)
              return reject(new Error(r.error === 'access_denied' ? 'Gmail access was not allowed.' : 'Google sign-in did not finish.'));
            cached = { token: r.access_token, expires: Date.now() + (Number(r.expires_in) || 3600) * 1000 };
            resolve(r.access_token);
          },
          error_callback: (e) =>
            reject(
              new Error(
                e?.type === 'popup_closed'
                  ? 'The Google window was closed.'
                  : 'Google sign-in could not start. Allow pop-ups and try again.',
              ),
            ),
        });
        client.requestAccessToken({ prompt: cached ? '' : undefined });
      }),
  );
}
export const forgetToken = () => {
  cached = null;
};

// Returns { ok: true, id } or { ok: false, message }.
export async function sendGmail({ to, subject, html, text }, { hint } = {}) {
  let raw;
  try {
    raw = b64url(buildMime({ to, subject, html, text }));
  } catch (e) {
    return { ok: false, message: e.message };
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    let token;
    try {
      token = await getAccessToken({ hint });
    } catch (e) {
      return { ok: false, message: e.message };
    }
    let res;
    try {
      res = await fetch(SEND_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw }),
      });
    } catch {
      return { ok: false, message: 'No connection. The e-mail was not sent.' };
    }
    if (res.status === 401) {
      forgetToken();
      if (attempt === 0) continue;
      return { ok: false, message: 'Gmail sign-in expired. Please try again.' };
    }
    if (res.ok) return { ok: true, id: (await res.json().catch(() => ({}))).id ?? null };
    const body = await res.json().catch(() => ({}));
    const why = body?.error?.message ?? '';
    if (res.status === 403)
      return {
        ok: false,
        message: /scope|insufficient/i.test(why)
          ? 'Gmail permission was not granted. Try again and tick the send permission.'
          : 'Google refused the request. Make sure this site is allowed for your Google client.',
      };
    return { ok: false, message: 'Gmail could not send the message.' };
  }
  return { ok: false, message: 'Gmail sign-in expired. Please try again.' };
}
