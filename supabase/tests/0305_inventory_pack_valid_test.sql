\set ON_ERROR_STOP on
-- 0305 (decision INV-18): the feed keeps the fact that a product's pack size was missing or unusable. conversion_factor
-- still holds a usable number (1 when the file's value was missing or zero); pack_valid says whether that number is real.
begin;
create function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; raise notice 'pass: %', msg; end $$;
create function pg_temp.pay(variadic p jsonb[]) returns jsonb language sql as $$ select jsonb_build_object('products', to_jsonb(p)) $$;

insert into auth.users(id, email) values ('00000000-0000-0000-0000-0000000000b1', 'j@t');
insert into public.staff(id, full_name) values ('10000000-0000-0000-0000-000000000001', 'J One');
insert into public.profiles(user_id, staff_id, username, role_template) values
  ('00000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-000000000001', 'junior1', 'junior');

do $t$ declare r jsonb; j jsonb; s0 bigint; q0 bigint; n int; begin
  -- ── stored as sent; a missing key (the old Edge Function) means "valid" ──
  set local role service_role;
  r := public.inventory_apply_sync(pg_temp.pay(
         jsonb_build_object('code', 'A1', 'name', 'Item A1', 'qty', 10, 'conversion_factor', 10, 'pack_valid', true),
         jsonb_build_object('code', 'A2', 'name', 'Item A2', 'qty', 5, 'conversion_factor', 1, 'pack_valid', false),
         jsonb_build_object('code', 'A3', 'name', 'Item A3', 'qty', 4, 'conversion_factor', 6),
         jsonb_build_object('code', 'A4', 'name', 'Item A4', 'qty', 3, 'conversion_factor', 1, 'pack_valid', true),
         jsonb_build_object('code', 'A5', 'name', 'Item A5', 'qty', 2)), 'dropbox', null, false, 'h1');
  reset role;
  perform pg_temp.ok((r->>'added')::int = 5, 'setup: five products added');
  perform pg_temp.ok((select pack_valid from public.inventory_products where code = 'A1') is true, 'pack_valid true is stored');
  perform pg_temp.ok((select pack_valid from public.inventory_products where code = 'A2') is false, 'pack_valid false is stored');
  perform pg_temp.ok((select pack_valid from public.inventory_products where code = 'A3') is true, 'a missing pack_valid key means valid');
  perform pg_temp.ok((select conversion_factor from public.inventory_products where code = 'A2') = 1, 'the usable number stays 1 for an unusable pack');
  perform pg_temp.ok((select conversion_factor from public.inventory_products where code = 'A5') = 1, 'a missing factor still becomes 1');

  -- ── the hash covers the flag, and always agrees with the stored columns ──
  perform pg_temp.ok((select count(*) from public.inventory_products
                      where row_hash_stock <> public.inventory_hash_stock(code, name, qty, price, company, generic, supplier, conversion_factor, creation_date, last_receive_date, last_sale_date, pack_valid)) = 0,
                     'every stored stock hash equals the hash of the stored columns');
  perform pg_temp.ok(public.inventory_hash_stock('a', 'b', 1, 1, 'c', 'd', 'e', 1, null, null, null, true) <> public.inventory_hash_stock('a', 'b', 1, 1, 'c', 'd', 'e', 1, null, null, null, false), 'the flag changes the hash');
  perform pg_temp.ok(not exists (select 1 from pg_proc p where p.proname = 'inventory_hash_stock' and p.pronargs = 11), 'the old 11-argument hash function is gone (no two definitions)');

  -- ── identical resync: nothing changes; flag change alone: one row, stock counter only ──
  set local role service_role;
  r := public.inventory_apply_sync(pg_temp.pay(
         jsonb_build_object('code', 'A1', 'name', 'Item A1', 'qty', 10, 'conversion_factor', 10, 'pack_valid', true),
         jsonb_build_object('code', 'A2', 'name', 'Item A2', 'qty', 5, 'conversion_factor', 1, 'pack_valid', false),
         jsonb_build_object('code', 'A3', 'name', 'Item A3', 'qty', 4, 'conversion_factor', 6, 'pack_valid', true),
         jsonb_build_object('code', 'A4', 'name', 'Item A4', 'qty', 3, 'conversion_factor', 1, 'pack_valid', true),
         jsonb_build_object('code', 'A5', 'name', 'Item A5', 'qty', 2, 'pack_valid', true)), 'dropbox', null, false, 'h2');
  reset role;
  perform pg_temp.ok(r->>'result' = 'unchanged' and (r->>'changed')::int = 0, 'sending the flag explicitly where it was implied is not a change');

  select seq_stock, seq_sales into s0, q0 from public.inventory_sync_state;
  set local role service_role;
  r := public.inventory_apply_sync(pg_temp.pay(
         jsonb_build_object('code', 'A1', 'name', 'Item A1', 'qty', 10, 'conversion_factor', 10, 'pack_valid', true),
         jsonb_build_object('code', 'A2', 'name', 'Item A2', 'qty', 5, 'conversion_factor', 1, 'pack_valid', false),
         jsonb_build_object('code', 'A3', 'name', 'Item A3', 'qty', 4, 'conversion_factor', 6, 'pack_valid', false),
         jsonb_build_object('code', 'A4', 'name', 'Item A4', 'qty', 3, 'conversion_factor', 1, 'pack_valid', true),
         jsonb_build_object('code', 'A5', 'name', 'Item A5', 'qty', 2, 'pack_valid', true)), 'dropbox', null, false, 'h3');
  reset role;
  perform pg_temp.ok((r->>'changed')::int = 1, 'only the product whose flag changed is written');
  perform pg_temp.ok((select seq_stock from public.inventory_sync_state) = s0 + 1 and (select seq_sales from public.inventory_sync_state) = q0, 'only the stock counter moved (the flag is a stock-group fact)');
  perform pg_temp.ok((select seq_stock from public.inventory_products where code = 'A3') = s0 + 1 and (select pack_valid from public.inventory_products where code = 'A3') is false, 'A3 carries the new flag and counter');

  -- ── delivered through the stock feed, in the documented column list ──
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000b1', 'aal', 'aal1', 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  j := public.inventory_changes_stock(0, 1000);
  perform pg_temp.ok(j->'cols' = '["code","name","qty","price","company","generic","supplier","pack","created","received","sold","packValid"]'::jsonb, 'the stock feed column list ends with packValid');
  perform pg_temp.ok(not exists (select 1 from jsonb_array_elements(j->'rows') x where jsonb_array_length(x) <> 12), 'every stock row has 12 values');
  perform pg_temp.ok((select x->>11 from jsonb_array_elements(j->'rows') x where x->>0 = 'A2') = 'false' and (select x->>11 from jsonb_array_elements(j->'rows') x where x->>0 = 'A1') = 'true', 'the flag arrives per product');
  -- a signed-in person may read the flag directly (it is a stock column), but still no sales column
  select count(*) into n from (select pack_valid from public.inventory_products) q;
  perform pg_temp.ok(n = 5, 'pack_valid is readable like the other stock columns');
  begin perform net_qty_30_days from public.inventory_products; perform pg_temp.ok(false, 'sales column');
  exception when insufficient_privilege then perform pg_temp.ok(true, 'sales columns are still refused (pass: refused)'); end;
  begin perform row_hash_stock from public.inventory_products; perform pg_temp.ok(false, 'hash');
  exception when insufficient_privilege then perform pg_temp.ok(true, 'the hash is still not readable (pass: refused)'); end;
  reset role;

  -- ── the earlier interfaces are untouched ──
  set local role service_role; r := public.inventory_prune(); reset role;
  perform pg_temp.ok(r ? 'tombstonesRemoved', 'the clean-up still runs');
end $t$;
rollback;
