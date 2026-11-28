// Automatic attendance (Android). The phone sends ONE event it saw (arrived / left) with the device secret, even while Dua is closed.
// The database decides: it measures the distance, refuses a fake location, ignores harmless repeats, and never records the same event
// id twice. Wrong device, wrong secret, a switched-off person and a revoked right all look the same: 401, and the phone stops sending.
// Public by design (the phone has no web login in the background), so it answers only this one question; the secret is never logged.
import { serviceClient } from '../_shared/clients.ts';
import { parseAttendanceEvent } from '../_shared/attendance.ts';
import { json, preflight, readJson } from '../_shared/http.ts';
import { sha256Hex } from '../_shared/widget.ts';

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return json(req, 405, { error: 'POST only' });
  const parsed = parseAttendanceEvent(await readJson(req));
  if (!parsed) return json(req, 400, { error: 'bad request' });
  try {
    const { data, error } = await serviceClient().rpc('app_attendance_event', {
      p_device_id: parsed.deviceId,
      p_secret_hash: await sha256Hex(parsed.secret),
      p_event_id: parsed.eventId,
      p_kind: parsed.kind,
      p_at: parsed.at,
      p_lat: parsed.latitude,
      p_lng: parsed.longitude,
      p_accuracy: parsed.accuracy,
      p_mock: parsed.mock,
    });
    if (error) return json(req, error.code === '22023' ? 400 : 500, { error: 'failed' });
    if (!data) return json(req, 401, { error: 'sign in again' });
    return json(req, 200, data);
  } catch {
    return json(req, 500, { error: 'failed' });
  }
});
