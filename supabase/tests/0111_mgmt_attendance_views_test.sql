-- Tests for 0111_mgmt_attendance_views: a person sees only their own history, the owner sees everyone, the day maths is right,
-- and nothing new is callable by anon or by the wrong person.
\set ON_ERROR_STOP on
begin;
create function pg_temp.as_user(uid uuid, lvl text default 'aal1') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'aal', lvl, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; raise notice 'pass: %', msg; end $$;
create function pg_temp.fails(stmt text, msg text) returns void language plpgsql as $$
begin
  begin execute stmt; exception when others then raise notice 'pass: % (%)', msg, sqlerrm; return; end;
  raise exception 'FAIL: % (it was allowed)', msg;
end $$;

insert into auth.users(id, email) values ('00000000-0000-0000-0000-0000000000a1','a@t'),('00000000-0000-0000-0000-0000000000b1','j@t'),('00000000-0000-0000-0000-0000000000c1','s@t');
select public.bootstrap_first_admin('00000000-0000-0000-0000-0000000000a1','owner','Test Owner');
insert into public.staff(id, full_name) values ('10000000-0000-0000-0000-000000000001','Junior One'),('10000000-0000-0000-0000-000000000002','Senior Two');
insert into public.profiles(user_id, staff_id, username, role_template) values
  ('00000000-0000-0000-0000-0000000000b1','10000000-0000-0000-0000-000000000001','junior1','junior'),
  ('00000000-0000-0000-0000-0000000000c1','10000000-0000-0000-0000-000000000002','senior1','senior');
insert into public.user_permissions(user_id, perm_key, effect) values ('00000000-0000-0000-0000-0000000000b1', 'attendance.check_in', 'grant');

-- Known history, written as the database owner so the times are exact (the table is append-only, not insert-proof).
-- Junior One, day 2026-03-02: in 09:00, out 13:00, in 14:00, out 18:30 (+05:00) = 240 + 270 = 510 minutes; one refused attempt.
-- Junior One, day 2026-03-03: a night shift in 22:00, out 06:00 the next morning = 480 minutes, counted on the day it started.
-- Senior Two, day 2026-03-02: in 10:00 and never out -> still open.
insert into public.mgmt_attendance (staff_id, business_date, at, kind, status, reject_reason, source) values
  ('10000000-0000-0000-0000-000000000001', '2026-03-02', '2026-03-02 09:00:00+05', 'in',  'accepted', null, 'app'),
  ('10000000-0000-0000-0000-000000000001', '2026-03-02', '2026-03-02 13:00:00+05', 'out', 'accepted', null, 'app'),
  ('10000000-0000-0000-0000-000000000001', '2026-03-02', '2026-03-02 14:00:00+05', 'in',  'accepted', null, 'app'),
  ('10000000-0000-0000-0000-000000000001', '2026-03-02', '2026-03-02 18:30:00+05', 'out', 'accepted', null, 'app'),
  ('10000000-0000-0000-0000-000000000001', '2026-03-02', '2026-03-02 19:00:00+05', 'in',  'rejected', 'outside', 'app'),
  ('10000000-0000-0000-0000-000000000001', '2026-03-03', '2026-03-03 22:00:00+05', 'in',  'accepted', null, 'app'),
  ('10000000-0000-0000-0000-000000000001', '2026-03-04', '2026-03-04 06:00:00+05', 'out', 'accepted', null, 'app'),
  ('10000000-0000-0000-0000-000000000002', '2026-03-02', '2026-03-02 10:00:00+05', 'in',  'accepted', null, 'app');

