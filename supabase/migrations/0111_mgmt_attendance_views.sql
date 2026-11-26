-- 0111_mgmt_attendance_views: read-only views of attendance history (Manager range 0100-0199).
--   * mgmt_attendance_my_history  a staff member's OWN days and events for a date range (attendance.check_in)
--   * mgmt_attendance_summary     the owner's one-line-per-person-per-day summary for a date range (attendance.view_all)
-- Nothing here writes a row and nothing changes 0110. Both functions share one internal day calculation so the staff screen and
-- the owner screen can never disagree. Rows stay append-only (0110); a refused attempt is counted, never hidden.
--
-- How a day is worked out (business date = Pakistan time, D-08):
--   first_in       the first accepted "in" of the day
--   worked_minutes whole minutes of every accepted "in" that was closed by the NEXT accepted event being an "out"
--                  (a night shift is counted on the day it STARTED, even though the "out" is after midnight)
--   last_out       the "out" that closed the last of those pairs
--   is_open        the person's last accepted event is an "in" that has not been closed yet (still at work, or a forgotten out)
--   refused        refused attempts that day (rows with status 'rejected')

-- ───────── internal: one row per person per day (not callable by clients) ─────────
create function public.mgmt_attendance_days(p_staff uuid, p_from date, p_to date)
returns table (staff_id uuid, business_date date, first_in timestamptz, last_out timestamptz,
               worked_minutes integer, accepted integer, refused integer, is_open boolean)
language sql stable security definer set search_path = public as $$
  with acc as (
    -- one day either side, so an "out" just after midnight can close an "in" from the day before
    select a.staff_id, a.business_date, a.at, a.kind,
           lead(a.kind) over w as next_kind, lead(a.at) over w as next_at,
           lag(a.kind) over w as prev_kind, lag(a.business_date) over w as prev_date
      from public.mgmt_attendance a
     where a.status = 'accepted'
       and a.business_date between p_from - 1 and p_to + 1
       and (p_staff is null or a.staff_id = p_staff)
    window w as (partition by a.staff_id order by a.at)
  ), owned as (
    -- an "out" after midnight belongs to the day its "in" started on (no stray row for the next day)
    select acc.*, case when acc.kind = 'out' and acc.prev_kind = 'in' and acc.prev_date < acc.business_date
                       then acc.prev_date else acc.business_date end as owner_day
      from acc
  ), acc_day as (
    select x.staff_id, x.owner_day as business_date,
           min(x.at) filter (where x.kind = 'in') as first_in,
           max(x.next_at) filter (where x.kind = 'in' and x.next_kind = 'out') as last_out,
           coalesce(sum(floor(extract(epoch from (x.next_at - x.at)) / 60))
                    filter (where x.kind = 'in' and x.next_kind = 'out'), 0)::integer as worked_minutes,
           count(*)::integer as accepted,
           coalesce(bool_or(x.kind = 'in' and x.next_kind is null), false) as is_open
      from owned x
     where x.owner_day between p_from and p_to
     group by x.staff_id, x.owner_day
  ), rej as (
    select r.staff_id, r.business_date, count(*)::integer as refused
      from public.mgmt_attendance r
     where r.status = 'rejected' and r.business_date between p_from and p_to
       and (p_staff is null or r.staff_id = p_staff)
     group by r.staff_id, r.business_date
  )
  select coalesce(d.staff_id, r.staff_id), coalesce(d.business_date, r.business_date),
         d.first_in, d.last_out, coalesce(d.worked_minutes, 0), coalesce(d.accepted, 0), coalesce(r.refused, 0),
         coalesce(d.is_open, false)
    from acc_day d
    full join rej r on r.staff_id = d.staff_id and r.business_date = d.business_date
$$;

-- ───────── a person's own history ─────────
create function public.mgmt_attendance_my_history(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  me uuid;
  v_today date := (now() at time zone 'Asia/Karachi')::date;
  v_to date := coalesce(p_to, (now() at time zone 'Asia/Karachi')::date);
  v_from date;
begin
  if not public.has_perm('attendance.check_in') then raise exception 'not allowed' using errcode = '42501'; end if;
  select staff_id into me from public.profiles where user_id = auth.uid();
  if me is null then raise exception 'not allowed' using errcode = '42501'; end if;
  if v_to > v_today then v_to := v_today; end if;
  v_from := coalesce(p_from, v_to - 30);
  if v_from < v_to - 62 then v_from := v_to - 62; end if;   -- at most about two months in one call
  if v_from > v_to then v_from := v_to; end if;

  return jsonb_build_object(
    'from', v_from, 'to', v_to,
    'days', coalesce((select jsonb_agg(jsonb_build_object(
                'date', d.business_date, 'first_in', d.first_in, 'last_out', d.last_out, 'worked_minutes', d.worked_minutes,
                'accepted', d.accepted, 'refused', d.refused, 'open', d.is_open) order by d.business_date desc)
              from public.mgmt_attendance_days(me, v_from, v_to) d), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(e order by e.at desc) from (
                select a.business_date as date, a.at, a.kind, a.status, a.reject_reason as reason, a.distance_m, a.source
                  from public.mgmt_attendance a
                 where a.staff_id = me and a.business_date between v_from and v_to
                 order by a.at desc limit 500) e), '[]'::jsonb));
end $$;

-- ───────── the owner's daily summary ─────────
create function public.mgmt_attendance_summary(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_to date := coalesce(p_to, (now() at time zone 'Asia/Karachi')::date);
  v_from date;
begin
  if not public.has_perm('attendance.view_all') then raise exception 'not allowed' using errcode = '42501'; end if;
  v_from := coalesce(p_from, v_to);
  if v_from < v_to - 62 then v_from := v_to - 62; end if;
  if v_from > v_to then v_from := v_to; end if;

  return jsonb_build_object(
    'from', v_from, 'to', v_to,
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
                'staff_id', d.staff_id, 'name', s.full_name, 'date', d.business_date, 'first_in', d.first_in, 'last_out', d.last_out,
                'worked_minutes', d.worked_minutes, 'accepted', d.accepted, 'refused', d.refused, 'open', d.is_open)
                order by d.business_date desc, s.full_name)
              from public.mgmt_attendance_days(null, v_from, v_to) d
              join public.staff s on s.id = d.staff_id), '[]'::jsonb));
end $$;

-- ───────── exposure ─────────
revoke all on function public.mgmt_attendance_days(uuid, date, date) from public, anon, authenticated;
revoke all on function public.mgmt_attendance_my_history(date, date), public.mgmt_attendance_summary(date, date)
  from public, anon, authenticated;
grant execute on function public.mgmt_attendance_my_history(date, date), public.mgmt_attendance_summary(date, date) to authenticated;
