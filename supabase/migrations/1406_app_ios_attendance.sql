-- 1406_app_ios_attendance: automatic attendance for iPhone employees, in the SAME system as Android (docs/IPHONE_ATTENDANCE_DESIGN.md).
-- (App range, after 1404, because it changes app_devices.)
--
-- An iPhone has no Dua app. The employee adds ready-made Apple Shortcuts and two personal automations (Arrive / Leave). The shortcut
-- sends the event to the same Edge Function (attendance-event) and the same decision function (app_attendance_event) as Android.
-- What is new here:
--   * a second platform, 'ios_shortcuts', on app_devices (one ACTIVE iPhone per person; enrolling one retires the person's Android key)
--   * app_device_enrolments: a one-time, 15-minute enrolment code the OWNER makes for one chosen employee (stored only as a SHA-256 hash)
--   * app_ios_enrol_peek / app_ios_enrol_consume: the setup shortcut shows the employee's first name, then swaps the code for the device
--     secret (shown once, stored only as a hash). The employee is derived from the device row, never from anything the shortcut sends.
--   * a ROLLING device secret: every accepted request returns a fresh "next" secret; using it makes the old one stop working. A copy of
--     the secret therefore stops working as soon as the real phone has used its next one, and the owner is alerted when a refused secret
--     arrives (it detects a copy, it cannot prevent one: Shortcuts has no Keychain, so the secret sits in a file on the phone).
--   * iPhone distance rules (an iPhone cannot enforce a geofence size): "in" up to the radius + a margin, "out" at least a minimum
--     distance away; no mock flag exists on iOS, so it is never used; accuracy may be missing.
--   * app_attendance_ios_signal: the setup shortcut's "test" (measured at the pharmacy, records nothing in attendance) and "confirm"
--   * owner functions: make / cancel a code, revoke a phone, list phones, per-phone journal, the two distance settings
-- Android behaviour is unchanged: every new rule is guarded by the device's platform, and the Android functions only gain guards.

-- ───────── devices: a second platform and the iPhone's setup status ─────────
alter table public.app_devices drop constraint app_devices_platform_check;
alter table public.app_devices add constraint app_devices_platform_check check (platform in ('android', 'ios_shortcuts'));

alter table public.app_devices
  add column device_name text check (device_name is null or length(device_name) <= 60),
  add column enrolled_by uuid references auth.users(id) on delete set null,
  add column enrolled_at timestamptz,
  add column revoked_at timestamptz,
  add column revoked_by uuid references auth.users(id) on delete set null,
  add column revoked_reason text check (revoked_reason is null or length(revoked_reason) <= 200),
  -- secrets issued to the phone but not used yet (up to 3, so two runs at once can never lock the phone out)
  add column attendance_next_hashes text[] not null default '{}',
  add column test_ok_at timestamptz,
  add column test_result text check (test_result is null or test_result in ('ok', 'outside', 'weak_signal', 'no_place_set')),
  add column confirmed_at timestamptz,
  add column first_event_at timestamptz,
  add column last_event_at timestamptz,
  add column stale_secret_count integer not null default 0,
  add column stale_secret_at timestamptz,
  add constraint app_devices_next_hashes_check check (
    cardinality(attendance_next_hashes) <= 3 and (cardinality(attendance_next_hashes) = 0 or attendance_secret_hash is not null));

-- At most ONE active iPhone per person (a revoked row has no secret, so it does not count).
create unique index app_devices_ios_active_uidx on public.app_devices (user_id)
  where platform = 'ios_shortcuts' and attendance_secret_hash is not null;

-- Another person signing in on the same phone never inherits the previous person's attendance secret (now also the unused next ones).
create or replace function public.app_devices_forget_attendance_secret() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.user_id is distinct from old.user_id then
    new.attendance_secret_hash := null;
    new.attendance_next_hashes := '{}';
  end if;
  return new;
end $$;

-- ───────── settings and history ─────────
alter table public.mgmt_attendance_config
  add column ios_arrive_margin_m integer not null default 100 check (ios_arrive_margin_m between 0 and 500),
  add column ios_leave_min_m integer not null default 50 check (ios_leave_min_m between 0 and 500);

-- the history outlives the device row, so it remembers which platform sent the event
alter table public.mgmt_attendance_auto_events
  add column platform text not null default 'android' check (platform in ('android', 'ios_shortcuts'));

-- ───────── enrolment codes ─────────
create table public.app_device_enrolments (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),   -- the code itself is never stored
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),   -- the real moment, so codes made in one transaction keep their order
  expires_at timestamptz not null,
  used_at timestamptz,
  device_id uuid,                                                           -- the device made from it
  cancelled_at timestamptz,
  cancel_reason text check (cancel_reason is null or length(cancel_reason) <= 200),
  check (used_at is null or cancelled_at is null)
);
-- one open code per person: making a new one cancels the earlier one first
create unique index app_device_enrolments_open_uidx on public.app_device_enrolments (user_id) where used_at is null and cancelled_at is null;
create index app_device_enrolments_staff_idx on public.app_device_enrolments (staff_id, created_at desc);
alter table public.app_device_enrolments enable row level security;
revoke all on public.app_device_enrolments from public, anon, authenticated;

