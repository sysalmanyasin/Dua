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

insert into auth.users(id, email) values ('00000000-0000-0000-0000-0000000000a1','a@t'),('00000000-0000-0000-0000-0000000000b1','j@t');
select public.bootstrap_first_admin('00000000-0000-0000-0000-0000000000a1','owner','Test Owner');
insert into public.staff(id, full_name) values ('10000000-0000-0000-0000-000000000001','J One');
insert into public.profiles(user_id, staff_id, username, role_template) values ('00000000-0000-0000-0000-0000000000b1','10000000-0000-0000-0000-000000000001','junior1','junior');

do $t$ declare c text; c2 text; n int; d date := (now() at time zone 'Asia/Karachi')::date - 1; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  perform pg_temp.fails($q$select public.payment_method_save(null, 'X', 'Banks', 'add', true, true)$q$, 'a junior cannot add a field', '42501');
  perform pg_temp.fails($q$select public.payment_methods_reorder(array['cash_sale'])$q$, 'a junior cannot reorder', '42501');
  reset role;

  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  c := public.payment_method_save(null, 'Bank Alfalah 2', 'Banks', 'add', true, true);
  perform pg_temp.ok(c = 'c_bank_alfalah_2', 'a new field gets a safe code made from its name');
  c2 := public.payment_method_save(null, 'Bank Alfalah 2', 'Banks', 'add', true, true);
  perform pg_temp.ok(c2 = 'c_bank_alfalah_2_2', 'a second field with the same name gets its own code');
  perform pg_temp.ok(public.payment_method_save(null, '!!!', 'Cash', 'none', true, true) = 'c_field', 'a name with no letters still works');
  perform pg_temp.fails($q$select public.payment_method_save(null, '', 'Cash', 'add', true, true)$q$, 'an empty name is refused', 'name must');
  perform pg_temp.fails($q$select public.payment_method_save(null, 'X', 'Space', 'add', true, true)$q$, 'an unknown section is refused', 'bad section');
  perform pg_temp.fails($q$select public.payment_method_save(null, 'X', 'Cash', 'weird', true, true)$q$, 'an unknown type is refused', 'bad type');

  -- the new field can be used in a day, and the day's total follows its type
  perform public.sales_save_day(d, '{}', format('[{"method":"%s","amount":500},{"method":"cash_sale","amount":100}]', c)::jsonb, null, gen_random_uuid());
  perform pg_temp.ok((select total from public.daily_sales where business_date = d) = 600, 'a new field counts in the total');

  -- once figures exist the type is locked, but the name and visibility can change
  perform pg_temp.fails(format($q$select public.payment_method_save(%L, 'Bank Alfalah 2', 'Banks', 'sub', true, true)$q$, c), 'type cannot change once it has figures', 'already has saved figures');
  perform pg_temp.fails(format($q$select public.payment_method_save(%L, 'Bank Alfalah 2', 'Cash', 'add', true, true)$q$, c), 'section cannot change once it has figures', 'already has saved figures');
  perform public.payment_method_save(c, 'Alfalah (second account)', 'Banks', 'add', false, true);
  perform pg_temp.ok((select label from public.payment_methods where code = c) = 'Alfalah (second account)' and not (select show_in_entry from public.payment_methods where code = c), 'a field can be renamed and hidden');
  -- an unused field can change type
  perform public.payment_method_save(c2, 'Bank Alfalah 3', 'Cash', 'sub', true, true);
  perform pg_temp.ok((select sign from public.payment_methods where code = c2) = 'sub', 'a field with no figures can change type');

  -- switching a field off stops it being used for new days but keeps its history
  perform public.payment_method_save(c, 'Alfalah (second account)', 'Banks', 'add', null, false);
  perform pg_temp.fails(format($q$select public.sales_save_day(%L, '{}', %L::jsonb, 'x y z', gen_random_uuid())$q$, d, format('[{"method":"%s","amount":1}]', c)), 'a switched-off field cannot be used for new entries', 'inactive');
  perform pg_temp.ok((select count(*) from public.daily_sale_lines where method_code = c) = 1, 'its old figures are kept');
  perform pg_temp.ok((select count(*) from public.payment_methods where code = c) = 1, 'and the field is still listed for admins');

  -- ordering
  perform public.payment_methods_reorder(array['pso', 'cash_sale', 'lda']);
  perform pg_temp.ok((select sort from public.payment_methods where code = 'pso') < (select sort from public.payment_methods where code = 'cash_sale') and (select sort from public.payment_methods where code = 'cash_sale') < (select sort from public.payment_methods where code = 'lda'), 'reorder puts the listed fields in that order');
  perform pg_temp.ok((select sort from public.payment_methods where code = 'hbl') > (select sort from public.payment_methods where code = 'lda'), 'fields not listed come after');
  select count(*) into n from public.activity_log where action like 'field.%'; perform pg_temp.ok(n >= 6, 'every change is logged');
  reset role;
end $t$;
-- the Sale Book view: per month and field, from days or from monthly figures
insert into public.monthly_history (month, total) values ('2020-04-01', 700);
insert into public.monthly_history_lines (month, method_code, amount) values ('2020-04-01', 'cash_sale', 700);
do $t$ declare n int; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  perform pg_temp.ok((select amount from public.v_monthly_methods where month = '2020-04-01' and method_code = 'cash_sale') = 700, 'a monthly-only month shows its monthly figures');
  select count(*) into n from public.v_monthly_methods; perform pg_temp.ok(n >= 2, 'daily months are summed per field');
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  select count(*) into n from public.v_monthly_methods; perform pg_temp.ok(n = 0, 'a junior sees no Sale Book data');
  reset role;
end $t$;
rollback;