do $t$ declare v jsonb; r jsonb;
begin
  -- owner summary
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  v := public.mgmt_attendance_summary('2026-03-02', '2026-03-04');
  perform pg_temp.ok(jsonb_array_length(v -> 'rows') = 3, 'the owner summary has one row per person per day (3 rows)');
  select x into r from jsonb_array_elements(v -> 'rows') x where x ->> 'name' = 'Junior One' and x ->> 'date' = '2026-03-02';
  perform pg_temp.ok((r ->> 'worked_minutes')::int = 510, 'two pairs in one day add up: 240 + 270 = 510 minutes');
  perform pg_temp.ok((r ->> 'accepted')::int = 4 and (r ->> 'refused')::int = 1, 'four accepted events and one refused attempt are counted');
  perform pg_temp.ok(not (r ->> 'open')::boolean, 'a day that ended with an out is not open');
  perform pg_temp.ok((r ->> 'first_in')::timestamptz = '2026-03-02 09:00:00+05'::timestamptz, 'first in is 09:00');
  perform pg_temp.ok((r ->> 'last_out')::timestamptz = '2026-03-02 18:30:00+05'::timestamptz, 'last out is 18:30');
  select x into r from jsonb_array_elements(v -> 'rows') x where x ->> 'name' = 'Junior One' and x ->> 'date' = '2026-03-03';
  perform pg_temp.ok((r ->> 'worked_minutes')::int = 480, 'a night shift counts on the day it started (480 minutes)');
  perform pg_temp.ok((r ->> 'last_out')::timestamptz = '2026-03-04 06:00:00+05'::timestamptz and not (r ->> 'open')::boolean,
                     'the out after midnight closes that shift, so it is not open');
  perform pg_temp.ok(not exists (select 1 from jsonb_array_elements(v -> 'rows') x where x ->> 'date' = '2026-03-04'),
                     'the out after midnight does not create a row for the next day');
  perform pg_temp.ok((r ->> 'accepted')::int = 2, 'both events of the night shift (in and out) are counted on the day it started');
  select x into r from jsonb_array_elements(v -> 'rows') x where x ->> 'name' = 'Senior Two';
  perform pg_temp.ok((r ->> 'open')::boolean and (r ->> 'worked_minutes')::int = 0 and r ->> 'last_out' is null,
                     'an in with no out is open and counts no minutes');
  -- newest day first, then by name
  perform pg_temp.ok((v -> 'rows' -> 0 ->> 'date') = '2026-03-03', 'rows come newest day first');
  -- a huge range is cut to about two months and a missing end means today
  v := public.mgmt_attendance_summary('2000-01-01', null);
  perform pg_temp.ok((v ->> 'to')::date = (now() at time zone 'Asia/Karachi')::date and (v ->> 'to')::date - (v ->> 'from')::date = 62,
                     'the range is cut to 62 days and a missing end date means today');
  reset role;

  -- a person's own history: only their own rows
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  v := public.mgmt_attendance_my_history('2026-03-02', '2026-03-04');
  perform pg_temp.ok(v ->> 'to' is not null, 'my history answers for a person who holds attendance.check_in');
  v := public.mgmt_attendance_my_history(current_date - 62, current_date);
  perform pg_temp.ok(jsonb_array_length(v -> 'days') = 0, 'a recent window with no records has no days');
  reset role;

  -- my_history clamps to today, so read the March days with a window that ends today only if they are within 62 days;
  -- instead, move the same rows to recent dates to prove the staff view with real windows.
  insert into public.mgmt_attendance (staff_id, business_date, at, kind, status, reject_reason, source)
  select '10000000-0000-0000-0000-000000000001'::uuid, (now() at time zone 'Asia/Karachi')::date, now() - interval '3 hours', 'in', 'accepted', null::text, 'app'
  union all
  select '10000000-0000-0000-0000-000000000001'::uuid, (now() at time zone 'Asia/Karachi')::date, now() - interval '1 hour', 'out', 'accepted', null::text, 'app'
  union all
  select '10000000-0000-0000-0000-000000000002'::uuid, (now() at time zone 'Asia/Karachi')::date, now() - interval '2 hours', 'in', 'accepted', null::text, 'app';
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  v := public.mgmt_attendance_my_history(null, null);
  perform pg_temp.ok(jsonb_array_length(v -> 'days') = 1 and jsonb_array_length(v -> 'events') = 2, 'my history shows my own day and my own two events');
  perform pg_temp.ok((v -> 'days' -> 0 ->> 'worked_minutes')::int = 120, 'my history: three hours in, one hour ago out = 120 minutes');
  perform pg_temp.ok(not (v::text like '%Senior%') and not exists (select 1 from jsonb_array_elements(v -> 'events') e where e ? 'staff_id' or e ? 'name'),
                     'my history carries no other person and no staff id');
  perform pg_temp.ok((public.mgmt_attendance_my_history(current_date + 30, current_date + 40) ->> 'to')::date <= (now() at time zone 'Asia/Karachi')::date,
                     'a future window is cut back to today');
  reset role;

  -- who may not
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  perform pg_temp.fails($f$select public.mgmt_attendance_summary(current_date, current_date)$f$, 'staff cannot read the owner summary');
  perform pg_temp.fails($f$select public.mgmt_attendance_days(null, current_date, current_date)$f$, 'the internal day calculation is not callable');
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  perform pg_temp.fails($f$select public.mgmt_attendance_my_history(current_date, current_date)$f$, 'a person without the grant has no history');
  perform pg_temp.fails($f$select public.mgmt_attendance_summary(current_date, current_date)$f$, 'a person without the grant has no summary');
  reset role;
  set local role anon;
  perform pg_temp.fails($f$select public.mgmt_attendance_my_history(current_date, current_date)$f$, 'anon cannot read history');
  perform pg_temp.fails($f$select public.mgmt_attendance_summary(current_date, current_date)$f$, 'anon cannot read the summary');
  reset role;
end $t$;
rollback;