-- ───────── the device check, shared by every call an iPhone or an Android phone makes with its secret (internal) ─────────
-- Returns no row for: unknown or revoked device, wrong secret, a person who lost the right or the login. For an iPhone it also rolls the
-- secret (see above) and counts a refused secret. Everything here is undone if the caller later raises an error.
create function public.app_attendance_device_auth(p_device_id uuid, p_secret_hash text)
returns table (device_id uuid, user_id uuid, staff_id uuid, platform text, next_secret text)
language plpgsql security definer set search_path = public as $$
declare d public.app_devices; me uuid; v_next text; v_promote boolean := false; v_day date;
begin
  select * into d from public.app_devices where id = p_device_id and attendance_secret_hash is not null for update;
  if not found then return; end if;

  if d.attendance_secret_hash = p_secret_hash then
    null;
  elsif d.platform = 'ios_shortcuts' and p_secret_hash = any (d.attendance_next_hashes) then
    v_promote := true;
  else
    -- a secret that is neither the current one nor one issued to this phone: a copy, an old backup, or a wrong guess
    if d.platform = 'ios_shortcuts' then
      update public.app_devices set stale_secret_count = stale_secret_count + 1, stale_secret_at = now() where id = d.id;
      if to_regprocedure('public.notify_owner(text, jsonb)') is not null then
        v_day := (now() at time zone 'Asia/Karachi')::date;
        perform public.notify_owner('attendance.key_refused', jsonb_build_object(
          'date', v_day, 'dedupe_key', 'attendance.key_refused:' || d.id::text || ':' || v_day::text));
      end if;
    end if;
    return;
  end if;

  if not public.app_user_has(d.user_id, 'attendance.check_in') then return; end if;
  select pr.staff_id into me from public.profiles pr where pr.user_id = d.user_id;
  if me is null then return; end if;

  if d.platform = 'ios_shortcuts' then
    if v_promote then
      update public.app_devices set attendance_secret_hash = p_secret_hash, attendance_next_hashes = '{}' where id = d.id;
      d.attendance_next_hashes := '{}';
    end if;
    v_next := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
    update public.app_devices set attendance_next_hashes = (
        select coalesce(array_agg(x.h order by x.n), '{}'::text[]) from (
          select t.h, t.n from unnest(d.attendance_next_hashes || encode(sha256(convert_to(v_next, 'UTF8')), 'hex'))
            with ordinality as t(h, n) order by t.n desc limit 3) x)
     where id = d.id;
  end if;
  return query select d.id, d.user_id, me, d.platform, v_next;
end $$;

