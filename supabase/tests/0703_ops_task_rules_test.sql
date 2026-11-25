-- Tests for 0703_ops_task_rules (Action Centre rules for overdue tasks and tasks waiting for verification).
\set ON_ERROR_STOP on
begin;
create function pg_temp.as_user(uid uuid, lvl text default 'aal1') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'aal', lvl, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; raise notice 'pass: %', msg; end $$;
create function pg_temp.items(k text) returns jsonb language sql as $$
  select coalesce(jsonb_agg(x), '[]'::jsonb) from jsonb_array_elements(public.ops_action_items() -> 'items') x where x ->> 'rule_key' = k $$;
create function pg_temp.raises(q text, state text) returns boolean language plpgsql as $$
begin execute q; return false; exception when others then return sqlstate = state; end $$;

insert into auth.users(id, email) values ('00000000-0000-0000-0000-0000000000a1','a@t'),('00000000-0000-0000-0000-0000000000b1','j@t'),('00000000-0000-0000-0000-0000000000c1','s@t');
select public.bootstrap_first_admin('00000000-0000-0000-0000-0000000000a1','owner','Test Owner');
insert into public.staff(id, full_name) values ('10000000-0000-0000-0000-000000000001','Junior One'),('10000000-0000-0000-0000-000000000002','Senior Two');
insert into public.profiles(user_id, staff_id, username, role_template) values
  ('00000000-0000-0000-0000-0000000000b1','10000000-0000-0000-0000-000000000001','junior1','junior'),
  ('00000000-0000-0000-0000-0000000000c1','10000000-0000-0000-0000-000000000002','senior2','senior');

