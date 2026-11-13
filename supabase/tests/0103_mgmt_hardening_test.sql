-- Tests for 0103_mgmt_hardening. Guards every Manager function, present and future, against a mutable search_path.
\set ON_ERROR_STOP on
begin;
create function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; raise notice 'pass: %', msg; end $$;
create function pg_temp.fails(sql text, msg text, part text default null) returns void language plpgsql as $$
begin
  begin execute sql; exception when others then
    if part is not null and sqlerrm not like '%' || part || '%' and sqlstate <> part then raise exception 'FAIL (wrong error "%"): %', sqlerrm, msg; end if;
    raise notice 'pass (refused): %', msg; return;
  end;
  raise exception 'FAIL (was allowed): %', msg;
end $$;

do $t$ declare bad text; sid uuid := gen_random_uuid(); eid uuid;
begin
  select string_agg(p.proname, ', ') into bad from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'mgmt\_%'
     and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%');
  perform pg_temp.ok(bad is null, 'every Manager function has a fixed search_path' || coalesce(' (missing: ' || bad || ')', ''));

  -- pinning the path must not change what the guards do
  insert into public.staff(id, full_name) values (sid, 'Fixture Hardening');
  insert into public.mgmt_credit_entries(staff_id, entry_date, kind, amount, description) values (sid, current_date, 'entry', 10, 'x') returning id into eid;
  perform pg_temp.fails(format($q$update public.mgmt_credit_entries set amount = 1 where id = %L$q$, eid), 'the credit ledger is still append-only', 'append-only');
  perform pg_temp.fails(format($q$delete from public.mgmt_credit_entries where id = %L$q$, eid), 'credit rows still cannot be deleted', 'append-only');
  insert into public.mgmt_staff_notes(staff_id, body) values (sid, 'Test note');
  perform pg_temp.fails($q$update public.mgmt_staff_notes set body = 'changed' where staff_id = (select id from public.staff where full_name = 'Fixture Hardening')$q$, 'notes still cannot be edited', 'cannot be changed');
end $t$;
rollback;
