// Admin-only actions. Caller must hold users.manage (admins need MFA aal2, enforced by has_perm in the database).
// POST {action, ...}: create_login | set_pin | unlock | set_disabled
//   create_login {staff_id, username, role, pin}  gives an existing registry person a login with a 4-digit PIN
//   set_pin      {user_id, pin}                   the owner sets a new permanent 4-digit PIN
//   unlock       {user_id}                        clears the wrong-PIN lock early
//   set_disabled {user_id, disabled}              stops or restores a login
// The owner chooses the PIN, so it is never shown back and never logged.
import { serviceClient, userClient } from '../_shared/clients.ts';
import { authPasswordFor } from '../_shared/codes.ts';
import { json, pinPepper, preflight, readJson, staffDomain } from '../_shared/http.ts';
import { isWeakPin, normalizeUsername, staffEmail, validPin, validUsername } from '../_shared/validate.ts';

const WEAK = { error: 'weak_pin', message: 'Choose a 4-digit PIN that is not a repeat, a run (1234), a year (1990) or a common pattern.' };
const BAD_PIN = { error: 'bad_pin', message: 'The PIN must be exactly 4 digits.' };

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
  // The PIN itself is never written to the log.
  const log = (a: string, entity: string, id: string, extra: Record<string, unknown> = {}) =>
    db.from('activity_log').insert({ user_id: actor, action: a, entity, entity_id: id, new_value: extra });

  const pepper = pinPepper();
  const passwordFor = async (username: string, pin: string): Promise<string | null> => {
    try {
      return await authPasswordFor(pepper, username, pin);
    } catch {
      return null; // PIN_PEPPER missing or too short
    }
  };
  const NOT_SET_UP = { error: 'not_set_up', message: 'PIN_PEPPER is not set on the server. See docs/SETUP.md.' };

  try {
    if (action === 'create_login') {
      const username = normalizeUsername(body?.username);
      const role = String(body?.role ?? '');
      const pin = body?.pin;
      const staffId = String(body?.staff_id ?? '');
      if (!validUsername(username)) {
        return json(req, 400, { error: 'username', message: 'Username: 3-24 letters, digits, . _ - ; start with a letter.' });
      }
      if (role !== 'junior' && role !== 'senior') return json(req, 400, { error: 'role', message: 'Choose Junior or Senior.' });
      if (!validPin(pin)) return json(req, 400, BAD_PIN);
      if (isWeakPin(pin)) return json(req, 400, WEAK);

      const { data: person } = await db.from('staff').select('id, active').eq('id', staffId).maybeSingle();
      if (!person) return json(req, 404, { error: 'not_found', message: 'That person is not in the staff registry.' });
      if (!person.active) return json(req, 409, { error: 'inactive', message: 'This person is not on the payroll list. Make them active first.' });
      const { data: hasLogin } = await db.from('profiles').select('user_id').eq('staff_id', staffId).maybeSingle();
      if (hasLogin) return json(req, 409, { error: 'has_login', message: 'This person already has a login.' });
      const { data: taken } = await db.from('profiles').select('user_id').eq('username', username).maybeSingle();
      if (taken) return json(req, 409, { error: 'username_taken', message: 'That username is already used. Pick another.' });
      const password = await passwordFor(username, pin);
      if (!password) return json(req, 500, NOT_SET_UP);

      const created = await db.auth.admin.createUser({ email: staffEmail(username, staffDomain()), password, email_confirm: true });
      if (created.error || !created.data.user) return json(req, 500, { error: 'create_failed', message: 'Could not create the login. Try again.' });
      const userId = created.data.user.id;
      try {
        const prof = await db.from('profiles').insert({ user_id: userId, staff_id: staffId, username, role_template: role });
        if (prof.error) throw prof.error;
        await log('access.login_created', 'profile', userId, { username, role, staff_id: staffId });
        return json(req, 200, { ok: true, username, user_id: userId });
      } catch (e) {
        await db.auth.admin.deleteUser(userId); // leave nothing half-created
        throw e;
      }
    }

    if (action === 'set_pin' || action === 'unlock' || action === 'set_disabled') {
      const userId = String(body?.user_id ?? '');
      const { data: p } = await db.from('profiles').select('user_id, username, role_template, disabled_at').eq('user_id', userId).maybeSingle();
      if (!p) return json(req, 404, { error: 'not_found' });
      if (p.role_template === 'admin') return json(req, 400, { error: 'admin_protected', message: 'Admin accounts are managed in the Supabase dashboard.' });

      if (action === 'set_pin') {
        const pin = body?.pin;
        if (!validPin(pin)) return json(req, 400, BAD_PIN);
        if (isWeakPin(pin)) return json(req, 400, WEAK);
        const password = await passwordFor(p.username, pin);
        if (!password) return json(req, 500, NOT_SET_UP);
        const { error } = await db.auth.admin.updateUserById(userId, { password }); // the old PIN stops working now
        if (error) return json(req, 400, { error: 'pin_rejected', message: 'That PIN was not accepted. Try a different one.' });
        await db.from('login_attempts').delete().eq('username', p.username).eq('success', false);
        await log('access.pin_set', 'profile', userId);
        return json(req, 200, { ok: true, username: p.username });
      }

      if (action === 'unlock') {
        await db.from('login_attempts').delete().eq('username', p.username).eq('success', false);
        await log('access.unlocked', 'profile', userId);
        return json(req, 200, { ok: true });
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
