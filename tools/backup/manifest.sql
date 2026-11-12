-- Fingerprint of the database, one line per item: name|rows|md5.
-- Run inside the same snapshot as the dump (backup) and again on the restored copy (drill); the two outputs must be identical.
-- It prints names, counts and hashes only. No business value ever appears in the output.
set timezone = 'UTC';
select line from (
  -- every public table: row count and a hash of its content
  select 'table:' || table_name || '|' ||
    (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', table_name), false, true, '')))[1]::text || '|' ||
    (xpath('/row/h/text()', query_to_xml(format('select coalesce(md5(string_agg(x::text, E''\n'' order by x::text)), ''empty'') as h from public.%I x', table_name), false, true, '')))[1]::text as line
  from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'
  union all
  select 'registry|' || count(*) || '|' || coalesce(md5(string_agg(version || ':' || name, ',' order by version)), 'empty') from supabase_migrations.schema_migrations
  union all
  select 'auth.users|' || count(*) || '|' || coalesce(md5(string_agg(id::text, ',' order by id::text)), 'empty') from auth.users
  union all
  -- security shape: row-level security flags and table privileges
  select 'fp.tables|' || count(*) || '|' || coalesce(md5(string_agg(c.relname || ':' || c.relrowsecurity::text || ':' || c.relforcerowsecurity::text || ':' || coalesce(c.relacl::text, ''), ',' order by c.relname)), 'empty')
    from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'p')
  union all
  select 'fp.policies|' || count(*) || '|' || coalesce(md5(string_agg(tablename || ':' || policyname || ':' || cmd || ':' || coalesce(qual, '') || ':' || coalesce(with_check, ''), ',' order by tablename, policyname)), 'empty')
    from pg_policies where schemaname = 'public'
  union all
  -- functions: who may run them, and their exact text
  select 'fp.functions|' || count(*) || '|' || coalesce(md5(string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || '):' || coalesce(p.proacl::text, '') || ':' || md5(p.prosrc), ',' order by p.proname, pg_get_function_identity_arguments(p.oid))), 'empty')
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
) m order by line;
