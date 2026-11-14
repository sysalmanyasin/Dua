\set ON_ERROR_STOP on
-- 0301: published inventory interfaces (inventory_balances, inventory_search), the new permission
-- inventory.view, and the wrapped read policies. All data below is invented.
begin;
create function pg_temp.as_user(uid uuid, lvl text default 'aal1') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'aal', lvl, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; raise notice 'pass: %', msg; end $$;

insert into auth.users(id, email) values
  ('00000000-0000-0000-0000-0000000000a1','a@t'),
  ('00000000-0000-0000-0000-0000000000b1','j@t'),
  ('00000000-0000-0000-0000-0000000000c1','s@t');
select public.bootstrap_first_admin('00000000-0000-0000-0000-0000000000a1','owner','Test Owner');
insert into public.staff(id, full_name) values
  ('10000000-0000-0000-0000-000000000001','J One'),
  ('10000000-0000-0000-0000-000000000002','S Two');
insert into public.profiles(user_id, staff_id, username, role_template) values
  ('00000000-0000-0000-0000-0000000000b1','10000000-0000-0000-0000-000000000001','junior1','junior'),
  ('00000000-0000-0000-0000-0000000000c1','10000000-0000-0000-0000-000000000002','senior1','senior');

do $t$ declare r record; n int; payload jsonb; codes text[]; msg text; begin
  -- ── invented products: 5 named ones plus 60 that share a prefix, for the limit tests ──
  payload := jsonb_build_object('products',
    jsonb_build_array(
      jsonb_build_object('code','A1','name','Test Tablet','qty',10,'price',5,'conversion_factor',10,'generic','Alphamol','company','Acme','supplier','Sup One'),
      jsonb_build_object('code','A2','name','Test Syrup','qty',3,'price',9,'generic','Betamol','company','Beta Co','supplier','Sup Two'),
      jsonb_build_object('code','B%5','name','Percent Cream','qty',7,'price',12),
      jsonb_build_object('code','B_6','name','Under Gel','qty',8,'price',14),
      jsonb_build_object('code','BX7','name','Plain Drops','qty',9,'price',3,'generic','Gammamol')
    ) || (select jsonb_agg(jsonb_build_object('code','LIM'||lpad(i::text,3,'0'),'name','Limit Item '||lpad(i::text,3,'0'),'qty',i,'price',1))
          from generate_series(1,60) i));
  set local role service_role;
  perform public.inventory_apply_sync(payload);
  reset role;

  -- ── the new permission exists, and no role template gets it ──
  perform pg_temp.ok(exists (select 1 from public.permissions where key = 'inventory.view'), 'inventory.view is seeded');
  perform pg_temp.ok(not exists (select 1 from public.role_permissions where perm_key = 'inventory.view'), 'no role template holds inventory.view (owner grants it by hand)');
  perform pg_temp.ok(exists (select 1 from public.role_permissions where role = 'junior' and perm_key = 'inventory.search'), 'junior keeps inventory.search (Audit needs it)');
  perform pg_temp.ok(exists (select 1 from public.role_permissions where role = 'senior' and perm_key = 'inventory.search'), 'senior keeps inventory.search (Audit needs it)');

  -- ── read policies use the wrapped form (one permission check per query, not per row) ──
  for r in select tablename, policyname, qual from pg_policies
           where schemaname = 'public' and policyname in ('inv_products_read','inv_sync_log_read','sales_pay_summary_read','sales_credit_cust_read','str_headers_read','str_lines_read') loop
    perform pg_temp.ok(r.qual ~* 'select\s+has_perm', 'policy ' || r.policyname || ' wraps has_perm in a select');
  end loop;
  perform pg_temp.ok((select count(*) from pg_policies where schemaname = 'public' and policyname in ('inv_products_read','inv_sync_log_read','sales_pay_summary_read','sales_credit_cust_read','str_headers_read','str_lines_read')) = 6, 'all six feed policies exist');

  -- ── a junior (inventory.search only) ──
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  select count(*) into n from public.inventory_products;
  perform pg_temp.ok(n = 65, 'a user with inventory.search still reads the products');
  select count(*) into n from public.str_headers;
  perform pg_temp.ok(n = 0, 'still no STR without str.approve');
  select count(*) into n from public.sales_payment_summary;
  perform pg_temp.ok(n = 0, 'still no sales summary without sales.view_history');
  select count(*) into n from public.sales_credit_by_customer;
  perform pg_temp.ok(n = 0, 'still no credit rows without credit.view');
  perform pg_temp.ok(not public.has_perm('inventory.view'), 'a junior does not hold inventory.view');
  begin update public.inventory_products set qty = 1 where true; perform pg_temp.ok(false, 'direct update must be refused');
  exception when insufficient_privilege then perform pg_temp.ok(true, 'a direct update is refused (pass: refused)'); end;
  begin insert into public.inventory_products(code, name) values ('Z', 'Z'); perform pg_temp.ok(false, 'direct insert must be refused');
  exception when insufficient_privilege then perform pg_temp.ok(true, 'a direct insert is refused (pass: refused)'); end;

  -- ── inventory_balances ──
  select count(*) into n from public.inventory_balances(array['A1','A2']);
  perform pg_temp.ok(n = 2, 'balances: two known codes give two rows');
  select * into r from public.inventory_balances(array['A1']);
  perform pg_temp.ok(r.code = 'A1' and r.name = 'Test Tablet' and r.qty = 10 and r.found is true, 'balances: code, name, qty and found are right');
  select * into r from public.inventory_balances(array['NOPE']);
  perform pg_temp.ok(r.code = 'NOPE' and r.found is false and r.qty is null and r.name is null, 'balances: an unknown code comes back as not found, not as zero');
  perform pg_temp.ok((select string_agg(code, ',' order by ord) from (select code, row_number() over () as ord from public.inventory_balances(array['A2','NOPE','A1'])) q) = 'A2,NOPE,A1', 'balances: rows keep the order the caller asked for');
  select count(*) into n from public.inventory_balances(array['A1','A1',' A1 ']);
  perform pg_temp.ok(n = 1, 'balances: repeated codes (and stray spaces) collapse to one row');
  select count(*) into n from public.inventory_balances(null);
  perform pg_temp.ok(n = 0, 'balances: a null list returns nothing');
  select count(*) into n from public.inventory_balances(array[]::text[]);
  perform pg_temp.ok(n = 0, 'balances: an empty list returns nothing');
  select count(*) into n from public.inventory_balances(array['A1', null, '', '  ']);
  perform pg_temp.ok(n = 1, 'balances: null and blank entries are ignored');
  select array_agg('C' || i) into codes from generate_series(1, 200) i;
  select count(*) into n from public.inventory_balances(codes);
  perform pg_temp.ok(n = 200, 'balances: exactly 200 codes are allowed');
  select array_agg('C' || i) into codes from generate_series(1, 201) i;
  begin perform * from public.inventory_balances(codes); perform pg_temp.ok(false, '201 codes must be refused');
  exception when sqlstate '22023' then perform pg_temp.ok(true, 'balances: 201 codes are refused, never silently cut (pass: refused)'); end;
  select count(*) into n from public.inventory_balances(array['B%5', 'B_6']);
  perform pg_temp.ok(n = 2 and (select count(*) from public.inventory_balances(array['B%5','B_6']) b where b.found) = 2, 'balances: % and _ in a code are plain characters');
  select count(*) into n from public.inventory_balances(array['%']);
  perform pg_temp.ok(n = 1 and (select b.found from public.inventory_balances(array['%']) b) is false, 'balances: a lone % is just an unknown code');

  -- ── inventory_search ──
  select count(*) into n from public.inventory_search('tablet');
  perform pg_temp.ok(n = 1, 'search: finds by name, any letter case');
  select count(*) into n from public.inventory_search('ALPHAMOL');
  perform pg_temp.ok(n = 1, 'search: finds by generic');
  select count(*) into n from public.inventory_search('beta co');
  perform pg_temp.ok(n = 1, 'search: finds by company');
  select count(*) into n from public.inventory_search('sup two');
  perform pg_temp.ok(n = 1, 'search: finds by supplier');
  select count(*) into n from public.inventory_search('test syr');
  perform pg_temp.ok(n = 1, 'search: several words must all match');
  select count(*) into n from public.inventory_search('tablet syrup');
  perform pg_temp.ok(n = 0, 'search: words from two different products match nothing');
  select * into r from public.inventory_search('a1');
  perform pg_temp.ok(r.code = 'A1' and r.qty = 10 and r.price = 5 and r.conversion_factor = 10, 'search: slim row carries code, name, qty, price, pack size');
  select count(*) into n from public.inventory_search('%');
  perform pg_temp.ok(n = 1 and (select code from public.inventory_search('%')) = 'B%5', 'search: % is plain text, not "match everything"');
  select count(*) into n from public.inventory_search('_');
  perform pg_temp.ok(n = 1 and (select code from public.inventory_search('_')) = 'B_6', 'search: _ is plain text, not "any one character"');
  select count(*) into n from public.inventory_search('');
  perform pg_temp.ok(n = 0, 'search: empty text returns nothing');
  select count(*) into n from public.inventory_search(null);
  perform pg_temp.ok(n = 0, 'search: null text returns nothing');
  select count(*) into n from public.inventory_search('   ');
  perform pg_temp.ok(n = 0, 'search: blank text returns nothing');
  select count(*) into n from public.inventory_search('lim', 1000);
  perform pg_temp.ok(n = 50, 'search: p_limit is clamped to 50');
  select count(*) into n from public.inventory_search('lim', 0);
  perform pg_temp.ok(n = 1, 'search: p_limit 0 is clamped up to 1');
  select count(*) into n from public.inventory_search('lim', -7);
  perform pg_temp.ok(n = 1, 'search: a negative p_limit is clamped up to 1');
  select count(*) into n from public.inventory_search('lim');
  perform pg_temp.ok(n = 20, 'search: the default page is 20');
  select count(*) into n from public.inventory_search('lim', 50, 55);
  perform pg_temp.ok(n = 5, 'search: p_offset pages through the results');
  select count(*) into n from public.inventory_search('lim', 50, -10);
  perform pg_temp.ok(n = 50, 'search: a negative p_offset counts as 0');
  perform pg_temp.ok((select string_agg(code, ',' order by rn) from (select code, row_number() over () rn from public.inventory_search('lim', 3)) q) = 'LIM001,LIM002,LIM003', 'search: order is stable (same rank, then by name)');
  perform pg_temp.ok((select code from public.inventory_search('bx7')) = 'BX7', 'search: an exact code match is found');
  perform pg_temp.ok((select code from public.inventory_search('a', 5) limit 1) in ('A1','A2'), 'search: codes that start with the text rank before products that only contain it');
  reset role;

  -- ── the latest-sync interface keeps working for a signed-in senior ──
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  perform pg_temp.ok((select count(*) from public.inventory_latest_sync()) = 1, 'inventory_latest_sync still answers for a senior');
  reset role;

  -- ── without inventory.search everything is refused ──
  delete from public.role_permissions where perm_key = 'inventory.search';
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  begin perform * from public.inventory_balances(array['A1']); perform pg_temp.ok(false, 'balances must be refused');
  exception when sqlstate '42501' then perform pg_temp.ok(true, 'balances: refused without inventory.search (pass: refused)'); end;
  begin perform * from public.inventory_search('tablet'); perform pg_temp.ok(false, 'search must be refused');
  exception when sqlstate '42501' then perform pg_temp.ok(true, 'search: refused without inventory.search (pass: refused)'); end;
  select count(*) into n from public.inventory_products;
  perform pg_temp.ok(n = 0, 'the table itself shows nothing without inventory.search');
  reset role;

  -- ── an owner without MFA holds no permission, so the functions refuse that too ──
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal1');
  begin perform * from public.inventory_balances(array['A1']); perform pg_temp.ok(false, 'owner without MFA must be refused');
  exception when sqlstate '42501' then perform pg_temp.ok(true, 'an owner without MFA is refused (pass: refused)'); end;
  reset role;

  -- ── the owner at MFA level 2 may use them and holds inventory.view ──
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  perform pg_temp.ok(public.has_perm('inventory.view'), 'the owner at aal2 holds inventory.view');
  select count(*) into n from public.inventory_balances(array['A1','A2']);
  perform pg_temp.ok(n = 2, 'the owner can use balances');
  select count(*) into n from public.inventory_sync_log;
  perform pg_temp.ok(n = 1, 'the owner reads the sync log');
  select count(*) into n from public.str_headers;
  perform pg_temp.ok(n = 0, 'the owner reads STR headers (none loaded in this test)');
  reset role;

  -- ── anon: no table, no function ──
  set local role anon;
  begin perform count(*) from public.inventory_products; perform pg_temp.ok(false, 'anon must not read products');
  exception when insufficient_privilege then perform pg_temp.ok(true, 'anon cannot read products (pass: refused)'); end;
  begin perform * from public.inventory_balances(array['A1']); perform pg_temp.ok(false, 'anon must not call balances');
  exception when insufficient_privilege then perform pg_temp.ok(true, 'anon cannot call balances (pass: refused)'); end;
  begin perform * from public.inventory_search('tablet'); perform pg_temp.ok(false, 'anon must not call search');
  exception when insufficient_privilege then perform pg_temp.ok(true, 'anon cannot call search (pass: refused)'); end;
  reset role;

end $t$;
rollback;
