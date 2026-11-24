-- Security guard for Task Master (task_*, tasks.*). Like 0199 for Manager and 0749 for Operations: it fails when a task function
-- becomes browser-callable without being listed here on purpose, when a table loses its protection, or when a role template
-- gains the right to manage or verify tasks.
\set ON_ERROR_STOP on
begin;
create function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; raise notice 'pass: %', msg; end $$;

do $t$ declare
  bad text; n int;
  -- the only task functions a signed-in browser may call. Each checks who is asking inside (permission, assignee, verifier rule).
  allowed text[] := array[
    'task_create','task_assign','task_set_deadline','task_cancel','task_accept','task_start','task_submit','task_begin_verification','task_verify',
    'task_comment_add','task_request_change','task_decide_change',
    'task_generate_now','task_schedule_create','task_schedule_set_active','task_schedule_list',
    'task_list_mine','task_snapshot_mine','task_list_all','task_verification_queue','task_get','task_change_requests_pending','task_team_overview'];
begin
  select string_agg(p.proname, ', ') into bad from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.proname like 'task\_%' and has_function_privilege('anon', p.oid, 'execute');
  perform pg_temp.ok(bad is null, 'no task function is executable by the visitor role' || coalesce(' (found: ' || bad || ')', ''));

  select string_agg(p.proname, ', ') into bad from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.proname like 'task\_%' and has_function_privilege('authenticated', p.oid, 'execute') and p.proname <> all (allowed);
  perform pg_temp.ok(bad is null, 'a signed-in browser can call only the whitelisted task functions' || coalesce(' (found: ' || bad || ')', ''));

  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.proname = any (allowed) and has_function_privilege('authenticated', p.oid, 'execute');
  perform pg_temp.ok(n = cardinality(allowed), 'all ' || cardinality(allowed) || ' whitelisted task functions exist and are callable (found ' || n || ')');

  select string_agg(p.proname, ', ') into bad from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.proname like 'task\_%' and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c = 'search_path=public');
  perform pg_temp.ok(bad is null, 'every task function has search_path pinned to public' || coalesce(' (missing: ' || bad || ')', ''));

  select string_agg(p.proname, ', ') into bad from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.proname = any (allowed) and not p.prosecdef;
  perform pg_temp.ok(bad is null, 'every browser-callable task function runs as the definer, so the tables can stay closed' || coalesce(' (not definer: ' || bad || ')', ''));

  -- the generator and its rule are internal: only the daily job and the Owner's button reach them
  select string_agg(p.proname, ', ') into bad from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.proname in ('task_generate_due', 'task_cycle', 'task_can_verify', 'task_can_see', 'task_event') and has_function_privilege('authenticated', p.oid, 'execute');
  perform pg_temp.ok(bad is null, 'the generator, the cycle rule and the verifier and visibility checks are internal' || coalesce(' (found: ' || bad || ')', ''));

  -- tables
  select string_agg(c.relname, ', ') into bad from pg_class c join pg_namespace s on s.oid = c.relnamespace
   where s.nspname = 'public' and c.relkind = 'r' and c.relname like 'task\_%' and not c.relrowsecurity;
  perform pg_temp.ok(bad is null, 'every task table has row level security on' || coalesce(' (without: ' || bad || ')', ''));
  select string_agg(distinct tablename, ', ') into bad from pg_policies where schemaname = 'public' and tablename like 'task\_%';
  perform pg_temp.ok(bad is null, 'no task table has a policy, so the browser cannot read or write it directly' || coalesce(' (found on: ' || bad || ')', ''));
  select string_agg(table_name || ':' || privilege_type || ':' || grantee, ', ') into bad from information_schema.role_table_grants
   where table_schema = 'public' and table_name like 'task\_%' and grantee in ('anon', 'authenticated', 'PUBLIC');
  perform pg_temp.ok(bad is null, 'anon and authenticated hold no privilege on any task table' || coalesce(' (found: ' || bad || ')', ''));
  select string_agg(c.relname, ', ') into bad from pg_class c join pg_namespace s on s.oid = c.relnamespace
   where s.nspname = 'public' and c.relname in ('task_events', 'task_comments', 'task_submissions')
     and not exists (select 1 from pg_trigger t where t.tgrelid = c.oid and not t.tgisinternal);
  perform pg_temp.ok(bad is null, 'the history tables keep their append-only triggers' || coalesce(' (without: ' || bad || ')', ''));

  -- permissions
  select string_agg(distinct role || ':' || perm_key, ', ') into bad from public.role_permissions where perm_key in ('tasks.manage', 'tasks.verify');
  perform pg_temp.ok(bad is null, 'no role template carries tasks.manage or tasks.verify' || coalesce(' (found: ' || bad || ')', ''));
  select string_agg(distinct role, ', ') into bad from public.role_permissions where perm_key = 'tasks.view_own' and role not in ('junior', 'senior');
  perform pg_temp.ok(bad is null, 'only Junior and Senior carry tasks.view_own' || coalesce(' (found: ' || bad || ')', ''));
  select string_agg(key, ', ') into bad from public.permissions where key like 'tasks.%' and key not in ('tasks.view_own', 'tasks.manage', 'tasks.verify');
  perform pg_temp.ok(bad is null, 'no unreviewed task permission exists' || coalesce(' (found: ' || bad || ')', ''));
  perform pg_temp.ok(not exists (select 1 from public.user_permissions where perm_key in ('tasks.manage', 'tasks.verify', 'tasks.view_own')), 'a fresh database grants no task permission to anyone');
end $t$;
rollback;
