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
do $t$ declare n int; begin
  perform pg_temp.ok((select count(*) from public.permissions where key in ('tasks.view_own','tasks.manage','tasks.verify')) = 3, 'the three task permissions exist');
  perform pg_temp.ok((select array_agg(role order by role) from public.role_permissions where perm_key = 'tasks.view_own') = array['junior','senior'], 'Junior and Senior carry tasks.view_own');
  perform pg_temp.ok(not exists (select 1 from public.role_permissions where perm_key in ('tasks.manage','tasks.verify')), 'no role template carries tasks.manage or tasks.verify');

  -- who may verify (D-53)
  perform pg_temp.owner();  perform pg_temp.ok(pg_temp.can_verify(), 'the Owner can verify'); reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal1'); perform pg_temp.ok(not pg_temp.can_verify(), 'the Owner without the second factor cannot'); reset role;
  perform pg_temp.named();  perform pg_temp.ok(pg_temp.can_verify(), 'a Senior the owner has named can verify'); reset role;
  perform pg_temp.senior(); perform pg_temp.ok(not pg_temp.can_verify(), 'a Senior who is not named cannot'); reset role;
  perform pg_temp.junior(); perform pg_temp.ok(not pg_temp.can_verify(), 'a Junior cannot'); reset role;
  insert into public.user_permissions(user_id, perm_key, effect) values ('00000000-0000-0000-0000-0000000000b1', 'tasks.verify', 'grant');
  perform pg_temp.junior(); perform pg_temp.ok(not pg_temp.can_verify(), 'a Junior still cannot even if granted by mistake'); reset role;
  insert into public.user_permissions(user_id, perm_key, effect) values ('00000000-0000-0000-0000-0000000000e1', 'tasks.verify', 'grant');
  update public.profiles set disabled_at = now() where user_id = '00000000-0000-0000-0000-0000000000d1';
  perform pg_temp.named();  perform pg_temp.ok(not pg_temp.can_verify(), 'a named Senior whose login is disabled cannot'); reset role;
  update public.profiles set disabled_at = null where user_id = '00000000-0000-0000-0000-0000000000d1';
  insert into public.user_permissions(user_id, perm_key, effect) values ('00000000-0000-0000-0000-0000000000d1', 'tasks.verify', 'deny') on conflict do nothing;
  perform pg_temp.ok(true, 'setup ok');

  -- the tables are closed to every browser role, the owner included
  perform pg_temp.owner();
  perform pg_temp.ok(pg_temp.raises('select count(*) from public.task_items', '42501'), 'even the owner cannot read task tables directly');
  perform pg_temp.ok(pg_temp.raises('update public.task_items set title = ''x''', '42501'), 'nor write them directly');
  reset role;
  perform pg_temp.ok((select count(*) from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'public' and c.relname like 'task\_%' and c.relkind = 'r' and not c.relrowsecurity) = 0, 'every task table has row level security on');

  -- history cannot be rewritten
  insert into public.task_items(id, title, status) values ('40000000-0000-0000-0000-000000000001', 'History check', 'created');
  insert into public.task_events(task_id, kind) values ('40000000-0000-0000-0000-000000000001', 'created');
  insert into public.task_comments(task_id, author_user, body) values ('40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'hello');
  perform pg_temp.ok(pg_temp.raises('update public.task_events set kind = ''x''', '42501'), 'an event cannot be changed');
  perform pg_temp.ok(pg_temp.raises('delete from public.task_events', '42501'), 'an event cannot be deleted');
  perform pg_temp.ok(pg_temp.raises('update public.task_comments set body = ''x''', '42501'), 'a comment cannot be changed');
  perform pg_temp.ok(pg_temp.raises('delete from public.task_comments', '42501'), 'a comment cannot be deleted');
  insert into public.task_submissions(task_id, n, submitted_by) values ('40000000-0000-0000-0000-000000000001', 1, '00000000-0000-0000-0000-0000000000b1');
  update public.task_submissions set decision = 'approved', decided_by = '00000000-0000-0000-0000-0000000000a1', decided_at = now() where task_id = '40000000-0000-0000-0000-000000000001';
  perform pg_temp.ok(pg_temp.raises('update public.task_submissions set decision = ''rejected'' where n = 1', '42501'), 'a decided submission cannot be changed');
  perform pg_temp.ok(pg_temp.raises('update public.task_submissions set note = ''edited'' where n = 1', '42501'), 'a submission cannot be edited');
  perform pg_temp.ok(pg_temp.raises('delete from public.task_submissions', '42501'), 'a submission cannot be deleted');

  -- constraints
  perform pg_temp.ok(pg_temp.raises('insert into public.task_items(title, status) values (''Needs a person'', ''assigned'')', '23514'), 'an assigned task must have an assignee');
  perform pg_temp.ok(pg_temp.raises('insert into public.task_items(title, evidence_rule) values (''Bad rule'', ''photo'')', '23514'), 'photo evidence is not allowed (no storage)');
  perform pg_temp.ok(pg_temp.raises('insert into public.task_items(title) values (''ab'')', '23514'), 'a title needs at least 3 characters');

  -- helpers are internal
  perform pg_temp.ok((select count(*) from pg_proc p where p.proname in ('task_append_only','task_submission_guard','task_today','task_my_staff','task_can_verify','task_staff_has_login','task_can_see','task_event')
    and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))) = 0, 'the helper functions cannot be called from the browser');
end $t$;
rollback;
