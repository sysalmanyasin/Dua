-- Tests for 0505_inventory_product_meta (Audit 0, T4): supplier and pack size for STR. Invented products and people.
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

insert into auth.users(id, email) values ('00000000-0000-0000-0000-0000000000a1','a@t'),('00000000-0000-0000-0000-0000000000b1','v@t'),
  ('00000000-0000-0000-0000-0000000000b2','n@t'),('00000000-0000-0000-0000-0000000000b3','s@t');
select public.bootstrap_first_admin('00000000-0000-0000-0000-0000000000a1','owner','Test Owner');
insert into public.staff(id, full_name) values ('10000000-0000-0000-0000-000000000001','Str viewer'),('10000000-0000-0000-0000-000000000002','Plain'),('10000000-0000-0000-0000-000000000003','Searcher');
insert into public.profiles(user_id, staff_id, username, role_template) values
 ('00000000-0000-0000-0000-0000000000b1','10000000-0000-0000-0000-000000000001','strv','junior'),
 ('00000000-0000-0000-0000-0000000000b2','10000000-0000-0000-0000-000000000002','plain','junior'),
 ('00000000-0000-0000-0000-0000000000b3','10000000-0000-0000-0000-000000000003','searcher','junior');
insert into public.user_permissions(user_id, perm_key, effect) values
 ('00000000-0000-0000-0000-0000000000b1','str.view','grant'), ('00000000-0000-0000-0000-0000000000b3','inventory.search','grant'),
 -- role templates may already carry these keys, so the plain person is denied both on purpose (deny wins)
 ('00000000-0000-0000-0000-0000000000b2','str.view','deny'), ('00000000-0000-0000-0000-0000000000b2','inventory.search','deny');
insert into public.inventory_products(code, name, supplier, conversion_factor, active) values
 ('M1', 'Test Syrup', 'Supplier A', 12, true),
 ('M2', 'Test Old Tablet', 'Supplier B', 10, false),
 ('M3', 'Test Other', 'Supplier C', 6, true);

do $t$ declare
  strv uuid := '00000000-0000-0000-0000-0000000000b1'; plain uuid := '00000000-0000-0000-0000-0000000000b2';
  srch uuid := '00000000-0000-0000-0000-0000000000b3'; r record; n int; codes text[];
begin
  perform pg_temp.as_user(strv);
  select * into r from public.inventory_product_meta(array['M1']);
  perform pg_temp.ok(r.found and r.supplier = 'Supplier A' and r.conversion_factor = 12, 'a str.view holder gets supplier and pack size');
  perform pg_temp.ok((select count(*) from public.inventory_product_meta(array['M1', 'M1', ' M1 '])) = 1, 'repeated and padded codes give one row');
  perform pg_temp.ok((select array_agg(code order by code) from public.inventory_product_meta(array['M3', 'M1'])) = array['M1', 'M3'], 'every asked code is answered');
  perform pg_temp.ok((select array_agg(code) from public.inventory_product_meta(array['M3', 'M1'])) = array['M3', 'M1'], 'rows come back in the order first asked');
  select * into r from public.inventory_product_meta(array['NOPE']);
  perform pg_temp.ok(r.found = false and r.supplier is null and r.conversion_factor is null, 'an unknown code comes back with found = false and no values');
  perform pg_temp.ok((select count(*) from public.inventory_product_meta(array['', '   ', null])) = 0, 'blank and null codes are skipped');
  perform pg_temp.ok((select count(*) from public.inventory_product_meta(null)) = 0 and (select count(*) from public.inventory_product_meta(array[]::text[])) = 0, 'null and empty arrays give no rows, not an error');
  select * into r from public.inventory_product_meta(array['M2']);
  perform pg_temp.ok(r.found and r.supplier = 'Supplier B', 'a deactivated product is still answered');
  select array_agg('C' || g) into codes from generate_series(1, 500) g;
  perform pg_temp.ok((select count(*) from public.inventory_product_meta(codes)) = 500, '500 codes are allowed');
  select array_agg('C' || g) into codes from generate_series(1, 501) g;
  perform pg_temp.fails(format('select * from public.inventory_product_meta(%L::text[])', codes), '501 codes are refused, never silently cut', 'at most 500');

  perform pg_temp.as_user(srch);
  perform pg_temp.ok((select count(*) from public.inventory_product_meta(array['M1'])) = 1, 'an inventory.search holder is allowed too');
  perform pg_temp.as_user(plain);
  perform pg_temp.fails('select * from public.inventory_product_meta(array[''M1''])', 'a person with neither key is refused', '42501');
  reset role;
  -- the function prefers an active row when a code has several, but inventory_products.code is unique, so that case cannot arise today
  perform pg_temp.fails('insert into public.inventory_products(code, name) values (''M3'', ''dup'')', 'a product code cannot be stored twice (so the several-rows rule never has to fire)', 'inventory_products_code_key');
  perform pg_temp.ok(not has_function_privilege('anon', 'public.inventory_product_meta(text[])', 'execute'), 'the visitor role cannot call it');
  perform pg_temp.ok((select prosecdef and provolatile = 's' from pg_proc where proname = 'inventory_product_meta'), 'it is a stable security-definer read');
  select count(*) into n from public.inventory_products;
  perform pg_temp.ok(n = 3, 'it changed no data');
end $t$;
rollback;
