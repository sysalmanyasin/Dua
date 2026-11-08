\set ON_ERROR_STOP on
begin;
create function pg_temp.as_user(uid uuid, lvl text default 'aal1') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'aal', lvl, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; raise notice 'pass: %', msg; end $$;

insert into auth.users(id, email) values ('00000000-0000-0000-0000-0000000000a1','a@t'),('00000000-0000-0000-0000-0000000000b1','j@t');
select public.bootstrap_first_admin('00000000-0000-0000-0000-0000000000a1','owner','Test Owner');
insert into public.staff(id, full_name) values ('10000000-0000-0000-0000-000000000001','J One');
insert into public.profiles(user_id, staff_id, username, role_template) values ('00000000-0000-0000-0000-0000000000b1','10000000-0000-0000-0000-000000000001','junior1','junior');

-- two daily months and one monthly-only month; the import helper path is replaced by direct inserts here
insert into public.daily_sales (business_date, total, comp_sale, customers) values
  ('2026-02-10', 1000, 900, 10), ('2026-02-11', 500, null, 5), ('2026-03-01', 700, 600, 7);
insert into public.daily_sale_lines (business_date, method_code, amount) values
  ('2026-02-10', 'cash_sale', 800), ('2026-02-10', 'cash_returns', -100), ('2026-02-10', 'bank_alfalah', 200), ('2026-02-10', 'pso', 100),
  ('2026-02-11', 'cash_sale', 500), ('2026-03-01', 'cash_sale', 600), ('2026-03-01', 'pso', 100);
insert into public.monthly_history (month, total, comp_sale, customers) values ('2021-04-01', 9000, null, 300);
insert into public.monthly_history_lines (month, method_code, amount) values ('2021-04-01', 'cash_sale', 8000), ('2021-04-01', 'pso', 1000);

do $t$ declare r record; n int; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  select * into r from public.v_daily_full where business_date = '2026-02-10';
  perform pg_temp.ok(r.cash = 700 and r.banks = 200 and r.credit = 100, 'a day splits into cash (net of returns), banks and credit clients');
  perform pg_temp.ok(r.cash + r.banks + r.credit = r.total, 'and the three parts add up to the total');
  select * into r from public.v_monthly_full where month = '2026-02-01';
  perform pg_temp.ok(r.total = 1500 and r.days = 2 and r.customers = 15 and r.cash = 1200 and not r.monthly_only, 'a month adds up its days');
  select * into r from public.v_monthly_full where month = '2021-04-01';
  perform pg_temp.ok(r.monthly_only and r.total = 9000 and r.cash = 8000 and r.credit = 1000 and r.days = 0, 'a monthly-only month comes from its monthly figures');
  select count(*) into n from public.v_monthly_full; perform pg_temp.ok(n = 3, 'one row per month, no duplicates');
  select * into r from public.v_client_totals where code = 'pso';
  perform pg_temp.ok(r.total = 1200, 'client totals include daily and monthly-only figures (100 + 100 + 1000)');
  perform pg_temp.ok((select count(*) from public.v_client_totals where code = 'cash_sale') = 0, 'only credit clients are in the client totals');
  reset role;

  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  select count(*) into n from public.v_daily_full; perform pg_temp.ok(n = 0, 'a junior sees no daily summary');
  select count(*) into n from public.v_monthly_full; perform pg_temp.ok(n = 0, 'a junior sees no monthly summary');
  select count(*) into n from public.v_client_totals; perform pg_temp.ok(n = 0, 'a junior sees no client totals');
  reset role;
end $t$;
rollback;
