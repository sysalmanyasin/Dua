-- 0110_mgmt_attendance: geo-fenced check-in / check-out (Manager range 0100-0199; docs/MODULES.md §8.3).
-- Staff phones WRITE their own check-in events while the rest of Manager is owner-only, so attendance has its own permissions
-- and its own narrow functions. Nothing here gives a staff member any mgmt.* or credit.* permission.
--
-- Every check is decided by the database, never by the phone:
--   * the distance to the nearest active place is computed here from the coordinates the phone sends,
--   * weak GPS (accuracy worse than the limit), a mock-location flag, and a check-in from the website (when the app is required) are refused,
--   * in / out must alternate (a forgotten "out" stops blocking after 24 hours).
-- A refused attempt is KEPT as a row (status 'rejected', with the reason) so the owner can see it. Rows are append-only (D-12).
-- The places, the accuracy limit and "app required" are settings the owner changes from the web page: no new APK is needed.
--
-- Honest limit: the phone reports its own location and its own "mock" flag. This stops the casual cases (standing outside the
-- shop, a fake-GPS app that Android flags). A determined person with a rooted phone is not stopped; that needs Play Integrity.

insert into public.permissions (key, description) values
 ('attendance.check_in', 'Check in and out at the pharmacy (own record only; location is checked by the server)'),
 ('attendance.view_all', 'See every person''s attendance records, including refused attempts (owner)'),
 ('attendance.manage', 'Set the attendance places, the GPS accuracy limit and whether the app is required (owner)');

-- No role preset carries any attendance permission (the contract adds presets only with the owner's approval, and the core
-- tests pin them). The owner switches check-in on for each person in Users & Access ("Allow"); that person's Android app and the
-- web page then show the Attendance tab. To make it a role default later, add a role_permissions row in a new migration.

-- ───────── places (geofence) ─────────
create table public.mgmt_attendance_sites (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 2 and 60),
  latitude numeric(9,6) not null check (latitude between -90 and 90),
  longitude numeric(9,6) not null check (longitude between -180 and 180),
  radius_m integer not null check (radius_m between 20 and 2000),
  active boolean not null default true,
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger mgmt_attendance_sites_updated before update on public.mgmt_attendance_sites
  for each row execute function public.set_updated_at();
alter table public.mgmt_attendance_sites enable row level security;

-- One row of limits.
create table public.mgmt_attendance_config (
  id boolean primary key default true check (id),
  max_accuracy_m integer not null default 100 check (max_accuracy_m between 10 and 500),
  require_app boolean not null default true,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);
insert into public.mgmt_attendance_config (id) values (true);
alter table public.mgmt_attendance_config enable row level security;

-- ───────── events (append-only) ─────────
create table public.mgmt_attendance (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id) on delete restrict,
  user_id uuid references auth.users(id),
  business_date date not null,
  at timestamptz not null default now(),
  kind text not null check (kind in ('in', 'out')),
  status text not null check (status in ('accepted', 'rejected')),
  reject_reason text check (reject_reason is null or reject_reason in
    ('app_required', 'mock_location', 'weak_signal', 'no_place_set', 'outside', 'already_in', 'not_in')),
  site_id uuid references public.mgmt_attendance_sites(id) on delete restrict,
  latitude numeric(9,6),
  longitude numeric(9,6),
  accuracy_m numeric(8,1),
  distance_m numeric(9,1),
  mock_location boolean,
  source text not null check (source in ('app', 'web')),
  check ((status = 'accepted') = (reject_reason is null))
);
create index mgmt_attendance_staff_at_idx on public.mgmt_attendance (staff_id, at desc);
create index mgmt_attendance_day_idx on public.mgmt_attendance (business_date);
create trigger mgmt_attendance_append_only before update or delete on public.mgmt_attendance
  for each row execute function public.mgmt_append_only();
alter table public.mgmt_attendance enable row level security;
-- No policy and no grant on any of the three tables: every read and write is one of the functions below.
revoke all on public.mgmt_attendance_sites, public.mgmt_attendance_config, public.mgmt_attendance from public, anon, authenticated;

-- ───────── distance (metres, great-circle). Internal: not callable by clients. ─────────
create function public.mgmt_attendance_distance_m(p_lat1 numeric, p_lng1 numeric, p_lat2 numeric, p_lng2 numeric) returns numeric
language sql immutable parallel safe set search_path = public as $$
  select round((2 * 6371000 * asin(least(1::float8, sqrt(
      power(sin(radians((p_lat2 - p_lat1)::float8) / 2), 2)
    + cos(radians(p_lat1::float8)) * cos(radians(p_lat2::float8)) * power(sin(radians((p_lng2 - p_lng1)::float8) / 2), 2)
  ))))::numeric, 1)
$$;

