-- 1404_app_attendance_health: the owner finds out when a staff phone stops tracking (automatic attendance, Phase 6).
-- (App range, after 1403, because it adds columns to app_devices.)
--
-- Staff cannot be stopped from switching location off or restricting Dua in Android, and no app can prevent that on a personal phone.
-- What this migration guarantees is that it can never happen SILENTLY:
--   * app_attendance_health   the phone reports its own tracking state every 15 minutes with the same device secret as the events
--                             (Edge Function attendance-health, service role only). A change is written to an append-only log,
--                             and the owner is alerted when tracking goes off.
--   * attendance_health_check a scheduled check (every 15 minutes) for the two things a phone cannot report itself:
--                               - a phone that stopped reporting (force-stop, uninstall, sign-out, switched off): "silent"
--                               - a check-in that is still open after 14 hours: "forgotten check-out"
--   * mgmt_attendance_health  the owner's list: who is at work now, and the tracking state of each person's phone
--   * mgmt_attendance_gaps    the periods when a person's phone was not tracking, so a gap is never mistaken for "no events"
-- Alerts carry ids and dates only, never a name (the push goes through a public server). Nothing here records a location.

alter table public.app_devices
  add column health_state text check (health_state is null or health_state in
    ('ok', 'no_precise_location', 'location_off', 'no_background_location', 'background_restricted', 'not_registered', 'silent')),
  add column health_at timestamptz,
  add column health_pending integer check (health_pending is null or health_pending between 0 and 1000);

-- ───────── history of tracking changes (append-only) ─────────
create table public.mgmt_attendance_tracking_log (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id) on delete restrict,
  device_id uuid not null references public.app_devices(id) on delete cascade,
  at timestamptz not null default clock_timestamp(),   -- the real moment, so changes inside one transaction still keep their order
  state text not null check (state in
    ('ok', 'no_precise_location', 'location_off', 'no_background_location', 'background_restricted', 'not_registered', 'silent'))
);
create index mgmt_attendance_tracking_log_staff_idx on public.mgmt_attendance_tracking_log (staff_id, at desc);
create trigger mgmt_attendance_tracking_log_append_only before update or delete on public.mgmt_attendance_tracking_log
  for each row execute function public.mgmt_append_only();
alter table public.mgmt_attendance_tracking_log enable row level security;
revoke all on public.mgmt_attendance_tracking_log from public, anon, authenticated;
grant all on public.mgmt_attendance_tracking_log to service_role;

