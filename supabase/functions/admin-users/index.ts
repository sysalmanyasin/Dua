// Admin-only actions. Caller must hold users.manage (admins need MFA aal2, enforced by has_perm in the database).
// POST {action, ...}: approve_request | reject_request | reset_pin | set_disabled
import { serviceClient, userClient } from '../_shared/clients.ts';
import { generateSetupCode, hashCode, newSalt, randomPassword } from '../_shared/codes.ts';
import { json, preflight, readJson, staffDomain } from '../_shared/http.ts';
import { staffEmail } from '../_shared/validate.ts';

const CODE_HOURS = 24;

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return json(req, 405, { error: 'method' });

  const authHeader = req.headers.get('authorization') ?? '';
  if (!authHeader.toLowerCase().startsWith('bearer ')) return json(req, 401, { error: 'auth' });
  const caller = userClient(authHeader);
  const { data: who } = await caller.auth.getUser();
  const { data: allowed } = await caller.rpc('has_perm', { p_key: 'users.manage' });
  if (!who?.user || allowed !== true) return json(req, 403, { error: 'forbidden' });
  const actor = who.user.id;

  const body = await readJson(req);
  const action = String(body?.action ?? '');
  const db = serviceClient();
  const log = (a: string, entity: string, id: string, extra: Record<string, unknown> = {}) =>
    db.from('activity_log').insert({ user_id: actor, action: a, entity, entity_id: id, new_value: extra });

  async function issueCode(userId: string) {
    await db.from('setup_codes').update({ used_at: new Date().toISOString() }).eq('user_id', userId).is('used_at', null);
    const code = generateSetupCode();
    const salt = newSalt();
    const expires = new Date(Date.now() + CODE_HOURS * 3_600_000).toISOString();
    const { error } = await db.from('setup_codes').insert({
      user_id: userId, code_hash: await hashCode(code, salt), salt, expires_at: expires, created_by: actor,
    });
    if (error) throw new Error('could not store code');
    return { code, expires_at: expires };
  }

  try {
    if (action === 'approve_request') {
      const role = String(body?.role ?? '');
      if (role !== 'junior' && role !== 'senior') return json(req, 400, { error: 'role' });
      const { data: r } = await db.from('access_requests').select('*').eq('id', String(body?.request_id ?? '')).eq('status', 'pending').maybeSingle();
      if (!r) return json(req, 404, { error: 'not_found' });
      const { data: taken } = await db.from('profiles').select('user_id').eq('username', r.username).maybeSingle();
      if (taken) return json(req, 409, { error: 'username_taken' });

      const created = await db.auth.admin.createUser({
        email: staffEmail(r.username, staffDomain()), password: randomPassword(), email_confirm: true,
      });
      if (created.error || !created.data.user) return json(req, 500, { error: 'create_failed' });
      const userId = created.data.user.id;
      try {
        const staff = await db.from('staff').insert({ full_name: r.full_name }).select('id').single();
        if (staff.error) throw staff.error;
        const prof = await db.from('profiles').insert({ user_id: userId, staff_id: staff.data.id, username: r.username, role_template: role });
        if (prof.error) throw prof.error;
        const issued = await issueCode(userId);
        await db.from('access_requests').update({ status: 'approved', decided_by: actor, decided_at: new Date().toISOString() }).eq('id', r.id);
        await log('access.approved', 'profile', userId, { username: r.username, role });
        return json(req, 200, { username: r.username, ...issued });
      } catch (e) {
        await db.auth.admin.deleteUser(userId); // leave nothing half-created
        throw e;
      }
    }

    if (action === 'reject_request') {
      const id = String(body?.request_id ?? '');
      await db.from('access_requests').update({ status: 'rejected', decided_by: actor, decided_at: new Date().toISOString() }).eq('id', id).eq('status', 'pending');
      await log('access.rejected', 'access_request', id);
      return json(req, 200, { ok: true });
    }

    if (action === 'reset_pin' || action === 'set_disabled') {
      const userId = String(body?.user_id ?? '');
      const { data: p } = await db.from('profiles').select('user_id, username, role_template, disabled_at').eq('user_id', userId).maybeSingle();
      if (!p) return json(req, 404, { error: 'not_found' });
      if (p.role_template === 'admin') return json(req, 400, { error: 'admin_protected', message: 'Admin accounts are managed in the Supabase dashboard.' });

      if (action === 'reset_pin') {
        await db.auth.admin.updateUserById(userId, { password: randomPassword() }); // old PIN stops working now
        const issued = await issueCode(userId);
        await log('access.pin_reset', 'profile', userId);
        return json(req, 200, { username: p.username, ...issued });
      }
      const disabled = body?.disabled === true;
      await db.from('profiles').update({ disabled_at: disabled ? new Date().toISOString() : null }).eq('user_id', userId);
      await db.auth.admin.updateUserById(userId, { ban_duration: disabled ? '876000h' : 'none' });
      await log(disabled ? 'access.disabled' : 'access.enabled', 'profile', userId);
      return json(req, 200, { ok: true });
    }
    return json(req, 400, { error: 'unknown_action' });
  } catch {
    return json(req, 500, { error: 'server' });
  }
});
