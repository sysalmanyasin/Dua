\set ON_ERROR_STOP on
begin;
create function pg_temp.as_user(uid uuid, lvl text default 'aal1') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'aal', lvl, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; raise notice 'pass: %', msg; end $$;
-- true when the statement raises exactly that error code
create function pg_temp.raises(q text, state text) returns boolean language plpgsql as $$
begin execute q; return false; exception when others then return sqlstate = state; end $$;
create function pg_temp.can_verify() returns boolean language sql security definer as $$ select public.task_can_verify() $$;
create function pg_temp.owner() returns void language sql as $$ select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2') $$;
create function pg_temp.junior() returns void language sql as $$ select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1') $$;
create function pg_temp.senior() returns void language sql as $$ select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1') $$;
create function pg_temp.named() returns void language sql as $$ select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1') $$;
create function pg_temp.other() returns void language sql as $$ select pg_temp.as_user('00000000-0000-0000-0000-0000000000e1') $$;

-- Owner (admin), Junior One, Senior Two (not named), Senior Three (named verifier), Junior Four, Ghost (no login)
insert into auth.users(id, email) values ('00000000-0000-0000-0000-0000000000a1','a@t'),('00000000-0000-0000-0000-0000000000b1','j@t'),('00000000-0000-0000-0000-0000000000c1','s@t'),('00000000-0000-0000-0000-0000000000d1','n@t'),('00000000-0000-0000-0000-0000000000e1','o@t');
select public.bootstrap_first_admin('00000000-0000-0000-0000-0000000000a1','owner','Test Owner');
insert into public.staff(id, full_name) values ('10000000-0000-0000-0000-000000000001','Junior One'),('10000000-0000-0000-0000-000000000002','Senior Two'),
  ('10000000-0000-0000-0000-000000000003','Senior Three'),('10000000-0000-0000-0000-000000000004','Junior Four'),('10000000-0000-0000-0000-000000000009','Ghost NoLogin');
insert into public.profiles(user_id, staff_id, username, role_template) values
  ('00000000-0000-0000-0000-0000000000b1','10000000-0000-0000-0000-000000000001','junior1','junior'),
  ('00000000-0000-0000-0000-0000000000c1','10000000-0000-0000-0000-000000000002','senior2','senior'),
  ('00000000-0000-0000-0000-0000000000d1','10000000-0000-0000-0000-000000000003','senior3','senior'),
  ('00000000-0000-0000-0000-0000000000e1','10000000-0000-0000-0000-000000000004','junior4','junior');
-- the owner names Senior Three as a verifier (a personal grant, never a template)
insert into public.user_permissions(user_id, perm_key, effect) values ('00000000-0000-0000-0000-0000000000d1', 'tasks.verify', 'grant');
create function pg_temp.cyc(k text, wd int[], md int, wk int, d date) returns text language sql as $$
  select coalesce((select cycle_key || ' ' || start_on || ' ' || due_on from public.task_cycle(k, wd, md, wk, d)), 'none') $$;
create function pg_temp.items(sid uuid) returns bigint language sql security definer as $$ select count(*) from public.task_items where schedule_id = sid $$;

