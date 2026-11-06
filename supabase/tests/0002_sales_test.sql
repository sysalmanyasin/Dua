-- Tests for 0002_sales. Fixture cases are shared with the browser tests (tests/fixtures/sales-total-cases.json).
\set ON_ERROR_STOP on
\set cases `cat ../../tests/fixtures/sales-total-cases.json`
begin;

create function pg_temp.as_user(uid uuid, lvl text default 'aal1') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'aal', lvl, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; raise notice 'pass: %', msg; end $$;
-- Runs sql; passes only if it fails (optionally with the given SQLSTATE or message part).
create function pg_temp.fails(sql text, msg text, part text default null) returns void language plpgsql as $$
begin
  begin execute sql; exception when others then
    if part is not null and sqlerrm not like '%' || part || '%' and sqlstate <> part then raise exception 'FAIL (wrong error "%"): %', sqlerrm, msg; end if;
    raise notice 'pass (refused): %', msg; return;
  end;
  raise exception 'FAIL (was allowed): %', msg;
end $$;

insert into auth.users(id, email) values
 ('00000000-0000-0000-0000-0000000000a1','admin@test'),('00000000-0000-0000-0000-0000000000b1','junior@test'),
 ('00000000-0000-0000-0000-0000000000b2','junior2@test');
select public.bootstrap_first_admin('00000000-0000-0000-0000-0000000000a1','owner','Test Owner');
insert into public.staff(id, full_name) values ('10000000-0000-0000-0000-000000000001','Junior One'),('10000000-0000-0000-0000-000000000002','Junior Two');
insert into public.profiles(user_id, staff_id, username, role_template) values
 ('00000000-0000-0000-0000-0000000000b1','10000000-0000-0000-0000-000000000001','junior1','junior'),
 ('00000000-0000-0000-0000-0000000000b2','10000000-0000-0000-0000-000000000002','junior2','junior');

-- 1. the formula in the database gives the same answers as the browser fixtures
create temp table case_data as select :'cases'::jsonb as j;
do $t$ declare c jsonb; begin
  for c in select * from jsonb_array_elements((select j from case_data)) loop
    perform pg_temp.ok(public.sales_compute_total(c -> 'lines') = (c ->> 'total')::numeric, 'fixture: ' || (c ->> 'name'));
  end loop;
end $t$;

-- 2. 31 built-in methods seeded; signs as designed
select pg_temp.ok((select count(*) from public.payment_methods) = 31, '31 payment methods seeded');
select pg_temp.ok((select sign from public.payment_methods where code = 'cash_returns') = 'sub', 'cash returns is a subtract column');

-- 3. owner saves a day
do $t$ declare r jsonb; d date := (now() at time zone 'Asia/Karachi')::date - 1; n int; rev record; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal1');
  perform pg_temp.fails(format($q$select public.sales_save_day(%L, '{}', '[]', null, gen_random_uuid())$q$, d), 'owner without MFA cannot save', '42501');
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  r := public.sales_save_day(d, '{"comp_sale": 100000, "customers": 210}',
        '[{"method":"cash_sale","amount":90000.5},{"method":"cash_returns","amount":-500},{"method":"pso","amount":15000},{"method":"hbl","amount":0}]',
        null, '11111111-1111-1111-1111-111111111111');
  perform pg_temp.ok((r ->> 'total')::numeric = 104501 and (r ->> 'diff')::numeric = 4501 and (r ->> 'revision')::int = 1, 'owner saves a day: total 104,501, diff 4,501, revision 1');
  select count(*) into n from public.daily_sale_lines where business_date = d; perform pg_temp.ok(n = 3, 'zero-amount lines are not stored');
  select count(*) into n from public.activity_log where action = 'sales.created'; perform pg_temp.ok(n = 1, 'creation is logged');

  -- idempotent retry: same key, no second write
  r := public.sales_save_day(d, '{"comp_sale": 1}', '[]', null, '11111111-1111-1111-1111-111111111111');
  perform pg_temp.ok((r ->> 'total')::numeric = 104501, 'same key returns the original result');
  select count(*) into n from public.daily_sales where business_date = d and revision = 1; perform pg_temp.ok(n = 1, 'retry did not change the day');

  -- correction needs a reason, keeps the old version
  perform pg_temp.fails(format($q$select public.sales_save_day(%L, '{}', '[{"method":"cash_sale","amount":1}]', '', gen_random_uuid())$q$, d), 'a correction without a reason is refused', 'reason');
  r := public.sales_save_day(d, '{"comp_sale": 100000}', '[{"method":"cash_sale","amount":120000}]', 'typo in cash', '22222222-2222-2222-2222-222222222222');
  perform pg_temp.ok((r ->> 'revision')::int = 2 and (r ->> 'total')::numeric = 120000, 'correction makes revision 2');
  select * into rev from public.daily_sales_revisions where business_date = d;
  perform pg_temp.ok(rev.revision = 1 and rev.reason = 'typo in cash' and (rev.header ->> 'total')::numeric = 104501 and jsonb_array_length(rev.lines) = 3, 'old version and reason are kept');
  select count(*) into n from public.activity_log where action = 'sales.corrected'; perform pg_temp.ok(n = 1, 'correction is logged');

  -- validation
  perform pg_temp.fails($q$select public.sales_save_day(current_date + 5, '{}', '[]', null, gen_random_uuid())$q$, 'future date refused', 'future');
  perform pg_temp.fails(format($q$select public.sales_save_day(%L, '{}', '[{"method":"nope","amount":1}]', 'x y z', gen_random_uuid())$q$, d - 5), 'unknown method refused', 'unknown');
  perform pg_temp.fails(format($q$select public.sales_save_day(%L, '{}', '[{"method":"pso","amount":1},{"method":"pso","amount":2}]', null, gen_random_uuid())$q$, d - 5), 'duplicate method refused', 'twice');
  perform pg_temp.fails(format($q$select public.sales_save_day(%L, '{}', '[{"method":"pso","amount":99999999999}]', null, gen_random_uuid())$q$, d - 5), 'absurd amount refused', 'range');
  perform pg_temp.fails(format($q$select public.sales_save_day(%L, '{}', '{"a":1}', null, gen_random_uuid())$q$, d - 5), 'lines must be a list', 'list');
  perform pg_temp.fails(format($q$select public.sales_save_day(%L, '{"customers": -4}', '[]', null, gen_random_uuid())$q$, d - 5), 'negative customers refused');
  perform pg_temp.fails(format($q$insert into public.daily_sales(business_date, total) values (%L, 1)$q$, d - 9), 'no direct writes to daily_sales, even for the owner', '42501');
  perform pg_temp.fails($q$update public.daily_sale_lines set amount = 1$q$, 'no direct writes to lines', '42501');
  reset role;