-- ───────── one event (replaces the 1403 version; same arguments, Android behaves exactly as before) ─────────
-- Returns null when the device, its secret or the person's right is wrong (the function answers 401 and the phone stops sending).
-- Returns {status: 'off'} when the owner has not switched automatic recording on (nothing is stored).
-- Otherwise {status: 'accepted' | 'rejected' | 'ignored', reason, kind, at, distance_m, place}; an iPhone's answer also carries next_secret.
create or replace function public.app_attendance_event(
  p_device_id uuid, p_secret_hash text, p_event_id uuid, p_kind text, p_at timestamptz,
  p_lat numeric, p_lng numeric, p_accuracy numeric, p_mock boolean
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  h record;
  cfg public.mgmt_attendance_config;
  me uuid;
  v_ios boolean;
  v_roll jsonb;
  v_mock boolean;
  prior public.mgmt_attendance_auto_events;
  v_site public.mgmt_attendance_sites;
  v_dist numeric;
  v_last public.mgmt_attendance;
  v_state text;
  v_outcome text;
  v_reason text;
  v_att uuid;
  v_day date;
  v_in_limit numeric;
  res jsonb;
begin
  select * into h from public.app_attendance_device_auth(p_device_id, p_secret_hash);
  if not found then return null; end if;
  me := h.staff_id;
  v_ios := h.platform = 'ios_shortcuts';
  v_roll := case when h.next_secret is null then '{}'::jsonb else jsonb_build_object('next_secret', h.next_secret) end;

  -- an iPhone cannot always report its accuracy; an Android phone always does
  if p_event_id is null or p_kind is null or p_kind not in ('in', 'out') or p_at is null
     or p_lat is null or p_lng is null or p_lat < -90 or p_lat > 90 or p_lng < -180 or p_lng > 180
     or (p_accuracy is null and not v_ios) or p_accuracy < 0 or p_accuracy > 100000 then
    raise exception 'invalid event' using errcode = '22023';
  end if;

  -- one person's events are handled one after another, so two phones or a retry can never both see "not in" and both record "in"
  perform pg_advisory_xact_lock(hashtext('attendance:' || me::text));

  -- the same event again: the same answer, nothing new recorded
  select * into prior from public.mgmt_attendance_auto_events where event_id = p_event_id;
  if found then
    if prior.staff_id <> me then return null; end if;
    return jsonb_build_object('status', prior.outcome, 'reason', prior.reason, 'kind', prior.kind, 'at', prior.event_at,
                              'distance_m', prior.distance_m, 'duplicate', true) || v_roll;
  end if;

  select * into cfg from public.mgmt_attendance_config;
  update public.app_devices set last_seen_at = now(), last_event_at = case when v_ios then now() else last_event_at end where id = h.device_id;
  if not cfg.auto_enabled then return jsonb_build_object('status', 'off') || v_roll; end if;

  -- iOS has no mock-location flag: nothing an iPhone sends is trusted as one
  v_mock := case when v_ios then false else coalesce(p_mock, false) end;

  select s.* into v_site from public.mgmt_attendance_sites s where s.active
   order by public.mgmt_attendance_distance_m(p_lat, p_lng, s.latitude, s.longitude) limit 1;
  if found then v_dist := public.mgmt_attendance_distance_m(p_lat, p_lng, v_site.latitude, v_site.longitude); end if;
  -- an iPhone's arrival fires at the edge of a region the employee drew, so it may be a little outside the radius; with no accuracy
  -- the plain radius applies
  v_in_limit := v_site.radius_m + case when v_ios and p_accuracy is not null then cfg.ios_arrive_margin_m else 0 end;

  -- the last recorded event decides whether this one makes sense (the same 24 hours the manual check-in uses)
  select * into v_last from public.mgmt_attendance
   where staff_id = me and status = 'accepted' and at > p_at - interval '24 hours' order by at desc limit 1;
  v_state := case when v_last.kind = 'in' then 'in' else 'out' end;

  if p_at < now() - interval '24 hours' or p_at > now() + interval '5 minutes' then
    v_outcome := 'ignored'; v_reason := 'stale';
  elsif v_mock then
    v_outcome := 'rejected'; v_reason := 'mock_location';
  elsif exists (select 1 from public.mgmt_attendance where staff_id = me and status = 'accepted' and at >= p_at) then
    v_outcome := 'ignored'; v_reason := 'older';                        -- something later is already recorded (for example a manual check-out)
  elsif p_kind = 'in' and v_state = 'in' then
    v_outcome := 'ignored'; v_reason := 'already_in';
  elsif p_kind = 'out' and v_state = 'out' then
    v_outcome := 'ignored'; v_reason := 'not_in';
  elsif p_accuracy is not null and p_accuracy > cfg.max_accuracy_m then
    v_outcome := 'rejected'; v_reason := 'weak_signal';
  elsif v_site.id is null then
    v_outcome := 'rejected'; v_reason := 'no_place_set';
  elsif p_kind = 'in' and v_dist > v_in_limit then
    v_outcome := 'rejected'; v_reason := 'outside';
  elsif p_kind = 'out' and (case when v_ios then v_dist < cfg.ios_leave_min_m else v_dist <= v_site.radius_m end) then
    v_outcome := 'rejected'; v_reason := 'still_inside';
  else
    v_outcome := 'accepted'; v_reason := null;
  end if;

  if v_outcome <> 'ignored' then
    v_day := (p_at at time zone 'Asia/Karachi')::date;
    insert into public.mgmt_attendance (staff_id, user_id, business_date, at, kind, status, reject_reason, site_id,
                                        latitude, longitude, accuracy_m, distance_m, mock_location, source)
    values (me, h.user_id, v_day, p_at, p_kind, v_outcome, v_reason, case when v_outcome = 'accepted' then v_site.id end,
            round(p_lat, 6), round(p_lng, 6), round(p_accuracy, 1), v_dist, v_mock, 'auto')
    returning id into v_att;
  end if;

  insert into public.mgmt_attendance_auto_events (event_id, staff_id, device_id, kind, event_at, outcome, reason, attendance_id,
                                                  latitude, longitude, accuracy_m, distance_m, mock_location, platform)
  values (p_event_id, me, h.device_id, p_kind, p_at, v_outcome, v_reason, v_att,
          round(p_lat, 6), round(p_lng, 6), round(p_accuracy, 1), v_dist, v_mock, h.platform);

  if v_ios and v_outcome = 'accepted' then
    update public.app_devices set first_event_at = coalesce(first_event_at, now()) where id = h.device_id;
  end if;

  if to_regprocedure('public.notify_owner(text, jsonb)') is not null then
    -- the owner hears about a fake location, as with a manual check-in (ids and dates only)
    if v_reason = 'mock_location' then
      perform public.notify_owner('attendance.rejected', jsonb_build_object(
        'date', v_day, 'reason', v_reason, 'dedupe_key', 'attendance.rejected:' || me::text || ':' || v_day::text || ':' || v_reason));
    end if;
    -- three refused iPhone events for one person in a day: the shortcut or the automations are probably set up wrongly
    if v_ios and v_outcome = 'rejected' and
       (select count(*) from public.mgmt_attendance_auto_events e
         where e.staff_id = me and e.platform = 'ios_shortcuts' and e.outcome = 'rejected'
           and (e.event_at at time zone 'Asia/Karachi')::date = v_day) >= 3 then
      perform public.notify_owner('attendance.ios_rejects', jsonb_build_object(
        'date', v_day, 'dedupe_key', 'attendance.ios_rejects:' || me::text || ':' || v_day::text));
    end if;
  end if;

  res := jsonb_build_object('status', v_outcome, 'reason', v_reason, 'kind', p_kind, 'at', p_at,
                            'distance_m', v_dist, 'place', v_site.name);
  return res || v_roll;
end $$;

-- ───────── the setup shortcut's test and confirmation (iPhone only; records nothing in attendance) ─────────
-- p_kind 'test': the setup shortcut sends a location; it is measured with the iPhone "arrival" rule. Do it standing at the pharmacy.
-- p_kind 'confirm': the employee says both automations are made (this is the employee's word; Dua cannot verify it).
create function public.app_attendance_ios_signal(p_device_id uuid, p_secret_hash text, p_kind text, p_lat numeric, p_lng numeric, p_accuracy numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  h record; cfg public.mgmt_attendance_config; v_site public.mgmt_attendance_sites; v_dist numeric; v_result text; v_roll jsonb;
begin
  select * into h from public.app_attendance_device_auth(p_device_id, p_secret_hash);
  if not found or h.platform <> 'ios_shortcuts' then return null; end if;
  v_roll := case when h.next_secret is null then '{}'::jsonb else jsonb_build_object('next_secret', h.next_secret) end;

  if p_kind = 'confirm' then
    update public.app_devices set confirmed_at = now(), last_seen_at = now() where id = h.device_id;
    return jsonb_build_object('status', 'confirmed') || v_roll;
  elsif p_kind = 'test' then
    if p_lat is null or p_lng is null or p_lat < -90 or p_lat > 90 or p_lng < -180 or p_lng > 180
       or p_accuracy < 0 or p_accuracy > 100000 then
      raise exception 'invalid test' using errcode = '22023';
    end if;
    select * into cfg from public.mgmt_attendance_config;
    select s.* into v_site from public.mgmt_attendance_sites s where s.active
     order by public.mgmt_attendance_distance_m(p_lat, p_lng, s.latitude, s.longitude) limit 1;
    if found then v_dist := public.mgmt_attendance_distance_m(p_lat, p_lng, v_site.latitude, v_site.longitude); end if;
    v_result := case
      when p_accuracy is not null and p_accuracy > cfg.max_accuracy_m then 'weak_signal'
      when v_site.id is null then 'no_place_set'
      when v_dist <= v_site.radius_m + case when p_accuracy is not null then cfg.ios_arrive_margin_m else 0 end then 'ok'
      else 'outside' end;
    update public.app_devices set test_result = v_result, test_ok_at = case when v_result = 'ok' then now() else test_ok_at end,
                                  last_seen_at = now() where id = h.device_id;
    return jsonb_build_object('status', v_result, 'distance_m', v_dist, 'place', v_site.name) || v_roll;
  end if;
  raise exception 'invalid signal' using errcode = '22023';
end $$;

-- ───────── enrolment: the setup shortcut (service role only, through the Edge Function attendance-enrol) ─────────
-- The employee's FIRST NAME is shown before anything is used up, so a wrong QR code on a wrong phone is noticed. Every problem
-- (wrong, used, expired, cancelled, person no longer allowed) returns null: one answer, nothing to probe.
create function public.app_ios_enrol_peek(p_token_hash text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare e public.app_device_enrolments; v_name text;
begin
  select * into e from public.app_device_enrolments where token_hash = p_token_hash;
  if not found or e.used_at is not null or e.cancelled_at is not null or e.expires_at <= now() then return null; end if;
  if not public.app_user_has(e.user_id, 'attendance.check_in') then return null; end if;
  select split_part(trim(s.full_name), ' ', 1) into v_name from public.staff s where s.id = e.staff_id;
  return jsonb_build_object('name', v_name, 'expires_at', e.expires_at);
end $$;

-- Swaps the code for the device. The code works once; the device id is made here (the shortcut cannot choose it); the secret is
-- shown once and only its hash is kept. Another attendance key of the same person (their Android phone) is retired.
create function public.app_ios_enrol_consume(p_token_hash text, p_device_name text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e public.app_device_enrolments; v_dev uuid := gen_random_uuid(); v_secret text; v_name text;
begin
  select * into e from public.app_device_enrolments where token_hash = p_token_hash for update;
  if not found or e.used_at is not null or e.cancelled_at is not null or e.expires_at <= now() then return null; end if;
  if not public.app_user_has(e.user_id, 'attendance.check_in')
     or not exists (select 1 from public.profiles pr where pr.user_id = e.user_id and pr.staff_id = e.staff_id) then return null; end if;
  perform pg_advisory_xact_lock(hashtext('attendance:' || e.staff_id::text));
  if exists (select 1 from public.app_devices d where d.user_id = e.user_id and d.platform = 'ios_shortcuts' and d.attendance_secret_hash is not null) then
    return null;
  end if;

  v_secret := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into public.app_devices (id, user_id, platform, device_name, attendance_secret_hash, enrolled_by, enrolled_at)
  values (v_dev, e.user_id, 'ios_shortcuts', left(nullif(trim(p_device_name), ''), 60),
          encode(sha256(convert_to(v_secret, 'UTF8')), 'hex'), e.created_by, clock_timestamp());
  update public.app_devices set attendance_secret_hash = null, attendance_next_hashes = '{}'
   where user_id = e.user_id and platform = 'android' and attendance_secret_hash is not null;
  update public.app_device_enrolments set used_at = now(), device_id = v_dev where id = e.id;

  insert into public.activity_log (user_id, action, entity, entity_id, new_value, reason)
  values (e.user_id, 'attendance.ios_enrolled', 'app_devices', v_dev::text, jsonb_build_object('staff_id', e.staff_id), 'enrolment code used');
  select split_part(trim(s.full_name), ' ', 1) into v_name from public.staff s where s.id = e.staff_id;
  return jsonb_build_object('device_id', v_dev, 'secret', v_secret, 'name', v_name);
end $$;

-- ───────── enrolment: the owner (attendance.manage; the owner's functions also need the authenticator code via has_perm) ─────────
-- The code is returned ONCE and is never stored. A repeat of the same request (same key) is answered without it, so nothing that can
-- be read back ever holds a code; the owner simply makes a new one.
create function public.mgmt_attendance_ios_enrol_create(p_staff uuid, p_replace boolean, p_reason text, p_key uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare res jsonb; v_user uuid; v_token text; v_id uuid := gen_random_uuid(); v_exp timestamptz := now() + interval '15 minutes';
begin
  if not public.has_perm('attendance.manage') then raise exception 'not allowed' using errcode = '42501'; end if;
  res := public.mgmt_idem_get(p_key, 'ios_enrol_create');
  if res is not null then return res; end if;
  if p_reason is null or length(trim(p_reason)) < 3 then raise exception 'a reason is required' using errcode = '22023'; end if;
  select pr.user_id into v_user from public.profiles pr where pr.staff_id = p_staff;
  if not found then raise exception 'no_login' using errcode = '22023'; end if;
  if not exists (select 1 from public.profiles pr where pr.user_id = v_user and pr.disabled_at is null
                   and (pr.expires_at is null or pr.expires_at > now())) then raise exception 'login_disabled' using errcode = '22023'; end if;
  if not public.app_user_has(v_user, 'attendance.check_in') then raise exception 'no_check_in_right' using errcode = '22023'; end if;

  perform pg_advisory_xact_lock(hashtext('attendance:' || p_staff::text));
  if exists (select 1 from public.app_devices d where d.user_id = v_user and d.platform = 'ios_shortcuts' and d.attendance_secret_hash is not null) then
    if not coalesce(p_replace, false) then raise exception 'already_has_phone' using errcode = '22023'; end if;
    update public.app_devices set attendance_secret_hash = null, attendance_next_hashes = '{}', revoked_at = now(), revoked_by = auth.uid(),
           revoked_reason = left('replaced: ' || trim(p_reason), 200)
     where user_id = v_user and platform = 'ios_shortcuts' and attendance_secret_hash is not null;
  end if;
  update public.app_device_enrolments set cancelled_at = now(), cancel_reason = 'replaced by a newer code'
   where user_id = v_user and used_at is null and cancelled_at is null;

  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into public.app_device_enrolments (id, staff_id, user_id, token_hash, created_by, expires_at)
  values (v_id, p_staff, v_user, encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), auth.uid(), v_exp);

  res := jsonb_build_object('ok', true, 'enrolment_id', v_id, 'staff_id', p_staff, 'expires_at', v_exp);
  perform public.mgmt_idem_put(p_key, 'ios_enrol_create', res);
  perform public.log_activity('attendance.ios_enrol_created', 'app_device_enrolments', v_id::text, null,
                              jsonb_build_object('staff_id', p_staff, 'replace', coalesce(p_replace, false)), trim(p_reason));
  return res || jsonb_build_object('token', v_token);
end $$;

create function public.mgmt_attendance_ios_enrol_cancel(p_enrolment uuid, p_reason text, p_key uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare res jsonb; n integer;
begin
  if not public.has_perm('attendance.manage') then raise exception 'not allowed' using errcode = '42501'; end if;
  res := public.mgmt_idem_get(p_key, 'ios_enrol_cancel');
  if res is not null then return res; end if;
  if p_reason is null or length(trim(p_reason)) < 3 then raise exception 'a reason is required' using errcode = '22023'; end if;
  update public.app_device_enrolments set cancelled_at = now(), cancel_reason = left(trim(p_reason), 200)
   where id = p_enrolment and used_at is null and cancelled_at is null;
  get diagnostics n = row_count;
  res := jsonb_build_object('ok', true, 'cancelled', n > 0);
  perform public.mgmt_idem_put(p_key, 'ios_enrol_cancel', res);
  if n > 0 then
    perform public.log_activity('attendance.ios_enrol_cancelled', 'app_device_enrolments', p_enrolment::text, null, null, trim(p_reason));
  end if;
  return res;
end $$;

-- Revoke an iPhone: the next event it sends is refused (401) and the shortcut stops. Needs the reason; the old row is kept as history.
create function public.mgmt_attendance_device_revoke(p_device uuid, p_reason text, p_key uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare res jsonb; n integer;
begin
  if not public.has_perm('attendance.manage') then raise exception 'not allowed' using errcode = '42501'; end if;
  res := public.mgmt_idem_get(p_key, 'attendance_device_revoke');
  if res is not null then return res; end if;
  if p_reason is null or length(trim(p_reason)) < 3 then raise exception 'a reason is required' using errcode = '22023'; end if;
  update public.app_devices set attendance_secret_hash = null, attendance_next_hashes = '{}', revoked_at = now(), revoked_by = auth.uid(),
         revoked_reason = left(trim(p_reason), 200)
   where id = p_device and platform = 'ios_shortcuts' and attendance_secret_hash is not null;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'unknown device' using errcode = '22023'; end if;
  res := jsonb_build_object('ok', true);
  perform public.mgmt_idem_put(p_key, 'attendance_device_revoke', res);
  perform public.log_activity('attendance.device_revoked', 'app_devices', p_device::text, null, null, trim(p_reason));
  return res;
end $$;

-- the two iPhone distance settings (owner)
create function public.mgmt_attendance_ios_set(p_arrive_margin_m integer, p_leave_min_m integer, p_reason text, p_key uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare res jsonb;
begin
  if not public.has_perm('attendance.manage') then raise exception 'not allowed' using errcode = '42501'; end if;
  res := public.mgmt_idem_get(p_key, 'attendance_ios_set');
  if res is not null then return res; end if;
  if p_reason is null or length(trim(p_reason)) < 3 then raise exception 'a reason is required' using errcode = '22023'; end if;
  if p_arrive_margin_m is null or p_arrive_margin_m not between 0 and 500 or p_leave_min_m is null or p_leave_min_m not between 0 and 500 then
    raise exception 'distances must be between 0 and 500 metres' using errcode = '22023';
  end if;
  update public.mgmt_attendance_config set ios_arrive_margin_m = p_arrive_margin_m, ios_leave_min_m = p_leave_min_m,
         updated_by = auth.uid(), updated_at = now() where id;
  res := jsonb_build_object('ok', true);
  perform public.mgmt_idem_put(p_key, 'attendance_ios_set', res);
  perform public.log_activity('attendance.ios_set', 'mgmt_attendance_config', 'config', null,
                              jsonb_build_object('ios_arrive_margin_m', p_arrive_margin_m, 'ios_leave_min_m', p_leave_min_m), trim(p_reason));
  return res;
end $$;

-- ───────── owner: every person and their iPhone setup ─────────
-- status (strongest first): working (a real event arrived) > confirmed (the employee says the automations are made) > tested (measured at
-- the pharmacy) > set_up > waiting (a code is open) > revoked > not_set_up. Only "working" and "tested" are verified by the server;
-- "confirmed" is the employee's word; whether an automation is still on can never be known (iOS does not tell Dua).
create function public.mgmt_attendance_phones() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare cfg public.mgmt_attendance_config;
begin
  if not (public.has_perm('attendance.view_all') or public.has_perm('attendance.manage')) then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into cfg from public.mgmt_attendance_config;
  return jsonb_build_object(
    'auto_enabled', cfg.auto_enabled, 'ios_arrive_margin_m', cfg.ios_arrive_margin_m, 'ios_leave_min_m', cfg.ios_leave_min_m,
    'people', coalesce((select jsonb_agg(q order by q.name) from (
      select x.staff_id, x.name, x.has_login, x.can_check_in, x.status, x.device, x.enrolment, x.android_active, x.rejects_7d,
             to_jsonb(array_remove(array[
               case when not x.has_login then 'needs_login' end,
               case when x.has_login and not x.can_check_in then 'needs_check_in_right' end,
               case when x.active_dev and x.test_ok_at is null then 'not_tested' end,
               case when x.active_dev and x.confirmed_at is null then 'not_confirmed' end,
               case when x.active_dev and coalesce(x.last_event_at, x.enrolled_at) < now() - interval '7 days' then 'no_events_7d' end,
               case when x.active_dev and x.stale_secret_at > now() - interval '7 days' then 'key_refused' end,
               case when not x.active_dev and x.enr_state = 'expired' then 'code_expired' end], null)) as issues
        from (
          select s.id as staff_id, s.full_name as name, pr.user_id is not null as has_login,
                 coalesce(public.app_user_has(pr.user_id, 'attendance.check_in'), false) as can_check_in,
                 (dev.id is not null and dev.attendance_secret_hash is not null) as active_dev,
                 dev.test_ok_at, dev.confirmed_at, dev.last_event_at, dev.enrolled_at, dev.stale_secret_at,
                 enr.state as enr_state,
                 case
                   when dev.id is not null and dev.attendance_secret_hash is not null then
                     case when dev.first_event_at is not null then 'working' when dev.confirmed_at is not null then 'confirmed'
                          when dev.test_ok_at is not null then 'tested' else 'set_up' end
                   when enr.state = 'open' then 'waiting'
                   when dev.id is not null then 'revoked'
                   else 'not_set_up' end as status,
                 case when dev.id is null then null else jsonb_build_object(
                   'id', dev.id, 'name', dev.device_name, 'active', dev.attendance_secret_hash is not null, 'enrolled_at', dev.enrolled_at,
                   'last_event_at', dev.last_event_at, 'first_event_at', dev.first_event_at, 'test_ok_at', dev.test_ok_at,
                   'test_result', dev.test_result, 'confirmed_at', dev.confirmed_at, 'revoked_at', dev.revoked_at,
                   'revoked_reason', dev.revoked_reason, 'stale_secret_count', dev.stale_secret_count, 'stale_secret_at', dev.stale_secret_at) end as device,
                 case when enr.id is null then null else jsonb_build_object(
                   'id', enr.id, 'state', enr.state, 'created_at', enr.created_at, 'expires_at', enr.expires_at) end as enrolment,
                 exists (select 1 from public.app_devices a where a.user_id = pr.user_id and a.platform = 'android' and a.attendance_secret_hash is not null) as android_active,
                 coalesce((select count(*) from public.mgmt_attendance_auto_events e
                            where e.staff_id = s.id and e.platform = 'ios_shortcuts' and e.outcome = 'rejected'
                              and e.received_at > now() - interval '7 days'), 0) as rejects_7d
            from public.staff s
            left join public.profiles pr on pr.staff_id = s.id
            left join lateral (select d.* from public.app_devices d where d.user_id = pr.user_id and d.platform = 'ios_shortcuts'
                                order by (d.attendance_secret_hash is not null) desc, coalesce(d.enrolled_at, d.created_at) desc limit 1) dev on true
            left join lateral (select e.id, e.created_at, e.expires_at,
                                      case when e.used_at is not null then 'used' when e.cancelled_at is not null then 'cancelled'
                                           when e.expires_at <= now() then 'expired' else 'open' end as state
                                 from public.app_device_enrolments e where e.staff_id = s.id order by e.created_at desc limit 1) enr on true
           where s.active
             -- an admin holds every right, so is listed only when they have actually set up an iPhone
             and (pr.role_template is distinct from 'admin' or dev.id is not null or enr.id is not null)
        ) x) q), '[]'::jsonb));
end $$;

-- ───────── owner: one phone's recent events, with the outcome and reason ─────────
create function public.mgmt_attendance_device_journal(p_device uuid, p_limit integer default 50) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.has_perm('attendance.view_all') or public.has_perm('attendance.manage')) then raise exception 'not allowed' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(j order by j.received_at desc) from (
    select e.event_id, e.kind, e.event_at, e.received_at, e.outcome, e.reason, e.distance_m, e.accuracy_m, e.platform
      from public.mgmt_attendance_auto_events e where e.device_id = p_device
     order by e.received_at desc limit least(greatest(coalesce(p_limit, 50), 1), 200)) j), '[]'::jsonb);
end $$;

-- ───────── existing owner and phone reads now carry the new settings / the platform ─────────
create or replace function public.mgmt_attendance_setup() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare cfg public.mgmt_attendance_config;
begin
  if not (public.has_perm('attendance.manage') or public.has_perm('attendance.view_all')) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into cfg from public.mgmt_attendance_config;
  return jsonb_build_object(
    'config', jsonb_build_object('max_accuracy_m', cfg.max_accuracy_m, 'require_app', cfg.require_app,
                                 'stable_seconds', cfg.stable_seconds, 'auto_enabled', cfg.auto_enabled,
                                 'ios_arrive_margin_m', cfg.ios_arrive_margin_m, 'ios_leave_min_m', cfg.ios_leave_min_m),
    'sites', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'latitude', latitude, 'longitude', longitude,
                'radius_m', radius_m, 'active', active) order by name) from public.mgmt_attendance_sites), '[]'::jsonb));
end $$;

-- "Who is at work": an iPhone cannot report its tracking state, so the owner's page must not say "no report" about it.
create or replace function public.mgmt_attendance_health() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare cfg public.mgmt_attendance_config;
begin
  if not public.has_perm('attendance.view_all') then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into cfg from public.mgmt_attendance_config;
  return jsonb_build_object(
    'auto_enabled', cfg.auto_enabled,
    'people', coalesce((select jsonb_agg(p order by p.name) from (
      select s.id as staff_id, s.full_name as name,
             coalesce(l.kind = 'in', false) as at_work, case when l.kind = 'in' then l.at end as since, l.source as source,
             case when d.id is null then null else jsonb_build_object(
               'platform', d.platform,
               'state', d.health_state, 'reported_at', d.health_at, 'pending', d.health_pending,
               'app_version', d.app_version, 'seen_at', d.last_seen_at,
               'setup', case when d.platform = 'ios_shortcuts' then
                          case when d.first_event_at is not null then 'working' when d.confirmed_at is not null then 'confirmed'
                               when d.test_ok_at is not null then 'tested' else 'set_up' end end,
               'last_event_at', d.last_event_at) end as phone
        from public.profiles pr
        join public.staff s on s.id = pr.staff_id
        left join lateral (select a.kind, a.at, a.source from public.mgmt_attendance a
                            where a.staff_id = s.id and a.status = 'accepted' and a.at > now() - interval '24 hours'
                            order by a.at desc limit 1) l on true
        left join lateral (select x.* from public.app_devices x where x.user_id = pr.user_id and x.attendance_secret_hash is not null
                            order by x.last_seen_at desc limit 1) d on true
       where public.app_user_has(pr.user_id, 'attendance.check_in')
         -- an admin holds every right, so is listed only when their own phone or a record shows they use it
         and (pr.role_template <> 'admin' or d.id is not null or l.kind is not null)) p), '[]'::jsonb));
end $$;

-- ───────── guards: Android functions never touch an iPhone row, and an iPhone excludes the person's Android attendance key ─────────
create or replace function public.app_device_register(p_device_id uuid, p_fcm_token text, p_app_version text, p_want_widget boolean default false)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_secret text; v_hash text;
begin
  if auth.uid() is null or not exists (select 1 from public.profiles
       where user_id = auth.uid() and disabled_at is null and (expires_at is null or expires_at > now())) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_device_id is null then raise exception 'invalid device' using errcode = '22023'; end if;
  -- an iPhone's row can never be taken over by someone who happens to know its id
  if exists (select 1 from public.app_devices where id = p_device_id and platform <> 'android') then
    raise exception 'invalid device' using errcode = '22023';
  end if;
  if p_want_widget then
    if not (public.has_perm('candela.today_total') or public.has_perm('candela.view')) then
      raise exception 'not allowed' using errcode = '42501';
    end if;
    v_secret := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
    v_hash := encode(sha256(convert_to(v_secret, 'UTF8')), 'hex');
  end if;
  -- a push address belongs to one install: if it moved here (reinstall), drop it from the old row
  if p_fcm_token is not null then delete from public.app_devices where fcm_token = p_fcm_token and id <> p_device_id and platform = 'android'; end if;

  insert into public.app_devices (id, user_id, app_version, fcm_token, widget_secret_hash)
  values (p_device_id, auth.uid(), left(p_app_version, 40), p_fcm_token, v_hash)
  on conflict (id) do update set
    user_id = auth.uid(),
    app_version = left(p_app_version, 40),
    fcm_token = coalesce(excluded.fcm_token, app_devices.fcm_token),
    push_disabled_at = case when excluded.fcm_token is not null then null else app_devices.push_disabled_at end,
    push_disabled_reason = case when excluded.fcm_token is not null then null else app_devices.push_disabled_reason end,
    -- another person signing in on the same phone never inherits the previous person's widget
    widget_secret_hash = case when app_devices.user_id <> auth.uid() then excluded.widget_secret_hash
                              else coalesce(excluded.widget_secret_hash, app_devices.widget_secret_hash) end,
    last_seen_at = now();
  return jsonb_build_object('widget_secret', v_secret);
end $$;

create or replace function public.app_device_unregister(p_device_id uuid) returns void
language sql security definer set search_path = public as $$
  delete from public.app_devices where id = p_device_id and user_id = auth.uid() and platform = 'android'
$$;

create or replace function public.app_widget_clear(p_device_id uuid) returns void
language sql security definer set search_path = public as $$
  update public.app_devices set widget_secret_hash = null where id = p_device_id and user_id = auth.uid() and platform = 'android'
$$;

-- One attendance device per person across platforms: while an iPhone is active, the Android app cannot take a key.
create or replace function public.app_device_attendance_enroll(p_device_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_secret text;
begin
  if not public.has_perm('attendance.check_in') then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_device_id is null or not exists (select 1 from public.app_devices where id = p_device_id and user_id = auth.uid() and platform = 'android') then
    raise exception 'unknown device' using errcode = '22023';
  end if;
  if exists (select 1 from public.app_devices where user_id = auth.uid() and platform = 'ios_shortcuts' and attendance_secret_hash is not null) then
    raise exception 'another phone is registered' using errcode = '22023';
  end if;
  v_secret := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  update public.app_devices set attendance_secret_hash = encode(sha256(convert_to(v_secret, 'UTF8')), 'hex'), last_seen_at = now()
   where id = p_device_id and user_id = auth.uid();
  return jsonb_build_object('secret', v_secret);
end $$;

-- ───────── exposure ─────────
revoke all on function public.app_attendance_device_auth(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.app_attendance_ios_signal(uuid, text, text, numeric, numeric, numeric),
  public.app_ios_enrol_peek(text), public.app_ios_enrol_consume(text, text) from public, anon, authenticated;
grant execute on function public.app_attendance_ios_signal(uuid, text, text, numeric, numeric, numeric),
  public.app_ios_enrol_peek(text), public.app_ios_enrol_consume(text, text) to service_role;
revoke all on function
  public.mgmt_attendance_ios_enrol_create(uuid, boolean, text, uuid), public.mgmt_attendance_ios_enrol_cancel(uuid, text, uuid),
  public.mgmt_attendance_device_revoke(uuid, text, uuid), public.mgmt_attendance_ios_set(integer, integer, text, uuid),
  public.mgmt_attendance_phones(), public.mgmt_attendance_device_journal(uuid, integer)
  from public, anon, authenticated;
grant execute on function
  public.mgmt_attendance_ios_enrol_create(uuid, boolean, text, uuid), public.mgmt_attendance_ios_enrol_cancel(uuid, text, uuid),
  public.mgmt_attendance_device_revoke(uuid, text, uuid), public.mgmt_attendance_ios_set(integer, integer, text, uuid),
  public.mgmt_attendance_phones(), public.mgmt_attendance_device_journal(uuid, integer)
  to authenticated;