-- ───────── check in / out (staff, own record only) ─────────
create function public.mgmt_attendance_check_in(
  p_kind text, p_lat numeric, p_lng numeric, p_accuracy numeric, p_mock boolean, p_source text, p_key uuid
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid;
  cfg public.mgmt_attendance_config;
  res jsonb;
  v_site public.mgmt_attendance_sites;
  v_dist numeric;
  v_last text;
  v_reason text;
  v_id uuid;
  v_at timestamptz := clock_timestamp();  -- not now(): two calls in one transaction must still be ordered
  v_day date := (now() at time zone 'Asia/Karachi')::date;
begin
  if not public.has_perm('attendance.check_in') then raise exception 'not allowed' using errcode = '42501'; end if;
  res := public.mgmt_idem_get(p_key, 'attendance_check_in');
  if res is not null then return res; end if;
  if p_kind is null or p_kind not in ('in', 'out') or p_source is null or p_source not in ('app', 'web')
     or p_lat is null or p_lng is null or p_lat < -90 or p_lat > 90 or p_lng < -180 or p_lng > 180
     or p_accuracy is null or p_accuracy < 0 or p_accuracy > 100000 then
    raise exception 'invalid check-in' using errcode = '22023';
  end if;

  select staff_id into me from public.profiles where user_id = auth.uid();
  if me is null then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into cfg from public.mgmt_attendance_config;

  select s.* into v_site from public.mgmt_attendance_sites s where s.active
   order by public.mgmt_attendance_distance_m(p_lat, p_lng, s.latitude, s.longitude) limit 1;
  if found then v_dist := public.mgmt_attendance_distance_m(p_lat, p_lng, v_site.latitude, v_site.longitude); end if;

  -- the last ACCEPTED event in the last 24 hours decides whether this one makes sense (night shifts cross midnight)
  select kind into v_last from public.mgmt_attendance
   where staff_id = me and status = 'accepted' and at > v_at - interval '24 hours' order by at desc limit 1;

  v_reason := case
    when cfg.require_app and p_source <> 'app' then 'app_required'
    when coalesce(p_mock, false) then 'mock_location'
    when p_accuracy > cfg.max_accuracy_m then 'weak_signal'
    when v_site.id is null then 'no_place_set'
    when v_dist > v_site.radius_m then 'outside'
    when p_kind = 'in' and v_last = 'in' then 'already_in'
    when p_kind = 'out' and v_last is distinct from 'in' then 'not_in'
    else null end;

  insert into public.mgmt_attendance (staff_id, user_id, business_date, at, kind, status, reject_reason, site_id,
                                      latitude, longitude, accuracy_m, distance_m, mock_location, source)
  values (me, auth.uid(), v_day, v_at, p_kind, case when v_reason is null then 'accepted' else 'rejected' end, v_reason,
          case when v_reason is null then v_site.id end, round(p_lat, 6), round(p_lng, 6), round(p_accuracy, 1), v_dist,
          coalesce(p_mock, false), p_source)
  returning id into v_id;

  res := jsonb_build_object('ok', v_reason is null, 'reason', v_reason, 'kind', p_kind, 'at', v_at, 'id', v_id,
                            'distance_m', v_dist, 'place', v_site.name, 'radius_m', v_site.radius_m);
  perform public.mgmt_idem_put(p_key, 'attendance_check_in', res);
  perform public.log_activity('attendance.' || case when v_reason is null then 'accepted' else 'rejected' end,
                              'mgmt_attendance', v_id::text, null, jsonb_build_object('kind', p_kind, 'reason', v_reason), null);

  -- The owner hears about attempts that look like cheating. Ids and dates only (no names, no places).
  if v_reason in ('mock_location', 'outside') and to_regprocedure('public.notify_owner(text, jsonb)') is not null then
    perform public.notify_owner('attendance.rejected', jsonb_build_object(
      'date', v_day, 'reason', v_reason, 'dedupe_key', 'attendance.rejected:' || me::text || ':' || v_day::text || ':' || v_reason));
  end if;
  return res;
end $$;

-- ───────── what the check-in screen needs (own record only) ─────────
create function public.mgmt_attendance_today() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid; cfg public.mgmt_attendance_config; v_last text;
begin
  if not public.has_perm('attendance.check_in') then raise exception 'not allowed' using errcode = '42501'; end if;
  select staff_id into me from public.profiles where user_id = auth.uid();
  if me is null then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into cfg from public.mgmt_attendance_config;
  select kind into v_last from public.mgmt_attendance
   where staff_id = me and status = 'accepted' and at > now() - interval '24 hours' order by at desc limit 1;
  return jsonb_build_object(
    'state', case when v_last = 'in' then 'in' else 'out' end,
    'has_place', exists (select 1 from public.mgmt_attendance_sites where active),
    'require_app', cfg.require_app,
    'max_accuracy_m', cfg.max_accuracy_m,
    'events', coalesce((select jsonb_agg(e order by e.at desc) from (
        select kind, status, reject_reason as reason, at, distance_m from public.mgmt_attendance
         where staff_id = me and at > now() - interval '24 hours' order by at desc limit 20) e), '[]'::jsonb));
end $$;

-- ───────── owner: records ─────────
create function public.mgmt_attendance_list(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_to date := coalesce(p_to, (now() at time zone 'Asia/Karachi')::date);
        v_from date := coalesce(p_from, coalesce(p_to, (now() at time zone 'Asia/Karachi')::date));
begin
  if not public.has_perm('attendance.view_all') then raise exception 'not allowed' using errcode = '42501'; end if;
  if v_from < v_to - 62 then v_from := v_to - 62; end if;
  return coalesce((select jsonb_agg(r order by r.at desc) from (
    select a.id, a.staff_id, s.full_name as name, a.business_date, a.at, a.kind, a.status, a.reject_reason as reason,
           a.distance_m, a.accuracy_m, a.mock_location as mock, a.source, p.name as place
      from public.mgmt_attendance a
      join public.staff s on s.id = a.staff_id
      left join public.mgmt_attendance_sites p on p.id = a.site_id
     where a.business_date between v_from and v_to
     order by a.at desc limit 2000) r), '[]'::jsonb);
end $$;

-- ───────── owner: places and limits ─────────
create function public.mgmt_attendance_setup() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare cfg public.mgmt_attendance_config;
begin
  if not (public.has_perm('attendance.manage') or public.has_perm('attendance.view_all')) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into cfg from public.mgmt_attendance_config;
  return jsonb_build_object(
    'config', jsonb_build_object('max_accuracy_m', cfg.max_accuracy_m, 'require_app', cfg.require_app),
    'sites', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'latitude', latitude, 'longitude', longitude,
                'radius_m', radius_m, 'active', active) order by name) from public.mgmt_attendance_sites), '[]'::jsonb));
