-- Tests for 1204_task_notices: who is told what, driven through the real task functions.
\set ON_ERROR_STOP on
begin;
create function pg_temp.as_user(uid uuid, lvl text default 'aal1') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'aal', lvl, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; raise notice 'pass: %', msg; end $$;
create function pg_temp.owner() returns void language sql as $$ select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2') $$;
create function pg_temp.junior() returns void language sql as $$ select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1') $$;
create function pg_temp.senior() returns void language sql as $$ select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1') $$;
create function pg_temp.named() returns void language sql as $$ select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1') $$;
create function pg_temp.msgs(uid uuid, k text default null) returns jsonb language sql security definer as $$
  select coalesce(jsonb_agg(jsonb_build_object(kind, kind, 'title', title, 'body', body, 'href', href) order by created_at, id), '[]'::jsonb) from public.ntf_messages where user_id = uid and (k is null or kind = k) $$;
create function pg_temp.raises(q text, state text) returns boolean language plpgsql as $$
begin execute q; return false; exception when others then return sqlstate = state; end $$;
insert into auth.users(id, email) values ('00000000-0000-0000-0000-0000000000a1','a@t'),('00000000-0000-0000-0000-0000000000b1','j@t'),('00000000-0000-0000-0000-0000000000c1','s@t'),('00000000-0000-0000-0000-0000000000d1','n@t');
select public.bootstrap_first_admin('00000000-0000-0000-0000-0000000000a1','owner','Test Owner');
insert into public.staff(id, full_name) values ('10000000-0000-0000-0000-000000000001','Junior One'),('10000000-0000-0000-0000-000000000002','Senior Two'),('10000000-0000-0000-0000-000000000003','Senior Three');
insert into public.profiles(user_id, staff_id, username, role_template) values
  ('00000000-0000-0000-0000-0000000000b1','10000000-0000-0000-0000-000000000001','junior1','junior'),
  ('00000000-0000-0000-0000-0000000000c1','10000000-0000-0000-0000-000000000002','senior2','senior'),
  ('00000000-0000-0000-0000-0000000000d1','10000000-0000-0000-0000-000000000003','senior3','senior');
insert into public.user_permissions(user_id, perm_key, effect) values ('00000000-0000-0000-0000-0000000000d1', 'tasks.verify', 'grant');

create function pg_temp.count(uid uuid, k text) returns integer language sql security definer as $$ select count(*)::int from public.ntf_messages where user_id = uid and kind = k $$;
create function pg_temp.last(uid uuid, k text) returns jsonb language sql security definer as $$
  select jsonb_build_object('title', title, 'body', body, 'href', href) from public.ntf_messages where user_id = uid and kind = k order by created_at desc, id limit 1 $$;
create function pg_temp.total(uid uuid) returns integer language sql security definer as $$ select count(*)::int from public.ntf_messages where user_id = uid $$;

do $t$
declare
  o uuid := '00000000-0000-0000-0000-0000000000a1'; j uuid := '00000000-0000-0000-0000-0000000000b1'; s2 uuid := '00000000-0000-0000-0000-0000000000c1'; s3 uuid := '00000000-0000-0000-0000-0000000000d1';
  j1 uuid := '10000000-0000-0000-0000-000000000001'; s2s uuid := '10000000-0000-0000-0000-000000000002';
  today date := (now() at time zone 'Asia/Karachi')::date; t1 uuid; t2 uuid; t3 uuid; t4 uuid; rid uuid; rid2 uuid; n integer;
