// Owner / staff push notifications through Firebase Cloud Messaging. Replaces notify-ntfy (ntfy hit its message limits).
// Same job, same three actions, same secrets and the same public.notifications table, so no module and no workflow changes except the URL:
//   drain          called every minute by pg_cron when alerts are due. Header x-ops-secret = NOTIFY_DRAIN_SECRET.
//   enqueue        called by the backup workflow to raise backup.failed / restore_drill.failed. Header x-ops-secret = OPS_REPORT_SECRET.
//   backup_report  called by the backup workflow with each result; stored in backup_log. Same secret.
//
// WHO gets an alert is decided by the database (app_push_rules; default: the owner), and WHICH phones by app_devices. Nothing here
// knows a person's name. A phone's push address is switched off when Firebase says it no longer exists.
//
// Secrets (Dashboard → Edge Functions → Secrets; never in Git):
//   FCM_SERVICE_ACCOUNT  the whole JSON file from Firebase → Project settings → Service accounts → Generate new private key
//   NOTIFY_DRAIN_SECRET, OPS_REPORT_SECRET   (the same two notify-ntfy already uses)
// A missing secret or a missing device is recorded as a failed notification with a plain reason; it is never silent.
import { serviceClient } from '../_shared/clients.ts';
import { json, readJson } from '../_shared/http.ts';
import { buildFcmMessage, forgetAccessToken, getAccessToken, notificationText, parseServiceAccount, sendFcm } from '../_shared/fcm.ts';
import { auditRoundMessage, canEnqueue, cleanBackupReport, cleanExternalPayload, closingMessage, messageFor, safeEqual, scrubError, type PushMessage } from '../_shared/ntfy.ts';

type Row = { id: string; kind: string; payload: Record<string, unknown> };
type Db = ReturnType<typeof serviceClient>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AUDIT_KEY = /^audit\.compiled:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

// closing.submitted, closing.corrected and audit.compiled carry figures (owner's choice, D-62, D-63, D-64). If the record cannot be read for
// any reason, fall back to the generic text so the alert is never lost. (Same logic as notify-ntfy, which this function replaces.)
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

type Device = { device_id: string; fcm_token: string };

async function deliver(db: Db, sa: NonNullable<ReturnType<typeof parseServiceAccount>>, row: Row): Promise<string | null> {
  const push = await buildMessage(db, row);
  // Keep the exact text for the Tools tab, even if no phone can be reached. A failure to save never stops the alert.
  const text = notificationText(push);
  const { error: saveErr } = await db.rpc('notifications_record_text', { p_id: row.id, p_title: text.title, p_body: text.body });
  if (saveErr) console.error('notifications_record_text failed', saveErr.message);
  const { data, error } = await db.rpc('app_push_tokens_for', { p_kind: row.kind });
  if (error) return `could not read the registered devices: ${error.message}`.slice(0, 200);
  const devices = (data ?? []) as Device[];
  if (devices.length === 0) return 'no device is registered for this alert yet (open the Dua Android app and allow notifications)';

  const access = await getAccessToken(sa);
  let delivered = 0;
  const issues: string[] = [];
  for (const d of devices) {
    const out = await sendFcm(sa.project_id, access, buildFcmMessage(d.fcm_token, push, row.kind));
    if (out.kind === 'ok') delivered++;
    else if (out.kind === 'dead') {
      const { error: offErr } = await db.rpc('app_push_disable', { p_device_id: d.device_id, p_reason: 'Firebase: push address no longer valid' });
      if (offErr) console.error('app_push_disable failed', offErr.message);
    } else {
      issues.push(out.detail);
      if (out.kind === 'config') forgetAccessToken(); // a rejected credential must not be reused from the cache
    }
  }
  if (delivered > 0) return null;
  return issues[0] ?? 'every registered device was no longer valid (open the Dua Android app once on each phone)';
}

async function drain(): Promise<{ sent: number; failed: number }> {
  const db = serviceClient();
  const { data, error } = await db.rpc('notifications_claim', { p_limit: 20 });
  if (error) throw new Error(`claim failed: ${error.message}`);
  const rows = (data ?? []) as Row[];
  const sa = parseServiceAccount(Deno.env.get('FCM_SERVICE_ACCOUNT'));
  let sent = 0, failed = 0;
  for (const row of rows) {
    let problem: string | null = null;
    if (!sa) problem = 'FCM_SERVICE_ACCOUNT secret is not set or is not the Firebase service-account JSON';
    else {
      try {
        problem = await deliver(db, sa, row);
      } catch (e) {
        problem = scrubError(e, [sa.private_key, sa.client_email]);
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
    console.error('notify-push', scrubError(e, [Deno.env.get('FCM_SERVICE_ACCOUNT')]));
    return json(req, 500, { error: 'failed' });
  }
});
