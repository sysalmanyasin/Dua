// Owner notifications (Foundation F4). Delivers rows of public.notifications to ntfy and records every failure.
// It is the only place that talks to ntfy. Modules only call the SQL function notify_owner(kind, payload).
//
// Two actions, each with its own secret (a leak of one cannot do what the other does):
//   drain    called every minute by pg_cron when alerts are due. Header x-ops-secret = NOTIFY_DRAIN_SECRET.
//   enqueue        called by the backup workflow to raise backup.failed / restore_drill.failed. Header x-ops-secret = OPS_REPORT_SECRET.
//   backup_report  called by the backup workflow with each result (ok or failed); stored in backup_log. Same secret.
//
// Secrets (Dashboard → Edge Functions → Secrets; never in Git):
//   NTFY_TOPIC (works like a password), NOTIFY_DRAIN_SECRET, OPS_REPORT_SECRET
//   optional: NTFY_SERVER (default https://ntfy.sh), NTFY_TOKEN
//   (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected by Supabase.)
// A missing secret is recorded as a failed notification with a plain reason; it is never silent.
import { serviceClient } from '../_shared/clients.ts';
import { json, readJson } from '../_shared/http.ts';
import { buildPublish, canEnqueue, cleanBackupReport, auditRoundMessage, cleanExternalPayload, closingMessage, messageFor, safeEqual, scrubError, validServer, type PushMessage } from '../_shared/ntfy.ts';

type Row = { id: string; kind: string; payload: Record<string, unknown> };
type Db = ReturnType<typeof serviceClient>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// closing.submitted, closing.corrected and audit.compiled carry figures (owner's choice, D-62, D-63, D-64). If the record cannot be read for
// any reason, fall back to the generic text so the alert is never lost.
const AUDIT_KEY = /^audit\.compiled:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

async function buildMessage(db: Db, row: Row): Promise<PushMessage> {
  try {
    if (row.kind === 'closing.submitted' || row.kind === 'closing.corrected') {
      const id = row.payload?.closing_id;
      if (typeof id === 'string' && UUID.test(id)) {
        const { data, error } = await db.rpc('closing_page_json', { p_closing: id });
        if (error) console.error('closing_page_json failed', error.message);
        else {
          const m = closingMessage(data);
          if (m) return m;
        }
      }
    } else if (row.kind === 'audit.compiled') {
      // the alert's dedupe key is "audit.compiled:<compilation id>"
      const id = AUDIT_KEY.exec(String(row.payload?.dedupe_key ?? ''))?.[1];
      if (id) {
        const { data, error } = await db.rpc('audit_round_alert_json', { p_compilation: id });
        if (error) console.error('audit_round_alert_json failed', error.message);
        else {
          const m = auditRoundMessage(data);
          if (m) return m;
        }
      }
    }
  } catch (e) {
    console.error('message build failed', row.kind, e instanceof Error ? e.message : String(e));
  }
  return messageFor(row.kind, row.payload);
}

// When ntfy refuses with 429, say whether the token is in use and what the account has left, so the owner can see the cause.
async function quotaNote(server: string, token: string | null): Promise<string> {
  if (!token) return ' [NTFY_TOKEN is not set: sending anonymously]';
  try {
    const r = await fetch(`${server.replace(/\/+$/, '')}/v1/account`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000) });
    if (!r.ok) return ` [NTFY_TOKEN was not accepted: ${r.status}]`;
    const a = await r.json();
    return ` [token ok, account ${a?.username ?? '?'}: ${a?.stats?.messages ?? '?'} sent today, ${a?.stats?.messages_remaining ?? '?'} left, limit ${a?.limits?.messages ?? '?'}]`;
  } catch {
    return ' [could not check the token]';
  }
}

async function drain(): Promise<{ sent: number; failed: number }> {
  const db = serviceClient();
  const { data, error } = await db.rpc('notifications_claim', { p_limit: 20 });
  if (error) throw new Error(`claim failed: ${error.message}`);
  const rows = (data ?? []) as Row[];
  const topic = Deno.env.get('NTFY_TOPIC') ?? '';
  const token = Deno.env.get('NTFY_TOKEN') || null;
  const server = Deno.env.get('NTFY_SERVER') || 'https://ntfy.sh';
  let sent = 0, failed = 0;
  for (const row of rows) {
    let problem: string | null = null;
    if (!topic) problem = 'NTFY_TOPIC secret is not set';
    else if (!validServer(server)) problem = 'NTFY_SERVER must be an https address';
    else {
      try {
        const req = buildPublish(server, topic, token, await buildMessage(db, row));
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), 8000);
        const res = await fetch(req.url, { ...req.init, signal: ctl.signal });
        clearTimeout(timer);
        if (!res.ok) {
          // ntfy explains a refusal in its body (e.g. which rate limit was hit); keep a short, scrubbed copy.
          const detail = (await res.text().catch(() => '')).replace(/\s+/g, ' ').trim().slice(0, 200);
          const note = res.status === 429 ? await quotaNote(server, token) : '';
          problem = scrubError(`ntfy answered ${res.status}${note}${detail ? `: ${detail}` : ''}`, [topic, token]);
        }
      } catch (e) {
        problem = scrubError(e, [topic, token]);
      }
    }
    const { error: markErr } = await db.rpc('notifications_mark', { p_id: row.id, p_ok: problem === null, p_error: problem });
    if (markErr) console.error('mark failed', row.id, markErr.message);
    if (problem === null) sent++; else failed++;
  }
  return { sent, failed };
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(req, 405, { error: 'POST only' });
  const body = await readJson(req);
  const action = body?.action;
  const given = req.headers.get('x-ops-secret') ?? '';
  const need = action === 'drain' ? 'NOTIFY_DRAIN_SECRET' : action === 'enqueue' || action === 'backup_report' ? 'OPS_REPORT_SECRET' : null;
  if (!need) return json(req, 400, { error: 'unknown action' });
  const expected = Deno.env.get(need) ?? '';
  if (!expected) return json(req, 500, { error: 'not configured' }); // fails closed; the cron call shows as undelivered on the Cover
  if (!safeEqual(given, expected)) return json(req, 401, { error: 'unauthorized' });

  try {
    if (action === 'enqueue') {
      if (!canEnqueue(body?.kind)) return json(req, 400, { error: 'kind not allowed' });
      const payload = cleanExternalPayload(body?.payload);
      const { data, error } = await serviceClient().rpc('notify_owner', { p_kind: body!.kind, p_payload: payload });
      if (error) return json(req, 500, { error: 'could not queue' });
      const res = await drain();
      return json(req, 200, { queued: data !== null, ...res });
    }
    if (action === 'backup_report') {
      const r = cleanBackupReport(body);
      if (!r) return json(req, 400, { error: 'invalid report' });
      const { error } = await serviceClient().rpc('backup_report', {
        p_kind: r.kind, p_status: r.status, p_day: r.day, p_size: r.size, p_sha: r.sha, p_manifest: r.manifest, p_error: r.error,
      });
      if (error) return json(req, 500, { error: 'could not record' });
      return json(req, 200, { recorded: true, ...(await drain()) });
    }
    return json(req, 200, await drain());
  } catch (e) {
    console.error('notify-ntfy', scrubError(e, [Deno.env.get('NTFY_TOPIC'), Deno.env.get('NTFY_TOKEN')]));
    return json(req, 500, { error: 'failed' });
  }
});
