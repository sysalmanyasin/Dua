-- Tests for 1403_app_attendance_auto_events: a phone records arrivals and departures with its own device secret.
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
create function pg_temp.hash(s text) returns text language sql as $$ select encode(sha256(convert_to(s, 'UTF8')), 'hex') $$;

insert into auth.users(id, email) values ('00000000-0000-0000-0000-0000000000a1','a@t'),('00000000-0000-0000-0000-0000000000b1','j@t'),
  ('00000000-0000-0000-0000-0000000000c1','s@t');
select public.bootstrap_first_admin('00000000-0000-0000-0000-0000000000a1','owner','Test Owner');
insert into public.staff(id, full_name) values ('10000000-0000-0000-0000-000000000001','Junior One'),('10000000-0000-0000-0000-000000000002','Senior Two');
insert into public.profiles(user_id, staff_id, username, role_template) values
  ('00000000-0000-0000-0000-0000000000b1','10000000-0000-0000-0000-000000000001','junior1','junior'),
  ('00000000-0000-0000-0000-0000000000c1','10000000-0000-0000-0000-000000000002','senior1','senior');
insert into public.user_permissions(user_id, perm_key, effect) values ('00000000-0000-0000-0000-0000000000b1', 'attendance.check_in', 'grant');

-- place centre 10, 20 (radius 100 m). 0.0005 degrees of latitude is about 55 m; 0.002 is about 222 m.
do $t$ declare v jsonb; k uuid; secret text; secret_other text; h text; n int; site uuid; r record;
  dev uuid := '20000000-0000-0000-0000-0000000000d1'; dev_c uuid := '20000000-0000-0000-0000-0000000000d3';
  e1 uuid := gen_random_uuid(); e2 uuid := gen_random_uuid(); e3 uuid := gen_random_uuid(); e4 uuid := gen_random_uuid();
  t0 timestamptz := now() - interval '3 hours';