begin
  -- ── assigned ──
  perform pg_temp.owner();
  t1 := public.task_create('Count the fridge', 'x', 'none', 'normal', j1, today + 5);
  reset role;
  perform pg_temp.ok(pg_temp.count(j, 'task.assigned') = 1 and pg_temp.last(j, 'task.assigned') ->> 'body' = 'Count the fridge' and pg_temp.last(j, 'task.assigned') ->> 'href' = '/tasks', 'a task given to someone tells them, with the title and a link to My Tasks');
  perform pg_temp.ok(pg_temp.total(o) = 0 and pg_temp.total(s2) = 0 and pg_temp.total(s3) = 0, 'nobody else is told');
  perform pg_temp.owner(); perform public.task_assign(t1, j1); reset role;
  perform pg_temp.ok(pg_temp.count(j, 'task.assigned') = 1, 'assigning to the same person again (a quiet no-op) tells them nothing new');
  perform pg_temp.owner(); t2 := public.task_create('Nobody yet', '', 'none', 'normal', null, today + 5); reset role;
  perform pg_temp.ok(pg_temp.total(j) = 1, 'a task with no assignee tells nobody');

  -- ── handed in: the Owner and the named verifier, not the Senior who is not named, not the person who did it ──
  perform pg_temp.junior(); perform public.task_accept(t1); perform public.task_start(t1); perform public.task_submit(t1, null, false); reset role;
  perform pg_temp.ok(pg_temp.count(o, 'task.waiting_verification') = 1 and pg_temp.last(o, 'task.waiting_verification') ->> 'href' = '/tasks/verify', 'the Owner is told work is waiting, with a link to the queue');
  perform pg_temp.ok(pg_temp.count(s3, 'task.waiting_verification') = 1, 'so is the Senior the owner named');
  perform pg_temp.ok(pg_temp.count(s2, 'task.waiting_verification') = 0, 'a Senior who is not named is not told');
  perform pg_temp.ok(pg_temp.count(j, 'task.waiting_verification') = 0, 'and the person who handed it in is not told');

  -- ── sent back ──
  perform pg_temp.owner(); perform public.task_begin_verification(t1); perform public.task_verify(t1, false, 'Count the top shelf again'); reset role;
  perform pg_temp.ok(pg_temp.count(j, 'task.returned') = 1 and pg_temp.last(j, 'task.returned') ->> 'body' = 'Count the fridge: Count the top shelf again', 'sent back: the person gets the reason');
  perform pg_temp.junior(); perform public.task_start(t1); perform public.task_submit(t1, null, false); reset role;
  perform pg_temp.ok(pg_temp.count(o, 'task.waiting_verification') = 2, 'handing it in again tells the verifiers again (a new event, a new message)');
  perform pg_temp.named(); perform public.task_verify(t1, true, null); reset role;
  perform pg_temp.ok(pg_temp.count(j, 'task.returned') = 1, 'approving sends no send-back message');

  -- ── requests ──
  perform pg_temp.owner(); t3 := public.task_create('Fix the shelf label', '', 'none', 'normal', j1, today + 3); reset role;
  perform pg_temp.junior(); rid := public.task_request_change(t3, 'deadline', 'Stock arrives late', today + 9); reset role;
  perform pg_temp.ok(pg_temp.count(o, 'task.change_requested') = 1 and pg_temp.last(o, 'task.change_requested') ->> 'href' = '/tasks/requests'
    and pg_temp.last(o, 'task.change_requested') ->> 'body' = 'Fix the shelf label: Stock arrives late', 'a new request tells the Owner, with the reason and a link to Requests');
  perform pg_temp.ok(pg_temp.count(s3, 'task.change_requested') = 0 and pg_temp.count(j, 'task.change_requested') = 0, 'a named verifier and the requester are not told of the request');
  perform pg_temp.owner(); perform public.task_decide_change(rid, true, 'Fine'); reset role;
  perform pg_temp.ok(pg_temp.last(j, 'task.request_decided') ->> 'title' = 'Your request was approved' and pg_temp.last(j, 'task.request_decided') ->> 'body' = 'Fix the shelf label: Fine', 'an approved request tells the requester, with the Owner''s note');
  perform pg_temp.ok(pg_temp.count(j, 'task.deadline_changed') = 0, 'and the deadline change it caused does not send a second message');
  perform pg_temp.junior(); rid2 := public.task_request_change(t3, 'reassign', 'Too busy this week', null); reset role;
  perform pg_temp.owner(); perform public.task_decide_change(rid2, false, 'Needed from you'); reset role;
  perform pg_temp.ok(pg_temp.last(j, 'task.request_decided') ->> 'title' = 'Your request was refused' and pg_temp.last(j, 'task.request_decided') ->> 'body' like '%Needed from you', 'a refused request says so, with the reason');

  -- ── a deadline set directly, and a cancellation ──
  perform pg_temp.owner(); perform public.task_set_deadline(t3, today + 20, 'Supplier delay'); reset role;
  perform pg_temp.ok(pg_temp.count(j, 'task.deadline_changed') = 1 and pg_temp.last(j, 'task.deadline_changed') ->> 'body' like 'Fix the shelf label is now due %', 'a deadline set by the Owner tells the person who holds the task');
  perform pg_temp.owner(); perform public.task_cancel(t3, 'Not needed any more'); reset role;
  perform pg_temp.ok(pg_temp.last(j, 'task.cancelled') ->> 'body' = 'Fix the shelf label: Not needed any more', 'a cancellation tells the person, with the reason');

  -- ── nobody is told about their own action ──
  perform pg_temp.owner(); perform public.task_assign(t2, s2s); reset role;
  perform pg_temp.ok(pg_temp.count(s2, 'task.assigned') = 1, 'a Senior is told of a task given to them');
  update public.profiles set disabled_at = now() where user_id = s2;
  perform pg_temp.owner(); perform public.task_set_deadline(t2, today + 7, null); reset role;
  perform pg_temp.ok(pg_temp.count(s2, 'task.deadline_changed') = 0, 'a disabled login is told nothing');
  update public.profiles set disabled_at = null where user_id = s2;

  -- ── a failing message never blocks the task action ──
  create function pg_temp.boom() returns trigger language plpgsql as $f$ begin raise exception 'inbox broke'; end $f$;
  execute 'create trigger zz_boom before insert on public.ntf_messages for each row execute function pg_temp.boom()';
  perform pg_temp.owner(); t4 := public.task_create('Task while inbox is broken', '', 'none', 'normal', j1, today + 5); reset role;
  perform pg_temp.ok(exists (select 1 from public.task_items where id = t4 and status = 'assigned'), 'when sending a message fails, the task action still goes through');
  execute 'drop trigger zz_boom on public.ntf_messages';

  -- ── overdue reminders: once a morning, to the person holding it, only while it is overdue ──
  insert into public.task_items (id, title, status, assignee_staff_id, due_on, created_at) values
    ('41000000-0000-0000-0000-0000000000a1', 'Late and open',   'in_progress', j1, today - 3, now() - interval '9 days'),
    ('41000000-0000-0000-0000-0000000000a2', 'Late and handed', 'submitted',   j1, today - 3, now() - interval '9 days'),
    ('41000000-0000-0000-0000-0000000000a3', 'Late and nobody', 'created',     null, today - 3, now() - interval '9 days'),
    ('41000000-0000-0000-0000-0000000000a4', 'Due today',       'assigned',    j1, today, now()),
    ('41000000-0000-0000-0000-0000000000a5', 'Late returned',   'returned',    j1, today - 1, now() - interval '9 days'),
    ('41000000-0000-0000-0000-0000000000a6', 'Late and done',   'completed',   j1, today - 3, now() - interval '9 days');
  n := public.task_overdue_reminders();
  perform pg_temp.ok(n = 2 and pg_temp.count(j, 'task.overdue') = 2, 'one reminder for each overdue task that is still with the person (open and returned), none for handed in, unassigned, due today or done');
  perform pg_temp.ok(pg_temp.last(j, 'task.overdue') ->> 'title' = 'Overdue task' and pg_temp.last(j, 'task.overdue') ->> 'body' like '%was due %', 'the reminder says which task and when it was due');
  perform pg_temp.ok(public.task_overdue_reminders() = 0 and pg_temp.count(j, 'task.overdue') = 2, 'running it again the same morning sends nothing extra');
  update public.ntf_messages set dedupe_key = replace(dedupe_key, ':' || today, ':' || (today - 1)) where kind = 'task.overdue';
  perform pg_temp.ok(public.task_overdue_reminders() = 2, 'the next morning it reminds again while the task is still overdue');
  update public.task_items set status = 'submitted' where id = '41000000-0000-0000-0000-0000000000a1';
  update public.ntf_messages set dedupe_key = replace(dedupe_key, ':' || today, ':' || (today - 2)) where kind = 'task.overdue';
  perform pg_temp.ok(public.task_overdue_reminders() = 1, 'once handed in, it stops');
  perform pg_temp.ok(pg_temp.total(o) = pg_temp.count(o, 'task.waiting_verification') + pg_temp.count(o, 'task.change_requested'), 'the Owner gets no reminders and no assignment echoes');

  -- ── privacy and closing ──
  perform pg_temp.ok(not exists (select 1 from public.ntf_messages where title ~* '(rs\.?|pkr|salary|payslip|cash|deposit)' or body ~* '(salary|payslip|\mrs\.? ?[0-9])'), 'no message carries money or salary wording');
  perform pg_temp.ok(not has_function_privilege('authenticated', 'public.task_notify_on_event()', 'execute') and not has_function_privilege('authenticated', 'public.task_overdue_reminders()', 'execute')
    and not has_function_privilege('anon', 'public.task_overdue_reminders()', 'execute'), 'the notice functions cannot be called from the browser');
  perform pg_temp.ok(exists (select 1 from pg_trigger where tgname = 'task_events_notify' and tgrelid = 'public.task_events'::regclass), 'the trigger sits on the history table');
  if to_regclass('cron.job') is not null then
    execute 'select count(*) from cron.job where jobname = ''task-overdue-reminders'' and schedule = ''0 3 * * *''' into n;
    perform pg_temp.ok(n = 1, 'the daily reminder job runs at 03:00 UTC (08:00 Pakistan time)');
  end if;
end $t$;
rollback;
