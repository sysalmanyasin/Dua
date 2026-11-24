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
-- junior2 may see today's total only
insert into public.user_permissions(user_id, perm_key, effect) values ('00000000-0000-0000-0000-0000000000b2','candela.today_total','grant');

insert into public.candela_daily_payments (sale_day, cash_sale, card_sale, credit_sale, total_sale) values
 (date '2030-02-01', 178128.42, 255872.93, 11408.46, 445409.81);
insert into public.candela_credit_daily (sale_day, customer_key, customer_name, credit_amount, receipt_count) values
 (date '2030-02-01', 'askari general insurance company ltd.', 'Askari General Insurance Company Ltd.', 7360.32, 2),
 (date '2030-02-01', 'parco', 'PARCO', 4048.14, 2),
 (date '2030-02-02', 'parco', 'PARCO', 10, 1); -- 2 Feb: credit rows but no payment summary

do $t$ declare r jsonb; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  r := public.candela_day_feed(date '2030-02-01');
  perform pg_temp.ok((r #>> '{payments,cash_sale}')::numeric = 178128.42 and (r #>> '{payments,total_sale}')::numeric = 445409.81, 'the owner gets the day''s payment summary');
  perform pg_temp.ok(jsonb_array_length(r -> 'credit') = 2 and (r #>> '{credit,0,amount}')::numeric = 7360.32 and (r #>> '{credit,1,amount}')::numeric = 4048.14, 'and the customer-wise credit');
  perform pg_temp.ok(r #>> '{credit,0,name}' = 'Askari General Insurance Company Ltd.', 'customers come back by name, in name order');
  r := public.candela_day_feed(date '2030-02-02');
  perform pg_temp.ok(r -> 'payments' = 'null'::jsonb and jsonb_array_length(r -> 'credit') = 1, 'a day with credit rows but no payment summary still answers');
  perform pg_temp.ok(public.candela_day_feed(date '2030-02-09') is null, 'a day Candela never sent gives null');
  perform pg_temp.ok(public.candela_day_feed(null) is null, 'a null date gives null');
  reset role;

  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  perform pg_temp.fails($q$select public.candela_day_feed(date '2030-02-01')$q$, 'an ordinary staff member is refused', 'not allowed');
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
  perform pg_temp.fails($q$select public.candela_day_feed(date '2030-02-01')$q$, 'the today-total permission does not open the day feed', 'not allowed');
  reset role;
  set local role anon;
  perform pg_temp.fails($q$select public.candela_day_feed(date '2030-02-01')$q$, 'a signed-out caller cannot call it', 'permission denied');
  reset role;
end $t$;
rollback;
