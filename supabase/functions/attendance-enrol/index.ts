// iPhone enrolment (migration 1406). The setup shortcut calls this twice, with the one-time code the owner made for ONE chosen employee:
//   peek     -> the employee's first name, so a wrong QR code on a wrong phone is noticed before anything is used up
//   consume  -> the device id and the device secret (shown once; only its hash is stored). The code works once.
// The employee is whoever the owner chose when making the code; nothing the shortcut sends names an employee.
// Public by design (the employee has no Dua login on this phone). Wrong, used, expired, cancelled and "person no longer allowed" all look
// the same (401). The code is about 240 bits made by the database, so guessing is not a concern; it is never logged and only its hash is stored.
import { serviceClient } from '../_shared/clients.ts';
import { parseEnrolRequest } from '../_shared/attendance.ts';
import { json, preflight, readJson } from '../_shared/http.ts';
import { sha256Hex } from '../_shared/widget.ts';

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return json(req, 405, { error: 'POST only' });
  const parsed = parseEnrolRequest(await readJson(req));
  if (!parsed) return json(req, 400, { error: 'bad request' });
  try {
    const tokenHash = await sha256Hex(parsed.token);
    const { data, error } = parsed.action === 'peek'
      ? await serviceClient().rpc('app_ios_enrol_peek', { p_token_hash: tokenHash })
      : await serviceClient().rpc('app_ios_enrol_consume', { p_token_hash: tokenHash, p_device_name: parsed.deviceName });
    if (error) return json(req, 500, { error: 'failed' });
    if (!data) return json(req, 401, { error: 'code not valid' });
    return json(req, 200, data);
  } catch {
    return json(req, 500, { error: 'failed' });
  }
});
