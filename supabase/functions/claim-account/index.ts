// POST {username, code, pin} -> {ok:true}. Sets the staff PIN using a one-time code from the owner.
import { serviceClient } from '../_shared/clients.ts';
import { hashCode, safeEqual, validCodeShape } from '../_shared/codes.ts';
import { json, preflight, readJson, requestIpHash, sleep } from '../_shared/http.ts';
import { LOCK_WINDOW_MIN, MAX_FAILS_PER_IP, isWeakPin, normalizeUsername, validPin, validUsername } from '../_shared/validate.ts';

const MAX_CODE_ATTEMPTS = 5;
const BAD = { error: 'invalid', message: 'That code is not valid or has expired. Ask the owner for a new one.' };

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return json(req, 405, { error: 'method' });

  const body = await readJson(req);
  const username = normalizeUsername(body?.username);
  const code = String(body?.code ?? '');
  const pin = body?.pin;
  if (!validUsername(username) || !validCodeShape(code)) return json(req, 400, BAD);
  if (!validPin(pin) || isWeakPin(pin)) {
    return json(req, 400, { error: 'weak_pin', message: 'Choose a 6-digit PIN that is not a repeat or a sequence (like 111111 or 123456).' });
  }

  const db = serviceClient();
  const iph = await requestIpHash(req);
  const since = new Date(Date.now() - LOCK_WINDOW_MIN * 60_000).toISOString();
  const ipFails = await db.from('login_attempts').select('id', { count: 'exact', head: true }).eq('ip_hash', iph).eq('success', false).gte('at', since);
  if ((ipFails.count ?? 0) >= MAX_FAILS_PER_IP) return json(req, 429, { error: 'locked', message: 'Too many attempts. Try again later.' });

  const fail = async () => {
    await db.from('login_attempts').insert({ username, ip_hash: iph, success: false });
    await sleep(300);
    return json(req, 400, BAD);
  };

  const { data: profile } = await db.from('profiles').select('user_id, role_template, disabled_at').eq('username', username).maybeSingle();
  if (!profile || profile.disabled_at || profile.role_template === 'admin') return fail();

  const { data: row } = await db.from('setup_codes').select('id, code_hash, salt, attempts, expires_at')
    .eq('user_id', profile.user_id).is('used_at', null).gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (!row || row.attempts >= MAX_CODE_ATTEMPTS) return fail();

  await db.from('setup_codes').update({ attempts: row.attempts + 1 }).eq('id', row.id); // count before checking
  if (!safeEqual(await hashCode(code, row.salt), row.code_hash)) return fail();

  const { error } = await db.auth.admin.updateUserById(profile.user_id, { password: pin });
  if (error) return json(req, 400, { error: 'pin_rejected', message: 'That PIN was not accepted. Try a different 6-digit PIN.' });
  await db.from('setup_codes').update({ used_at: new Date().toISOString() }).eq('id', row.id);
  await db.from('activity_log').insert({ user_id: profile.user_id, action: 'account.pin_set', entity: 'profile', entity_id: profile.user_id });
  return json(req, 200, { ok: true });
});
