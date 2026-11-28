-- Tests for 1406_app_ios_attendance: iPhone attendance in the same system as Android.
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
-- the status of one person in the owner's phone list
create function pg_temp.person(p_staff uuid) returns jsonb language sql as $$
  select e from jsonb_array_elements(public.mgmt_attendance_phones() -> 'people') e where e ->> 'staff_id' = p_staff::text $$;

insert into auth.users(id, email) values ('00000000-0000-0000-0000-0000000000a1','a@t'),('00000000-0000-0000-0000-0000000000b1','j@t'),
  ('00000000-0000-0000-0000-0000000000c1','s@t'),('00000000-0000-0000-0000-0000000000d1','t@t');
select public.bootstrap_first_admin('00000000-0000-0000-0000-0000000000a1','owner','Test Owner');
insert into public.staff(id, full_name) values ('10000000-0000-0000-0000-000000000001','Junior One'),('10000000-0000-0000-0000-000000000002','Senior Two'),
  ('10000000-0000-0000-0000-000000000003','Third Person'),('10000000-0000-0000-0000-000000000004','No Login');
insert into public.profiles(user_id, staff_id, username, role_template) values
  ('00000000-0000-0000-0000-0000000000b1','10000000-0000-0000-0000-000000000001','junior1','junior'),
  ('00000000-0000-0000-0000-0000000000c1','10000000-0000-0000-0000-000000000002','senior1','senior'),
  ('00000000-0000-0000-0000-0000000000d1','10000000-0000-0000-0000-000000000003','junior3','junior');
insert into public.user_permissions(user_id, perm_key, effect) values
  ('00000000-0000-0000-0000-0000000000b1', 'attendance.check_in', 'grant'),
  ('00000000-0000-0000-0000-0000000000d1', 'attendance.check_in', 'grant');

-- place centre 10, 20 (radius 100 m). 0.0005 degrees of latitude is about 55 m; 0.0006 about 67 m; 0.0015 about 167 m; 0.002 about 222 m.
do $t$ declare
  v jsonb; k uuid; n int; r record; site uuid; tok text; tok2 text; ios uuid; ios2 uuid; cur text; old text; n1 text; n2 text; n3 text; n4 text; sa text;
  adev uuid := '20000000-0000-0000-0000-0000000000d1'; ddev uuid := '20000000-0000-0000-0000-0000000000d3';
  s1 uuid := '10000000-0000-0000-0000-000000000001'; s2 uuid := '10000000-0000-0000-0000-000000000002';
  s3 uuid := '10000000-0000-0000-0000-000000000003'; s4 uuid := '10000000-0000-0000-0000-000000000004';
  u1 uuid := '00000000-0000-0000-0000-0000000000b1'; u3 uuid := '00000000-0000-0000-0000-0000000000d1'; own uuid := '00000000-0000-0000-0000-0000000000a1';
  t0 timestamptz := now() - interval '5 hours';
