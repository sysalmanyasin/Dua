// The phone reports its own tracking state every 15 minutes (location off, "all the time" removed, Dua restricted, ...), even while
// Dua is closed. No location is sent. The database stores it, logs a change, and alerts the owner when tracking went off (migration 1404).
// Public by design (same reason as attendance-event: no web login in the background); wrong device, wrong secret and a lost right all
// look the same (401). The secret is never logged.
import { serviceClient } from '../_shared/clients.ts';
import { parseAttendanceHealth } from '../_shared/attendance.ts';
import { json, preflight, readJson } from '../_shared/http.ts';
import { sha256Hex } from '../_shared/widget.ts';

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return json(req, 405, { error: 'POST only' });
  const parsed = parseAttendanceHealth(await readJson(req));
  if (!parsed) return json(req, 400, { error: 'bad request' });
  try {
    const { data, error } = await serviceClient().rpc('app_attendance_health', {
      p_device_id: parsed.deviceId,
      p_secret_hash: await sha256Hex(parsed.secret),
      p_state: parsed.state,
      p_pending: parsed.pending,
    });
    if (error) return json(req, error.code === '22023' ? 400 : 500, { error: 'failed' });
    if (!data) return json(req, 401, { error: 'sign in again' });
    return json(req, 200, data);
  } catch {
    return json(req, 500, { error: 'failed' });
  }
});
