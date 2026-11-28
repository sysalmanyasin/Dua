-- Tests for 0004_remove_import_helper (Audit 0): the one-time, token-protected import helper from 0003 must be gone for good.
\set ON_ERROR_STOP on
begin;
create function pg_temp.as_user(uid uuid, lvl text default 'aal1') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'aal', lvl, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
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

do $t$ begin
  perform pg_temp.ok(to_regprocedure('public.import_sales_batch(jsonb,jsonb,jsonb)') is null, 'the import function import_sales_batch no longer exists');
  perform pg_temp.ok(to_regprocedure('public.import_check_token(text,boolean)') is null, 'the token check function no longer exists');
  perform pg_temp.ok(to_regclass('public.import_tokens') is null, 'the import token table no longer exists');
  perform pg_temp.ok(not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'import\_%'), 'no function named import_* exists in the public schema');
  perform pg_temp.ok(not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname like 'import\_%'), 'no table or view named import_* exists in the public schema');
end $t$;
rollback;
