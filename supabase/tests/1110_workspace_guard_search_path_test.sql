-- Tests for 1110_workspace_guard_search_path.
\set ON_ERROR_STOP on
begin;
create function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; raise notice 'pass: %', msg; end $$;

select pg_temp.ok((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('workspace_documents_guard', 'workspace_members_guard', 'workspace_folders_guard', 'workspace_note_revisions_guard')
    and 'search_path=public' = any (coalesce(p.proconfig, array[]::text[]))) = 4, 'all four trigger guards pin search_path to public');
select pg_temp.ok((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname like 'workspace\_%'
    and not exists (select 1 from unnest(coalesce(p.proconfig, array[]::text[])) c where c like 'search_path=%')) = 0, 'every Workspace function pins its search_path, guards included');
select pg_temp.ok((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('workspace_documents_guard', 'workspace_members_guard', 'workspace_folders_guard', 'workspace_note_revisions_guard')
    and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))) = 0, 'the guards stay uncallable from the browser');
select pg_temp.ok((select count(*) from pg_trigger t join pg_proc p on p.oid = t.tgfoid
  where not t.tgisinternal and p.proname in ('workspace_documents_guard', 'workspace_members_guard', 'workspace_folders_guard', 'workspace_note_revisions_guard')) = 4, 'each guard is still attached to its table');
rollback;
