-- Whole-schema security invariants (Audit 0, T1). The per-area exposure tests (0199, 0749, 1299, 1399) guard their own ranges;
-- this one guards everything in schema public, so a new table or function cannot slip past them.
-- Read-only: it only reads the catalog.
\set ON_ERROR_STOP on
begin;
create function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; raise notice 'pass: %', msg; end $$;

do $t$ declare
  bad text;
  -- KNOWN ISSUE (docs/KNOWN_ISSUES.md KI-1): these five functions keep the built-in PUBLIC execute right, so the visitor role can run them.
  -- None is SECURITY DEFINER and none reads or writes data (two pure helpers, three trigger functions). Remove a name from this list when
  -- a migration revokes it; never add a name without a written reason.
  anon_known text[] := array[
    'invoice_desk_under_thousand', 'invoice_desk_amount_words',
    'invoice_desk_validate_amount_words', 'invoice_desk_validate_line_product',
    'app_devices_forget_attendance_secret'];
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
  perform pg_temp.ok(bad is null, 'the visitor role can run no function outside the documented known list' || coalesce(' (new: ' || bad || ')', ''));

  select string_agg(p.proname, ', ') into bad from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = any (anon_known) and p.prosecdef;
  perform pg_temp.ok(bad is null, 'the known visitor-runnable functions stay non-definer, so they cannot touch data as the owner' || coalesce(' (now definer: ' || bad || ')', ''));

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
