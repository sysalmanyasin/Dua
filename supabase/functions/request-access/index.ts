// POST {full_name, username} -> {ok:true}. Creates a pending request only; no account, no access.
import { serviceClient } from '../_shared/clients.ts';
import { json, preflight, readJson, requestIpHash } from '../_shared/http.ts';
import { normalizeUsername, validFullName, validUsername } from '../_shared/validate.ts';

const MAX_PENDING = 30;
const MAX_PER_IP_PER_HOUR = 5;

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return json(req, 405, { error: 'method' });

  const body = await readJson(req);
  const username = normalizeUsername(body?.username);
  const fullName = body?.full_name;
  if (!validUsername(username) || !validFullName(fullName)) {
    return json(req, 400, { error: 'invalid', message: 'Enter your name and a username (3-24 letters, digits, . _ -; start with a letter).' });
  }

  const db = serviceClient();
  const iph = await requestIpHash(req);
  const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
  const [pending, mine] = await Promise.all([
    db.from('access_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    db.from('access_requests').select('id', { count: 'exact', head: true }).eq('ip_hash', iph).gte('requested_at', hourAgo),
  ]);
  if ((pending.count ?? 0) >= MAX_PENDING || (mine.count ?? 0) >= MAX_PER_IP_PER_HOUR) {
    return json(req, 429, { error: 'busy', message: 'Too many requests. Please ask the owner directly.' });
  }

  // Same answer whether or not the username is taken: no account enumeration.
  const { data: existing } = await db.from('profiles').select('user_id').eq('username', username).maybeSingle();
  if (!existing) {
    await db.from('access_requests').insert({ full_name: fullName.trim(), username, ip_hash: iph });
  }
  return json(req, 200, { ok: true, message: 'Request sent. The owner will approve it and give you a setup code.' });
});
