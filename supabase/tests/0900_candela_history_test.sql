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

insert into auth.users(id, email) values ('00000000-0000-0000-0000-0000000000a1','a@t'),('00000000-0000-0000-0000-0000000000b1','j@t'),('00000000-0000-0000-0000-0000000000b2','j2@t');
select public.bootstrap_first_admin('00000000-0000-0000-0000-0000000000a1','owner','Test Owner');
insert into public.staff(id, full_name) values ('10000000-0000-0000-0000-000000000001','J One'),('10000000-0000-0000-0000-000000000002','J Two');
insert into public.profiles(user_id, staff_id, username, role_template) values
 ('00000000-0000-0000-0000-0000000000b1','10000000-0000-0000-0000-000000000001','junior1','junior'),
 ('00000000-0000-0000-0000-0000000000b2','10000000-0000-0000-0000-000000000002','junior2','junior');
-- junior2 is the staff member the owner trusts with today's total
insert into public.user_permissions(user_id, perm_key, effect) values ('00000000-0000-0000-0000-0000000000b2','candela.today_total','grant');

do $t$ declare
  d date := (now() at time zone 'Asia/Karachi')::date;
  p jsonb; n int; v numeric;
  prod jsonb := jsonb_build_array(jsonb_build_object('code','A1','name','Test Tablet','qty',10,'price',5));
