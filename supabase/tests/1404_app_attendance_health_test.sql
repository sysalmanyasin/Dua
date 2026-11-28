-- Tests for 1404_app_attendance_health: tracking can never be switched off silently; the owner is told.
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

do $t$ declare v jsonb; secret text; h text; n int; r record; j jsonb;
  dev uuid := '20000000-0000-0000-0000-0000000000d1'; staff1 uuid := '10000000-0000-0000-0000-000000000001';
  p_day timestamptz := (current_date::timestamp + interval '7 hours') at time zone 'UTC';    -- 12:00 in Pakistan
  p_night timestamptz := (current_date::timestamp + interval '18 hours') at time zone 'UTC'; -- 23:00 in Pakistan
begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  perform public.mgmt_attendance_site_save(null, 'Test Shop', 10, 20, 100, true, 'first place', gen_random_uuid());
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  perform public.app_device_register(dev, repeat('a', 40), '1.0', false);
  secret := public.app_device_attendance_enroll(dev) ->> 'secret';
  h := pg_temp.hash(secret);
  perform pg_temp.fails($f$select public.app_attendance_health('20000000-0000-0000-0000-0000000000d1', repeat('0',64), 'ok', 0)$f$, 'a phone cannot call the report function itself');
  perform pg_temp.fails($f$select public.attendance_health_check()$f$, 'nobody but the server can run the scheduled check');
  perform pg_temp.fails($f$select public.mgmt_attendance_health()$f$, 'staff cannot read the owner list');
  perform pg_temp.fails($f$select public.mgmt_attendance_gaps(null, null, null)$f$, 'staff cannot read the gaps');
  perform pg_temp.fails($f$select * from public.mgmt_attendance_tracking_log$f$, 'nobody reads the log directly');
  reset role;

  -- wrong device / secret / bad input
  perform pg_temp.ok(public.app_attendance_health(dev, pg_temp.hash('wrong'), 'ok', 0) is null, 'a wrong secret is refused');
  perform pg_temp.ok(public.app_attendance_health(gen_random_uuid(), h, 'ok', 0) is null, 'an unknown device is refused');
  perform pg_temp.fails(format('select public.app_attendance_health(%L, %L, %L, 0)', dev, h, 'on_fire'), 'an unknown state is an error');
  perform pg_temp.fails(format('select public.app_attendance_health(%L, %L, %L, -1)', dev, h, 'ok'), 'a negative queue size is an error');
  perform pg_temp.fails(format('select public.app_attendance_health(%L, %L, %L, 5000)', dev, h, 'ok'), 'an absurd queue size is an error');
  perform pg_temp.fails(format('select public.app_attendance_health(%L, %L, %L, null)', dev, h, 'ok'), 'a missing queue size is an error');

  -- recording is OFF: the state is stored for the owner to see, but nothing is logged or alerted
  v := public.app_attendance_health(dev, h, 'location_off', 0);
  perform pg_temp.ok(v ->> 'status' = 'off', 'with the switch off the report is answered "off"');
  perform pg_temp.ok((select health_state from public.app_devices where id = dev) = 'location_off', 'the state is still stored');
  perform pg_temp.ok((select count(*) from public.mgmt_attendance_tracking_log) = 0 and (select count(*) from public.notifications) = 0,
                     'no history and no alert while recording is off');

  -- the owner switches recording on
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  perform public.mgmt_attendance_auto_set(true, 'phone test passed', gen_random_uuid());
  reset role;

  -- an ok report after "off" while on: change from location_off to ok is logged, no alert
  v := public.app_attendance_health(dev, h, null, 0);
  perform pg_temp.ok(v ->> 'status' = 'on', 'with the switch on the report is answered "on"');
  perform pg_temp.ok((select state from public.mgmt_attendance_tracking_log order by at desc limit 1) = 'ok', 'tracking back is logged');
  perform pg_temp.ok((select count(*) from public.notifications) = 0, 'and no alert for good news');

  -- the same good state again: nothing new
  perform public.app_attendance_health(dev, h, 'ok', 0);
  perform pg_temp.ok((select count(*) from public.mgmt_attendance_tracking_log) = 1, 'a repeated good report adds nothing');

  -- location is switched off: logged and alerted, once
  perform public.app_attendance_health(dev, h, 'location_off', 2);
  perform pg_temp.ok((select state from public.mgmt_attendance_tracking_log order by at desc, id limit 1) = 'location_off', 'switching location off is logged');
  perform pg_temp.ok((select count(*) from public.notifications where kind = 'attendance.tracking_off') = 1, 'the owner is alerted');
  perform pg_temp.ok((select health_pending from public.app_devices where id = dev) = 2, 'the number of waiting events is kept');
  perform public.app_attendance_health(dev, h, 'location_off', 2);
  perform pg_temp.ok((select count(*) from public.mgmt_attendance_tracking_log where state = 'location_off') = 1
                     and (select count(*) from public.notifications where kind = 'attendance.tracking_off') = 1, 'the same problem again adds no history and no second alert');
  perform pg_temp.ok(not exists (select 1 from public.notifications where payload::text ~* 'Junior|Shop|junior1'), 'the alert carries no name or place');

  -- a different problem is a new alert
  perform public.app_attendance_health(dev, h, 'no_background_location', 0);
  perform pg_temp.ok((select count(*) from public.notifications where kind = 'attendance.tracking_off') = 2, 'a different problem is alerted too');
  perform public.app_attendance_health(dev, h, 'ok', 0);

  -- the owner's list and gaps
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  v := public.mgmt_attendance_health();
  perform pg_temp.ok((v ->> 'auto_enabled')::boolean, 'the list says recording is on');
  perform pg_temp.ok(jsonb_array_length(v -> 'people') = 1 and v -> 'people' -> 0 ->> 'name' = 'Junior One',
                     'only people who may check in are listed (the senior has no right)');
  perform pg_temp.ok(v -> 'people' -> 0 -> 'phone' ->> 'state' = 'ok' and (v -> 'people' -> 0 ->> 'at_work')::boolean = false, 'the phone is ok and the person is not at work');
  j := public.mgmt_attendance_gaps(staff1, current_date - 1, current_date + 1);
  perform pg_temp.ok(jsonb_array_length(j) = 2, 'two periods of no tracking are listed');
  perform pg_temp.ok(not exists (select 1 from jsonb_array_elements(j) e where e ->> 'to_at' is null), 'both are closed (tracking is back)');
  perform pg_temp.ok(public.mgmt_attendance_gaps(staff1, current_date - 40, current_date - 30) = '[]'::jsonb, 'a period with no gaps is an empty list');
  reset role;

  -- an open gap has no end
  perform public.app_attendance_health(dev, h, 'background_restricted', 0);
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  j := public.mgmt_attendance_gaps(null, null, null);
  perform pg_temp.ok(j -> 0 ->> 'state' = 'background_restricted' and j -> 0 ->> 'to_at' is null and j -> 0 ->> 'name' = 'Junior One', 'a problem that is still there has no end');
  reset role;
  perform public.app_attendance_health(dev, h, 'ok', 0);

  -- the log is append-only
  perform pg_temp.fails($f$update public.mgmt_attendance_tracking_log set state = 'ok'$f$, 'the log cannot be changed');
  perform pg_temp.fails($f$delete from public.mgmt_attendance_tracking_log$f$, 'the log cannot be erased');

  -- silent phone: it reported two hours ago, nothing since
  update public.app_devices set health_at = p_day - interval '2 hours', last_seen_at = p_day - interval '2 hours' where id = dev;
  v := public.attendance_health_check(p_night);
  perform pg_temp.ok((v ->> 'silent')::int = 0, 'a quiet phone is not reported at night');
  v := public.attendance_health_check(p_day);
  perform pg_temp.ok((v ->> 'silent')::int = 1, 'a phone quiet for two hours in the daytime is reported');
  perform pg_temp.ok((select health_state from public.app_devices where id = dev) = 'silent', 'it is marked silent');
  perform pg_temp.ok(exists (select 1 from public.mgmt_attendance_tracking_log where state = 'silent' and at = p_day), 'the silence is logged');
  perform pg_temp.ok(exists (select 1 from public.notifications where kind = 'attendance.tracking_off' and dedupe_key like '%:silent:%'), 'the owner is alerted');
  v := public.attendance_health_check(p_day);
  perform pg_temp.ok((v ->> 'silent')::int = 0, 'the same silence is not reported twice');
  perform public.app_attendance_health(dev, h, 'ok', 0);
  perform pg_temp.ok((select state from public.mgmt_attendance_tracking_log order by at desc, id limit 1) = 'ok'
                     or (select health_state from public.app_devices where id = dev) = 'ok', 'when the phone reports again the silence ends');

  -- a phone that has never reported (older app) is not "silent"
  update public.app_devices set health_state = null, health_at = null, last_seen_at = p_day - interval '5 hours' where id = dev;
  v := public.attendance_health_check(p_day);
  perform pg_temp.ok((v ->> 'silent')::int = 0, 'a phone that cannot report yet is not called silent');

  -- recording off: nothing is looked for
  update public.app_devices set health_state = 'ok', health_at = p_day - interval '3 hours', last_seen_at = p_day - interval '3 hours' where id = dev;
  update public.mgmt_attendance_config set auto_enabled = false;
  v := public.attendance_health_check(p_day);
  perform pg_temp.ok((v ->> 'silent')::int = 0 and (v ->> 'still_off')::int = 0, 'with recording off there is no silent-phone check');
  update public.mgmt_attendance_config set auto_enabled = true;

  -- tracking that stays off is reminded about once a day
  update public.app_devices set health_state = 'location_off', health_at = now(), last_seen_at = now() where id = dev;
  delete from public.notifications;
  v := public.attendance_health_check(now());
  perform pg_temp.ok((v ->> 'still_off')::int = 1, 'a phone that is still off is reminded about');
  v := public.attendance_health_check(now());
  perform pg_temp.ok((v ->> 'still_off')::int = 0, 'but only once while the reminder is unread');

  -- forgotten check-out
  delete from public.notifications;
  insert into public.mgmt_attendance (staff_id, user_id, business_date, at, kind, status, source)
  values ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000c1', ((now() - interval '5 hours') at time zone 'Asia/Karachi')::date, now() - interval '5 hours', 'in', 'accepted', 'web');
  v := public.attendance_health_check(now());
  perform pg_temp.ok((v ->> 'checkout_missed')::int = 0, 'five hours in is a normal day');
  insert into public.mgmt_attendance (staff_id, user_id, business_date, at, kind, status, source)
  values (staff1, '00000000-0000-0000-0000-0000000000b1', ((now() - interval '15 hours') at time zone 'Asia/Karachi')::date, now() - interval '15 hours', 'in', 'accepted', 'auto');
  v := public.attendance_health_check(now());
  perform pg_temp.ok((v ->> 'checkout_missed')::int = 1, 'a check-in open for 15 hours is reported as a forgotten check-out');
  v := public.attendance_health_check(now());
  perform pg_temp.ok((v ->> 'checkout_missed')::int = 0, 'and only once');
  perform pg_temp.ok(not exists (select 1 from public.notifications where kind = 'attendance.checkout_missed' and payload::text ~* 'Junior'), 'the alert carries no name');
  insert into public.mgmt_attendance (staff_id, user_id, business_date, at, kind, status, source)
  values (staff1, '00000000-0000-0000-0000-0000000000b1', (now() at time zone 'Asia/Karachi')::date, now() - interval '1 hour', 'out', 'accepted', 'auto');
  delete from public.notifications;
  v := public.attendance_health_check(now());
  perform pg_temp.ok((v ->> 'checkout_missed')::int = 0, 'a check-in that was closed is not reported');

  -- who is at work
  insert into public.mgmt_attendance (staff_id, user_id, business_date, at, kind, status, source)
  values (staff1, '00000000-0000-0000-0000-0000000000b1', (now() at time zone 'Asia/Karachi')::date, now() - interval '10 minutes', 'in', 'accepted', 'auto');
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  v := public.mgmt_attendance_health();
  perform pg_temp.ok((v -> 'people' -> 0 ->> 'at_work')::boolean and v -> 'people' -> 0 ->> 'source' = 'auto', 'the list shows who is at work now');
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal1');
  perform pg_temp.fails($f$select public.mgmt_attendance_health()$f$, 'the owner list needs the second factor like the rest of the owner pages')
    ;
  reset role;
end $t$;
rollback;
