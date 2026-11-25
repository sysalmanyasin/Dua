// Today's Sale home-screen widget (Android). The widget sends the device id and its secret; the database decides, with the person's
// CURRENT permissions, whether anything is returned. Wrong secret, switched-off person and revoked permission all look the same: 401.
// Staff holding candela.today_total get one number; the owner also gets the cash / card / credit split.
// Public by design (the widget has no web login), so it answers only this one question and nothing is logged with the secret.
import { serviceClient } from '../_shared/clients.ts';
import { json, preflight, readJson } from '../_shared/http.ts';
import { parseWidgetRequest, sha256Hex } from '../_shared/widget.ts';

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return json(req, 405, { error: 'POST only' });
  const parsed = parseWidgetRequest(await readJson(req));
  if (!parsed) return json(req, 400, { error: 'bad request' });
  try {
    const { data, error } = await serviceClient().rpc('app_widget_today', {
      p_device_id: parsed.deviceId,
      p_secret_hash: await sha256Hex(parsed.secret),
    });
    if (error) return json(req, 500, { error: 'failed' });
    if (!data) return json(req, 401, { error: 'sign in again' });
    return json(req, 200, data);
  } catch {
    return json(req, 500, { error: 'failed' });
  }
});
