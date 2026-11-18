\set ON_ERROR_STOP on
-- 0308: inventory_products_for_scope and inventory_companies. All data below is invented.
begin;
create function pg_temp.as_user(uid uuid, lvl text default 'aal1') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'aal', lvl, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; raise notice 'pass: %', msg; end $$;

insert into auth.users(id, email) values ('00000000-0000-0000-0000-0000000000a1','a@t'), ('00000000-0000-0000-0000-0000000000b1','j@t');
select public.bootstrap_first_admin('00000000-0000-0000-0000-0000000000a1','owner','Test Owner');
insert into public.staff(id, full_name) values ('10000000-0000-0000-0000-000000000001','J One');
insert into public.profiles(user_id, staff_id, username, role_template) values
  ('00000000-0000-0000-0000-0000000000b1','10000000-0000-0000-0000-000000000001','junior1','junior');

do $t$ declare n int; r record; msg text; begin
  set local role service_role;
  perform public.inventory_apply_sync(jsonb_build_object('products', jsonb_build_array(
    jsonb_build_object('code','A1','name','Alpha one','qty',10,'price',100.5,'company','Acme'),
    jsonb_build_object('code','A2','name','Alpha two','qty',5,'price',20,'company','Acme'),
    jsonb_build_object('code','B1','name','Beta one','qty',8,'price',55,'company','Beta'),
    jsonb_build_object('code','N1','name','No company','qty',1,'price',9))));
  reset role;

  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  select count(*) into n from public.inventory_products_for_scope('{"type":"full"}');
  perform pg_temp.ok(n = 4, 'full scope returns every product');
  select count(*) into n from public.inventory_products_for_scope('{"type":"selected","companies":["Acme"]}');
  perform pg_temp.ok(n = 2, 'selected scope returns the products of that company');
  select count(*) into n from public.inventory_products_for_scope('{"type":"single","companies":["Beta"]}');
  perform pg_temp.ok(n = 1, 'single scope works the same way');
  select count(*) into n from public.inventory_products_for_scope('{"type":"template","codes":["A1","B1","ZZ"]}');
  perform pg_temp.ok(n = 2, 'template scope returns the codes that exist and skips the rest');
  select count(*) into n from public.inventory_products_for_scope('{"type":"selected","companies":[]}');
  perform pg_temp.ok(n = 0, 'a scope that names nothing returns nothing, not everything');
  select count(*) into n from public.inventory_products_for_scope('{"type":"template"}');
  perform pg_temp.ok(n = 0, 'a template with no codes returns nothing');
  select * into r from public.inventory_products_for_scope('{"type":"template","codes":["A1"]}');
  perform pg_temp.ok(r.code = 'A1' and r.name = 'Alpha one' and r.company = 'Acme' and r.qty = 10 and r.price = 100.5, 'the columns are code, name, company, qty, price');
  select count(*) into n from public.inventory_products_for_scope('{"type":"selected","companies":["Unassigned Manufacturer"]}');
  perform pg_temp.ok(n = 1, 'a product with no company sits under Unassigned Manufacturer');
  begin perform * from public.inventory_products_for_scope('{"type":"bogus"}'); msg := 'none'; exception when others then msg := sqlerrm; end;
  perform pg_temp.ok(msg = 'unknown scope', 'an unknown scope type is refused');
  select count(*) into n from public.inventory_companies();
  perform pg_temp.ok(n = 3, 'inventory_companies lists each company once');
  perform pg_temp.ok((select array_agg(company) from public.inventory_companies()) = array['Acme','Beta','Unassigned Manufacturer'], 'companies come in name order');

  -- a junior holds inventory.search, so may read; revoke it and the call is refused
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  select count(*) into n from public.inventory_products_for_scope('{"type":"full"}');
  perform pg_temp.ok(n = 4, 'a person with inventory.search can read the scope');
  reset role;
  delete from public.role_permissions where role = 'junior' and perm_key in ('inventory.search', 'audit.manage', 'audit.compile', 'audit.individual');
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  begin perform * from public.inventory_products_for_scope('{"type":"full"}'); msg := 'none'; exception when others then msg := sqlerrm; end;
  perform pg_temp.ok(msg = 'not allowed', 'without inventory.search or an audit key the call is refused');
  begin perform * from public.inventory_companies(); msg := 'none'; exception when others then msg := sqlerrm; end;
  perform pg_temp.ok(msg = 'not allowed', 'the company list is refused too');
  reset role;

  -- anon cannot run either
  perform pg_temp.ok(not has_function_privilege('anon', 'public.inventory_products_for_scope(jsonb)', 'execute')
                 and not has_function_privilege('anon', 'public.inventory_companies()', 'execute'), 'anon cannot execute them');
end $t$;
rollback;