begin
  perform pg_temp.ok(exists (select 1 from public.permissions where key = 'candela.view') and exists (select 1 from public.permissions where key = 'candela.today_total'), 'both permissions are seeded');
  perform pg_temp.ok(not exists (select 1 from public.role_permissions where perm_key like 'candela.%'), 'no role preset carries a Candela permission');

  -- first sync: four days, with the same customer written two ways on one day
  set local role service_role;
  perform public.inventory_apply_sync(jsonb_build_object('products', prod,
    'payment_summary', jsonb_build_array(
      jsonb_build_object('sale_day', d - 3, 'cash_sale', 100.10, 'card_sale', 200.20, 'credit_sale', 50.05, 'total_sale', 350.35),
      jsonb_build_object('sale_day', d - 2, 'cash_sale', 1, 'card_sale', 2, 'credit_sale', 3, 'total_sale', 6),
      jsonb_build_object('sale_day', d - 1, 'cash_sale', 10, 'card_sale', 20, 'credit_sale', 30, 'total_sale', 60),
      jsonb_build_object('sale_day', d,     'cash_sale', 400, 'card_sale', 500, 'credit_sale', 100, 'total_sale', 1000)),
    'credit_by_customer', jsonb_build_array(
      jsonb_build_object('sale_day', d - 1, 'customer_name', 'Test Customer A', 'credit_amount', 10, 'receipt_count', 1),
      jsonb_build_object('sale_day', d - 1, 'customer_name', '  test   customer a ', 'credit_amount', 5.5, 'receipt_count', 2),
      jsonb_build_object('sale_day', d - 1, 'customer_name', 'Test Customer B', 'credit_amount', 7, 'receipt_count', 1))));
  reset role;
  perform pg_temp.ok((select count(*) from public.candela_daily_payments) = 4, 'four days are kept');
  perform pg_temp.ok((select total_sale from public.candela_daily_payments where sale_day = d - 3) = 350.35, 'amounts arrive to the paisa');
  perform pg_temp.ok((select count(*) from public.candela_credit_daily) = 2, 'same customer written two ways is one customer');
  perform pg_temp.ok((select credit_amount from public.candela_credit_daily where customer_key = 'test customer a') = 15.5
    and (select receipt_count from public.candela_credit_daily where customer_key = 'test customer a') = 3, 'merged customer rows are added together');

  -- the feed moves on: the window now starts later. Old days must survive; overlapping days must not duplicate.
  set local role service_role;
  perform public.inventory_apply_sync(jsonb_build_object('products', prod,
    'payment_summary', jsonb_build_array(
      jsonb_build_object('sale_day', d - 1, 'cash_sale', 10, 'card_sale', 20, 'credit_sale', 30, 'total_sale', 60),
      jsonb_build_object('sale_day', d,     'cash_sale', 400, 'card_sale', 500, 'credit_sale', 100, 'total_sale', 1000),
      jsonb_build_object('sale_day', d + 1, 'cash_sale', 9, 'card_sale', 9, 'credit_sale', 9, 'total_sale', 27)),
    'credit_by_customer', '[]'::jsonb));
  reset role;
  perform pg_temp.ok((select count(*) from public.sales_payment_summary) = 3, 'the rolling landing table holds only the new window (existing behaviour)');
  perform pg_temp.ok((select count(*) from public.candela_daily_payments) = 5, 'days that left the window are still kept, new day added');
  perform pg_temp.ok((select count(*) from public.candela_credit_daily) = 2, 'an empty credit payload deletes nothing');
  perform pg_temp.ok((select max(revision) from public.candela_daily_payments) = 1 and (select count(*) from public.candela_changes) = 0, 'repeating the same figures changes nothing and logs nothing');

  -- Candela corrects a day: new figure stored, old figure kept in the change log
  set local role service_role;
  perform public.inventory_apply_sync(jsonb_build_object('products', prod,
    'payment_summary', jsonb_build_array(jsonb_build_object('sale_day', d, 'cash_sale', 450, 'card_sale', 500, 'credit_sale', 100, 'total_sale', 1050)),
    'credit_by_customer', jsonb_build_array(jsonb_build_object('sale_day', d - 1, 'customer_name', 'Test Customer B', 'credit_amount', 8, 'receipt_count', 2))));
  reset role;
  perform pg_temp.ok((select total_sale from public.candela_daily_payments where sale_day = d) = 1050 and (select revision from public.candela_daily_payments where sale_day = d) = 2, 'a corrected day is updated and its revision rises');
  perform pg_temp.ok((select (old_values ->> 'total_sale')::numeric from public.candela_changes where kind = 'payment' and sale_day = d) = 1000, 'the old figure is kept');
  perform pg_temp.ok((select credit_amount from public.candela_credit_daily where customer_key = 'test customer b') = 8 and (select count(*) from public.candela_changes where kind = 'credit') = 1, 'a corrected customer figure is updated and logged');
  perform pg_temp.ok((select count(*) from public.candela_daily_payments) = 5, 'a correction does not create a duplicate day');

  -- a failed sync (bad number after the payment rows) rolls the history copy back too
  begin
    set local role service_role;
    perform public.inventory_apply_sync(jsonb_build_object('products', prod,
      'payment_summary', jsonb_build_array(jsonb_build_object('sale_day', d + 5, 'cash_sale', 1, 'card_sale', 1, 'credit_sale', 1, 'total_sale', 3)),
      'credit_by_customer', jsonb_build_array(jsonb_build_object('sale_day', d, 'customer_name', 'X', 'credit_amount', 'abc', 'receipt_count', 1))));
    reset role;
    perform pg_temp.ok(false, 'a bad row must fail the sync');
  exception when others then reset role;
  end;
  perform pg_temp.ok(not exists (select 1 from public.candela_daily_payments where sale_day = d + 5), 'a failed sync leaves no half-copied history');

  -- security: anon
  set local role anon;
  perform pg_temp.fails('select * from public.candela_daily_payments', 'anon cannot read payments', '42501');
  perform pg_temp.fails('select * from public.candela_credit_daily', 'anon cannot read credit', '42501');
  perform pg_temp.fails('select public.candela_today_total()', 'anon cannot call the total', '42501');
  reset role;

  -- security: a junior with no Candela permission
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  select count(*) into n from public.candela_daily_payments; perform pg_temp.ok(n = 0, 'junior reads no payment rows');
  select count(*) into n from public.candela_credit_daily; perform pg_temp.ok(n = 0, 'junior reads no credit rows');
  select count(*) into n from public.candela_changes; perform pg_temp.ok(n = 0, 'junior reads no change log');
  perform pg_temp.fails('select public.candela_today_total()', 'junior cannot get the total', '42501');
  perform pg_temp.fails($q$insert into public.candela_daily_payments(sale_day) values (current_date + 9)$q$, 'no direct writes', '42501');
  perform pg_temp.fails($q$delete from public.candela_daily_payments$q$, 'no direct deletes', '42501');
  reset role;

  -- security: the staff member granted only today's total
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
  v := public.candela_today_total();
  perform pg_temp.ok(v = 1050, 'granted staff gets today''s single total');
  select count(*) into n from public.candela_daily_payments; perform pg_temp.ok(n = 0, 'granted staff still reads no payment rows');
  select count(*) into n from public.candela_credit_daily; perform pg_temp.ok(n = 0, 'granted staff still reads no customer credit');
  select count(*) into n from public.sales_payment_summary; perform pg_temp.ok(n = 0, 'granted staff cannot read the landing table either');
  reset role;

  -- security: the owner
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  select count(*) into n from public.candela_daily_payments; perform pg_temp.ok(n = 5, 'owner (with MFA) reads every kept day');
  select count(*) into n from public.candela_credit_daily; perform pg_temp.ok(n = 2, 'owner reads the customer credit rows');
  perform pg_temp.ok(public.candela_today_total() = 1050, 'owner gets today''s total');
  perform pg_temp.fails($q$update public.candela_daily_payments set total_sale = 0$q$, 'even the owner cannot edit history directly', '42501');
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal1');
  select count(*) into n from public.candela_daily_payments; perform pg_temp.ok(n = 0, 'owner without MFA reads nothing');
  perform pg_temp.fails('select public.candela_today_total()', 'owner without MFA cannot call the total', '42501');
  reset role;

  -- no data for today -> the total is empty, not an error
  delete from public.candela_daily_payments where sale_day = d;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
  perform pg_temp.ok(public.candela_today_total() is null, 'no figure for today gives null');
  reset role;
end $t$;
rollback;
