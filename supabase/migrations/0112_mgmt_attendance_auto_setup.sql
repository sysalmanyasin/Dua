-- 0112_mgmt_attendance_auto_setup: what a staff phone needs to watch the pharmacy by itself (automatic attendance, Phase 3).
--   * stable_seconds              how long a person must stay inside (or outside) before the phone counts it (default 120 s)
--   * mgmt_attendance_stable_set  the owner changes it (reason required, logged, idempotent), like the other limits
--   * mgmt_attendance_my_site     a staff member's phone reads the ACTIVE places and the stability period so it can register its
--                                 geofence. Staff cannot use mgmt_attendance_setup (owner only), so this is the narrow read for them.
--   * mgmt_attendance_setup       now also reports stable_seconds (same signature, same grants)
-- Nothing here records an attendance event. 0110 and 0111 are unchanged apart from setup() carrying one more field.

alter table public.mgmt_attendance_config
  add column stable_seconds integer not null default 120 check (stable_seconds between 30 and 600);

-- ───────── owner: places and limits (adds stable_seconds to the answer) ─────────
create or replace function public.mgmt_attendance_setup() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare cfg public.mgmt_attendance_config;
begin
  if not (public.has_perm('attendance.manage') or public.has_perm('attendance.view_all')) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into cfg from public.mgmt_attendance_config;
  return jsonb_build_object(
    'config', jsonb_build_object('max_accuracy_m', cfg.max_accuracy_m, 'require_app', cfg.require_app, 'stable_seconds', cfg.stable_seconds),
    'sites', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'latitude', latitude, 'longitude', longitude,
                'radius_m', radius_m, 'active', active) order by name) from public.mgmt_attendance_sites), '[]'::jsonb));
end $$;

-- ───────── owner: the stability period ─────────
create function public.mgmt_attendance_stable_set(p_seconds integer, p_reason text, p_key uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare res jsonb;
begin
  if not public.has_perm('attendance.manage') then raise exception 'not allowed' using errcode = '42501'; end if;
  res := public.mgmt_idem_get(p_key, 'attendance_stable_set');
  if res is not null then return res; end if;
  if p_reason is null or length(trim(p_reason)) < 3 then raise exception 'a reason is required' using errcode = '22023'; end if;
  if p_seconds is null or p_seconds < 30 or p_seconds > 600 then raise exception 'the stability period must be 30 to 600 seconds' using errcode = '22023'; end if;
  update public.mgmt_attendance_config set stable_seconds = p_seconds, updated_by = auth.uid(), updated_at = now() where id;
  res := jsonb_build_object('ok', true, 'stable_seconds', p_seconds);
  perform public.mgmt_idem_put(p_key, 'attendance_stable_set', res);
  perform public.log_activity('attendance.stable_set', 'mgmt_attendance_config', 'config', null,
                              jsonb_build_object('stable_seconds', p_seconds), trim(p_reason));
  return res;
end $$;

-- ───────── staff phone: what to watch ─────────
-- Only active places, only what the phone needs to draw a circle. No name of any other person, nothing from the records.
create function public.mgmt_attendance_my_site() returns jsonb
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
    'sites', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'latitude', s.latitude, 'longitude', s.longitude,
                'radius_m', s.radius_m) order by s.name)
              from (select * from public.mgmt_attendance_sites where active order by name limit 5) s), '[]'::jsonb));
end $$;

-- ───────── exposure ─────────
revoke all on function public.mgmt_attendance_stable_set(integer, text, uuid), public.mgmt_attendance_my_site() from public, anon, authenticated;
grant execute on function public.mgmt_attendance_stable_set(integer, text, uuid), public.mgmt_attendance_my_site() to authenticated;
