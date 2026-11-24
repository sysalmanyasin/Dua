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
-- the owner's own staff record, for the self-verification cases
create function pg_temp.owner_staff() returns uuid language sql security definer as $$ select staff_id from public.profiles where user_id = '00000000-0000-0000-0000-0000000000a1' $$;
create function pg_temp.events(tid uuid) returns bigint language sql security definer as $$ select count(*) from public.task_events where task_id = tid $$;
create function pg_temp.status(tid uuid) returns text language sql security definer as $$ select status from public.task_items where id = tid $$;
create function pg_temp.task(tid uuid) returns public.task_items language sql security definer as $$ select * from public.task_items where id = tid $$;
create function pg_temp.subs(tid uuid) returns bigint language sql security definer as $$ select count(*) from public.task_submissions where task_id = tid $$;
create function pg_temp.kinds(tid uuid) returns text language sql security definer as $$ select string_agg(kind, ',' order by id) from public.task_events where task_id = tid $$;

do $t$
declare t1 uuid; t2 uuid; t3 uuid; t4 uuid; t5 uuid; rid uuid; rid2 uuid; ev bigint; today date := (now() at time zone 'Asia/Karachi')::date; me_staff uuid := pg_temp.owner_staff();
  j1 uuid := '10000000-0000-0000-0000-000000000001'; s3 uuid := '10000000-0000-0000-0000-000000000003'; j4 uuid := '10000000-0000-0000-0000-000000000004';