end $t$;

-- 4. a junior: last closed day only
do $t$ declare r jsonb; d date := (now() at time zone 'Asia/Karachi')::date - 1; n int; today date := (now() at time zone 'Asia/Karachi')::date; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  perform public.sales_save_day(today, '{}', '[{"method":"cash_sale","amount":777}]', null, gen_random_uuid());   -- today is not "closed"
  perform public.sales_save_day(d - 1, '{}', '[{"method":"cash_sale","amount":5}]', null, gen_random_uuid());
  reset role;

  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  r := public.sales_last_closed_day();
  perform pg_temp.ok((r ->> 'total')::numeric = 120000 and (r ->> 'business_date')::date = d, 'junior sees only yesterday''s total (today excluded)');
  perform pg_temp.ok((select count(*) from jsonb_object_keys(r)) = 2, 'and nothing else about the day');
  select count(*) into n from public.daily_sales; perform pg_temp.ok(n = 0, 'junior cannot read the sales table');
  select count(*) into n from public.daily_sale_lines; perform pg_temp.ok(n = 0, 'junior cannot read payment lines');
  select count(*) into n from public.v_monthly; perform pg_temp.ok(n = 0, 'junior cannot read monthly totals');
  select count(*) into n from public.payment_methods; perform pg_temp.ok(n = 0, 'junior cannot read the payment methods list');
  perform pg_temp.fails($q$select public.sales_save_day(current_date - 20, '{}', '[]', null, gen_random_uuid())$q$, 'junior cannot enter sales', '42501');
  reset role;

  -- the owner can deny even that, per person
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  perform public.set_user_permission('00000000-0000-0000-0000-0000000000b2', 'sales.view_last_day', 'deny', null);
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
  perform pg_temp.fails($q$select public.sales_last_closed_day()$q$, 'a person with that permission denied sees nothing', '42501');
  reset role;
end $t$;

-- 5. enter and edit are separate permissions
do $t$ declare r jsonb; d date := (now() at time zone 'Asia/Karachi')::date - 30; n int; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  perform public.set_user_permission('00000000-0000-0000-0000-0000000000b1', 'sales.enter', 'grant', null);
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  r := public.sales_save_day(d, '{}', '[{"method":"cash_sale","amount":10}]', null, gen_random_uuid());
  perform pg_temp.ok((r ->> 'revision')::int = 1, 'a junior granted sales.enter can create a new day');
  perform pg_temp.fails(format($q$select public.sales_save_day(%L, '{}', '[{"method":"cash_sale","amount":11}]', 'fixing it', gen_random_uuid())$q$, d), 'but cannot correct it without sales.edit', '42501');
  perform pg_temp.fails(format($q$select public.sales_save_day(%L, '{}', '[]', null, '11111111-1111-1111-1111-111111111111')$q$, d), 'and cannot reuse another user''s key', '42501');
  reset role;
end $t$;

-- 6. owner reads monthly totals; they equal the sum of days
do $t$ declare n int; m numeric; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  select sum(total) into m from public.v_monthly; select sum(total) into n from public.daily_sales;
  perform pg_temp.ok(m = n and m > 0, 'monthly view equals the sum of the days');
  reset role;
end $t$;

-- 7. the report view (cash sale / cash returns per day) follows permissions
do $t$ declare r record; n int; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  select * into r from public.v_daily_report where business_date = (now() at time zone 'Asia/Karachi')::date - 1;
  perform pg_temp.ok(r.cash_sale = 120000 and r.cash_returns = 0, 'report view: yesterday''s cash sale is 120,000');
  perform public.sales_save_day((now() at time zone 'Asia/Karachi')::date - 3, '{"fdpp_pos": 40}',
    '[{"method":"cash_sale","amount":1000},{"method":"cash_returns","amount":-250},{"method":"pso","amount":-10}]', null, gen_random_uuid());
  select * into r from public.v_daily_report where business_date = (now() at time zone 'Asia/Karachi')::date - 3;
  perform pg_temp.ok(r.cash_sale = 1000 and r.cash_returns = 250 and r.fdpp_pos = 40, 'report view: returns come out positive, one row per day');
  select count(*) into n from public.v_daily_report; select count(*) into r.cash_sale from public.daily_sales;
  perform pg_temp.ok(n = (select count(*) from public.daily_sales), 'report view has exactly one row per day');
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
  select count(*) into n from public.v_daily_report; perform pg_temp.ok(n = 0, 'a person without history access sees nothing in the report view');
  reset role;
end $t$;

rollback;
