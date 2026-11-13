// Pure helpers for the owner-notification sender (Foundation F4). No network or Deno APIs here, so they are unit tested.
// The text of a push is generic on purpose: it goes through a public ntfy server, so it never carries amounts or names.
// The only payload value that may appear is a date shaped YYYY-MM-DD.

export type PushMessage = { title: string; message: string; priority: 1 | 2 | 3 | 4 | 5; tags: string[] };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const KIND = /^[a-z][a-z0-9_.]{0,59}$/;
const dateOf = (p: Record<string, unknown>, key = 'date'): string => {
  const v = p?.[key];
  return typeof v === 'string' && DATE.test(v) ? ` (${v})` : '';
};

const KNOWN: Record<string, (p: Record<string, unknown>) => PushMessage> = {
  'closing.submitted': (p) => ({ title: 'Dua: closing submitted', message: `A closing was submitted${dateOf(p)}.`, priority: 3, tags: ['inbox_tray'] }),
  'inventory.sync_stale': () => ({ title: 'Dua: inventory feed is late', message: 'No successful inventory sync for over 3 hours.', priority: 4, tags: ['warning'] }),
  'inventory.sync_failed': () => ({ title: 'Dua: inventory sync failed', message: 'The last inventory sync failed. See Needs attention.', priority: 4, tags: ['warning'] }),
  'backup.failed': (p) => ({ title: 'Dua: BACKUP FAILED', message: `The daily backup did not complete${dateOf(p)}. Check the Tools tab.`, priority: 5, tags: ['rotating_light'] }),
  'backup.stale': () => ({ title: 'Dua: no recent backup', message: 'No verified backup in the last 30 hours.', priority: 5, tags: ['rotating_light'] }),
  'restore_drill.failed': () => ({ title: 'Dua: restore drill failed', message: 'A backup could not be restored in the test. Check the Tools tab.', priority: 4, tags: ['warning'] }),
};

export function messageFor(kind: string, payload: Record<string, unknown>): PushMessage {
  const make = KNOWN[kind];
  if (make) return make(payload ?? {});
  const safeKind = KIND.test(kind) ? kind : 'unknown';
  return { title: 'Dua: alert', message: `Alert: ${safeKind}. Open Dua to see it.`, priority: 3, tags: ['bell'] };
}

// Kinds the backup workflow may enqueue from outside the database. Everything else must come from inside Dua.
export const ENQUEUE_KINDS = ['backup.failed', 'restore_drill.failed'] as const;
export const canEnqueue = (kind: unknown): kind is (typeof ENQUEUE_KINDS)[number] =>
  typeof kind === 'string' && (ENQUEUE_KINDS as readonly string[]).includes(kind);

// Only a short, plain payload may come in from outside.
export function cleanExternalPayload(p: unknown): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (!p || typeof p !== 'object') return out;
  for (const [k, v] of Object.entries(p as Record<string, unknown>).slice(0, 10)) {
    if (!/^[a-z][a-z0-9_]{0,29}$/.test(k)) continue;
    if (typeof v === 'string') out[k] = v.slice(0, 120);
    else if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    else if (typeof v === 'boolean') out[k] = v;
  }
  return out;
}

// ntfy accepts a JSON publish at the server root, which keeps the topic out of the URL and any error text.
export function buildPublish(server: string, topic: string, token: string | null, m: PushMessage) {
  const base = server.replace(/\/+$/, '');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return { url: `${base}/`, init: { method: 'POST', headers, body: JSON.stringify({ topic, title: m.title, message: m.message, priority: m.priority, tags: m.tags }) } };
}

export const validServer = (s: string): boolean => {
  try { return new URL(s).protocol === 'https:'; } catch { return false; }
};

// Error text is stored and shown to the owner, so it must never contain the topic or token.
export function scrubError(err: unknown, secrets: Array<string | null | undefined>): string {
  let text = err instanceof Error ? err.message : String(err);
  for (const s of secrets) if (s && s.length >= 4) text = text.split(s).join('***');
  return text.slice(0, 300);
}

export function safeEqual(a: string, b: string): boolean {
  if (a.length === 0 || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// What the backup workflow may report. Everything is validated; nothing free-form is stored beyond a short error line.
export type BackupReport = {
  kind: 'daily' | 'weekly' | 'restore_drill'; status: 'ok' | 'failed'; day: string | null;
  size: number | null; sha: string | null; manifest: Record<string, { rows: string; md5: string }> | null; error: string | null;
};
export function cleanBackupReport(b: Record<string, unknown> | null): BackupReport | null {
  if (!b) return null;
  const kind = b.kind, status = b.status;
  if (kind !== 'daily' && kind !== 'weekly' && kind !== 'restore_drill') return null;
  if (status !== 'ok' && status !== 'failed') return null;
  const day = typeof b.day === 'string' && DATE.test(b.day) ? b.day : null;
  const size = typeof b.size_bytes === 'number' && Number.isInteger(b.size_bytes) && b.size_bytes >= 0 && b.size_bytes < 1e12 ? b.size_bytes : null;
  const sha = typeof b.sha256 === 'string' && /^[0-9a-f]{64}$/.test(b.sha256) ? b.sha256 : null;
  let manifest: BackupReport['manifest'] = null;
  if (b.manifest && typeof b.manifest === 'object') {
    const entries = Object.entries(b.manifest as Record<string, unknown>);
    if (entries.length > 200) return null;
    manifest = {};
    for (const [name, v] of entries) {
      const o = v as Record<string, unknown>;
      if (!/^[a-z0-9_.:]{1,80}$/.test(name) || typeof o?.rows !== 'string' || !/^\d{1,12}$/.test(o.rows) || typeof o?.md5 !== 'string' || !/^([0-9a-f]{32}|empty)$/.test(o.md5)) return null;
      manifest[name] = { rows: o.rows, md5: o.md5 };
    }
  }
  if (status === 'ok' && (!day || !size || !sha)) return null; // a success must say what it saved
  const error = typeof b.error === 'string' ? b.error.slice(0, 500) : null;
  return { kind, status, day, size, sha, manifest, error };
}
