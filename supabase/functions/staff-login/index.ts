// POST {username, pin} -> {access_token, refresh_token, expires_in}
// Lockout: 5 failures per username or 30 per IP in 15 minutes. Generic errors only.
import { anonClient, serviceClient } from '../_shared/clients.ts';
import { json, preflight, readJson, requestIpHash, sleep, staffDomain } from '../_shared/http.ts';
import { LOCK_WINDOW_MIN, isLocked, normalizeUsername, staffEmail, validPin, validUsername } from '../_shared/validate.ts';

const BAD = { error: 'invalid', message: 'Invalid username or PIN.' };

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return json(req, 405, { error: 'method' });

  const body = await readJson(req);
  const username = normalizeUsername(body?.username);
  const pin = body?.pin;
  if (!validUsername(username) || !validPin(pin)) return json(req, 400, BAD);

  const db = serviceClient();
  const iph = await requestIpHash(req);
  const since = new Date(Date.now() - LOCK_WINDOW_MIN * 60_000).toISOString();
  const [u, i] = await Promise.all([
    db.from('login_attempts').select('id', { count: 'exact', head: true }).eq('username', username).eq('success', false).gte('at', since),
    db.from('login_attempts').select('id', { count: 'exact', head: true }).eq('ip_hash', iph).eq('success', false).gte('at', since),
  ]);
  if (isLocked(u.count ?? 0, i.count ?? 0)) {
    return json(req, 429, { error: 'locked', message: `Too many attempts. Try again in ${LOCK_WINDOW_MIN} minutes or ask the owner.` });
  }

  const { data: profile } = await db.from('profiles').select('user_id, role_template, disabled_at, expires_at').eq('username', username).maybeSingle();
  const usable = profile && profile.role_template !== 'admin' && !profile.disabled_at &&
    (!profile.expires_at || new Date(profile.expires_at) > new Date());

  let session: { access_token: string; refresh_token: string; expires_in: number } | null = null;
  if (usable) {
    const { data, error } = await anonClient().auth.signInWithPassword({ email: staffEmail(username, staffDomain()), password: pin });
    if (!error && data.session) {
      session = { access_token: data.session.access_token, refresh_token: data.session.refresh_token, expires_in: data.session.expires_in };
    }
  } else {
    await sleep(300); // keep timing similar for unknown/disabled accounts
  }

  await db.from('login_attempts').insert({ username, ip_hash: iph, success: !!session });
  if (!session) return json(req, 401, BAD);
  await db.from('login_attempts').delete().eq('username', username).eq('success', false);
  return json(req, 200, session);
});