do $t$
declare sid uuid; sid2 uuid; sid3 uuid; n int; j1 uuid := '10000000-0000-0000-0000-000000000001'; ghost uuid := '10000000-0000-0000-0000-000000000009'; tk record;
begin
  -- ── the pure rule ──
  perform pg_temp.ok(pg_temp.cyc('daily', null, null, null, '2026-11-18') = '2026-11-18 2026-11-18 2026-11-18', 'daily: every day, due the same day');
  perform pg_temp.ok(pg_temp.cyc('weekly', array[1, 3], null, null, '2026-11-23') = '2026-11-23 2026-11-23 2026-11-23', 'weekly: a chosen weekday (Monday)');
  perform pg_temp.ok(pg_temp.cyc('weekly', array[1, 3], null, null, '2026-11-24') = 'none', 'weekly: not on other weekdays');
  perform pg_temp.ok(pg_temp.cyc('monthly', null, 15, null, '2026-11-15') = '2026-11 2026-11-15 2026-11-15', 'monthly: on the chosen day');
  perform pg_temp.ok(pg_temp.cyc('monthly', null, 15, null, '2026-11-16') = 'none', 'monthly: not on other days');
  perform pg_temp.ok(pg_temp.cyc('monthly', null, 31, null, '2026-11-30') = '2026-11 2026-11-30 2026-11-30', 'monthly: day 31 falls on the last day of a 30-day month');
  perform pg_temp.ok(pg_temp.cyc('monthly', null, 31, null, '2026-02-28') = '2026-02 2026-02-28 2026-02-28', 'monthly: day 31 falls on 28 February');
  -- the owner's example: the 3rd week of the month is days 15 to 21, due on the 21st
  perform pg_temp.ok(pg_temp.cyc('nth_week', null, null, 3, '2026-11-14') = 'none', '3rd week: not on the 14th');
  perform pg_temp.ok(pg_temp.cyc('nth_week', null, null, 3, '2026-11-15') = '2026-11-W3 2026-11-15 2026-11-21', '3rd week: starts on the 15th, due on the 21st');
  perform pg_temp.ok(pg_temp.cyc('nth_week', null, null, 3, '2026-11-18') = '2026-11-W3 2026-11-15 2026-11-21', '3rd week: any day inside the window gives the same cycle');
  perform pg_temp.ok(pg_temp.cyc('nth_week', null, null, 3, '2026-11-21') = '2026-11-W3 2026-11-15 2026-11-21', '3rd week: still on the 21st');
  perform pg_temp.ok(pg_temp.cyc('nth_week', null, null, 3, '2026-11-22') = 'none', '3rd week: not on the 22nd');
  perform pg_temp.ok(pg_temp.cyc('nth_week', null, null, 1, '2026-11-03') = '2026-11-W1 2026-11-01 2026-11-07', '1st week is days 1 to 7');
  perform pg_temp.ok(pg_temp.cyc('nth_week', null, null, 4, '2026-02-25') = '2026-02-W4 2026-02-22 2026-02-28', '4th week of a 28-day February ends on the 28th');
  perform pg_temp.ok(pg_temp.cyc('nth_week', null, null, 5, '2026-11-30') = '2026-11-W5 2026-11-29 2026-11-30', '5th week of a 30-day month is the 29th to the 30th');
  perform pg_temp.ok(pg_temp.cyc('nth_week', null, null, 5, '2026-02-28') = 'none', 'a 28-day February has no 5th week');
  perform pg_temp.ok(pg_temp.cyc('nth_week', null, null, 5, '2028-02-29') = '2028-02-W5 2028-02-29 2028-02-29', 'a leap February''s 5th week is the 29th alone');

  -- ── only the Owner manages schedules ──
  perform pg_temp.junior();
  perform pg_temp.ok(pg_temp.raises(format('select public.task_schedule_create(''Expiry check'', '''', ''none'', ''normal'', %L, ''nth_week'', null, null, 3)', j1), '42501'), 'a Junior cannot create a schedule');
  perform pg_temp.ok(pg_temp.raises('select public.task_generate_now()', '42501'), 'a Junior cannot press Generate now');
  perform pg_temp.ok(public.task_schedule_list() is null, 'a Junior cannot list schedules');
  reset role; perform pg_temp.named();
  perform pg_temp.ok(pg_temp.raises('select public.task_generate_now()', '42501'), 'a named verifier cannot press Generate now');
  reset role; perform pg_temp.owner();
  perform pg_temp.ok(pg_temp.raises('select public.task_schedule_create(''Expiry check'', '''', ''none'', ''normal'', null, ''weekly'', null, null, null)', '22023'), 'weekly needs weekdays');
  perform pg_temp.ok(pg_temp.raises('select public.task_schedule_create(''Expiry check'', '''', ''none'', ''normal'', null, ''weekly'', array[8], null, null)', '22023'), 'weekday 8 does not exist');
  perform pg_temp.ok(pg_temp.raises('select public.task_schedule_create(''Expiry check'', '''', ''none'', ''normal'', null, ''monthly'', null, 32, null)', '22023'), 'day 32 does not exist');
  perform pg_temp.ok(pg_temp.raises('select public.task_schedule_create(''Expiry check'', '''', ''none'', ''normal'', null, ''nth_week'', null, null, 6)', '22023'), 'week 6 does not exist');
  perform pg_temp.ok(pg_temp.raises('select public.task_schedule_create(''Expiry check'', '''', ''none'', ''normal'', null, ''yearly'', null, null, null)', '22023'), 'an unknown kind is refused');
  perform pg_temp.ok(pg_temp.raises(format('select public.task_schedule_create(''Expiry check'', '''', ''photo'', ''normal'', %L, ''daily'', null, null, null)', j1), '22023'), 'photo evidence is refused');
  sid := public.task_schedule_create('Expiry check', 'Check every shelf for expiry', 'tick', 'normal', j1, 'nth_week', null, null, 3);
  sid2 := public.task_schedule_create('Daily till check', '', 'none', 'normal', '10000000-0000-0000-0000-000000000004', 'daily', null, null, null);
  perform pg_temp.ok(pg_temp.raises(format('select public.task_schedule_create(''X job'', '''', ''none'', ''normal'', %L, ''daily'', null, null, null)', ghost), '22023'), 'a default person with no login is refused');
  perform pg_temp.ok(jsonb_array_length(public.task_schedule_list()) = 2, 'the Owner lists both schedules');
  perform pg_temp.ok((select (x ->> 'kind') = 'nth_week' and (x ->> 'week_of_month')::int = 3 from jsonb_array_elements(public.task_schedule_list()) x where x ->> 'title' = 'Expiry check'), 'the list shows the rule');
  reset role;
  perform pg_temp.ok((select approved_by from public.task_schedules where id = sid) = '00000000-0000-0000-0000-0000000000a1', 'creating a schedule is approving it, and records who');

  -- ── generation ──
  update public.profiles set disabled_at = now() where user_id = '00000000-0000-0000-0000-0000000000e1'; -- the daily job's default person loses their login
  n := public.task_generate_due('2026-11-14');
  perform pg_temp.ok(n = 1 and pg_temp.items(sid) = 0, 'on the 14th the 3rd-week task is not made (only the daily one)');
  n := public.task_generate_due('2026-11-15');
  perform pg_temp.ok(pg_temp.items(sid) = 1, 'on the 15th the 3rd-week task is made');
  select * into tk from public.task_items where schedule_id = sid;
  perform pg_temp.ok(tk.title = 'Expiry check' and tk.source = 'schedule' and tk.start_on = '2026-11-15' and tk.due_on = '2026-11-21' and tk.cycle_key = '2026-11-W3', 'it is due at the end of the window');
  perform pg_temp.ok(tk.status = 'assigned' and tk.assignee_staff_id = j1 and tk.evidence_rule = 'tick', 'it goes to the default person with the schedule''s evidence rule');
  perform pg_temp.ok((select string_agg(kind, ',' order by id) from public.task_events where task_id = tk.id) = 'created,assigned', 'its history starts with created and assigned, by the system');
  perform pg_temp.ok((select actor_user is null from public.task_events where task_id = tk.id limit 1), 'the system is the actor for generated tasks');
  n := public.task_generate_due('2026-11-15');
  perform pg_temp.ok(n = 0 and pg_temp.items(sid) = 1, 'running it again the same day makes nothing (no duplicates)');
  n := public.task_generate_due('2026-11-18');
  perform pg_temp.ok(pg_temp.items(sid) = 1, 'running it later in the same window makes nothing');
  n := public.task_generate_due('2026-11-22');
  perform pg_temp.ok(pg_temp.items(sid) = 1, 'running it after the window makes nothing');
  n := public.task_generate_due('2026-12-17');
  perform pg_temp.ok(pg_temp.items(sid) = 2, 'a late run inside the next month''s window still makes that month''s task');
  n := public.task_generate_due('2026-12-17');
  perform pg_temp.ok(pg_temp.items(sid) = 2, 'and only once');
  perform pg_temp.ok((select status from public.task_items where schedule_id = sid2 limit 1) = 'created' and (select assignee_staff_id from public.task_items where schedule_id = sid2 limit 1) is null, 'a default person who lost their login leaves the task unassigned instead of failing');
  perform pg_temp.ok((select count(*) from public.task_items where schedule_id = sid2) >= 3, 'the daily schedule made one task per run date');
  perform pg_temp.ok(pg_temp.raises(format('insert into public.task_items(title, schedule_id, cycle_key, status) values (''dup'', %L, ''2026-11-W3'', ''created'')', sid), '23505'), 'the database itself refuses a second task for the same cycle');

  -- ── pausing ──
  perform pg_temp.owner(); perform public.task_schedule_set_active(sid, false); perform public.task_schedule_set_active(sid, false); reset role;
  n := public.task_generate_due('2027-01-16');
  perform pg_temp.ok(pg_temp.items(sid) = 2, 'a paused schedule makes nothing');
  perform pg_temp.owner(); perform public.task_schedule_set_active(sid, true);
  perform pg_temp.ok(pg_temp.raises('select public.task_schedule_set_active(''40000000-0000-0000-0000-0000000000ff'', true)', '22023'), 'an unknown schedule is refused');
  reset role;
  n := public.task_generate_due('2027-01-16');
  perform pg_temp.ok(pg_temp.items(sid) = 3, 'resuming it makes the task again');
  perform pg_temp.ok((select count(*) from public.activity_log where action = 'task.schedule_created') = 2 and (select count(*) from public.activity_log where action = 'task.schedule_changed') = 2, 'schedule changes are in the audit log');

  -- ── the Owner's button ──
  perform pg_temp.owner(); n := public.task_generate_now(); reset role;
  perform pg_temp.ok(n >= 0 and (select count(*) from public.activity_log where action = 'task.generated') = 1, 'Generate now runs the same function and is audited');
  perform pg_temp.owner(); perform pg_temp.ok(public.task_generate_now() = 0, 'pressing it again makes nothing new'); reset role;
  perform pg_temp.ok((select count(*) from pg_proc p where p.proname in ('task_cycle','task_generate_due') and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))) = 0, 'the generator itself cannot be called from the browser');
end $t$;
rollback;
