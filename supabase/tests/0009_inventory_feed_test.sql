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

do $t$ declare r jsonb; n int; ok boolean; payload jsonb; begin
  payload := jsonb_build_object(
    'products', jsonb_build_array(
      jsonb_build_object('code','A1','name','Test Tablet','qty',10,'price',5,'conversion_factor',10,'last_sale_date',null),
      jsonb_build_object('code','A2','name','Test Syrup','qty',3,'price',9,'last_receive_date','2026-01-05')),
    'payment_summary', jsonb_build_array(jsonb_build_object('sale_day','2026-11-08','cash_sale',1,'card_sale',2,'credit_sale',3,'total_sale',6)),
    'str_headers', jsonb_build_array(jsonb_build_object('str_id',1,'str_number','S-1','direction','in','str_date','2026-11-07')),
    'str_line_items', jsonb_build_array(jsonb_build_object('str_id',1,'str_item_id',1,'product_code','A1','str_qty',2)));

  -- service role applies a sync
  set local role service_role;
  r := public.inventory_apply_sync(payload);
  perform pg_temp.ok((r->>'count')::int = 2 and (r->>'strLineItemCount')::int = 1, 'a sync loads products and STR lines');
  perform pg_temp.ok((select conversion_factor from public.inventory_products where code='A1') = 10, 'values arrive intact');
  perform pg_temp.ok((select name from public.inventory_products where code='A2') = 'Test Syrup' and (select supplier from public.inventory_products where code='A2') = 'Unassigned Supplier', 'missing fields take defaults');

  -- two syncs in a row replace, not duplicate
  perform public.inventory_apply_sync(payload);
  select count(*) into n from public.inventory_products;
  perform pg_temp.ok(n = 2, 'two syncs replace rather than duplicate');
  perform pg_temp.ok((select count(*) from public.inventory_sync_log where status='ok') = 2, 'each sync leaves a log row');

  -- a failed sync keeps the old data
  begin
    perform public.inventory_apply_sync(payload || jsonb_build_object('products', jsonb_build_array(jsonb_build_object('code','X'))));
    perform pg_temp.ok(false, 'a bad row must fail');
  exception when others then null;
  end;
  perform pg_temp.ok((select count(*) from public.inventory_products) = 2, 'a failed sync keeps the old rows');
  begin
    perform public.inventory_apply_sync('{"products":[]}'::jsonb);
    perform pg_temp.ok(false, 'an empty products list must fail');
  exception when others then null;
  end;
  perform pg_temp.ok((select count(*) from public.inventory_products) = 2, 'an empty feed never wipes the table');
  perform public.inventory_log_sync_failure('boom');
  perform pg_temp.ok((select count(*) from public.inventory_sync_log where status='failed') = 1, 'failures are logged');
  reset role;

  -- junior: has inventory.search only
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  select count(*) into n from public.inventory_products;
  perform pg_temp.ok(n = 2, 'a user with inventory.search reads products');
  select count(*) into n from public.inventory_sync_log;
  perform pg_temp.ok(n = 2, 'and sees only successful syncs');
  select count(*) into n from public.str_headers;
  perform pg_temp.ok(n = 0, 'but not STR (needs str.approve)');
  select count(*) into n from public.sales_payment_summary;
  perform pg_temp.ok(n = 0, 'nor sales summaries (needs sales.view_history)');
  perform pg_temp.ok((select count(*) from public.inventory_latest_sync()) = 1, 'inventory_latest_sync works for them');
  begin perform public.inventory_apply_sync(payload); perform pg_temp.ok(false, 'junior must not call apply');
  exception when insufficient_privilege then null; end;
  begin delete from public.inventory_products where true; perform pg_temp.ok(false, 'junior must not delete');
  exception when insufficient_privilege then null; end;
  reset role;

  -- a user without inventory.search reads nothing
  delete from public.role_permissions where perm_key = 'inventory.search';
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  select count(*) into n from public.inventory_products;
  perform pg_temp.ok(n = 0, 'without inventory.search nothing is readable');
  reset role;

  -- admin (aal2) sees failures too
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  select count(*) into n from public.inventory_sync_log;
  perform pg_temp.ok(n = 3, 'an admin holding inventory.sync sees the failed run as well');
  reset role;
end $t$;
rollback;