begin
  -- ── creating and assigning: the Owner only ──
  perform pg_temp.junior();
  perform pg_temp.ok(pg_temp.raises(format('select public.task_create(''Count stock'', '''', ''none'', ''normal'', %L, null)', j1), '42501'), 'a Junior cannot create a task');
  reset role; perform pg_temp.senior();
  perform pg_temp.ok(pg_temp.raises(format('select public.task_create(''Count stock'', '''', ''none'', ''normal'', %L, null)', j1), '42501'), 'a Senior cannot create a task');
  reset role; perform pg_temp.named();
  perform pg_temp.ok(pg_temp.raises(format('select public.task_create(''Count stock'', '''', ''none'', ''normal'', %L, null)', j1), '42501'), 'a named verifier cannot create a task (verifying is not managing)');
  reset role; perform pg_temp.owner();
  perform pg_temp.ok(pg_temp.raises('select public.task_create(''ab'', '''', ''none'', ''normal'', null, null)', '22023'), 'a short title is refused');
  perform pg_temp.ok(pg_temp.raises('select public.task_create(''Count stock'', '''', ''photo'', ''normal'', null, null)', '22023'), 'photo evidence is refused');
  perform pg_temp.ok(pg_temp.raises('select public.task_create(''Count stock'', '''', ''none'', ''huge'', null, null)', '22023'), 'an unknown priority is refused');
  perform pg_temp.ok(pg_temp.raises(format('select public.task_create(''Count stock'', '''', ''none'', ''normal'', null, %L)', today - 1), '22023'), 'a deadline in the past is refused');
  perform pg_temp.ok(pg_temp.raises('select public.task_create(''Count stock'', '''', ''none'', ''normal'', ''10000000-0000-0000-0000-000000000009'', null)', '22023'), 'a person with no login cannot be given a task');
  t1 := public.task_create('Count the fridge stock', 'Count every product', 'note', 'normal', j1, today + 3);
  reset role;
  perform pg_temp.ok(pg_temp.status(t1) = 'assigned' and pg_temp.kinds(t1) = 'created,assigned', 'a task created with a person starts as assigned, with two history lines');
  perform pg_temp.owner();
  t2 := public.task_create('Unassigned job', '', 'none', 'normal', null, null);
  reset role; perform pg_temp.ok(pg_temp.status(t2) = 'created', 'a task with no person starts as created');

  -- ── the assignee works it ──
  perform pg_temp.senior();
  perform pg_temp.ok(pg_temp.raises(format('select public.task_accept(%L)', t1), '42501'), 'someone else cannot accept my task');
  reset role; perform pg_temp.junior();
  perform pg_temp.ok(pg_temp.raises(format('select public.task_start(%L)', t1), '55000'), 'a task must be accepted before it is started');
  perform public.task_accept(t1);
  reset role; ev := pg_temp.events(t1); perform pg_temp.junior();
  perform public.task_accept(t1);
  reset role; perform pg_temp.ok(pg_temp.events(t1) = ev and pg_temp.status(t1) = 'accepted', 'accepting twice is harmless and adds no second history line');
  perform pg_temp.junior();
  perform pg_temp.ok(pg_temp.raises(format('select public.task_submit(%L, ''done'', true)', t1), '55000'), 'a task must be started before it is handed in');
  perform public.task_start(t1);
  perform pg_temp.ok(pg_temp.raises(format('select public.task_submit(%L, '''', true)', t1), '22023'), 'a note task needs a note');
  perform pg_temp.ok(pg_temp.raises(format('select public.task_submit(%L, ''   '', true)', t1), '22023'), 'a blank note does not count');
  perform public.task_submit(t1, 'Counted all 120 products', false);
  reset role; ev := pg_temp.events(t1);
  perform pg_temp.ok(pg_temp.status(t1) = 'submitted' and pg_temp.subs(t1) = 1, 'submitting moves it to submitted and records the submission');
  perform pg_temp.junior(); perform public.task_submit(t1, 'Counted all 120 products', false); reset role;
  perform pg_temp.ok(pg_temp.events(t1) = ev and pg_temp.subs(t1) = 1, 'submitting twice (a double tap) creates no second submission');

  -- ── staff cannot change ownership or deadline ──
  perform pg_temp.junior();
  perform pg_temp.ok(pg_temp.raises(format('select public.task_assign(%L, %L)', t1, j4), '42501'), 'staff cannot reassign a task');
  perform pg_temp.ok(pg_temp.raises(format('select public.task_set_deadline(%L, %L, ''x'')', t1, today + 9), '42501'), 'staff cannot change a deadline');
  perform pg_temp.ok(pg_temp.raises(format('select public.task_cancel(%L, ''no longer needed'')', t1), '42501'), 'staff cannot cancel a task');
  perform pg_temp.ok(pg_temp.raises(format('select public.task_verify(%L, true, null)', t1), '42501'), 'the person who did the work cannot verify it');
  reset role;

  -- ── verification: who may and may not (D-53) ──
  perform pg_temp.other();
  perform pg_temp.ok(pg_temp.raises(format('select public.task_verify(%L, true, null)', t1), '42501'), 'another Junior cannot verify');
  perform pg_temp.ok(pg_temp.raises(format('select public.task_begin_verification(%L)', t1), '42501'), 'another Junior cannot start verification');
  reset role; perform pg_temp.senior();
  perform pg_temp.ok(pg_temp.raises(format('select public.task_verify(%L, true, null)', t1), '42501'), 'a Senior the owner has not named cannot verify');
  reset role; perform pg_temp.named();
  perform public.task_begin_verification(t1);
  reset role; perform pg_temp.ok(pg_temp.status(t1) = 'in_verification', 'a named Senior takes it into verification');
  perform pg_temp.named(); perform public.task_begin_verification(t1); reset role;
  perform pg_temp.ok(pg_temp.kinds(t1) like '%verification_started' , 'starting verification twice adds no second line');
  perform pg_temp.owner();
  perform pg_temp.ok(pg_temp.raises(format('select public.task_begin_verification(%L)', t1), '55000'), 'a second verifier cannot take a task someone else is checking');
  reset role; perform pg_temp.named();
  perform pg_temp.ok(pg_temp.raises(format('select public.task_verify(%L, false, '''')', t1), '22023'), 'rejecting needs a reason');
  perform public.task_verify(t1, false, 'Two shelves were missed');
  reset role;
  perform pg_temp.ok(pg_temp.status(t1) = 'returned', 'a rejected task goes back to the assignee as returned');
  perform pg_temp.ok((select decision from public.task_submissions where task_id = t1 and n = 1) = 'rejected', 'the first submission is marked rejected');

  -- ── correction and resubmission ──
  perform pg_temp.junior(); perform public.task_start(t1);
  reset role; perform pg_temp.ok(pg_temp.status(t1) = 'in_progress' and pg_temp.kinds(t1) like '%correction_started', 'the assignee starts the correction');
  perform pg_temp.junior(); perform public.task_submit(t1, 'Counted the two missed shelves too', false); reset role;
  perform pg_temp.ok(pg_temp.subs(t1) = 2 and pg_temp.status(t1) = 'submitted', 'the resubmission is a second submission');
  perform pg_temp.owner(); perform public.task_verify(t1, true, 'Good'); reset role;
  perform pg_temp.ok(pg_temp.status(t1) = 'completed' and (pg_temp.task(t1)).completed_at is not null, 'the Owner can verify and complete it');
  ev := pg_temp.events(t1);
  perform pg_temp.owner(); perform public.task_verify(t1, true, 'Good'); reset role;
  perform pg_temp.ok(pg_temp.events(t1) = ev, 'approving twice (a retry) adds no second line');
  perform pg_temp.owner();
  perform pg_temp.ok(pg_temp.raises(format('select public.task_verify(%L, false, ''changed my mind'')', t1), '55000'), 'a completed task cannot be rejected afterwards');
  perform pg_temp.ok(pg_temp.raises(format('select public.task_cancel(%L, ''too late'')', t1), '55000'), 'a completed task cannot be cancelled');
  reset role;
  perform pg_temp.ok((select count(*) from public.task_submissions where task_id = t1 and decision is not null) = 2, 'both submissions keep their decisions: complete verification history');

  -- ── nobody verifies their own work, the Owner included ──
  perform pg_temp.owner();
  t3 := public.task_create('Owner does this one', '', 'none', 'normal', me_staff, null);
  perform public.task_accept(t3); perform public.task_start(t3); perform public.task_submit(t3, null, false);
  perform pg_temp.ok(pg_temp.raises(format('select public.task_verify(%L, true, null)', t3), '42501'), 'the Owner cannot verify their own submission');
  perform pg_temp.ok(pg_temp.raises(format('select public.task_begin_verification(%L)', t3), '42501'), 'nor start verifying it');
  reset role; perform pg_temp.named();
  perform public.task_verify(t3, true, 'checked by the named Senior');
  reset role; perform pg_temp.ok(pg_temp.status(t3) = 'completed', 'another verifier can verify the Owner''s work');
  perform pg_temp.owner();
  t4 := public.task_create('Named senior does this one', '', 'none', 'normal', s3, null);
  reset role; perform pg_temp.named();
  perform public.task_accept(t4); perform public.task_start(t4); perform public.task_submit(t4, null, false);
  perform pg_temp.ok(pg_temp.raises(format('select public.task_verify(%L, true, null)', t4), '42501'), 'a named Senior cannot verify their own submission');
  reset role; perform pg_temp.owner(); perform public.task_verify(t4, true, null); reset role;
  perform pg_temp.ok(pg_temp.status(t4) = 'completed', 'the Owner verifies the named Senior''s work');

  -- ── tick evidence and no evidence ──
  perform pg_temp.owner();
  t5 := public.task_create('Tick job', '', 'tick', 'urgent', j4, today + 1);
  reset role; perform pg_temp.other(); perform public.task_accept(t5); perform public.task_start(t5);
  perform pg_temp.ok(pg_temp.raises(format('select public.task_submit(%L, ''a note'', false)', t5), '22023'), 'a tick task needs the tick');
  perform public.task_submit(t5, null, true);
  reset role; perform pg_temp.ok(pg_temp.status(t5) = 'submitted', 'a tick task is handed in with the tick');

  -- ── change requests ──
  perform pg_temp.owner(); t5 := public.task_create('Change me', '', 'none', 'normal', j1, today + 2); reset role;
  perform pg_temp.junior();
  perform pg_temp.ok(pg_temp.raises(format('select public.task_request_change(%L, ''deadline'', ''ab'', %L)', t5, today + 6), '22023'), 'a request needs a reason');
  perform pg_temp.ok(pg_temp.raises(format('select public.task_request_change(%L, ''deadline'', ''Short staffed today'', null)', t5), '22023'), 'a deadline request needs a new date');
  rid := public.task_request_change(t5, 'deadline', 'Short staffed today', today + 6);
  rid2 := public.task_request_change(t5, 'reassign', 'also this', null);
  reset role;
  perform pg_temp.ok(rid = rid2, 'only one request can wait at a time; asking again returns the same one');
  perform pg_temp.ok((pg_temp.task(t5)).due_on = today + 2, 'asking does not change the deadline');
  perform pg_temp.other(); perform pg_temp.ok(pg_temp.raises(format('select public.task_request_change(%L, ''deadline'', ''not mine to ask'', %L)', t5, today + 6), '42501'), 'only the assignee can ask'); reset role;
  perform pg_temp.junior();
  perform pg_temp.ok(pg_temp.raises(format('select public.task_decide_change(%L, true, null, null)', rid), '42501'), 'staff cannot decide a request'); reset role;
  perform pg_temp.owner();
  perform pg_temp.ok(pg_temp.raises(format('select public.task_decide_change(%L, false, '''', null)', rid), '22023'), 'refusing a request needs a reason');
  perform public.task_decide_change(rid, true, 'OK', null);
  reset role; perform pg_temp.ok((pg_temp.task(t5)).due_on = today + 6, 'an approved deadline request changes the deadline');
  perform pg_temp.owner(); perform public.task_decide_change(rid, true, 'OK', null); reset role;
  perform pg_temp.owner(); perform pg_temp.ok(pg_temp.raises(format('select public.task_decide_change(%L, false, ''no'', null)', rid), '55000'), 'a decided request cannot be flipped'); reset role;
  perform pg_temp.junior(); rid := public.task_request_change(t5, 'reassign', 'On leave tomorrow', null); reset role;
  perform pg_temp.owner(); perform public.task_decide_change(rid, true, 'Giving it to Four', j4); reset role;
  perform pg_temp.ok((pg_temp.task(t5)).assignee_staff_id = j4 and pg_temp.status(t5) = 'assigned' and (pg_temp.task(t5)).accepted_at is null, 'an approved reassignment gives it to the new person, to accept again');
  perform pg_temp.junior(); perform pg_temp.ok(pg_temp.raises(format('select public.task_accept(%L)', t5), '42501'), 'the old assignee can no longer act on it'); reset role;
  perform pg_temp.other(); rid := public.task_request_change(t5, 'reassign', 'Cannot do it', null); reset role;
  perform pg_temp.owner(); perform public.task_decide_change(rid, true, 'Back to the pool', null); reset role;
  perform pg_temp.ok(pg_temp.status(t5) = 'created' and (pg_temp.task(t5)).assignee_staff_id is null, 'an approved reassignment with no new person leaves it unassigned');
  perform pg_temp.owner(); perform public.task_assign(t5, j1); perform public.task_assign(t5, j1); reset role;
  perform pg_temp.ok(pg_temp.status(t5) = 'assigned', 'the Owner can assign it again (repeating is harmless)');
  perform pg_temp.junior(); rid := public.task_request_change(t5, 'deadline', 'Need a day', today + 8); reset role;
  perform pg_temp.owner(); perform public.task_decide_change(rid, false, 'Not possible this week', null); reset role;
  perform pg_temp.ok((pg_temp.task(t5)).due_on = today + 6, 'a refused request changes nothing');

  -- ── cancel, deadline, comments ──
  perform pg_temp.owner();
  perform pg_temp.ok(pg_temp.raises(format('select public.task_cancel(%L, '''')', t5), '22023'), 'cancelling needs a reason');
  perform pg_temp.ok(pg_temp.raises(format('select public.task_set_deadline(%L, %L, null)', t5, today - 2), '22023'), 'the Owner cannot set a deadline in the past');
  perform public.task_set_deadline(t5, today + 10, 'Stock delivery late');
  perform public.task_cancel(t5, 'No longer needed'); perform public.task_cancel(t5, 'No longer needed');
  reset role;
  perform pg_temp.ok(pg_temp.status(t5) = 'cancelled' and (pg_temp.task(t5)).cancelled_reason = 'No longer needed', 'the Owner can cancel with a reason (twice is harmless)');
  perform pg_temp.junior(); perform pg_temp.ok(pg_temp.raises(format('select public.task_request_change(%L, ''deadline'', ''why not'', %L)', t5, today + 9), '55000'), 'no request can be made on a cancelled task'); reset role;

  perform pg_temp.junior(); perform public.task_comment_add(t1, 'Counted everything'); reset role;
  perform pg_temp.other(); perform pg_temp.ok(pg_temp.raises(format('select public.task_comment_add(%L, ''I can see this?'')', t1), '42501'), 'a person who is not on the task cannot comment'); reset role;
  perform pg_temp.owner(); perform public.task_comment_add(t1, 'Thanks'); perform pg_temp.ok(pg_temp.raises(format('select public.task_comment_add(%L, '''')', t1), '22023'), 'an empty comment is refused'); reset role;
  perform pg_temp.ok((select count(*) from public.task_comments where task_id = t1) = 2, 'comments are kept');

  -- the audit trail
  perform pg_temp.ok((select count(*) from public.activity_log where action in ('task.created','task.assigned','task.verified','task.returned','task.cancelled','task.deadline_changed','task.change_decided')) >= 8, 'important actions are written to the audit log');
  perform pg_temp.ok(pg_temp.kinds(t1) = 'created,assigned,accepted,started,submitted,verification_started,returned,correction_started,submitted,verified', 'the full history of a task reads in order: ' || pg_temp.kinds(t1));
end $t$;
rollback;
