-- Tests for 0017_foundation_rls_auto_enable_revoke. The platform function does not exist on plain PostgreSQL, so a stand-in
-- with the same shape (an event-trigger function, SECURITY DEFINER, pinned search_path) and the live grants is built inside a
-- transaction, the migration is run again over it, and the result is rolled back.
\set ON_ERROR_STOP on
begin;
create function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; raise notice 'pass: %', msg; end $$;

-- 1. with no such function the migration changes nothing and does not fail
select pg_temp.ok(to_regprocedure('public.rls_auto_enable()') is null, 'the platform function is absent on plain PostgreSQL');
\i ../migrations/0017_foundation_rls_auto_enable_revoke.sql
select pg_temp.ok(true, 'the migration is a no-op when the function is absent');

-- 2. a stand-in like the live one, with the live grants (owner, signed-in users)
create function public.rls_auto_enable() returns event_trigger language plpgsql security definer set search_path to 'pg_catalog' as $f$
declare cmd record; tbl name;
begin
  for cmd in select * from pg_event_trigger_ddl_commands() where command_tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO') and object_type in ('table', 'partitioned table') loop
    if cmd.schema_name = 'public' then
      select c.relname into tbl from pg_catalog.pg_class c where c.oid = cmd.objid;
      execute format('alter table if exists %I.%I enable row level security', cmd.schema_name, tbl);
    end if;
  end loop;
end; $f$;
revoke execute on function public.rls_auto_enable() from public;
grant execute on function public.rls_auto_enable() to authenticated;
create event trigger zz_test_ensure_rls on ddl_command_end when tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO') execute function public.rls_auto_enable();
select pg_temp.ok(has_function_privilege('authenticated', 'public.rls_auto_enable()', 'execute'), 'before: signed-in users can execute it (the advisor finding)');

-- 3. the migration removes it
\i ../migrations/0017_foundation_rls_auto_enable_revoke.sql
select pg_temp.ok(not has_function_privilege('authenticated', 'public.rls_auto_enable()', 'execute'), 'after: signed-in users cannot execute it');
select pg_temp.ok(not has_function_privilege('anon', 'public.rls_auto_enable()', 'execute'), 'anon cannot execute it');
select pg_temp.ok(not exists (select 1 from pg_proc p, aclexplode(p.proacl) a where p.proname = 'rls_auto_enable' and a.grantee = 0), 'PUBLIC cannot execute it');
select pg_temp.ok(has_function_privilege(current_user, 'public.rls_auto_enable()', 'execute'), 'the owner still can');

-- 4. running it twice is harmless
\i ../migrations/0017_foundation_rls_auto_enable_revoke.sql
select pg_temp.ok(not has_function_privilege('authenticated', 'public.rls_auto_enable()', 'execute'), 'it can be run again');

-- 5. the trigger still works for tables made by someone who cannot execute the function
create table public.zz_rls_probe_plain (a int);
create table public.zz_rls_probe_ctas as select 1 as x;
grant create on schema public to authenticated; -- undone by the rollback below
set local role authenticated;
create table public.zz_rls_probe_auth (a int);
reset role;
select pg_temp.ok((select relrowsecurity from pg_class where relname = 'zz_rls_probe_plain' and relnamespace = 'public'::regnamespace), 'a new table still gets row level security');
select pg_temp.ok((select relrowsecurity from pg_class where relname = 'zz_rls_probe_ctas' and relnamespace = 'public'::regnamespace), 'CREATE TABLE AS still gets row level security');
select pg_temp.ok((select relrowsecurity from pg_class where relname = 'zz_rls_probe_auth' and relnamespace = 'public'::regnamespace), 'a table made by a signed-in role still gets row level security');
rollback;
