-- Tests for 0702_ops_bi_summary.
\set ON_ERROR_STOP on
begin;
create function pg_temp.as_user(uid uuid, lvl text default 'aal1') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'aal', lvl, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; raise notice 'pass: %', msg; end $$;
insert into auth.users(id, email) values ('00000000-0000-0000-0000-0000000000a1','a@t'),('00000000-0000-0000-0000-0000000000c1','s@t');
select public.bootstrap_first_admin('00000000-0000-0000-0000-0000000000a1','owner','Test Owner');
insert into public.staff(id, full_name) values ('10000000-0000-0000-0000-000000000002','S Two');
insert into public.profiles(user_id, staff_id, username, role_template) values ('00000000-0000-0000-0000-0000000000c1','10000000-0000-0000-0000-000000000002','senior1','senior');

do $t$ declare v jsonb; failed boolean; today date := (now() at time zone 'Asia/Karachi')::date; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  perform pg_temp.ok(public.ops_bi_summary(30) is null, 'a senior gets nothing');
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal1');
  perform pg_temp.ok(public.ops_bi_summary(30) is null, 'an owner session without the second factor gets nothing');
  reset role;

  -- current 7 days: 3 recorded days (1000, 2000, 3000; customers 10, 20, null); previous 7 days: 2 recorded days (500, 500; customers 5, 5)
  insert into public.daily_sales(business_date, total, customers) values
    (today - 1, 1000, 10), (today - 3, 2000, 20), (today - 7, 3000, null),
    (today - 8, 500, 5), (today - 10, 500, 5),
    (today - 20, 4000, 40), (today - 60, 100, 1);
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');

  v := public.ops_bi_summary(7);
  perform pg_temp.ok((v -> 'sales' ->> 'total')::numeric = 6000 and (v -> 'sales' ->> 'recorded_days')::int = 3, '7 days: sales add up the recorded days');
  perform pg_temp.ok((v -> 'sales' ->> 'avg_per_day')::numeric = 2000, '7 days: average is per recorded day, not per calendar day');
  perform pg_temp.ok((v -> 'sales' ->> 'previous_total')::numeric = 1000 and (v -> 'sales' ->> 'previous_recorded_days')::int = 2, '7 days: the previous period is the 7 days before');
  perform pg_temp.ok((v -> 'transactions' ->> 'total')::int = 30 and (v -> 'transactions' ->> 'counted_days')::int = 2, '7 days: a day with no customer count is not counted as zero');
  perform pg_temp.ok(jsonb_array_length(v -> 'sales' -> 'series') = 3, '7 days: the trend lists only recorded days');
  perform pg_temp.ok((v ->> 'to')::date = today - 1 and (v ->> 'from')::date = today - 7, 'the period is complete days ending yesterday; today is excluded');
  perform pg_temp.ok((v -> 'operations' ->> 'days_with_sales')::int = 3 and (v -> 'operations' ->> 'days_in_period')::int = 7, 'operations show days with sales entered out of the period');

  v := public.ops_bi_summary(30);
  perform pg_temp.ok((v -> 'sales' ->> 'total')::numeric = 11000 and (v -> 'sales' ->> 'recorded_days')::int = 6, '30 days: everything inside 30 days is included');
  perform pg_temp.ok((v -> 'sales' ->> 'previous_total')::numeric = 100, '30 days: the previous period reaches back to day 60');
  v := public.ops_bi_summary();
  perform pg_temp.ok((v ->> 'days')::int = 30, 'the default period is 30 days');
  v := public.ops_bi_summary(90);
  perform pg_temp.ok((v -> 'sales' ->> 'total')::numeric = 11100, '90 days includes the 60-day-old day');

  failed := false; begin perform public.ops_bi_summary(14); exception when sqlstate '22023' then failed := true; end;
  perform pg_temp.ok(failed, 'any period other than 7, 30 or 90 is refused');
  failed := false; begin perform public.ops_bi_summary(null); exception when sqlstate '22023' then failed := true; end;
  perform pg_temp.ok(failed, 'a blank period is refused');

  v := public.ops_bi_summary(7);
  perform pg_temp.ok(v ? 'inventory' and v ? 'inventory_failed' and (v ->> 'inventory_failed')::boolean = false, 'inventory comes from its own summary');
  reset role;

  -- no data at all in a period: averages are null, not zero or an error
  delete from public.daily_sales;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  v := public.ops_bi_summary(7);
  perform pg_temp.ok((v -> 'sales' ->> 'avg_per_day') is null and (v -> 'sales' ->> 'total')::numeric = 0 and jsonb_array_length(v -> 'sales' -> 'series') = 0, 'an empty period gives a null average and a zero total');
  reset role;

  -- a broken inventory summary is reported, and the rest still works
  drop function public.inventory_cover_summary(timestamptz);
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  v := public.ops_bi_summary(7);
  perform pg_temp.ok((v ->> 'inventory_failed')::boolean and v -> 'inventory' = 'null'::jsonb and v ? 'sales', 'a failed inventory read is flagged, not hidden, and does not stop the rest');
  reset role;
  perform pg_temp.ok((select count(*) from pg_proc p where p.proname = 'ops_bi_summary' and has_function_privilege('anon', p.oid, 'execute')) = 0, 'the visitor role cannot call it');
end $t$;
rollback;