do $t$ declare today date := (now() at time zone 'Asia/Karachi')::date; j1 uuid := '10000000-0000-0000-0000-000000000001'; v jsonb; begin
  -- ── the rules ──
  perform pg_temp.ok((select count(*) from public.ops_rules) = 7, 'seven rules now exist');
  perform pg_temp.ok((select enabled and severity = 'warning' and category = 'tasks' and params = '{}' from public.ops_rules where rule_key = 'task_overdue'), 'the overdue rule is on, a warning, in the tasks category');
  perform pg_temp.ok((select enabled and severity = 'info' and category = 'tasks' from public.ops_rules where rule_key = 'task_verification_waiting'), 'the verification rule is on and for information');
  perform pg_temp.ok((select not enabled from public.ops_rules where rule_key = 'deposit_vs_cash'), 'the deposit rule is still off');
  perform pg_temp.ok((select count(*) from public.ops_rules where not public.ops_params_ok(rule_key, params)) = 0, 'every rule passes its own settings check');
  perform pg_temp.ok(not public.ops_params_ok('task_overdue', '{"days": 2}'::jsonb) and not public.ops_params_ok('task_verification_waiting', '{"hours": 2}'::jsonb), 'the task rules accept no settings, so a typo cannot change them');

  -- ── nothing to report on a fresh database ──
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  perform pg_temp.ok(jsonb_array_length(pg_temp.items('task_overdue')) = 0 and jsonb_array_length(pg_temp.items('task_verification_waiting')) = 0, 'no tasks, no task issues');
  reset role;

  insert into public.task_items(id, title, status, assignee_staff_id, due_on, created_at, submitted_by) values
    ('41000000-0000-0000-0000-000000000001', 'late one',      'in_progress', j1, today - 2, now() - interval '9 days', null),
    ('41000000-0000-0000-0000-000000000002', 'late two',      'returned',    j1, today - 1, now() - interval '9 days', null),
    ('41000000-0000-0000-0000-000000000003', 'on time',       'assigned',    j1, today + 3, now(), null),
    ('41000000-0000-0000-0000-000000000004', 'waiting check', 'submitted',   j1, today - 5, now() - interval '9 days', '00000000-0000-0000-0000-0000000000b1'),
    ('41000000-0000-0000-0000-000000000005', 'cancelled late','cancelled',   j1, today - 5, now() - interval '9 days', null),
    ('41000000-0000-0000-0000-000000000006', 'nobody late',   'created',     null, today - 1, now() - interval '9 days', null),
    ('41000000-0000-0000-0000-000000000007', 'nobody future', 'created',     null, today + 4, now(), null);

  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  v := pg_temp.items('task_overdue');
  perform pg_temp.ok(jsonb_array_length(v) = 2, 'one issue for the person with overdue work and one for unassigned overdue work');
  perform pg_temp.ok(exists (select 1 from jsonb_array_elements(v) x where x ->> 'responsible' = 'Junior One' and x ->> 'detail' = 'Junior One has 2 overdue tasks.' and x ->> 'href' = '/tasks/manage' and x ->> 'category' = 'tasks' and x ->> 'severity' = 'warning'),
    'the person is named with the count; work already handed in or cancelled is not counted');
  perform pg_temp.ok(exists (select 1 from jsonb_array_elements(v) x where x ->> 'ref' = 'unassigned' and x ->> 'detail' like '1 task is past the deadline%'), 'overdue work nobody holds gets its own issue; one that is not yet due does not');
  v := pg_temp.items('task_verification_waiting');
  perform pg_temp.ok(jsonb_array_length(v) = 1 and v -> 0 ->> 'detail' = '1 task is waiting to be checked.' and v -> 0 ->> 'href' = '/tasks/verify' and v -> 0 ->> 'severity' = 'info', 'work waiting for a verifier is one informational issue with a link to the queue');

  perform public.ops_rule_set('task_overdue', null, 'critical', null, 'test');
  perform pg_temp.ok((select bool_and(x ->> 'severity' = 'critical') from jsonb_array_elements(pg_temp.items('task_overdue')) x), 'the owner can raise the severity of the overdue rule');
  perform public.ops_rule_set('task_overdue', false, null, null, null);
  perform public.ops_rule_set('task_verification_waiting', false, null, null, null);
  perform pg_temp.ok(jsonb_array_length(pg_temp.items('task_overdue')) = 0 and jsonb_array_length(pg_temp.items('task_verification_waiting')) = 0, 'switching a rule off raises nothing');
  perform public.ops_rule_set('task_overdue', true, null, null, null);
  reset role;

  -- fixing the cause clears the issue with no dismiss step
  update public.task_items set status = 'completed', completed_at = now() where id in ('41000000-0000-0000-0000-000000000001', '41000000-0000-0000-0000-000000000002');
  update public.task_items set assignee_staff_id = j1, status = 'assigned' where id = '41000000-0000-0000-0000-000000000006';
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  v := pg_temp.items('task_overdue');
  perform pg_temp.ok(jsonb_array_length(v) = 1 and v -> 0 ->> 'detail' = 'Junior One has 1 overdue task.', 'finishing or assigning the work clears its issue and the wording follows the count');
  reset role;

  -- ── who can see it ──
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  perform pg_temp.ok(public.ops_action_items() is null, 'a junior still gets nothing from the Action Centre');
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal1');
  perform pg_temp.ok(public.ops_action_items() is null, 'an owner session without the second factor still gets nothing');
  reset role;
  -- a person who was given ops.view but not tasks.manage: the task check cannot run, and says so instead of staying silent
  insert into public.user_permissions(user_id, perm_key, effect) values ('00000000-0000-0000-0000-0000000000c1', 'ops.view', 'grant');
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  perform pg_temp.ok(exists (select 1 from jsonb_array_elements(public.ops_action_items() -> 'items') x where x ->> 'title' = 'Tasks could not be checked' and x ->> 'category' = 'system'),
    'without the task permission the check is reported as not done, never silently skipped');
  perform pg_temp.ok(not exists (select 1 from jsonb_array_elements(public.ops_action_items() -> 'items') x where x ->> 'category' = 'tasks'), 'and no task figures leak to that person');
  reset role;

  -- ── the function is still closed to visitors and keeps its pinned search path ──
  perform pg_temp.ok(not has_function_privilege('anon', 'public.ops_action_items()', 'execute') and has_function_privilege('authenticated', 'public.ops_action_items()', 'execute'), 'ops_action_items keeps its grants');
  perform pg_temp.ok((select p.prosecdef and 'search_path=public' = any (p.proconfig) from pg_proc p where p.proname = 'ops_action_items'), 'ops_action_items is still a definer function with search_path pinned');
end $t$;
rollback;
