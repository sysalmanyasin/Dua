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
create function pg_temp.titles(v jsonb) returns text language sql as $$ select string_agg(x ->> 'title', ',' order by ord) from jsonb_array_elements(coalesce(v, '[]'::jsonb)) with ordinality t(x, ord) $$;

do $t$
declare today date := (now() at time zone 'Asia/Karachi')::date; j1 uuid := '10000000-0000-0000-0000-000000000001'; s2 uuid := '10000000-0000-0000-0000-000000000002'; v jsonb; row jsonb;
  ju uuid := '00000000-0000-0000-0000-0000000000b1';
begin
  -- Junior One's tasks, in every state
  insert into public.task_items(id, title, status, priority, assignee_staff_id, due_on, created_at) values
    ('41000000-0000-0000-0000-00000000000a', 'A overdue',          'in_progress', 'normal', j1, today - 2,  now() - interval '10 days'),
    ('41000000-0000-0000-0000-00000000000b', 'B urgent',           'assigned',    'urgent', j1, today + 10, now()),
    ('41000000-0000-0000-0000-00000000000c', 'C due tomorrow',     'assigned',    'normal', j1, today + 1,  now()),
    ('41000000-0000-0000-0000-00000000000d', 'D normal',           'accepted',    'normal', j1, today + 20, now()),
    ('41000000-0000-0000-0000-00000000000e', 'E returned',         'returned',    'normal', j1, today + 30, now()),
    ('41000000-0000-0000-0000-00000000000f', 'F awaiting check',   'submitted',   'normal', j1, today + 5,  now()),
    ('41000000-0000-0000-0000-000000000010', 'G done recently',    'completed',   'normal', j1, null,       now() - interval '5 days'),
    ('41000000-0000-0000-0000-000000000011', 'H done long ago',    'completed',   'normal', j1, null,       now() - interval '60 days'),
    ('41000000-0000-0000-0000-000000000012', 'I belongs to Two',   'assigned',    'normal', s2, today + 1,  now()),
    ('41000000-0000-0000-0000-000000000013', 'J unassigned',       'created',     'normal', null, today - 1, now() - interval '5 days'),
    ('41000000-0000-0000-0000-000000000014', 'K cancelled',        'cancelled',   'normal', j1, today - 4,  now() - interval '9 days');
  update public.task_items set submitted_by = ju, submitted_at = now(), completed_at = now() - interval '3 days' where id in ('41000000-0000-0000-0000-00000000000f');
  update public.task_items set completed_at = now() - interval '3 days' where id = '41000000-0000-0000-0000-000000000010';
  update public.task_items set completed_at = now() - interval '40 days' where id = '41000000-0000-0000-0000-000000000011';
  update public.task_items set completed_at = null where id = '41000000-0000-0000-0000-00000000000f';
  insert into public.task_submissions(task_id, n, submitted_by, note, tick) values ('41000000-0000-0000-0000-00000000000f', 1, ju, 'all done', false);
  insert into public.task_comments(task_id, author_user, body) values ('41000000-0000-0000-0000-00000000000f', ju, 'please check');
  insert into public.task_events(task_id, kind, to_status) values ('41000000-0000-0000-0000-00000000000f', 'created', 'created');

  -- ── a person's own list: the order the brief asks for ──
  perform pg_temp.junior();
  v := public.task_list_mine('open');
  perform pg_temp.ok(pg_temp.titles(v) = 'A overdue,B urgent,C due tomorrow,D normal,E returned,F awaiting check', 'order: overdue, urgent, due soon, normal, returned, then awaiting verification: ' || pg_temp.titles(v));
  perform pg_temp.ok((v -> 0 ->> 'overdue')::boolean and not (v -> 1 ->> 'overdue')::boolean, 'only the late one is flagged overdue (work waiting on a verifier is not overdue)');
  perform pg_temp.ok(pg_temp.titles(public.task_list_mine('done')) = 'G done recently', 'the done list shows only the last 30 days');
  perform pg_temp.ok(not (v::text like '%I belongs to Two%') and not (v::text like '%J unassigned%'), 'nothing of other people''s tasks appears');
  perform pg_temp.ok(pg_temp.raises('select public.task_list_mine(''all'')', '22023'), 'an unknown scope is refused');
  v := public.task_snapshot_mine();
  perform pg_temp.ok((v ->> 'assigned')::int = 6 and (v ->> 'pending')::int = 4 and (v ->> 'overdue')::int = 1 and (v ->> 'completed')::int = 1, 'snapshot: assigned 6, pending 4, overdue 1, completed 1');
  perform pg_temp.ok((v ->> 'awaiting_verification')::int = 1 and (v ->> 'returned')::int = 1 and (v ->> 'upcoming')::int = 1, 'snapshot: awaiting verification 1, returned 1, upcoming 1');
  reset role;

  -- a person with no staff record in tasks sees an empty list, and an unrelated person sees only their own
  perform pg_temp.other(); perform pg_temp.ok(jsonb_array_length(public.task_list_mine('open')) = 0 and (public.task_snapshot_mine() ->> 'assigned')::int = 0, 'another Junior sees none of it');
  reset role;
  update public.profiles set disabled_at = now() where user_id = ju;
  perform pg_temp.junior(); perform pg_temp.ok(public.task_list_mine('open') is null and public.task_snapshot_mine() is null, 'a disabled login sees nothing'); reset role;
  update public.profiles set disabled_at = null where user_id = ju;

  -- ── the Owner's view ──
  perform pg_temp.owner();
  v := public.task_list_all();
  perform pg_temp.ok(jsonb_array_length(v) = 11, 'the Owner sees every task');
  perform pg_temp.ok((v -> 0 ->> 'overdue')::boolean, 'overdue work comes first for the Owner');
  perform pg_temp.ok(pg_temp.titles(public.task_list_all('returned')) = 'E returned', 'the Owner can filter by status');
  perform pg_temp.ok(jsonb_array_length(public.task_list_all(null, s2)) = 1, 'the Owner can filter by person');
  perform pg_temp.ok(pg_temp.raises('select public.task_list_all(''bogus'')', '22023'), 'an unknown status filter is refused');
  reset role;
  perform pg_temp.junior(); perform pg_temp.ok(public.task_list_all() is null and public.task_team_overview(30) is null and public.task_change_requests_pending() is null, 'a Junior cannot read the Owner lists'); reset role;
  perform pg_temp.named(); perform pg_temp.ok(public.task_list_all() is null and public.task_team_overview(30) is null, 'a named verifier cannot read the Owner lists either'); reset role;

  -- ── the verification queue ──
  perform pg_temp.named();
  v := public.task_verification_queue();
  perform pg_temp.ok(pg_temp.titles(v) = 'F awaiting check' and (v -> 0 ->> 'submitted_note') = 'all done', 'a named verifier sees the submission waiting, with its note');
  reset role; perform pg_temp.junior(); perform pg_temp.ok(public.task_verification_queue() is null, 'a Junior has no queue'); reset role;
  perform pg_temp.senior(); perform pg_temp.ok(public.task_verification_queue() is null, 'an unnamed Senior has no queue'); reset role;
  update public.task_items set submitted_by = '00000000-0000-0000-0000-0000000000d1' where id = '41000000-0000-0000-0000-00000000000f';
  perform pg_temp.named(); perform pg_temp.ok(jsonb_array_length(public.task_verification_queue()) = 0, 'a verifier''s own submission is not in their queue'); reset role;
  update public.task_items set submitted_by = ju where id = '41000000-0000-0000-0000-00000000000f';

  -- ── opening one task ──
  perform pg_temp.junior(); v := public.task_get('41000000-0000-0000-0000-00000000000f');
  perform pg_temp.ok(v is not null and (v -> 'can' ->> 'is_assignee')::boolean and not (v -> 'can' ->> 'verify')::boolean and jsonb_array_length(v -> 'comments') = 1 and jsonb_array_length(v -> 'submissions') = 1, 'the assignee opens their task with its comments and submissions');
  perform pg_temp.ok(public.task_get('41000000-0000-0000-0000-000000000012') is null, 'the same answer as "no such task" for someone else''s task');
  reset role; perform pg_temp.named(); v := public.task_get('41000000-0000-0000-0000-00000000000f');
  perform pg_temp.ok(v is not null and (v -> 'can' ->> 'verify')::boolean, 'a named verifier can open a task in their queue and decide it');
  perform pg_temp.ok(public.task_get('41000000-0000-0000-0000-00000000000b') is null, 'but not tasks that are not waiting for verification');
  reset role; perform pg_temp.owner();
  perform pg_temp.ok(public.task_get('41000000-0000-0000-0000-00000000000b') is not null and (public.task_get('41000000-0000-0000-0000-00000000000f') -> 'can' ->> 'manage')::boolean, 'the Owner can open any task');
  perform pg_temp.ok(public.task_get('40000000-0000-0000-0000-0000000000ff') is null, 'an unknown task id returns null, not an error');
  reset role; perform pg_temp.senior(); perform pg_temp.ok(public.task_get('41000000-0000-0000-0000-00000000000f') is null, 'an unrelated Senior cannot open it'); reset role;

  -- ── change requests the Owner has to decide ──
  insert into public.task_change_requests(task_id, kind, reason, proposed_due_on, requested_by) values ('41000000-0000-0000-0000-00000000000c', 'deadline', 'short staffed', today + 4, ju);
  perform pg_temp.owner(); v := public.task_change_requests_pending();
  perform pg_temp.ok(jsonb_array_length(v) = 1 and v -> 0 ->> 'requested_by_name' = 'Junior One' and (v -> 0 ->> 'kind') = 'deadline', 'the Owner sees who asked, what and why'); reset role;

  -- ── team overview and the fair completion rate ──
  insert into public.task_items(title, status, assignee_staff_id, due_on, created_at, completed_at) values
    ('R1 on time',            'completed',   j1, today - 5, now() - interval '10 days', now() - interval '6 days'),
    ('R2 late',               'completed',   j1, today - 5, now() - interval '10 days', now() - interval '3 days'),
    ('R3 cancelled',          'cancelled',   j1, today - 5, now() - interval '10 days', null),
    ('R4 created after due',  'in_progress', j1, today - 5, now(),                      null),
    ('R5 not done',           'in_progress', j1, today - 4, now() - interval '10 days', null);
  perform pg_temp.owner();
  v := public.task_team_overview(30);
  select x into row from jsonb_array_elements(v -> 'staff') x where x ->> 'name' = 'Junior One';
  perform pg_temp.ok((row ->> 'rate_due')::int = 4 and (row ->> 'rate_on_time')::int = 1, 'rate: 4 tasks were due (R1, R2, R5 and A), 1 finished on time; cancelled and created-after-deadline tasks are left out');
  perform pg_temp.ok((row ->> 'completed')::int = 3, 'completed in the period: the two with deadlines and the one without');
  perform pg_temp.ok((row ->> 'overdue')::int = 3 and (row ->> 'returned')::int = 1 and (row ->> 'verification_pending')::int = 1, 'overdue, returned and verification-pending counts');
  perform pg_temp.ok(exists (select 1 from jsonb_array_elements(v -> 'staff') x where x ->> 'name' = 'Senior Two' and (x ->> 'assigned_open')::int = 1), 'every person with a login appears, with their own open count');
  perform pg_temp.ok(not exists (select 1 from jsonb_array_elements(v -> 'staff') x where x ->> 'name' = 'Ghost NoLogin'), 'a person with no login and no tasks does not appear');
  perform pg_temp.ok((v ->> 'to')::date = today - 1 and (v ->> 'from')::date = today - 30, 'the period is complete days ending yesterday');
  perform pg_temp.ok(pg_temp.raises('select public.task_team_overview(14)', '22023') and pg_temp.raises('select public.task_team_overview(null)', '22023'), 'only 7, 30 or 90 days are allowed');
  perform pg_temp.ok(jsonb_array_length(public.task_team_overview(7) -> 'staff') >= 1, '7 days works');
  reset role;
  perform pg_temp.ok((select count(*) from pg_proc p where p.proname = 'task_card' and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))) = 0, 'the card builder is internal');
end $t$;
rollback;
