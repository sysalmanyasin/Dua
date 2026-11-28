// Automatic attendance. A phone sends ONE event it saw (arrived / left) with its per-device secret, even while Dua is closed:
//   * an Android phone (the app), and
//   * an iPhone (an Apple Shortcut run by an Arrive / Leave automation; see migration 1406). The same shortcut also sends "test" and
//     "confirm" once while the employee sets the phone up (they record nothing in attendance).
// The database decides: it finds the EMPLOYEE from the device (nothing in the request names one), measures the distance, refuses a
// fake location, ignores harmless repeats, and never records the same event id twice. Wrong device, wrong secret, a revoked phone,
// a switched-off person and a revoked right all look the same: 401, and the phone stops sending.
// An iPhone's answer also carries next_secret (the rolling secret): the shortcut saves it before doing anything else.
// Public by design (the phone has no web login in the background), so it answers only this one question; the secret is never logged.
import { serviceClient } from '../_shared/clients.ts';
import { parseAttendanceRequest } from '../_shared/attendance.ts';
import { json, preflight, readJson } from '../_shared/http.ts';
import { sha256Hex } from '../_shared/widget.ts';

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return json(req, 405, { error: 'POST only' });
  const parsed = parseAttendanceRequest(await readJson(req));
  if (!parsed) return json(req, 400, { error: 'bad request' });
  try {
    const secretHash = await sha256Hex(parsed.secret);
    const { data, error } = parsed.type === 'event'
      ? await serviceClient().rpc('app_attendance_event', {
        p_device_id: parsed.deviceId,
        p_secret_hash: secretHash,
        p_event_id: parsed.eventId,
        p_kind: parsed.kind,
        p_at: parsed.at,
        p_lat: parsed.latitude,
        p_lng: parsed.longitude,
        p_accuracy: parsed.accuracy,
        p_mock: parsed.mock,
      })
      : await serviceClient().rpc('app_attendance_ios_signal', {
        p_device_id: parsed.deviceId,
        p_secret_hash: secretHash,
        p_kind: parsed.type,
        p_lat: parsed.type === 'test' ? parsed.latitude : null,
        p_lng: parsed.type === 'test' ? parsed.longitude : null,
        p_accuracy: parsed.type === 'test' ? parsed.accuracy : null,
      });
    if (error) return json(req, error.code === '22023' ? 400 : 500, { error: 'failed' });
    if (!data) return json(req, 401, { error: 'sign in again' });
    return json(req, 200, data);
  } catch {
    return json(req, 500, { error: 'failed' });
  }
});