end $$;

create function public.mgmt_attendance_site_save(
  p_id uuid, p_name text, p_lat numeric, p_lng numeric, p_radius integer, p_active boolean, p_reason text, p_key uuid
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare res jsonb; v_id uuid := p_id;
begin
  if not public.has_perm('attendance.manage') then raise exception 'not allowed' using errcode = '42501'; end if;
  res := public.mgmt_idem_get(p_key, 'attendance_site_save');
  if res is not null then return res; end if;
  if p_reason is null or length(trim(p_reason)) < 3 then raise exception 'a reason is required' using errcode = '22023'; end if;
  if p_id is null then
    insert into public.mgmt_attendance_sites (name, latitude, longitude, radius_m, active, updated_by)
    values (trim(p_name), p_lat, p_lng, p_radius, coalesce(p_active, true), auth.uid()) returning id into v_id;
  else
    update public.mgmt_attendance_sites set name = trim(p_name), latitude = p_lat, longitude = p_lng, radius_m = p_radius,
           active = coalesce(p_active, active), updated_by = auth.uid() where id = p_id;
    if not found then raise exception 'unknown place' using errcode = '22023'; end if;
  end if;
  res := jsonb_build_object('id', v_id);
  perform public.mgmt_idem_put(p_key, 'attendance_site_save', res);
  perform public.log_activity('attendance.place_saved', 'mgmt_attendance_sites', v_id::text, null,
                              jsonb_build_object('radius_m', p_radius, 'active', coalesce(p_active, true)), trim(p_reason));
  return res;
end $$;

create function public.mgmt_attendance_config_set(p_max_accuracy integer, p_require_app boolean, p_reason text, p_key uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare res jsonb;
begin
  if not public.has_perm('attendance.manage') then raise exception 'not allowed' using errcode = '42501'; end if;
  res := public.mgmt_idem_get(p_key, 'attendance_config_set');
  if res is not null then return res; end if;
  if p_reason is null or length(trim(p_reason)) < 3 then raise exception 'a reason is required' using errcode = '22023'; end if;
  update public.mgmt_attendance_config set max_accuracy_m = p_max_accuracy, require_app = coalesce(p_require_app, require_app),
         updated_by = auth.uid(), updated_at = now() where id;
  res := jsonb_build_object('ok', true);
  perform public.mgmt_idem_put(p_key, 'attendance_config_set', res);
  perform public.log_activity('attendance.config_set', 'mgmt_attendance_config', 'config', null,
                              jsonb_build_object('max_accuracy_m', p_max_accuracy, 'require_app', p_require_app), trim(p_reason));
  return res;
end $$;

-- ───────── exposure: internal helper is not callable; the six functions are the whole client surface ─────────
revoke all on function public.mgmt_attendance_distance_m(numeric, numeric, numeric, numeric) from public, anon, authenticated;
revoke all on function
  public.mgmt_attendance_check_in(text, numeric, numeric, numeric, boolean, text, uuid),
  public.mgmt_attendance_today(),
  public.mgmt_attendance_list(date, date),
  public.mgmt_attendance_setup(),
  public.mgmt_attendance_site_save(uuid, text, numeric, numeric, integer, boolean, text, uuid),
  public.mgmt_attendance_config_set(integer, boolean, text, uuid)
  from public, anon, authenticated;
grant execute on function
  public.mgmt_attendance_check_in(text, numeric, numeric, numeric, boolean, text, uuid),
  public.mgmt_attendance_today(),
  public.mgmt_attendance_list(date, date),
  public.mgmt_attendance_setup(),
  public.mgmt_attendance_site_save(uuid, text, numeric, numeric, integer, boolean, text, uuid),
  public.mgmt_attendance_config_set(integer, boolean, text, uuid)
  to authenticated;
