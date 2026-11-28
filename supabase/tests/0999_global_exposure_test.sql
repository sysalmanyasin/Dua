-- Whole-schema security invariants (Audit 0, T1; strict since KI-1 was closed by 1004 and 1405). The per-area exposure tests (0199, 0749, 1299, 1399) guard their own ranges;
-- this one guards everything in schema public, so a new table or function cannot slip past them.
-- Read-only: it only reads the catalog.
\set ON_ERROR_STOP on
begin;
create function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; raise notice 'pass: %', msg; end $$;

do $t$ declare
  bad text;
  -- KI-1 is closed by migrations 1004 and 1405: no function in schema public may be executable by the visitor role. Do not add an allow-list
  -- entry to make this pass; revoke the right in the migration that creates the function ('revoke execute ... from public, anon').
  anon_known text[] := array[]::text[];
begin
  select string_agg(c.relname, ', ') into bad from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity;
  perform pg_temp.ok(bad is null, 'every public table has row level security on' || coalesce(' (without: ' || bad || ')', ''));

  select string_agg(p.proname, ', ') into bad from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef
     and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%');
  perform pg_temp.ok(bad is null, 'every SECURITY DEFINER function pins its search_path' || coalesce(' (missing: ' || bad || ')', ''));

  select string_agg(p.proname, ', ') into bad from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute');
  perform pg_temp.ok(bad is null, 'the visitor role can run no SECURITY DEFINER function' || coalesce(' (found: ' || bad || ')', ''));

  select string_agg(p.proname, ', ') into bad from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute') and p.proname <> all (anon_known);
  perform pg_temp.ok(bad is null, 'the visitor role can run no function at all' || coalesce(' (new: ' || bad || ')', ''));

  perform pg_temp.ok(has_function_privilege('authenticated', 'public.invoice_desk_amount_words(numeric)', 'execute') and has_function_privilege('service_role', 'public.invoice_desk_amount_words(numeric)', 'execute')
    and has_function_privilege('authenticated', 'public.invoice_desk_under_thousand(integer)', 'execute'), 'the Invoice Desk helpers stay callable by signed-in people and the service role');
  perform pg_temp.ok(not has_function_privilege('authenticated', 'public.invoice_desk_validate_amount_words()', 'execute') and not has_function_privilege('authenticated', 'public.app_devices_forget_attendance_secret()', 'execute'), 'trigger functions are not callable by anyone but their owner');

  select string_agg(distinct table_name, ', ') into bad from information_schema.role_table_grants
   where table_schema = 'public' and grantee = 'anon';
  perform pg_temp.ok(bad is null, 'the visitor role has no grant on any public table or view' || coalesce(' (found: ' || bad || ')', ''));

  select string_agg(c.relname, ', ') into bad from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'v'
     and not exists (select 1 from unnest(coalesce(c.reloptions, '{}')) o where o in ('security_invoker=true', 'security_invoker=on'));
  perform pg_temp.ok(bad is null, 'every public view runs with the caller''s rights (security_invoker)' || coalesce(' (not: ' || bad || ')', ''));

  select string_agg(distinct c.relname, ', ') into bad from pg_class c join pg_namespace n on n.oid = c.relnamespace,
         lateral aclexplode(c.relacl) a
   where n.nspname = 'public' and c.relkind = 'S' and a.grantee = (select oid from pg_roles where rolname = 'anon');
  perform pg_temp.ok(bad is null, 'the visitor role has no right on any public sequence' || coalesce(' (found: ' || bad || ')', ''));
end $t$;
rollback;
