-- Security guard for the Notifications range (1300-1399): the browser can call exactly the whitelisted functions, nothing else.
-- Add to the whitelist only on purpose; never loosen this silently.
\set ON_ERROR_STOP on
begin;
create function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; raise notice 'pass: %', msg; end $$;
do $t$
declare
  allowed text[] := array['ntf_list_mine', 'ntf_unread_count', 'ntf_mark_read', 'ntf_mark_all_read'];
  bad text; n integer;
begin
  select string_agg(p.proname, ', ') into bad from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.proname like 'ntf\_%' and has_function_privilege('anon', p.oid, 'execute');
  perform pg_temp.ok(bad is null, 'no ntf function is callable by anon' || coalesce(' (found ' || bad || ')', ''));
  select string_agg(p.proname, ', ') into bad from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.proname like 'ntf\_%' and has_function_privilege('authenticated', p.oid, 'execute') and p.proname <> all (allowed);
  perform pg_temp.ok(bad is null, 'the browser can call only the whitelisted ntf functions' || coalesce(' (found ' || bad || ')', ''));
  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.proname = any (allowed) and has_function_privilege('authenticated', p.oid, 'execute');
  perform pg_temp.ok(n = cardinality(allowed), 'all ' || cardinality(allowed) || ' whitelisted functions exist and are callable (found ' || n || ')');
  select string_agg(p.proname, ', ') into bad from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.proname like 'ntf\_%' and (not p.prosecdef or not ('search_path=public' = any (coalesce(p.proconfig, '{}'))));
  perform pg_temp.ok(bad is null, 'every ntf function is a definer function with search_path pinned' || coalesce(' (found ' || bad || ')', ''));
  perform pg_temp.ok(not has_table_privilege('authenticated', 'public.ntf_messages', 'select, insert, update, delete') and not has_table_privilege('anon', 'public.ntf_messages', 'select'), 'the table is closed');
  -- the task side: the notice functions are server-only
  select string_agg(p.proname, ', ') into bad from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.proname in ('task_notify_on_event', 'task_overdue_reminders') and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'));
  perform pg_temp.ok(bad is null, 'the task notice functions cannot be called from the browser' || coalesce(' (found ' || bad || ')', ''));
end $t$;
rollback;
