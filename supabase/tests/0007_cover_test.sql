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

insert into auth.users(id, email) values ('00000000-0000-0000-0000-0000000000a1','a@t'),('00000000-0000-0000-0000-0000000000b1','j@t'),('00000000-0000-0000-0000-0000000000b2','j2@t'),('00000000-0000-0000-0000-0000000000c1','o@t');
select public.bootstrap_first_admin('00000000-0000-0000-0000-0000000000a1','owner','Test Owner');
insert into public.staff(id, full_name) values ('10000000-0000-0000-0000-000000000001','J One'),('10000000-0000-0000-0000-000000000002','J Two');
insert into public.profiles(user_id, staff_id, username, role_template) values
 ('00000000-0000-0000-0000-0000000000b1','10000000-0000-0000-0000-000000000001','junior1','junior'),
 ('00000000-0000-0000-0000-0000000000b2','10000000-0000-0000-0000-000000000002','junior2','junior');

do $t$ declare today date := (now() at time zone 'Asia/Karachi')::date; r jsonb; n int; ms date := date_trunc('month', (now() at time zone 'Asia/Karachi'))::date; begin
  -- the owner enters yesterday and today (today is not "closed"), sets a target
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  perform public.sales_save_day(today - 1, '{"comp_sale":900,"customers":10}', '[{"method":"cash_sale","amount":1000}]', null, gen_random_uuid());
  perform public.sales_save_day(today, '{}', '[{"method":"cash_sale","amount":500}]', null, gen_random_uuid());
  perform public.sales_set_target(ms, 20000);
  r := public.cover_summary();
  perform pg_temp.ok((r -> 'sales' -> 'last_day' ->> 'total')::numeric = 1000 and (r -> 'sales' -> 'last_day' ->> 'diff')::numeric = 100, 'cover: last closed day is yesterday with its diff');
  perform pg_temp.ok((r -> 'sales' -> 'target')::numeric = 20000, 'cover: month target shown');
  perform pg_temp.ok((r -> 'sales' -> 'mtd' ->> 'total')::numeric >= 500, 'cover: month to date includes today');
  perform pg_temp.ok(jsonb_array_length(r -> 'sales' -> 'missing_days') = 2, 'cover: the two earlier days without an entry are flagged');
  perform pg_temp.ok(not (r ? 'checklist') or (r -> 'checklist' ->> 'today_exists') = 'false', 'cover: checklist not started today');
  perform public.sales_set_target(ms, null);
  perform pg_temp.ok((select count(*) from public.sales_targets) = 0, 'a target can be cleared');
  perform public.sales_set_target(ms, 20000);
  select count(*) into n from public.activity_log where action = 'sales.target_set'; perform pg_temp.ok(n = 3, 'target changes are logged');
  reset role;

  -- a junior with only last-day access sees only that
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  r := public.cover_summary();
  perform pg_temp.ok((r -> 'sales' -> 'last_day' ->> 'total')::numeric = 1000, 'junior cover: last day total');
  perform pg_temp.ok(not (r -> 'sales' ? 'mtd') and not (r -> 'sales' ? 'target') and not (r -> 'sales' -> 'last_day' ? 'diff'), 'junior cover: nothing beyond the last day total');
  perform pg_temp.ok(not (r ? 'checklist'), 'junior cover: no checklist block without permission');
  select count(*) into n from public.sales_targets; perform pg_temp.ok(n = 0, 'junior cannot read targets');
  perform pg_temp.fails($q$select public.sales_set_target(date '2026-01-01', 5)$q$, 'junior cannot set a target', '42501');
  reset role;

  -- someone with no profile gets nothing
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  perform pg_temp.ok(public.cover_summary() is null, 'an outsider gets no cover data');
  perform pg_temp.fails($q$select public.prefs_set('x', '1')$q$, 'an outsider cannot store preferences', '42501');
  reset role;

  -- preferences are private to the person, validated and bounded
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  perform public.prefs_set('sale_report.hidden', '["hbl","mcb"]');
  perform public.prefs_set('sale_report.hidden', '["hbl"]');
  select count(*) into n from public.user_prefs; perform pg_temp.ok(n = 1, 'a preference is one row per key (updated, not duplicated)');
  perform pg_temp.fails($q$select public.prefs_set('Bad Key!', '1')$q$, 'a malformed key is refused', 'bad key');
  perform pg_temp.fails($q$select public.prefs_set('big', to_jsonb(repeat('x', 21000)))$q$, 'an oversized value is refused', 'too large');
  perform pg_temp.fails($q$insert into public.user_prefs(user_id, key, value) values (auth.uid(), 'k', '1')$q$, 'no direct writes', '42501');
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
  select count(*) into n from public.user_prefs; perform pg_temp.ok(n = 0, 'one person cannot read another person''s preferences');
  reset role;
end $t$;
rollback;