-- ───────── the phone reports its state (service role only; called by the Edge Function attendance-health) ─────────
-- p_state: null or 'ok' when everything works, otherwise the problem the phone found. Wrong device, wrong secret and a lost right all
-- return null (the same answer, so nothing can be probed). The state is always stored, so the owner sees a phone being tested before
-- recording is switched on; history and alerts start only once the owner has switched recording on.
create function public.app_attendance_health(p_device_id uuid, p_secret_hash text, p_state text, p_pending integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  d public.app_devices; me uuid; cfg public.mgmt_attendance_config; v_new text; v_prev text; v_day date;
begin
  select * into d from public.app_devices
   where id = p_device_id and attendance_secret_hash is not null and attendance_secret_hash = p_secret_hash;
  if not found or not public.app_user_has(d.user_id, 'attendance.check_in') then return null; end if;
  select staff_id into me from public.profiles where user_id = d.user_id;
  if me is null then return null; end if;

  v_new := coalesce(p_state, 'ok');
  if v_new not in ('ok', 'no_precise_location', 'location_off', 'no_background_location', 'background_restricted', 'not_registered')
     or p_pending is null or p_pending < 0 or p_pending > 1000 then
    raise exception 'invalid health report' using errcode = '22023';
  end if;

  select * into cfg from public.mgmt_attendance_config;
  perform pg_advisory_xact_lock(hashtext('attendance-health:' || d.id::text));
  select health_state into v_prev from public.app_devices where id = d.id;
  update public.app_devices set health_state = v_new, health_at = now(), health_pending = p_pending, last_seen_at = now() where id = d.id;

  if cfg.auto_enabled and v_prev is distinct from v_new and not (v_prev is null and v_new = 'ok') then
    insert into public.mgmt_attendance_tracking_log (staff_id, device_id, state) values (me, d.id, v_new);
    if v_new <> 'ok' and to_regprocedure('public.notify_owner(text, jsonb)') is not null then
      v_day := (now() at time zone 'Asia/Karachi')::date;
      perform public.notify_owner('attendance.tracking_off', jsonb_build_object(
        'date', v_day, 'dedupe_key', 'attendance.tracking_off:' || me::text || ':' || v_new || ':' || v_day::text));
    end if;
  end if;
  return jsonb_build_object('status', case when cfg.auto_enabled then 'on' else 'off' end);
end $$;

-- ───────── scheduled check: silent phones, tracking still off, forgotten check-outs ─────────
-- p_now is only for tests. Silent phones are looked for between 07:00 and 22:00 in Pakistan (a phone switched off at night is normal)
-- and only for phones that have reported at least once (an older app that cannot report is shown to the owner as "no report", not as silent).
create function public.attendance_health_check(p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  cfg public.mgmt_attendance_config; r record; v_silent integer := 0; v_off integer := 0; v_open integer := 0;
  v_day date := (p_now at time zone 'Asia/Karachi')::date;
  v_hour integer := extract(hour from (p_now at time zone 'Asia/Karachi'));
begin
  select * into cfg from public.mgmt_attendance_config;

  -- a check-in still open after 14 hours: someone forgot to check out (works for manual and automatic check-ins)
  for r in
    select distinct on (a.staff_id) a.id, a.staff_id, a.kind, a.at from public.mgmt_attendance a
     where a.status = 'accepted' order by a.staff_id, a.at desc
  loop
    if r.kind = 'in' and r.at < p_now - interval '14 hours' and to_regprocedure('public.notify_owner(text, jsonb)') is not null then
      if public.notify_owner('attendance.checkout_missed', jsonb_build_object(
           'date', (r.at at time zone 'Asia/Karachi')::date, 'dedupe_key', 'attendance.checkout_missed:' || r.id::text)) is not null then
        v_open := v_open + 1;
      end if;
    end if;
  end loop;

  if cfg.auto_enabled then
    -- a phone that has gone quiet for an hour
    if v_hour between 7 and 21 then
      for r in
        select d.id, d.user_id, pr.staff_id from public.app_devices d join public.profiles pr on pr.user_id = d.user_id
         where d.attendance_secret_hash is not null and d.health_at is not null and d.health_state is distinct from 'silent'
           and greatest(d.health_at, d.last_seen_at) < p_now - interval '60 minutes'
           and public.app_user_has(d.user_id, 'attendance.check_in')
      loop
        update public.app_devices set health_state = 'silent' where id = r.id;
        insert into public.mgmt_attendance_tracking_log (staff_id, device_id, at, state) values (r.staff_id, r.id, p_now, 'silent');
        if to_regprocedure('public.notify_owner(text, jsonb)') is not null then
          perform public.notify_owner('attendance.tracking_off', jsonb_build_object(
            'date', v_day, 'dedupe_key', 'attendance.tracking_off:' || r.staff_id::text || ':silent:' || v_day::text));
        end if;
        v_silent := v_silent + 1;
      end loop;
    end if;
    -- tracking that is still off (the first alert may have been acknowledged): remind once a day
    for r in
      select d.id, pr.staff_id, d.health_state from public.app_devices d join public.profiles pr on pr.user_id = d.user_id
       where d.attendance_secret_hash is not null and d.health_state is not null and d.health_state <> 'ok'
         and public.app_user_has(d.user_id, 'attendance.check_in')
    loop
      if to_regprocedure('public.notify_owner(text, jsonb)') is not null
         and public.notify_owner('attendance.tracking_off', jsonb_build_object(
               'date', v_day, 'dedupe_key', 'attendance.tracking_off:' || r.staff_id::text || ':' || r.health_state || ':' || v_day::text)) is not null then
        v_off := v_off + 1;
      end if;
    end loop;
  end if;
  return jsonb_build_object('silent', v_silent, 'still_off', v_off, 'checkout_missed', v_open);
end $$;

-- ───────── owner: who is at work, and how each phone is doing ─────────
create function public.mgmt_attendance_health() returns jsonb
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
               'state', d.health_state, 'reported_at', d.health_at, 'pending', d.health_pending,
               'app_version', d.app_version, 'seen_at', d.last_seen_at) end as phone
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

-- ───────── owner: the periods when a phone was not tracking ─────────
-- One row per period, newest first. "to" is null while the problem is still there. Only periods while recording was on are known.
create function public.mgmt_attendance_gaps(p_staff uuid, p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_to date := coalesce(p_to, (now() at time zone 'Asia/Karachi')::date);
        v_from date := coalesce(p_from, v_to);
begin
  if not public.has_perm('attendance.view_all') then raise exception 'not allowed' using errcode = '42501'; end if;
  if v_from < v_to - 62 then v_from := v_to - 62; end if;
  return coalesce((select jsonb_agg(g order by g.from_at desc) from (
    select x.staff_id, s.full_name as name, x.state, x.at as from_at, x.next_at as to_at
      from (select l.staff_id, l.state, l.at, lead(l.at) over (partition by l.device_id order by l.at) as next_at
              from public.mgmt_attendance_tracking_log l
             where l.at >= (v_from::timestamp at time zone 'Asia/Karachi') - interval '30 days'
               and (p_staff is null or l.staff_id = p_staff)) x
      join public.staff s on s.id = x.staff_id
     where x.state <> 'ok'
       and x.at < ((v_to + 1)::timestamp at time zone 'Asia/Karachi')
       and (x.next_at is null or x.next_at >= (v_from::timestamp at time zone 'Asia/Karachi'))
     order by x.at desc limit 200) g), '[]'::jsonb);
end $$;

-- ───────── exposure ─────────
revoke all on function public.app_attendance_health(uuid, text, text, integer), public.attendance_health_check(timestamptz),
  public.mgmt_attendance_health(), public.mgmt_attendance_gaps(uuid, date, date) from public, anon, authenticated;
grant execute on function public.app_attendance_health(uuid, text, text, integer), public.attendance_health_check(timestamptz) to service_role;
grant execute on function public.mgmt_attendance_health(), public.mgmt_attendance_gaps(uuid, date, date) to authenticated;

-- every 15 minutes. Skipped where pg_cron is missing (CI, a restored test project); no secret.
do $cron$
begin
  begin
    if exists (select 1 from pg_available_extensions where name = 'pg_cron') then create extension if not exists pg_cron; end if;
  exception when others then
    raise notice 'could not enable pg_cron here: %', sqlerrm;
  end;
  if to_regclass('cron.job') is null then
    raise notice 'pg_cron not available: attendance health schedule skipped';
  elsif not exists (select 1 from cron.job where jobname = 'attendance-health-check') then
    perform cron.schedule('attendance-health-check', '*/15 * * * *', 'select public.attendance_health_check()');
  end if;
end $cron$;
