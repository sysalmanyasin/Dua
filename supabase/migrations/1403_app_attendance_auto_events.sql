-- 1403_app_attendance_auto_events: the phone records arrivals and departures by itself (automatic attendance, Phase 4).
-- (Numbered in the app range, after 1401, because it adds a column to app_devices; the attendance tables it changes come from 0110-0112.)
--
-- A phone that detected "stayed inside" or "left" while Dua was closed has no web login to use (the web app's session lives inside the
-- web view, which is not running). So, like the home-screen widget (1401), it uses a per-device secret:
--   * app_device_attendance_enroll   the signed-in app asks for the device's attendance secret ONCE (stored here only as a SHA-256 hash)
--   * app_attendance_event           the Edge Function attendance-event gives the database one event; the database decides (service role only)
--   * mgmt_attendance_auto_set       the owner switches automatic recording on or off (off by default: the first phones are tested in
--                                    "test mode" and the owner turns it on deliberately)
--   * mgmt_attendance_auto_events    an append-only history of EVERY event a phone sent, with the outcome (recorded, refused or ignored)
-- The phone only reports what it saw (kind, the time, a fresh location fix with accuracy and Android's mock flag). It never decides:
--   * the distance to the place is measured here; an "in" must be inside, an "out" must be outside (the opposite of a manual check-out);
--   * the same event id is answered with the same answer and never recorded twice (a phone that did not get the answer sends it again);
--   * an event older than the last recorded event, an "in" when already in, an "out" when not in, and an event more than a day old or
--     in the future are IGNORED (kept in the history, not shown as refused attempts: they are harmless duplicates);
--   * weak GPS, a mock location, no place set, wrong side of the radius are REFUSED and shown to the owner like a manual refusal.
-- A recorded event is an ordinary row in mgmt_attendance with source 'auto' and the time the phone saw it, so every existing page,
-- summary and the night-shift handling work unchanged.

-- ───────── the owner's switch ─────────
alter table public.mgmt_attendance_config add column auto_enabled boolean not null default false;

-- ───────── a recorded row may come from the phone, and "out" may be refused because the person is still inside ─────────
alter table public.mgmt_attendance drop constraint mgmt_attendance_source_check;
alter table public.mgmt_attendance add constraint mgmt_attendance_source_check check (source in ('app', 'web', 'auto'));
alter table public.mgmt_attendance drop constraint mgmt_attendance_reject_reason_check;
alter table public.mgmt_attendance add constraint mgmt_attendance_reject_reason_check check (reject_reason is null or reject_reason in
  ('app_required', 'mock_location', 'weak_signal', 'no_place_set', 'outside', 'already_in', 'not_in', 'still_inside'));

-- ───────── the device's attendance secret ─────────
alter table public.app_devices add column attendance_secret_hash text check (attendance_secret_hash is null or attendance_secret_hash ~ '^[0-9a-f]{64}$');

-- Another person signing in on the same phone never inherits the previous person's attendance secret.
create function public.app_devices_forget_attendance_secret() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.user_id is distinct from old.user_id then new.attendance_secret_hash := null; end if;
  return new;
end $$;
create trigger app_devices_forget_attendance_secret before update of user_id on public.app_devices
  for each row execute function public.app_devices_forget_attendance_secret();

-- Called by the signed-in Android app, only when the owner switched automatic recording on. Asking again replaces the secret.
-- The secret works only for this one purpose, and is checked against the person's CURRENT right to check in on every event.
create function public.app_device_attendance_enroll(p_device_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_secret text;
begin
  if not public.has_perm('attendance.check_in') then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_device_id is null or not exists (select 1 from public.app_devices where id = p_device_id and user_id = auth.uid()) then
    raise exception 'unknown device' using errcode = '22023';
  end if;
  v_secret := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  update public.app_devices set attendance_secret_hash = encode(sha256(convert_to(v_secret, 'UTF8')), 'hex'), last_seen_at = now()
   where id = p_device_id and user_id = auth.uid();
  return jsonb_build_object('secret', v_secret);
end $$;

-- ───────── history of every event a phone sent ─────────
create table public.mgmt_attendance_auto_events (
  event_id uuid primary key,                       -- made by the phone; the same id is never processed twice
  staff_id uuid not null references public.staff(id) on delete restrict,
  device_id uuid not null,                         -- no foreign key: the history outlives the device row
  kind text not null check (kind in ('in', 'out')),
  event_at timestamptz not null,                   -- when the phone saw it (not when it arrived)
  received_at timestamptz not null default now(),
  outcome text not null check (outcome in ('accepted', 'rejected', 'ignored')),
  reason text,
  attendance_id uuid references public.mgmt_attendance(id),
  latitude numeric(9,6),
  longitude numeric(9,6),
  accuracy_m numeric(8,1),
  distance_m numeric(9,1),
  mock_location boolean,
  check ((outcome = 'accepted') = (reason is null))
);
create index mgmt_attendance_auto_events_staff_idx on public.mgmt_attendance_auto_events (staff_id, received_at desc);
create index mgmt_attendance_auto_events_device_idx on public.mgmt_attendance_auto_events (device_id, received_at desc);
create trigger mgmt_attendance_auto_events_append_only before update or delete on public.mgmt_attendance_auto_events
  for each row execute function public.mgmt_append_only();
alter table public.mgmt_attendance_auto_events enable row level security;
revoke all on public.mgmt_attendance_auto_events from public, anon, authenticated;

-- ───────── one event from a phone (called only by the Edge Function, with the service role) ─────────
-- Returns null when the device, its secret or the person's right is wrong (the function answers 401 and the phone stops sending).
-- Returns {status: 'off'} when the owner has not switched automatic recording on (nothing is stored).
-- Otherwise {status: 'accepted' | 'rejected' | 'ignored', reason, kind, at, distance_m, place}.
create function public.app_attendance_event(
  p_device_id uuid, p_secret_hash text, p_event_id uuid, p_kind text, p_at timestamptz,
  p_lat numeric, p_lng numeric, p_accuracy numeric, p_mock boolean
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  d public.app_devices;
  cfg public.mgmt_attendance_config;
  me uuid;
  prior public.mgmt_attendance_auto_events;
  v_site public.mgmt_attendance_sites;
  v_dist numeric;
  v_last public.mgmt_attendance;
  v_state text;
  v_outcome text;
  v_reason text;
  v_att uuid;
  v_day date;
  res jsonb;
begin
  select * into d from public.app_devices
   where id = p_device_id and attendance_secret_hash is not null and attendance_secret_hash = p_secret_hash;
  if not found or not public.app_user_has(d.user_id, 'attendance.check_in') then return null; end if;
  select staff_id into me from public.profiles where user_id = d.user_id;
  if me is null then return null; end if;

  if p_event_id is null or p_kind is null or p_kind not in ('in', 'out') or p_at is null
     or p_lat is null or p_lng is null or p_lat < -90 or p_lat > 90 or p_lng < -180 or p_lng > 180
     or p_accuracy is null or p_accuracy < 0 or p_accuracy > 100000 then
    raise exception 'invalid event' using errcode = '22023';
  end if;

  -- one person's events are handled one after another, so two phones or a retry can never both see "not in" and both record "in"
  perform pg_advisory_xact_lock(hashtext('attendance:' || me::text));

  -- the same event again: the same answer, nothing new recorded
  select * into prior from public.mgmt_attendance_auto_events where event_id = p_event_id;
  if found then
    if prior.staff_id <> me then return null; end if;
    return jsonb_build_object('status', prior.outcome, 'reason', prior.reason, 'kind', prior.kind, 'at', prior.event_at,
                              'distance_m', prior.distance_m, 'duplicate', true);
  end if;

  select * into cfg from public.mgmt_attendance_config;
  update public.app_devices set last_seen_at = now() where id = d.id;
  if not cfg.auto_enabled then return jsonb_build_object('status', 'off'); end if;

  select s.* into v_site from public.mgmt_attendance_sites s where s.active
   order by public.mgmt_attendance_distance_m(p_lat, p_lng, s.latitude, s.longitude) limit 1;
  if found then v_dist := public.mgmt_attendance_distance_m(p_lat, p_lng, v_site.latitude, v_site.longitude); end if;

  -- the last recorded event decides whether this one makes sense (the same 24 hours the manual check-in uses)
  select * into v_last from public.mgmt_attendance
   where staff_id = me and status = 'accepted' and at > p_at - interval '24 hours' order by at desc limit 1;
  v_state := case when v_last.kind = 'in' then 'in' else 'out' end;

  if p_at < now() - interval '24 hours' or p_at > now() + interval '5 minutes' then
    v_outcome := 'ignored'; v_reason := 'stale';
  elsif coalesce(p_mock, false) then
    v_outcome := 'rejected'; v_reason := 'mock_location';
  elsif exists (select 1 from public.mgmt_attendance where staff_id = me and status = 'accepted' and at >= p_at) then
    v_outcome := 'ignored'; v_reason := 'older';                        -- something later is already recorded (for example a manual check-out)
  elsif p_kind = 'in' and v_state = 'in' then
    v_outcome := 'ignored'; v_reason := 'already_in';
  elsif p_kind = 'out' and v_state = 'out' then
    v_outcome := 'ignored'; v_reason := 'not_in';
  elsif p_accuracy > cfg.max_accuracy_m then
    v_outcome := 'rejected'; v_reason := 'weak_signal';
  elsif v_site.id is null then
    v_outcome := 'rejected'; v_reason := 'no_place_set';
  elsif p_kind = 'in' and v_dist > v_site.radius_m then
    v_outcome := 'rejected'; v_reason := 'outside';
  elsif p_kind = 'out' and v_dist <= v_site.radius_m then
    v_outcome := 'rejected'; v_reason := 'still_inside';
  else
    v_outcome := 'accepted'; v_reason := null;
  end if;

  if v_outcome <> 'ignored' then
    v_day := (p_at at time zone 'Asia/Karachi')::date;
    insert into public.mgmt_attendance (staff_id, user_id, business_date, at, kind, status, reject_reason, site_id,
                                        latitude, longitude, accuracy_m, distance_m, mock_location, source)
    values (me, d.user_id, v_day, p_at, p_kind, v_outcome, v_reason, case when v_outcome = 'accepted' then v_site.id end,
            round(p_lat, 6), round(p_lng, 6), round(p_accuracy, 1), v_dist, coalesce(p_mock, false), 'auto')
    returning id into v_att;
  end if;

  insert into public.mgmt_attendance_auto_events (event_id, staff_id, device_id, kind, event_at, outcome, reason, attendance_id,
                                                  latitude, longitude, accuracy_m, distance_m, mock_location)
  values (p_event_id, me, d.id, p_kind, p_at, v_outcome, v_reason, v_att,
          round(p_lat, 6), round(p_lng, 6), round(p_accuracy, 1), v_dist, coalesce(p_mock, false));

  -- the owner hears about a fake location, as with a manual check-in (ids and dates only)
  if v_reason = 'mock_location' and to_regprocedure('public.notify_owner(text, jsonb)') is not null then
    perform public.notify_owner('attendance.rejected', jsonb_build_object(
      'date', v_day, 'reason', v_reason, 'dedupe_key', 'attendance.rejected:' || me::text || ':' || v_day::text || ':' || v_reason));
  end if;

  res := jsonb_build_object('status', v_outcome, 'reason', v_reason, 'kind', p_kind, 'at', p_at,
                            'distance_m', v_dist, 'place', v_site.name);
  return res;
end $$;

-- ───────── owner: switch automatic recording on or off ─────────
create function public.mgmt_attendance_auto_set(p_enabled boolean, p_reason text, p_key uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare res jsonb;
begin
  if not public.has_perm('attendance.manage') then raise exception 'not allowed' using errcode = '42501'; end if;
  res := public.mgmt_idem_get(p_key, 'attendance_auto_set');
  if res is not null then return res; end if;
  if p_reason is null or length(trim(p_reason)) < 3 then raise exception 'a reason is required' using errcode = '22023'; end if;
  if p_enabled is null then raise exception 'on or off is required' using errcode = '22023'; end if;
  update public.mgmt_attendance_config set auto_enabled = p_enabled, updated_by = auth.uid(), updated_at = now() where id;
  res := jsonb_build_object('ok', true, 'auto_enabled', p_enabled);
  perform public.mgmt_idem_put(p_key, 'attendance_auto_set', res);
  perform public.log_activity('attendance.auto_set', 'mgmt_attendance_config', 'config', null,
                              jsonb_build_object('auto_enabled', p_enabled), trim(p_reason));
  return res;
end $$;

-- ───────── owner setup and phone read now carry the switch ─────────
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
                                 'stable_seconds', cfg.stable_seconds, 'auto_enabled', cfg.auto_enabled),
    'sites', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'latitude', latitude, 'longitude', longitude,
                'radius_m', radius_m, 'active', active) order by name) from public.mgmt_attendance_sites), '[]'::jsonb));
