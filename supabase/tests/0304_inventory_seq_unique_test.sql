\set ON_ERROR_STOP on
-- 0304: every product row has its own counter value (paging relies on it). Reproduces the state the 0302 backfill left
-- on a database that already had products (every row at counter 1) and checks that renumbering repairs it.
begin;
create function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; raise notice 'pass: %', msg; end $$;

insert into auth.users(id, email) values ('00000000-0000-0000-0000-0000000000b1', 'j@t');
insert into public.staff(id, full_name) values ('10000000-0000-0000-0000-000000000001', 'J One');
insert into public.profiles(user_id, staff_id, username, role_template) values
  ('00000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-000000000001', 'junior1', 'junior');

do $t$ declare j jsonb; r jsonb; since bigint; total int; pages int; codes text[]; n int; begin
  set local role service_role;
  r := public.inventory_apply_sync(jsonb_build_object('products',
         (select jsonb_agg(jsonb_build_object('code', 'P' || lpad(i::text, 4, '0'), 'name', 'Item ' || i, 'qty', i, 'price', 1)) from generate_series(1, 2500) i)), 'dropbox', null, false, 'h1');
  reset role;
  perform pg_temp.ok((r->>'count')::int = 2500, 'setup: 2,500 products loaded');

  -- the unique rule exists and is enforced
  perform pg_temp.ok((select count(*) from pg_indexes where tablename = 'inventory_products' and indexname = 'inventory_products_seq_stock_uq') = 1
                 and (select count(*) from pg_indexes where tablename = 'inventory_products' and indexname = 'inventory_products_seq_sales_uq') = 1, 'unique counter indexes exist');
  begin update public.inventory_products set seq_stock = 1 where code in ('P0001', 'P0002'); perform pg_temp.ok(false, 'duplicate counters must be refused');
  exception when unique_violation then perform pg_temp.ok(true, 'two rows cannot share a stock counter value (pass: refused)'); end;
  begin update public.inventory_products set seq_sales = 1 where code in ('P0001', 'P0002'); perform pg_temp.ok(false, 'duplicate sales counters must be refused');
  exception when unique_violation then perform pg_temp.ok(true, 'two rows cannot share a sales counter value (pass: refused)'); end;

  -- recreate the live situation: no unique rule yet, every row at counter 1, state at 1
  drop index public.inventory_products_seq_stock_uq;
  drop index public.inventory_products_seq_sales_uq;
  update public.inventory_products set seq_stock = 1, seq_sales = 1;
  update public.inventory_sync_state set seq_stock = 1, seq_sales = 1;

  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000b1', 'aal', 'aal1', 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  since := 0; total := 0; pages := 0;
  loop
    j := public.inventory_changes_stock(since, 1000); pages := pages + 1; total := total + jsonb_array_length(j->'rows');
    exit when (j->>'done')::boolean or pages > 10; since := (j->>'next')::bigint;
  end loop;
  perform pg_temp.ok(total = 1000 and pages = 2, 'broken state reproduced: paging from 0 ends after 1,000 of 2,500 products');
  reset role;

  -- repair
  execute 'set local role authenticated';
  begin perform public.inventory_renumber_seq(); perform pg_temp.ok(false, 'renumber must be service role only');
  exception when insufficient_privilege then perform pg_temp.ok(true, 'renumbering is not callable by a signed-in user (pass: refused)'); end;
  reset role;
  set local role service_role; r := public.inventory_renumber_seq(); reset role;
  perform pg_temp.ok((r->>'rows')::int = 2500, 'renumbering reports 2,500 rows');
  perform pg_temp.ok((select count(distinct seq_stock) from public.inventory_products) = 2500 and (select min(seq_stock) from public.inventory_products) = 1 and (select max(seq_stock) from public.inventory_products) = 2500, 'stock counters are 1..2500, all different');
  perform pg_temp.ok((select count(distinct seq_sales) from public.inventory_products) = 2500 and (select max(seq_sales) from public.inventory_products) = 2500, 'sales counters are 1..2500, all different');
  perform pg_temp.ok((select seq_stock from public.inventory_sync_state) = 2500 and (select seq_sales from public.inventory_sync_state) = 2500, 'the state counters equal the highest row counter');
  create unique index inventory_products_seq_stock_uq on public.inventory_products (seq_stock) where seq_stock > 0;
  create unique index inventory_products_seq_sales_uq on public.inventory_products (seq_sales) where seq_sales > 0;
  perform pg_temp.ok(true, 'the unique indexes can be created again after renumbering');

  -- a phone installing now gets everything, in pages
  execute 'set local role authenticated';
  since := 0; total := 0; pages := 0; codes := array[]::text[];
  loop
    j := public.inventory_changes_stock(since, 1000); pages := pages + 1;
    total := total + jsonb_array_length(j->'rows'); codes := codes || coalesce((select array_agg(x->>0) from jsonb_array_elements(j->'rows') x), array[]::text[]);
    exit when (j->>'done')::boolean or pages > 10; since := (j->>'next')::bigint;
  end loop;
  perform pg_temp.ok(pages = 3 and total = 2500 and (select count(distinct c) from unnest(codes) c) = 2500, 'after repair: 2,500 distinct products arrive in 3 pages');
  reset role;

  -- order is by code (the old order is kept as the tie-break), and a later change gets the next counter
  perform pg_temp.ok((select seq_stock from public.inventory_products where code = 'P0001') = 1 and (select seq_stock from public.inventory_products where code = 'P2500') = 2500, 'renumbering follows the code order');
  set local role service_role;
  r := public.inventory_apply_sync(jsonb_build_object('products',
         (select jsonb_agg(jsonb_build_object('code', 'P' || lpad(i::text, 4, '0'), 'name', 'Item ' || i, 'qty', i + (case when i = 7 then 1 else 0 end), 'price', 1)) from generate_series(1, 2500) i)), 'dropbox', null, false, 'h2');
  reset role;
  perform pg_temp.ok((r->>'changed')::int = 1 and (select seq_stock from public.inventory_products where code = 'P0007') = 2501 and (select seq_stock from public.inventory_sync_state) = 2501, 'one later change takes counter 2501');
  execute 'set local role authenticated';
  j := public.inventory_changes_stock(2500, 1000);
  perform pg_temp.ok(jsonb_array_length(j->'rows') = 1 and j->'rows'->0->>0 = 'P0007' and (j->>'done')::boolean is true, 'a phone at 2500 receives exactly that one row');
  reset role;
end $t$;
rollback;