begin
  perform pg_temp.as_user(own, 'aal2');
  site := (public.mgmt_attendance_site_save(null, 'Test Shop', 10, 20, 100, true, 'first place', gen_random_uuid()) ->> 'id')::uuid;
  perform public.mgmt_attendance_auto_set(true, 'phone test passed', gen_random_uuid());
  reset role;
  perform pg_temp.ok((select ios_arrive_margin_m = 100 and ios_leave_min_m = 50 from public.mgmt_attendance_config), 'the iPhone distances default to 100 m and 50 m');

  -- ───────── Android is unchanged ─────────
  perform pg_temp.as_user(u1);
  perform public.app_device_register(adev, repeat('a', 40), '1.0', false);
  sa := public.app_device_attendance_enroll(adev) ->> 'secret';
  reset role;
  v := public.app_attendance_event(adev, pg_temp.hash(sa), gen_random_uuid(), 'in', t0 - interval '2 hours', 10.0005, 20, 12, false);
  perform pg_temp.ok(v ->> 'status' = 'accepted' and not v ? 'next_secret', 'an Android arrival is recorded and its answer has no rolling secret');
  perform pg_temp.fails(format('select public.app_attendance_event(%L, %L, gen_random_uuid(), %L, now(), 10, 20, null, false)', adev, pg_temp.hash(sa), 'in'),
    'an Android event without an accuracy is still an error');
  v := public.app_attendance_event(adev, pg_temp.hash(sa), gen_random_uuid(), 'out', t0 - interval '105 minutes', 10.002, 20, 12, false);
  perform pg_temp.ok(v ->> 'status' = 'accepted', 'an Android departure outside the radius is recorded');
  v := public.app_attendance_event(adev, pg_temp.hash(sa), gen_random_uuid(), 'in', t0 - interval '100 minutes', 10.0015, 20, 12, false);
  perform pg_temp.ok(v ->> 'status' = 'rejected' and v ->> 'reason' = 'outside', 'Android has no margin: 167 m is outside the 100 m radius');
  perform pg_temp.ok((select stale_secret_count from public.app_devices where id = adev) = 0
                     and public.app_attendance_event(adev, pg_temp.hash('wrong'), gen_random_uuid(), 'in', t0, 10, 20, 12, false) is null
                     and (select stale_secret_count from public.app_devices where id = adev) = 0, 'a wrong Android secret is refused and not counted');
  perform pg_temp.ok((select count(*) from public.mgmt_attendance_auto_events where platform = 'android') >= 3, 'the history marks these events as Android');

  -- ───────── the owner makes an enrolment code ─────────
  perform pg_temp.as_user(u1);
  perform pg_temp.fails(format('select public.mgmt_attendance_ios_enrol_create(%L, false, %L, gen_random_uuid())', s1, 'self'), 'staff cannot make a code, not even for themselves');
  reset role;
  perform pg_temp.as_user(own, 'aal1');
  perform pg_temp.fails(format('select public.mgmt_attendance_ios_enrol_create(%L, false, %L, gen_random_uuid())', s1, 'no authenticator'), 'the owner needs the authenticator code too');
  reset role;
  perform pg_temp.as_user(own, 'aal2');
  perform pg_temp.fails(format('select public.mgmt_attendance_ios_enrol_create(%L, false, %L, gen_random_uuid())', s1, ''), 'a reason is required');
  perform pg_temp.fails(format('select public.mgmt_attendance_ios_enrol_create(%L, false, %L, gen_random_uuid())', s4, 'iphone'), 'a person with no Dua login cannot be enrolled');
  perform pg_temp.fails(format('select public.mgmt_attendance_ios_enrol_create(%L, false, %L, gen_random_uuid())', s2, 'iphone'), 'a person without the check-in right cannot be enrolled');
  perform pg_temp.ok(pg_temp.person(s1) ->> 'status' = 'not_set_up', 'before enrolment the person is "not set up"');
  perform pg_temp.ok(pg_temp.person(s4) -> 'issues' ? 'needs_login' and pg_temp.person(s2) -> 'issues' ? 'needs_check_in_right', 'the owner is told why those two cannot be enrolled');

  k := gen_random_uuid();
  v := public.mgmt_attendance_ios_enrol_create(s1, false, 'new iPhone', k);
  tok := v ->> 'token';
  perform pg_temp.ok(length(tok) = 64 and (v ->> 'expires_at')::timestamptz between now() + interval '14 minutes' and now() + interval '16 minutes', 'a code is made once and lasts 15 minutes');
  v := public.mgmt_attendance_ios_enrol_create(s1, false, 'new iPhone', k);
  perform pg_temp.ok(not v ? 'token', 'the same request again returns no code');
  perform pg_temp.ok(pg_temp.person(s1) ->> 'status' = 'waiting', 'the person is "waiting for the phone"');
  reset role;
  perform pg_temp.ok((select count(*) from public.app_device_enrolments where staff_id = s1) = 1, 'and makes no second one');
  perform pg_temp.ok(not exists (select 1 from public.app_device_enrolments where token_hash = tok) and exists (select 1 from public.app_device_enrolments where token_hash = pg_temp.hash(tok)),
    'only the hash of the code is stored');
  perform pg_temp.ok(not exists (select 1 from public.mgmt_save_keys where result::text like '%' || tok || '%'), 'the idempotency record never holds the code');
  perform pg_temp.ok(not exists (select 1 from public.activity_log where new_value::text like '%' || tok || '%' or reason like '%' || tok || '%'), 'the log never holds the code');
  perform pg_temp.ok(exists (select 1 from public.activity_log where action = 'attendance.ios_enrol_created'), 'making a code is logged');

  -- a newer code cancels the older one
  perform pg_temp.as_user(own, 'aal2');
  tok2 := public.mgmt_attendance_ios_enrol_create(s1, false, 'again', gen_random_uuid()) ->> 'token';
  reset role;
  perform pg_temp.ok(public.app_ios_enrol_peek(pg_temp.hash(tok)) is null, 'an older code stops working when a newer one is made');
  perform pg_temp.ok(public.app_ios_enrol_consume(pg_temp.hash(tok), 'x') is null, 'and cannot be used');
  tok := tok2;

  -- ───────── the setup shortcut ─────────
  perform pg_temp.ok(public.app_ios_enrol_peek(pg_temp.hash('wrong')) is null and public.app_ios_enrol_consume(pg_temp.hash('wrong'), 'x') is null, 'a wrong code gives the same empty answer');
  v := public.app_ios_enrol_peek(pg_temp.hash(tok));
  perform pg_temp.ok(v ->> 'name' = 'Junior', 'the shortcut is shown the first name only');
  perform pg_temp.ok((select count(*) from public.app_devices where platform = 'ios_shortcuts') = 0, 'looking at the code uses nothing up');
  v := public.app_ios_enrol_consume(pg_temp.hash(tok), 'Ayesha''s iPhone');
  ios := (v ->> 'device_id')::uuid; cur := v ->> 'secret';
  perform pg_temp.ok(ios is not null and length(cur) = 64 and v ->> 'name' = 'Junior', 'the code is swapped for a device id and a secret');
  perform pg_temp.ok(public.app_ios_enrol_consume(pg_temp.hash(tok), 'x') is null and public.app_ios_enrol_peek(pg_temp.hash(tok)) is null, 'a code works once');
  select * into r from public.app_devices where id = ios;
  perform pg_temp.ok(r.platform = 'ios_shortcuts' and r.user_id = u1 and r.enrolled_by = own and r.attendance_secret_hash = pg_temp.hash(cur), 'the device belongs to the person the owner chose, and only the hash is stored');
  perform pg_temp.ok(not exists (select 1 from public.app_devices where attendance_secret_hash = cur or cur = any (attendance_next_hashes)), 'the secret itself is not stored anywhere');
  perform pg_temp.ok(public.app_attendance_event(adev, pg_temp.hash(sa), gen_random_uuid(), 'in', t0, 10.0005, 20, 12, false) is null, 'the person''s Android key was retired (one device per person)');

  -- one person, one active iPhone; Android cannot take a key or take over the iPhone row
  perform pg_temp.as_user(u1);
  perform pg_temp.fails(format('select public.app_device_attendance_enroll(%L)', adev), 'the Android app cannot enrol while an iPhone is active');
  perform pg_temp.fails(format('select public.app_device_register(%L, null, %L, false)', ios, '9.9'), 'the iPhone row cannot be taken over through the Android registration');
  perform public.app_device_unregister(ios);
  perform public.app_widget_clear(ios);
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  perform pg_temp.fails(format('select public.app_device_register(%L, null, %L, false)', ios, '9.9'), 'nor by another person');
  reset role;
  perform pg_temp.ok(exists (select 1 from public.app_devices where id = ios and attendance_secret_hash = pg_temp.hash(cur) and user_id = u1), 'the iPhone row is untouched by the Android functions');
  begin
    insert into public.app_devices (id, user_id, platform, attendance_secret_hash) values (gen_random_uuid(), u1, 'ios_shortcuts', pg_temp.hash('other'));
    raise exception 'FAIL: a second active iPhone for one person was allowed';
  exception when unique_violation then raise notice 'pass: the database allows only one active iPhone per person';
  end;
  perform pg_temp.fails($f$insert into public.app_devices (id, user_id, platform) values (gen_random_uuid(), '00000000-0000-0000-0000-0000000000b1', 'windows')$f$, 'only android and ios_shortcuts exist');
  perform pg_temp.as_user(own, 'aal2');
  perform pg_temp.ok(pg_temp.person(s1) ->> 'status' = 'set_up' and (pg_temp.person(s1) ->> 'android_active')::boolean = false, 'the owner sees "phone set up"; the Android key is gone');
  reset role;

  -- ───────── the setup test and the confirmation ─────────
  v := public.app_attendance_ios_signal(ios, pg_temp.hash(cur), 'test', 10.01, 20, 10);
  perform pg_temp.ok(v ->> 'status' = 'outside' and (select test_ok_at from public.app_devices where id = ios) is null, 'a test far from the pharmacy says "outside" and does not count');
  cur := v ->> 'next_secret';
  v := public.app_attendance_ios_signal(ios, pg_temp.hash(cur), 'test', 10.0005, 20, 300);
  perform pg_temp.ok(v ->> 'status' = 'weak_signal', 'a test with a weak signal says so');
  cur := v ->> 'next_secret';
  v := public.app_attendance_ios_signal(ios, pg_temp.hash(cur), 'test', 10.0015, 20, null);
  perform pg_temp.ok(v ->> 'status' = 'outside', 'with no accuracy the plain radius applies (167 m is outside 100 m)');
  cur := v ->> 'next_secret';
  v := public.app_attendance_ios_signal(ios, pg_temp.hash(cur), 'test', 10.0015, 20, 30);
  perform pg_temp.ok(v ->> 'status' = 'ok' and v ->> 'place' = 'Test Shop' and (select test_ok_at from public.app_devices where id = ios) is not null, 'at the edge, with an accuracy, the test passes (radius + margin)');
  cur := v ->> 'next_secret';
  perform pg_temp.ok((select count(*) from public.mgmt_attendance) = 3 and (select count(*) from public.mgmt_attendance_auto_events where platform = 'ios_shortcuts') = 0, 'a test records nothing in attendance');
  perform pg_temp.as_user(own, 'aal2');
  perform pg_temp.ok(pg_temp.person(s1) ->> 'status' = 'tested' and pg_temp.person(s1) -> 'issues' ? 'not_confirmed', 'the owner sees "tested" and "not confirmed"');
  reset role;
  v := public.app_attendance_ios_signal(ios, pg_temp.hash(cur), 'confirm', null, null, null);
  perform pg_temp.ok(v ->> 'status' = 'confirmed' and (select confirmed_at from public.app_devices where id = ios) is not null, 'the employee confirms both automations (their word)');
  cur := v ->> 'next_secret';
  perform pg_temp.fails(format('select public.app_attendance_ios_signal(%L, %L, %L, 95, 20, 10)', ios, pg_temp.hash(cur), 'test'), 'a test with a bad latitude is an error');
  perform pg_temp.fails(format('select public.app_attendance_ios_signal(%L, %L, %L, null, null, null)', ios, pg_temp.hash(cur), 'sideways'), 'an unknown signal is an error');
  perform pg_temp.as_user(own, 'aal2');
  perform pg_temp.ok(pg_temp.person(s1) ->> 'status' = 'confirmed', 'the owner sees "confirmed by the employee"');
  reset role;

  -- an Android phone cannot use the iPhone-only calls
  perform pg_temp.as_user(u3);
  perform public.app_device_register(ddev, repeat('d', 40), '1.0', false);
  old := public.app_device_attendance_enroll(ddev) ->> 'secret';
  reset role;
  perform pg_temp.ok(public.app_attendance_ios_signal(ddev, pg_temp.hash(old), 'confirm', null, null, null) is null, 'an Android device cannot send test or confirm');

  -- ───────── events from the iPhone ─────────
  v := public.app_attendance_event(ios, pg_temp.hash(cur), gen_random_uuid(), 'in', t0, 10.0005, 20, null, false);
  perform pg_temp.ok(v ->> 'status' = 'accepted' and v ->> 'place' = 'Test Shop', 'an iPhone arrival inside the place is recorded, even with no accuracy');
  cur := v ->> 'next_secret';
  perform pg_temp.ok(length(cur) = 64, 'and the answer carries the next secret');
  select * into r from public.mgmt_attendance where staff_id = s1 and at = t0;
  perform pg_temp.ok(r.source = 'auto' and r.user_id = u1 and r.kind = 'in', 'it is an ordinary attendance row: source auto, for the person who owns the phone');
  perform pg_temp.ok((select platform from public.mgmt_attendance_auto_events where attendance_id = r.id) = 'ios_shortcuts', 'the history marks it as iPhone');
  perform pg_temp.ok((select first_event_at is not null and last_event_at is not null from public.app_devices where id = ios), 'the phone''s first and last activity are kept');

  -- the same event id again: same answer, nothing new
  k := gen_random_uuid();
  v := public.app_attendance_event(ios, pg_temp.hash(cur), k, 'out', t0 + interval '30 minutes', 10.0004, 20, 20, false);
  perform pg_temp.ok(v ->> 'status' = 'rejected' and v ->> 'reason' = 'still_inside', 'an iPhone departure only 44 m from the place is refused (needs at least 50 m)');
  cur := v ->> 'next_secret';
  v := public.app_attendance_event(ios, pg_temp.hash(cur), k, 'out', t0 + interval '30 minutes', 10.0004, 20, 20, false);
  perform pg_temp.ok((v ->> 'duplicate')::boolean and v ->> 'reason' = 'still_inside' and (select count(*) from public.mgmt_attendance where staff_id = s1) = 5, 'the same event id is answered again and recorded once');
  cur := v ->> 'next_secret';

  -- iPhone rules differ from Android: out at 67 m is fine (Android would call it still inside), mock is never used
  v := public.app_attendance_event(ios, pg_temp.hash(cur), gen_random_uuid(), 'out', t0 + interval '1 hour', 10.0006, 20, 20, true);
  perform pg_temp.ok(v ->> 'status' = 'accepted', 'an iPhone departure 67 m away is recorded, and a "mock" flag from an iPhone is ignored');
  cur := v ->> 'next_secret';
  v := public.app_attendance_event(ios, pg_temp.hash(cur), gen_random_uuid(), 'in', t0 + interval '2 hours', 10.0015, 20, 20, false);
  perform pg_temp.ok(v ->> 'status' = 'accepted' and (v ->> 'distance_m')::numeric > 100, 'an iPhone arrival 167 m away is recorded (inside radius + margin)');
  cur := v ->> 'next_secret';
  v := public.app_attendance_event(ios, pg_temp.hash(cur), gen_random_uuid(), 'out', t0 + interval '3 hours', 10.003, 20, 20, false);
  perform pg_temp.ok(v ->> 'status' = 'accepted', 'a real departure is recorded');
  cur := v ->> 'next_secret';

  perform pg_temp.as_user(own, 'aal2');
  perform pg_temp.ok(pg_temp.person(s1) ->> 'status' = 'working', 'after a real event the person is "working"');
  k := gen_random_uuid();
  perform public.mgmt_attendance_ios_set(0, 50, 'test no margin', k);
  perform pg_temp.fails($f$select public.mgmt_attendance_ios_set(600, 50, 'too big', gen_random_uuid())$f$, 'a distance above 500 m is refused');
  perform pg_temp.fails($f$select public.mgmt_attendance_ios_set(100, 50, '', gen_random_uuid())$f$, 'the setting needs a reason');
  reset role;
  v := public.app_attendance_event(ios, pg_temp.hash(cur), gen_random_uuid(), 'in', now() - interval '40 minutes', 10.0015, 20, 20, false);
  perform pg_temp.ok(v ->> 'status' = 'rejected' and v ->> 'reason' = 'outside', 'with the margin set to 0, 167 m is outside');
  cur := v ->> 'next_secret';
  perform pg_temp.as_user(own, 'aal2');
  perform public.mgmt_attendance_ios_set(100, 50, 'back to normal', gen_random_uuid());
  perform pg_temp.ok((public.mgmt_attendance_setup() -> 'config' ->> 'ios_arrive_margin_m')::int = 100, 'the owner''s setup shows the iPhone distances');
  perform pg_temp.fails(format('select public.mgmt_attendance_ios_set(0, 0, %L, gen_random_uuid())', 'x'), 'a one-letter reason is refused');
  reset role;
  perform pg_temp.as_user(u1);
  perform pg_temp.fails($f$select public.mgmt_attendance_ios_set(500, 500, 'sneaky', gen_random_uuid())$f$, 'staff cannot change the iPhone distances');
  reset role;
  v := public.app_attendance_event(ios, pg_temp.hash(cur), gen_random_uuid(), 'in', now() - interval '30 minutes', 10.0025, 20, 20, false);
  perform pg_temp.ok(v ->> 'status' = 'rejected' and v ->> 'reason' = 'outside', 'an iPhone arrival 278 m away is outside radius + margin');
  cur := v ->> 'next_secret';
  v := public.app_attendance_event(ios, pg_temp.hash(cur), gen_random_uuid(), 'in', now() - interval '20 minutes', 10.0005, 20, 250, false);
  perform pg_temp.ok(v ->> 'status' = 'rejected' and v ->> 'reason' = 'weak_signal', 'a weak iPhone fix is refused');
  cur := v ->> 'next_secret';
  perform pg_temp.ok(exists (select 1 from public.notifications where kind = 'attendance.ios_rejects'), 'three refused iPhone events in a day alert the owner');
  perform pg_temp.ok(not exists (select 1 from public.notifications where payload::text ~* '(Junior|Ayesha)'), 'alerts carry no names');

  -- stale and bad input
  v := public.app_attendance_event(ios, pg_temp.hash(cur), gen_random_uuid(), 'in', now() - interval '2 days', 10.0005, 20, 20, false);
  perform pg_temp.ok(v ->> 'status' = 'ignored' and v ->> 'reason' = 'stale', 'an old iPhone event is ignored');
  cur := v ->> 'next_secret';
  perform pg_temp.fails(format('select public.app_attendance_event(%L, %L, gen_random_uuid(), %L, now(), 10, 20, 10, false)', ios, pg_temp.hash(cur), 'test'), 'the event function does not accept a test');
  perform pg_temp.fails(format('select public.app_attendance_event(%L, %L, gen_random_uuid(), %L, now(), 95, 20, 10, false)', ios, pg_temp.hash(cur), 'in'), 'a latitude beyond 90 is an error');

  -- ───────── the rolling secret ─────────
  n1 := null;
  v := public.app_attendance_event(ios, pg_temp.hash(cur), gen_random_uuid(), 'in', t0 + interval '10 hours', 10, 20, 20, false);   -- later than now: stale, still rolls
  n1 := v ->> 'next_secret';
  v := public.app_attendance_event(ios, pg_temp.hash(cur), gen_random_uuid(), 'in', t0 + interval '10 hours', 10, 20, 20, false);
  n2 := v ->> 'next_secret';
  perform pg_temp.ok(n1 <> n2 and n1 is not null and n2 is not null, 'each answer carries a fresh secret');
  perform pg_temp.ok(public.app_attendance_event(ios, pg_temp.hash(cur), gen_random_uuid(), 'in', now() - interval '3 days', 10, 20, 20, false) is not null, 'the current secret keeps working until a next one is used');
  v := public.app_attendance_event(ios, pg_temp.hash(n1), gen_random_uuid(), 'in', now() - interval '3 days', 10, 20, 20, false);
  perform pg_temp.ok(v is not null, 'using a next secret works (two runs at once can save either)');
  n3 := v ->> 'next_secret';
  old := cur;
  perform pg_temp.ok(public.app_attendance_event(ios, pg_temp.hash(old), gen_random_uuid(), 'in', now() - interval '3 days', 10, 20, 20, false) is null, 'and the old secret then stops working');
  perform pg_temp.ok(public.app_attendance_event(ios, pg_temp.hash(n2), gen_random_uuid(), 'in', now() - interval '3 days', 10, 20, 20, false) is null, 'so does a next secret that was not the one used');
  perform pg_temp.ok((select stale_secret_count from public.app_devices where id = ios) = 2 and (select stale_secret_at is not null from public.app_devices where id = ios), 'each refused secret is counted');
  perform pg_temp.ok((select count(*) from public.notifications where kind = 'attendance.key_refused') = 1, 'the owner is alerted once a day, not once per attempt');
  cur := n3;
  perform pg_temp.as_user(own, 'aal2');
  perform pg_temp.ok(pg_temp.person(s1) -> 'issues' ? 'key_refused', 'the owner sees "key refused: possible copy"');
  reset role;
  perform pg_temp.ok(public.app_attendance_event(ios, pg_temp.hash('a wrong guess'), gen_random_uuid(), 'in', now() - interval '3 days', 10, 20, 20, false) is null, 'a wrong guess is refused');
  -- no more than three secrets are outstanding
  v := public.app_attendance_event(ios, pg_temp.hash(cur), gen_random_uuid(), 'in', now() - interval '3 days', 10, 20, 20, false); n1 := v ->> 'next_secret';
  v := public.app_attendance_event(ios, pg_temp.hash(cur), gen_random_uuid(), 'in', now() - interval '3 days', 10, 20, 20, false); n2 := v ->> 'next_secret';
  v := public.app_attendance_event(ios, pg_temp.hash(cur), gen_random_uuid(), 'in', now() - interval '3 days', 10, 20, 20, false); n3 := v ->> 'next_secret';
  v := public.app_attendance_event(ios, pg_temp.hash(cur), gen_random_uuid(), 'in', now() - interval '3 days', 10, 20, 20, false); n4 := v ->> 'next_secret';
  perform pg_temp.ok((select cardinality(attendance_next_hashes) from public.app_devices where id = ios) = 3, 'at most three unused secrets are kept');
  perform pg_temp.ok(public.app_attendance_event(ios, pg_temp.hash(n1), gen_random_uuid(), 'in', now() - interval '3 days', 10, 20, 20, false) is null, 'the oldest unused secret has been dropped');
  v := public.app_attendance_event(ios, pg_temp.hash(n4), gen_random_uuid(), 'in', now() - interval '3 days', 10, 20, 20, false);
  perform pg_temp.ok(v is not null, 'the newest works');
  cur := v ->> 'next_secret';
  -- an error undoes the roll, so the phone is never left holding a secret the server has not recorded
  perform pg_temp.fails(format('select public.app_attendance_event(%L, %L, gen_random_uuid(), %L, now(), 95, 20, 10, false)', ios, pg_temp.hash(cur), 'in'), 'a bad event is an error');
  perform pg_temp.ok((select cardinality(attendance_next_hashes) from public.app_devices where id = ios) = 1, 'and it does not issue a secret');

  -- losing the right stops the phone at once, without counting as a copy
  delete from public.user_permissions where user_id = u1 and perm_key = 'attendance.check_in';
  n := (select stale_secret_count from public.app_devices where id = ios);
  perform pg_temp.ok(public.app_attendance_event(ios, pg_temp.hash(cur), gen_random_uuid(), 'in', now() - interval '3 days', 10, 20, 20, false) is null, 'a person who lost the right is refused');
  perform pg_temp.ok((select stale_secret_count from public.app_devices where id = ios) = n, 'and that is not counted as a copied secret');
  insert into public.user_permissions(user_id, perm_key, effect) values (u1, 'attendance.check_in', 'grant');

  -- ───────── monitoring does not misread an iPhone ─────────
  update public.app_devices set last_seen_at = now() - interval '3 days' where id = ios;
  perform public.attendance_health_check(date_trunc('day', now() at time zone 'Asia/Karachi') at time zone 'Asia/Karachi' + interval '12 hours');
  perform pg_temp.ok((select health_state is null from public.app_devices where id = ios) and not exists (select 1 from public.mgmt_attendance_tracking_log where device_id = ios),
    'the silent-phone check never marks an iPhone as silent');
  perform pg_temp.as_user(own, 'aal2');
  select e into v from jsonb_array_elements(public.mgmt_attendance_health() -> 'people') e where e ->> 'staff_id' = s1::text;
  perform pg_temp.ok(v -> 'phone' ->> 'platform' = 'ios_shortcuts' and v -> 'phone' ->> 'setup' = 'working', 'who-is-at-work says it is an iPhone and how far its setup got');

  -- ───────── the journal ─────────
  perform pg_temp.ok(jsonb_array_length(public.mgmt_attendance_device_journal(ios, 50)) >= 8, 'the journal lists the phone''s events');
  perform pg_temp.ok(jsonb_array_length(public.mgmt_attendance_device_journal(ios, 2)) = 2, 'and respects the limit');
  reset role;
  perform pg_temp.as_user(u1);
  perform pg_temp.fails(format('select public.mgmt_attendance_device_journal(%L, 5)', ios), 'staff cannot read a journal');
  perform pg_temp.fails(format('select public.mgmt_attendance_phones()'), 'staff cannot read the phone list');
  perform pg_temp.fails($f$select * from public.app_device_enrolments$f$, 'nobody reads the enrolment table directly');
  reset role;

  -- ───────── an expired and a cancelled code ─────────
  perform pg_temp.as_user(own, 'aal2');
  v := public.mgmt_attendance_ios_enrol_create(s3, false, 'third phone', gen_random_uuid());
  tok := v ->> 'token';
  perform pg_temp.ok(pg_temp.person(s3) ->> 'status' = 'waiting', 'a person with an open code is waiting');
  perform public.mgmt_attendance_ios_enrol_cancel((v ->> 'enrolment_id')::uuid, 'wrong person', gen_random_uuid());
  perform pg_temp.fails(format('select public.mgmt_attendance_ios_enrol_cancel(%L, %L, gen_random_uuid())', v ->> 'enrolment_id', ''), 'cancelling needs a reason');
  reset role;
  perform pg_temp.ok(public.app_ios_enrol_peek(pg_temp.hash(tok)) is null and public.app_ios_enrol_consume(pg_temp.hash(tok), 'x') is null, 'a cancelled code does not work');
  perform pg_temp.as_user(own, 'aal2');
  v := public.mgmt_attendance_ios_enrol_create(s3, false, 'third phone again', gen_random_uuid());
  tok := v ->> 'token';
  reset role;
  update public.app_device_enrolments set expires_at = now() - interval '1 second' where token_hash = pg_temp.hash(tok);
  perform pg_temp.ok(public.app_ios_enrol_peek(pg_temp.hash(tok)) is null and public.app_ios_enrol_consume(pg_temp.hash(tok), 'x') is null, 'an expired code does not work');
  perform pg_temp.as_user(own, 'aal2');
  perform pg_temp.ok(pg_temp.person(s3) -> 'issues' ? 'code_expired', 'the owner sees an expired code as an incomplete setup');
  reset role;
  -- the person loses the right before using the code
  perform pg_temp.as_user(own, 'aal2');
  tok := public.mgmt_attendance_ios_enrol_create(s3, false, 'third phone, last try', gen_random_uuid()) ->> 'token';
  reset role;
  delete from public.user_permissions where user_id = u3 and perm_key = 'attendance.check_in';
  perform pg_temp.ok(public.app_ios_enrol_peek(pg_temp.hash(tok)) is null and public.app_ios_enrol_consume(pg_temp.hash(tok), 'x') is null, 'a code is refused if the person no longer has the right');
  insert into public.user_permissions(user_id, perm_key, effect) values (u3, 'attendance.check_in', 'grant');

  -- ───────── replacing a phone ─────────
  perform pg_temp.as_user(own, 'aal2');
  perform pg_temp.fails(format('select public.mgmt_attendance_ios_enrol_create(%L, false, %L, gen_random_uuid())', s1, 'new phone'), 'a second code is refused while the person has an active iPhone');
  v := public.mgmt_attendance_ios_enrol_create(s1, true, 'lost phone, replacing', gen_random_uuid());
  tok := v ->> 'token';
  reset role;
  perform pg_temp.ok((select attendance_secret_hash is null and revoked_at is not null and revoked_by = own from public.app_devices where id = ios), 'replacing revokes the old phone');
  perform pg_temp.ok(public.app_attendance_event(ios, pg_temp.hash(cur), gen_random_uuid(), 'in', now() - interval '3 days', 10, 20, 20, false) is null, 'the old phone is refused from then on');
  perform pg_temp.ok((select stale_secret_count from public.app_devices where id = ios) = n, 'and a revoked phone is not counted as a copy');
  v := public.app_ios_enrol_consume(pg_temp.hash(tok), 'New iPhone');
  ios2 := (v ->> 'device_id')::uuid; old := v ->> 'secret';
  perform pg_temp.ok(ios2 <> ios and (select count(*) from public.app_devices where user_id = u1 and platform = 'ios_shortcuts' and attendance_secret_hash is not null) = 1, 'the new phone is the only active one');
  perform pg_temp.as_user(own, 'aal2');
  perform pg_temp.ok((pg_temp.person(s1) -> 'device' ->> 'id')::uuid = ios2, 'the owner''s list shows the new phone');
  -- revoke
  perform pg_temp.fails(format('select public.mgmt_attendance_device_revoke(%L, %L, gen_random_uuid())', ios2, ''), 'revoking needs a reason');
  perform pg_temp.fails(format('select public.mgmt_attendance_device_revoke(%L, %L, gen_random_uuid())', ios, 'again'), 'a phone that is already revoked cannot be revoked again');
  perform pg_temp.fails(format('select public.mgmt_attendance_device_revoke(%L, %L, gen_random_uuid())', adev, 'android'), 'only iPhones are revoked here');
  k := gen_random_uuid();
  perform public.mgmt_attendance_device_revoke(ios2, 'phone lost', k);
  perform public.mgmt_attendance_device_revoke(ios2, 'phone lost', k);
  perform pg_temp.ok(pg_temp.person(s1) ->> 'status' = 'revoked' and pg_temp.person(s1) -> 'device' ->> 'revoked_reason' = 'phone lost', 'the owner sees "revoked" with the reason');
  reset role;
  perform pg_temp.ok(public.app_attendance_event(ios2, pg_temp.hash(old), gen_random_uuid(), 'in', now() - interval '3 days', 10, 20, 20, false) is null, 'a revoked phone is refused');
  perform pg_temp.ok(exists (select 1 from public.activity_log where action = 'attendance.device_revoked'), 'revoking is logged');
  perform pg_temp.as_user(u1);
  perform pg_temp.fails(format('select public.mgmt_attendance_device_revoke(%L, %L, gen_random_uuid())', ios2, 'sneaky'), 'staff cannot revoke');
  reset role;

  -- ───────── back to Android after the iPhone is revoked ─────────
  perform pg_temp.as_user(u1);
  sa := public.app_device_attendance_enroll(adev) ->> 'secret';
  reset role;
  v := public.app_attendance_event(adev, pg_temp.hash(sa), gen_random_uuid(), 'in', now() - interval '1 minute', 10.0005, 20, 12, false);
  perform pg_temp.ok(v ->> 'status' = 'accepted' and not v ? 'next_secret', 'after the iPhone is revoked the person''s Android phone can enrol and record again, unchanged');

  -- ───────── exposure ─────────
  set local role anon;
  perform pg_temp.fails(format('select public.app_ios_enrol_consume(%L, %L)', repeat('0', 64), 'x'), 'anon cannot consume a code');
  perform pg_temp.fails(format('select public.app_ios_enrol_peek(%L)', repeat('0', 64)), 'anon cannot look at a code');
  perform pg_temp.fails(format('select public.mgmt_attendance_ios_enrol_create(%L, false, %L, gen_random_uuid())', s1, 'anon'), 'anon cannot make a code');
  reset role;
  perform pg_temp.as_user(u1);
  perform pg_temp.fails(format('select public.app_ios_enrol_consume(%L, %L)', repeat('0', 64), 'x'), 'a signed-in person cannot consume a code through the database');
  perform pg_temp.fails(format('select public.app_attendance_ios_signal(%L, %L, %L, null, null, null)', ios2, repeat('0', 64), 'confirm'), 'nor send a signal');
  perform pg_temp.fails(format('select * from public.app_attendance_device_auth(%L, %L)', ios2, repeat('0', 64)), 'nor call the internal device check');
  reset role;
  perform pg_temp.ok(not has_function_privilege('service_role', 'public.app_attendance_device_auth(uuid, text)', 'execute'), 'the internal device check is not exposed even to the service role');
end $t$;
rollback;
