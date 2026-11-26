-- Tests for 0110_mgmt_attendance: the server decides every check-in; refused attempts are kept; nothing is writable directly.
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
-- invented place: 10.000000, 20.000000, radius 100 m. 0.0005 degrees of latitude is about 55.6 m.
do $t$ declare v jsonb; n int; site uuid; k uuid;
begin
  perform pg_temp.ok((select count(*) from public.permissions where key like 'attendance.%') = 3, 'the three attendance permissions exist');
  perform pg_temp.ok(round(public.mgmt_attendance_distance_m(10, 20, 10.001, 20)) between 110 and 112, 'distance: 0.001 degree of latitude is about 111 m');
  perform pg_temp.ok(public.mgmt_attendance_distance_m(10, 20, 10, 20) = 0, 'distance: same point is 0');

  -- the owner (admin with MFA) sets the place
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  v := public.mgmt_attendance_site_save(null, 'Test Shop', 10, 20, 100, true, 'first place', gen_random_uuid());
  site := (v ->> 'id')::uuid;
  perform pg_temp.ok(site is not null, 'owner can add a place');
  k := gen_random_uuid();
  perform public.mgmt_attendance_site_save(site, 'Test Shop', 10, 20, 100, true, 'same again', k);
  perform public.mgmt_attendance_site_save(site, 'Renamed', 10, 20, 100, true, 'must not run twice', k);
  perform pg_temp.ok((public.mgmt_attendance_setup() -> 'sites' -> 0 ->> 'name') = 'Test Shop', 'the same idempotency key is answered, not re-run');
  reset role;

  -- a place needs a reason; a radius out of range is refused
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  perform pg_temp.fails($f$select public.mgmt_attendance_site_save(null, 'No reason', 10, 20, 100, true, '', gen_random_uuid())$f$, 'a place without a reason is refused');
  perform pg_temp.fails($f$select public.mgmt_attendance_site_save(null, 'Huge', 10, 20, 99999, true, 'because', gen_random_uuid())$f$, 'a radius over 2000 m is refused');
  reset role;

  -- staff cannot manage places or read everyone
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  perform pg_temp.fails($f$select public.mgmt_attendance_site_save(null, 'Mine', 10, 20, 100, true, 'sneaky', gen_random_uuid())$f$, 'staff cannot add a place');
  perform pg_temp.fails($f$select public.mgmt_attendance_list(current_date, current_date)$f$, 'staff cannot list everyone''s attendance');
  perform pg_temp.fails($f$select public.mgmt_attendance_setup()$f$, 'staff cannot read the place setup');
  perform pg_temp.fails($f$select public.mgmt_attendance_config_set(50, false, 'sneaky', gen_random_uuid())$f$, 'staff cannot change the limits');
  perform pg_temp.fails($f$select * from public.mgmt_attendance$f$, 'staff cannot read the table directly');
  perform pg_temp.fails($f$insert into public.mgmt_attendance(staff_id, business_date, kind, status, source) values ('10000000-0000-0000-0000-000000000001', current_date, 'in', 'accepted', 'app')$f$, 'staff cannot insert a row directly');
  reset role;

  -- check-in: inside the place, from the app, good signal -> accepted
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  v := public.mgmt_attendance_today();
  perform pg_temp.ok(v ->> 'state' = 'out' and (v ->> 'has_place')::boolean, 'before any check-in the state is out and a place exists');
  v := public.mgmt_attendance_check_in('in', 10.0005, 20, 12, false, 'app', gen_random_uuid());
  perform pg_temp.ok((v ->> 'ok')::boolean and (v ->> 'distance_m')::numeric between 55 and 56, 'inside the place: accepted, about 55.6 m away');
  perform pg_temp.ok(public.mgmt_attendance_today() ->> 'state' = 'in', 'the state is now in');

  -- the same key twice records once
  k := gen_random_uuid();
  perform public.mgmt_attendance_check_in('out', 10, 20, 5, false, 'app', k);
  perform public.mgmt_attendance_check_in('out', 10, 20, 5, false, 'app', k);
  perform pg_temp.ok(jsonb_array_length(public.mgmt_attendance_today() -> 'events') = 2, 'a retried request with the same key made one record');
  perform pg_temp.ok(public.mgmt_attendance_today() ->> 'state' = 'out', 'out was accepted: the state is out');

  -- refusals, each with its reason
  v := public.mgmt_attendance_check_in('in', 10.0020, 20, 10, false, 'app', gen_random_uuid());
  perform pg_temp.ok(not (v ->> 'ok')::boolean and v ->> 'reason' = 'outside', 'about 222 m away is refused as outside');
  v := public.mgmt_attendance_check_in('in', 10, 20, 10, true, 'app', gen_random_uuid());
  perform pg_temp.ok(v ->> 'reason' = 'mock_location', 'a mock-location flag is refused');
  v := public.mgmt_attendance_check_in('in', 10, 20, 400, false, 'app', gen_random_uuid());
  perform pg_temp.ok(v ->> 'reason' = 'weak_signal', 'accuracy worse than the limit is refused');
  v := public.mgmt_attendance_check_in('in', 10, 20, 10, false, 'web', gen_random_uuid());
  perform pg_temp.ok(v ->> 'reason' = 'app_required', 'a web check-in is refused while the app is required');
  v := public.mgmt_attendance_check_in('out', 10, 20, 10, false, 'app', gen_random_uuid());
  perform pg_temp.ok(v ->> 'reason' = 'not_in', 'out without an in is refused');
  perform public.mgmt_attendance_check_in('in', 10, 20, 10, false, 'app', gen_random_uuid());
  v := public.mgmt_attendance_check_in('in', 10, 20, 10, false, 'app', gen_random_uuid());
  perform pg_temp.ok(v ->> 'reason' = 'already_in', 'a second in is refused');
  perform pg_temp.fails($f$select public.mgmt_attendance_check_in('sideways', 10, 20, 10, false, 'app', gen_random_uuid())$f$, 'an invalid kind is refused');
  perform pg_temp.fails($f$select public.mgmt_attendance_check_in('in', 95, 20, 10, false, 'app', gen_random_uuid())$f$, 'a latitude out of range is refused');
  reset role;

  -- refused attempts are kept
  perform pg_temp.ok((select count(*) from public.mgmt_attendance where status = 'rejected') = 6, 'every refused attempt was kept as a row');
  perform pg_temp.ok((select count(*) from public.mgmt_attendance where status = 'accepted') = 3, 'accepted rows: in, out, in');
  perform pg_temp.ok((select count(*) from public.notifications where kind = 'attendance.rejected') = 2, 'the owner is alerted for outside and mock only (once each)');
  perform pg_temp.ok(not exists (select 1 from public.notifications where kind = 'attendance.rejected' and payload::text ~* 'Junior|Shop'), 'the alert carries no name or place');

  -- append-only
  perform pg_temp.fails($f$update public.mgmt_attendance set kind = 'out'$f$, 'a record cannot be edited');
  perform pg_temp.fails($f$delete from public.mgmt_attendance$f$, 'a record cannot be deleted');

  -- nobody holds it by default: a person who was not granted it is refused, and no role preset carries it
  perform pg_temp.ok(not exists (select 1 from public.role_permissions where perm_key like 'attendance.%'), 'no role preset carries an attendance permission');
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  perform pg_temp.fails($f$select public.mgmt_attendance_check_in('in', 10, 20, 10, false, 'app', gen_random_uuid())$f$, 'a person without the grant cannot check in');
  reset role;

  -- no place -> refused with its own reason
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  perform public.mgmt_attendance_site_save(site, 'Test Shop', 10, 20, 100, false, 'switch off', gen_random_uuid());
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  v := public.mgmt_attendance_check_in('out', 10, 20, 10, false, 'app', gen_random_uuid());
  perform pg_temp.ok(v ->> 'reason' = 'no_place_set', 'with every place switched off the check-in is refused');
  reset role;

  -- owner can switch the app requirement off and then a web check-in works (limits are remote-controlled)
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  perform public.mgmt_attendance_site_save(site, 'Test Shop', 10, 20, 100, true, 'back on', gen_random_uuid());
  perform public.mgmt_attendance_config_set(150, false, 'allow web for a test', gen_random_uuid());
  v := public.mgmt_attendance_list(current_date - 1, current_date + 1);
  n := jsonb_array_length(v);
  perform pg_temp.ok(n >= 9, 'the owner lists every record, refused ones included');
  perform pg_temp.ok(v::text like '%Junior One%', 'the owner sees names');
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  perform public.mgmt_attendance_check_in('out', 10, 20, 10, false, 'web', gen_random_uuid());
  v := public.mgmt_attendance_check_in('in', 10, 20, 120, false, 'web', gen_random_uuid());
  perform pg_temp.ok((v ->> 'ok')::boolean, 'with the app not required and a 150 m limit a 120 m reading from the web is accepted');
  reset role;

  -- anon gets nothing
  set local role anon;
  perform pg_temp.fails($f$select public.mgmt_attendance_today()$f$, 'anon cannot call today');
  perform pg_temp.fails($f$select * from public.mgmt_attendance_sites$f$, 'anon cannot read places');
  reset role;
end $t$;
rollback;
