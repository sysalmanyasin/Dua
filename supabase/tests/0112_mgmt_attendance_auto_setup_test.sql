-- Tests for 0112_mgmt_attendance_auto_setup: the stability period, and the narrow read a staff phone uses to watch the pharmacy.
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

do $t$ declare v jsonb; k uuid; site1 uuid; site2 uuid;
begin
  perform pg_temp.ok((select stable_seconds from public.mgmt_attendance_config) = 120, 'the stability period defaults to 120 seconds (two minutes)');

  -- the owner
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  site1 := (public.mgmt_attendance_site_save(null, 'Test Shop', 10, 20, 100, true, 'first place', gen_random_uuid()) ->> 'id')::uuid;
  site2 := (public.mgmt_attendance_site_save(null, 'Old Shop', 11, 21, 150, false, 'closed place', gen_random_uuid()) ->> 'id')::uuid;
  perform pg_temp.ok((public.mgmt_attendance_setup() -> 'config' ->> 'stable_seconds')::int = 120, 'setup reports the stability period');
  k := gen_random_uuid();
  v := public.mgmt_attendance_stable_set(90, 'faster test', k);
  perform pg_temp.ok((v ->> 'stable_seconds')::int = 90, 'the owner can change the stability period');
  perform public.mgmt_attendance_stable_set(300, 'must not run twice', k);
  perform pg_temp.ok((public.mgmt_attendance_setup() -> 'config' ->> 'stable_seconds')::int = 90, 'the same idempotency key is answered, not re-run');
  perform pg_temp.fails($f$select public.mgmt_attendance_stable_set(90, '', gen_random_uuid())$f$, 'a change without a reason is refused');
  perform pg_temp.fails($f$select public.mgmt_attendance_stable_set(29, 'too short', gen_random_uuid())$f$, '29 seconds is refused');
  perform pg_temp.fails($f$select public.mgmt_attendance_stable_set(601, 'too long', gen_random_uuid())$f$, '601 seconds is refused');
  perform pg_temp.fails($f$select public.mgmt_attendance_stable_set(null, 'nothing', gen_random_uuid())$f$, 'no value is refused');
  perform pg_temp.ok(public.mgmt_attendance_stable_set(30, 'lowest', gen_random_uuid()) is not null
                     and public.mgmt_attendance_stable_set(600, 'highest', gen_random_uuid()) is not null, '30 and 600 seconds are the allowed ends');
  perform public.mgmt_attendance_stable_set(120, 'back to default', gen_random_uuid());
  reset role;
  perform pg_temp.ok(exists (select 1 from public.activity_log where action = 'attendance.stable_set'), 'every change is logged');

  -- a staff phone reads what to watch
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  v := public.mgmt_attendance_my_site();
  perform pg_temp.ok(jsonb_array_length(v -> 'sites') = 1, 'staff see only the active place (the switched-off one is left out)');
  perform pg_temp.ok(v -> 'sites' -> 0 ->> 'name' = 'Test Shop' and (v -> 'sites' -> 0 ->> 'radius_m')::int = 100
                     and (v -> 'sites' -> 0 ->> 'latitude')::numeric = 10 and (v -> 'sites' -> 0 ->> 'longitude')::numeric = 20, 'the place comes with its centre and distance');
  perform pg_temp.ok((v ->> 'stable_seconds')::int = 120 and (v ->> 'max_accuracy_m')::int = 100, 'and the stability period and the accuracy limit');
  perform pg_temp.ok(not (v::text ~* 'Old Shop|Junior|Senior|Owner'), 'nothing else leaks: no other place, no person');
  perform pg_temp.fails($f$select public.mgmt_attendance_stable_set(60, 'sneaky', gen_random_uuid())$f$, 'staff cannot change the stability period');
  perform pg_temp.fails($f$select public.mgmt_attendance_setup()$f$, 'staff still cannot read the owner setup');
  reset role;

  -- no active place -> an empty list, not an error
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  perform public.mgmt_attendance_site_save(site1, 'Test Shop', 10, 20, 100, false, 'switch off', gen_random_uuid());
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  perform pg_temp.ok(jsonb_array_length(public.mgmt_attendance_my_site() -> 'sites') = 0, 'with every place switched off the list is empty');
  reset role;

  -- at most five places
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  for i in 1..7 loop
    perform public.mgmt_attendance_site_save(null, 'Place ' || i, 10 + i * 0.01, 20, 100, true, 'many', gen_random_uuid());
  end loop;
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  perform pg_temp.ok(jsonb_array_length(public.mgmt_attendance_my_site() -> 'sites') = 5, 'a phone is given at most five places');
  reset role;

  -- who may not
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  perform pg_temp.fails($f$select public.mgmt_attendance_my_site()$f$, 'a person without the grant cannot read the places');
  reset role;
  set local role anon;
  perform pg_temp.fails($f$select public.mgmt_attendance_my_site()$f$, 'anon cannot read the places');
  perform pg_temp.fails($f$select public.mgmt_attendance_stable_set(60, 'x', gen_random_uuid())$f$, 'anon cannot change the stability period');
  reset role;
end $t$;
rollback;