end $$;

create or replace function public.mgmt_attendance_my_site() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid; cfg public.mgmt_attendance_config;
begin
  if not public.has_perm('attendance.check_in') then raise exception 'not allowed' using errcode = '42501'; end if;
  select staff_id into me from public.profiles where user_id = auth.uid();
  if me is null then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into cfg from public.mgmt_attendance_config;
  return jsonb_build_object(
    'stable_seconds', cfg.stable_seconds,
    'max_accuracy_m', cfg.max_accuracy_m,
    'auto_enabled', cfg.auto_enabled,
    'sites', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'latitude', s.latitude, 'longitude', s.longitude,
                'radius_m', s.radius_m) order by s.name)
              from (select * from public.mgmt_attendance_sites where active order by name limit 5) s), '[]'::jsonb));
end $$;

-- ───────── exposure ─────────
revoke all on function public.app_device_attendance_enroll(uuid), public.mgmt_attendance_auto_set(boolean, text, uuid) from public, anon, authenticated;
grant execute on function public.app_device_attendance_enroll(uuid), public.mgmt_attendance_auto_set(boolean, text, uuid) to authenticated;
revoke all on function public.app_attendance_event(uuid, text, uuid, text, timestamptz, numeric, numeric, numeric, boolean) from public, anon, authenticated;
grant execute on function public.app_attendance_event(uuid, text, uuid, text, timestamptz, numeric, numeric, numeric, boolean) to service_role;
