-- Security guard for the Operations Dashboard range (ops_*, closing_ops_*, payroll.view_own). Like 0199 for Manager: it fails
-- when a new function is made browser-callable without being listed here on purpose, or when a table loses its protection.
\set ON_ERROR_STOP on
begin;
create function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; raise notice 'pass: %', msg; end $$;

do $t$ declare
  bad text; n int;
  -- the only ops functions a signed-in browser may call; each checks ops.view or ops.manage_rules inside and returns null or refuses otherwise
  allowed text[] := array['ops_action_items','ops_recent_activity','ops_bi_summary','ops_closing_summary','ops_rules_list','ops_rule_set','ops_activity_category_set'];
begin
  select string_agg(p.proname, ', ') into bad from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and (p.proname like 'ops\_%' or p.proname like 'closing\_ops\_%' or p.proname = 'mgmt_my_payslips') and has_function_privilege('anon', p.oid, 'execute');
  perform pg_temp.ok(bad is null, 'no ops, closing_ops or payslip function is executable by the visitor role' || coalesce(' (found: ' || bad || ')', ''));

  select string_agg(p.proname, ', ') into bad from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and (p.proname like 'ops\_%' or p.proname like 'closing\_ops\_%') and has_function_privilege('authenticated', p.oid, 'execute') and p.proname <> all (allowed);
  perform pg_temp.ok(bad is null, 'a signed-in browser can call only the seven whitelisted ops functions' || coalesce(' (found: ' || bad || ')', ''));

  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.proname = any (allowed) and has_function_privilege('authenticated', p.oid, 'execute');
  perform pg_temp.ok(n = cardinality(allowed), 'all ' || cardinality(allowed) || ' whitelisted ops functions exist and are callable (found ' || n || ')');

  select string_agg(p.proname, ', ') into bad from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.proname like 'closing\_ops\_%' and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'));
  perform pg_temp.ok(bad is null, 'the Closing read helpers are internal only' || coalesce(' (found: ' || bad || ')', ''));

  select string_agg(p.proname, ', ') into bad from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and (p.proname like 'ops\_%' or p.proname like 'closing\_ops\_%' or p.proname = 'mgmt_my_payslips')
     and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c = 'search_path=public');
  perform pg_temp.ok(bad is null, 'every ops, closing_ops and payslip function has search_path pinned to public' || coalesce(' (missing: ' || bad || ')', ''));

  select string_agg(p.proname, ', ') into bad from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.proname in ('ops_action_items','ops_recent_activity','ops_bi_summary','ops_closing_summary','ops_rules_list','ops_rule_set','ops_activity_category_set','mgmt_my_payslips') and not p.prosecdef;
  perform pg_temp.ok(bad is null, 'the browser-callable ops functions run as the definer, so the tables can stay closed' || coalesce(' (not definer: ' || bad || ')', ''));

  -- tables: closed to the browser, reachable only through the functions
  select string_agg(c.relname, ', ') into bad from pg_class c join pg_namespace s on s.oid = c.relnamespace
   where s.nspname = 'public' and c.relkind = 'r' and c.relname like 'ops\_%' and not c.relrowsecurity;
  perform pg_temp.ok(bad is null, 'every ops table has row level security on' || coalesce(' (without: ' || bad || ')', ''));
  select string_agg(distinct tablename, ', ') into bad from pg_policies where schemaname = 'public' and tablename like 'ops\_%';
  perform pg_temp.ok(bad is null, 'no ops table has a policy, so the browser cannot read or write it directly' || coalesce(' (found on: ' || bad || ')', ''));
  select string_agg(table_name || ':' || privilege_type || ':' || grantee, ', ') into bad from information_schema.role_table_grants
   where table_schema = 'public' and table_name like 'ops\_%' and grantee in ('anon', 'authenticated', 'PUBLIC');
  perform pg_temp.ok(bad is null, 'anon and authenticated hold no privilege on any ops table' || coalesce(' (found: ' || bad || ')', ''));

  -- permissions: owner-only keys are carried by no role template
  select string_agg(distinct perm_key, ', ') into bad from public.role_permissions where perm_key in ('ops.view', 'ops.manage_rules', 'payroll.view_own');
  perform pg_temp.ok(bad is null, 'no role template carries ops.view, ops.manage_rules or payroll.view_own' || coalesce(' (found: ' || bad || ')', ''));
  select string_agg(key, ', ') into bad from public.permissions where (key like 'ops.%' or key like 'payroll.%') and key not in ('ops.view', 'ops.manage_rules', 'payroll.view_own');
  perform pg_temp.ok(bad is null, 'no unreviewed ops or payroll permission exists' || coalesce(' (found: ' || bad || ')', ''));
  perform pg_temp.ok((select count(*) from public.permissions where key in ('ops.view', 'ops.manage_rules', 'payroll.view_own')) = 3, 'the three reviewed permissions exist');
  perform pg_temp.ok(not exists (select 1 from public.user_permissions where perm_key in ('ops.view', 'ops.manage_rules', 'payroll.view_own')), 'a fresh database grants none of them to anyone');
end $t$;
rollback;
