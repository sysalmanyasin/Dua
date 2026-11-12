// Owner notifications (Foundation F4). Delivers rows of public.notifications to ntfy and records every failure.
// It is the only place that talks to ntfy. Modules only call the SQL function notify_owner(kind, payload).
//
// Two actions, each with its own secret (a leak of one cannot do what the other does):
//   drain    called every minute by pg_cron when alerts are due. Header x-ops-secret = NOTIFY_DRAIN_SECRET.
//   enqueue  called by the backup workflow to raise backup.failed / restore_drill.failed. Header x-ops-secret = OPS_REPORT_SECRET.
//
// Secrets (Dashboard → Edge Functions → Secrets; never in Git):
//   NTFY_TOPIC (works like a password), NOTIFY_DRAIN_SECRET, OPS_REPORT_SECRET
//   optional: NTFY_SERVER (default https://ntfy.sh), NTFY_TOKEN
//   (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected by Supabase.)
// A missing secret is recorded as a failed notification with a plain reason; it is never silent.
import { serviceClient } from '../_shared/clients.ts';
import { json, readJson } from '../_shared/http.ts';
import { buildPublish, canEnqueue, cleanExternalPayload, messageFor, safeEqual, scrubError, validServer } from '../_shared/ntfy.ts';

type Row = { id: string; kind: string; payload: Record<string, unknown> };

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
        const req = buildPublish(server, topic, token, messageFor(row.kind, row.payload));
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), 8000);
        const res = await fetch(req.url, { ...req.init, signal: ctl.signal });
        clearTimeout(timer);
        if (!res.ok) problem = `ntfy answered ${res.status}`;
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
  const need = action === 'drain' ? 'NOTIFY_DRAIN_SECRET' : action === 'enqueue' ? 'OPS_REPORT_SECRET' : null;
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
    return json(req, 200, await drain());
  } catch (e) {
    console.error('notify-ntfy', scrubError(e, [Deno.env.get('NTFY_TOPIC'), Deno.env.get('NTFY_TOKEN')]));
    return json(req, 500, { error: 'failed' });
  }
});