begin
  perform pg_temp.ok((select auto_enabled from public.mgmt_attendance_config) = false, 'automatic recording is OFF by default');

  -- the owner sets a place and registers the junior's phone
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  site := (public.mgmt_attendance_site_save(null, 'Test Shop', 10, 20, 100, true, 'first place', gen_random_uuid()) ->> 'id')::uuid;
  perform pg_temp.ok((public.mgmt_attendance_setup() -> 'config' ->> 'auto_enabled')::boolean = false, 'setup reports the switch (off)');
  reset role;

  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  perform public.app_device_register(dev, repeat('a', 40), '1.0', false);
  perform pg_temp.ok((public.mgmt_attendance_my_site() ->> 'auto_enabled')::boolean = false, 'the phone is told the switch is off');
  v := public.app_device_attendance_enroll(dev);
  secret := v ->> 'secret';
  h := pg_temp.hash(secret);
  perform pg_temp.ok(length(secret) = 64, 'enrolling gives the secret once');
  perform pg_temp.fails($f$select public.app_device_attendance_enroll('20000000-0000-0000-0000-0000000000ff')$f$, 'an unknown device cannot be enrolled');
  perform pg_temp.fails($f$select public.app_attendance_event('20000000-0000-0000-0000-0000000000d1', repeat('0',64), gen_random_uuid(), 'in', now(), 10, 20, 10, false)$f$, 'a phone cannot call the event function itself');
  perform pg_temp.fails($f$select * from public.mgmt_attendance_auto_events$f$, 'nobody reads the event history directly');
  reset role;

  -- a person without the right cannot enrol, and someone else's device cannot be enrolled
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  perform public.app_device_register(dev_c, repeat('c', 40), '1.0', false);
  perform pg_temp.fails($f$select public.app_device_attendance_enroll('20000000-0000-0000-0000-0000000000d3')$f$, 'a person without attendance.check_in cannot enrol');
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  perform pg_temp.fails($f$select public.app_device_attendance_enroll('20000000-0000-0000-0000-0000000000d3')$f$, 'a device that is not yours cannot be enrolled');
  reset role;

  -- wrong secret / device -> null (the function answers 401)
  perform pg_temp.ok(public.app_attendance_event(dev, pg_temp.hash('wrong'), gen_random_uuid(), 'in', t0, 10, 20, 10, false) is null, 'a wrong secret is refused');
  perform pg_temp.ok(public.app_attendance_event(gen_random_uuid(), h, gen_random_uuid(), 'in', t0, 10, 20, 10, false) is null, 'an unknown device is refused');

  -- switched off: nothing is stored
  v := public.app_attendance_event(dev, h, e1, 'in', t0, 10, 20, 10, false);
  perform pg_temp.ok(v ->> 'status' = 'off', 'with the switch off the event is not recorded');
  perform pg_temp.ok((select count(*) from public.mgmt_attendance) = 0 and (select count(*) from public.mgmt_attendance_auto_events) = 0, 'and nothing is stored at all');

  -- the owner switches it on (reason required, idempotent, logged)
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  k := gen_random_uuid();
  perform pg_temp.fails($f$select public.mgmt_attendance_auto_set(true, '', gen_random_uuid())$f$, 'switching on needs a reason');
  perform pg_temp.fails($f$select public.mgmt_attendance_auto_set(null, 'unclear', gen_random_uuid())$f$, 'on or off is required');
  v := public.mgmt_attendance_auto_set(true, 'phone test passed', k);
  perform pg_temp.ok((v ->> 'auto_enabled')::boolean, 'the owner switches automatic recording on');
  perform public.mgmt_attendance_auto_set(false, 'must not run twice', k);
  perform pg_temp.ok((public.mgmt_attendance_setup() -> 'config' ->> 'auto_enabled')::boolean, 'the same key is answered, not re-run');
  reset role;
  perform pg_temp.ok(exists (select 1 from public.activity_log where action = 'attendance.auto_set'), 'the switch is logged');
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  perform pg_temp.fails($f$select public.mgmt_attendance_auto_set(false, 'sneaky', gen_random_uuid())$f$, 'staff cannot switch it');
  perform pg_temp.ok((public.mgmt_attendance_my_site() ->> 'auto_enabled')::boolean, 'the phone is told the switch is on');
  reset role;

  -- arrival inside the place is recorded, with the time the phone saw it and source auto
  v := public.app_attendance_event(dev, h, e1, 'in', t0, 10.0005, 20, 12, false);
  perform pg_temp.ok(v ->> 'status' = 'accepted' and v ->> 'reason' is null and v ->> 'place' = 'Test Shop', 'an arrival inside the place is recorded');
  select * into r from public.mgmt_attendance where staff_id = '10000000-0000-0000-0000-000000000001';
  perform pg_temp.ok(r.kind = 'in' and r.source = 'auto' and r.status = 'accepted' and r.at = t0 and r.site_id = site, 'it is an ordinary row: source auto, at the phone''s time');
  perform pg_temp.ok(r.business_date = (t0 at time zone 'Asia/Karachi')::date, 'the business day follows the event time');
  perform pg_temp.ok(r.user_id = '00000000-0000-0000-0000-0000000000b1', 'recorded for the person who owns the phone');

  -- the same event again is answered the same and never recorded twice
  v := public.app_attendance_event(dev, h, e1, 'in', t0, 10.0005, 20, 12, false);
  perform pg_temp.ok(v ->> 'status' = 'accepted' and (v ->> 'duplicate')::boolean, 'the same event id is answered again, flagged duplicate');
  perform pg_temp.ok((select count(*) from public.mgmt_attendance) = 1, 'and nothing new is recorded');

  -- another arrival (new id) while already in is harmless: ignored, kept in the history, not a refused attempt
  v := public.app_attendance_event(dev, h, e2, 'in', t0 + interval '5 minutes', 10.0005, 20, 12, false);
  perform pg_temp.ok(v ->> 'status' = 'ignored' and v ->> 'reason' = 'already_in', 'an arrival while already in is ignored');
  perform pg_temp.ok((select count(*) from public.mgmt_attendance) = 1, 'no second row for it');
  perform pg_temp.ok((select count(*) from public.mgmt_attendance_auto_events where outcome = 'ignored' and reason = 'already_in') = 1, 'but it is kept in the history');

  -- a departure that is still inside the place is refused (the person has not left)
  v := public.app_attendance_event(dev, h, e3, 'out', t0 + interval '1 hour', 10.0005, 20, 12, false);
  perform pg_temp.ok(v ->> 'status' = 'rejected' and v ->> 'reason' = 'still_inside', 'a departure measured inside the place is refused');
  -- weak signal
  v := public.app_attendance_event(dev, h, gen_random_uuid(), 'out', t0 + interval '1 hour', 10.002, 20, 250, false);
  perform pg_temp.ok(v ->> 'status' = 'rejected' and v ->> 'reason' = 'weak_signal', 'a weak fix is refused');
  -- mock location
  v := public.app_attendance_event(dev, h, gen_random_uuid(), 'out', t0 + interval '1 hour', 10.002, 20, 12, true);
  perform pg_temp.ok(v ->> 'status' = 'rejected' and v ->> 'reason' = 'mock_location', 'a mock location is refused');
  perform pg_temp.ok(exists (select 1 from public.mgmt_attendance where reject_reason = 'mock_location' and source = 'auto'), 'the refusals are kept as rows the owner can see');

  -- a real departure: outside the place
  v := public.app_attendance_event(dev, h, e4, 'out', t0 + interval '2 hours', 10.002, 20, 12, false);
  perform pg_temp.ok(v ->> 'status' = 'accepted' and (v ->> 'distance_m')::numeric > 100, 'a departure outside the place is recorded');
  -- out again: not in
  v := public.app_attendance_event(dev, h, gen_random_uuid(), 'out', t0 + interval '2 hours 5 minutes', 10.002, 20, 12, false);
  perform pg_temp.ok(v ->> 'status' = 'ignored' and v ->> 'reason' = 'not_in', 'a second departure is ignored');
  -- an older event than what is recorded
  v := public.app_attendance_event(dev, h, gen_random_uuid(), 'in', t0 + interval '30 minutes', 10.0005, 20, 12, false);
  perform pg_temp.ok(v ->> 'status' = 'ignored' and v ->> 'reason' = 'older', 'an event older than the last recorded one is ignored');
  -- an arrival far from the place
  v := public.app_attendance_event(dev, h, gen_random_uuid(), 'in', t0 + interval '2 hours 30 minutes', 10.002, 20, 12, false);
  perform pg_temp.ok(v ->> 'status' = 'rejected' and v ->> 'reason' = 'outside', 'an arrival outside the place is refused');

  -- time bounds
  v := public.app_attendance_event(dev, h, gen_random_uuid(), 'in', now() - interval '2 days', 10.0005, 20, 12, false);
  perform pg_temp.ok(v ->> 'status' = 'ignored' and v ->> 'reason' = 'stale', 'an event more than a day old is ignored');
  v := public.app_attendance_event(dev, h, gen_random_uuid(), 'in', now() + interval '1 hour', 10.0005, 20, 12, false);
  perform pg_temp.ok(v ->> 'status' = 'ignored' and v ->> 'reason' = 'stale', 'an event in the future is ignored');

  -- bad input is an error, not a recording
  perform pg_temp.fails(format('select public.app_attendance_event(%L, %L, gen_random_uuid(), %L, now(), 10, 20, 10, false)', dev, h, 'sideways'), 'an unknown kind is an error');
  perform pg_temp.fails(format('select public.app_attendance_event(%L, %L, gen_random_uuid(), %L, now(), 95, 20, 10, false)', dev, h, 'in'), 'a latitude beyond 90 is an error');

  -- history shape
  perform pg_temp.ok((select count(*) from public.mgmt_attendance_auto_events where staff_id = '10000000-0000-0000-0000-000000000001') >= 9, 'every event is in the history');
  perform pg_temp.fails($f$update public.mgmt_attendance_auto_events set outcome = 'accepted'$f$, 'the history cannot be changed');
  perform pg_temp.fails($f$delete from public.mgmt_attendance_auto_events$f$, 'the history cannot be deleted');

  -- the owner's views: refused attempts show, ignored duplicates do not
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  select count(*) into n from jsonb_array_elements(public.mgmt_attendance_list((now() at time zone 'Asia/Karachi')::date - 1, (now() at time zone 'Asia/Karachi')::date)) e
   where e ->> 'source' = 'auto' and e ->> 'status' = 'rejected';
  perform pg_temp.ok(n >= 3, 'the owner sees the refused automatic attempts');
  select count(*) into n from jsonb_array_elements(public.mgmt_attendance_list((now() at time zone 'Asia/Karachi')::date - 1, (now() at time zone 'Asia/Karachi')::date)) e
   where e ->> 'reason' in ('already_in', 'not_in', 'older', 'stale');
  perform pg_temp.ok(n = 0, 'ignored duplicates are not listed as refused attempts');
  reset role;

  -- losing the right stops the phone at once
  delete from public.user_permissions where user_id = '00000000-0000-0000-0000-0000000000b1' and perm_key = 'attendance.check_in';
  perform pg_temp.ok(public.app_attendance_event(dev, h, gen_random_uuid(), 'in', now(), 10.0005, 20, 12, false) is null, 'a person who lost the right is refused (401) with the same secret');
  insert into public.user_permissions(user_id, perm_key, effect) values ('00000000-0000-0000-0000-0000000000b1', 'attendance.check_in', 'grant');

  -- a new secret replaces the old one
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  secret_other := public.app_device_attendance_enroll(dev) ->> 'secret';
  reset role;
  perform pg_temp.ok(public.app_attendance_event(dev, h, gen_random_uuid(), 'in', now(), 10.0005, 20, 12, false) is null, 'enrolling again retires the old secret');
  perform pg_temp.ok(public.app_attendance_event(dev, pg_temp.hash(secret_other), gen_random_uuid(), 'in', now(), 10.0005, 20, 12, false) is not null, 'and the new one works');

  -- the phone changes hands: the new person never inherits the old secret
  update public.app_devices set user_id = '00000000-0000-0000-0000-0000000000c1' where id = dev;
  perform pg_temp.ok((select attendance_secret_hash from public.app_devices where id = dev) is null, 'another person on the same phone starts without a secret');
  perform pg_temp.ok(public.app_attendance_event(dev, pg_temp.hash(secret_other), gen_random_uuid(), 'in', now(), 10.0005, 20, 12, false) is null, 'and the previous secret no longer works');

  -- anon and authenticated cannot call the event function
  set local role anon;
  perform pg_temp.fails($f$select public.app_attendance_event('20000000-0000-0000-0000-0000000000d1', repeat('0',64), gen_random_uuid(), 'in', now(), 10, 20, 10, false)$f$, 'anon cannot call the event function');
  perform pg_temp.fails($f$select public.app_device_attendance_enroll('20000000-0000-0000-0000-0000000000d1')$f$, 'anon cannot enrol');
  perform pg_temp.fails($f$select public.mgmt_attendance_auto_set(true, 'x', gen_random_uuid())$f$, 'anon cannot switch it');
  reset role;
end $t$;
rollback;
