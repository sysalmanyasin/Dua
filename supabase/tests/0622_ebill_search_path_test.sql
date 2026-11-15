\set ON_ERROR_STOP on
-- 0622: every ebill function has a fixed search path.
begin;
do $t$ declare bad text; begin
  select string_agg(p.proname, ', ') into bad from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'ebill\_%' and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%');
  if bad is not null then raise exception 'FAIL: no fixed search_path on: %', bad; end if;
  raise notice 'pass: every ebill function has a fixed search_path';
end $t$;
rollback;
