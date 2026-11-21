-- Tests for 0015_core_trigger_search_path.
\set ON_ERROR_STOP on
begin;
create function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; raise notice 'pass: %', msg; end $$;

select pg_temp.ok((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('set_updated_at', 'activity_log_immutable')
    and 'search_path=public' = any (coalesce(p.proconfig, array[]::text[]))) = 2, 'both core trigger functions pin search_path to public');
select pg_temp.ok((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('set_updated_at', 'activity_log_immutable')
    and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))) = 0, 'both stay uncallable from the browser');
select pg_temp.ok((select count(*) from pg_trigger t join pg_proc p on p.oid = t.tgfoid
  where not t.tgisinternal and p.proname = 'activity_log_immutable') = 1, 'the audit-log guard is still attached');
select pg_temp.ok((select count(*) from pg_trigger t join pg_proc p on p.oid = t.tgfoid
  where not t.tgisinternal and p.proname = 'set_updated_at') >= 1, 'set_updated_at is still attached to tables');

-- behaviour unchanged: the audit log still refuses update and delete, and updated_at still moves
insert into public.activity_log(action, entity, entity_id) values ('test.0015', 'test', 'x');
do $$ begin
  begin update public.activity_log set reason = 'x' where action = 'test.0015'; raise exception 'FAIL: update was allowed';
  exception when others then if sqlerrm not like '%append-only%' then raise; end if; end;
  begin delete from public.activity_log where action = 'test.0015'; raise exception 'FAIL: delete was allowed';
  exception when others then if sqlerrm not like '%append-only%' then raise; end if; end;
end $$;
select pg_temp.ok(true, 'activity_log still refuses update and delete');

insert into public.staff(full_name) values ('Search Path Check');
update public.staff set updated_at = '2000-01-01' where full_name = 'Search Path Check';
select pg_temp.ok((select updated_at > now() - interval '1 minute' from public.staff where full_name = 'Search Path Check'), 'set_updated_at still stamps updated_at');

-- a browser-role user (no EXECUTE right on the function) must still get updated_at stamped and the audit log guarded
create table public.zz_0015_probe (id int primary key, v text, updated_at timestamptz not null default now());
create trigger zz_0015_probe_updated before update on public.zz_0015_probe for each row execute function public.set_updated_at();
insert into public.zz_0015_probe values (1, 'a', '2000-01-01');
grant select, update on public.zz_0015_probe to authenticated;
set local role authenticated;
update public.zz_0015_probe set v = 'b' where id = 1;
reset role;
select pg_temp.ok((select updated_at > now() - interval '1 minute' from public.zz_0015_probe where id = 1), 'triggers still fire for a signed-in role without EXECUTE on the function');
rollback;
