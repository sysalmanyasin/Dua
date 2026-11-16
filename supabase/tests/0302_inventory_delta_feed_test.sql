\set ON_ERROR_STOP on
-- 0302: changed-rows-only feed. Counters, tombstones, guards, column privileges, delta reads. Invented data only.
begin;
create function pg_temp.as_user(uid uuid, lvl text default 'aal1') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'aal', lvl, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; raise notice 'pass: %', msg; end $$;
-- one invented product
create function pg_temp.prod(code text, qty numeric default 1, price numeric default 1, n30 numeric default 0) returns jsonb language sql as $$
  select jsonb_build_object('code', code, 'name', 'Item ' || btrim(coalesce(code, 'x')), 'qty', qty, 'price', price, 'net_qty_30_days', n30) $$;
create function pg_temp.pay(variadic p jsonb[]) returns jsonb language sql as $$
  select jsonb_build_object('products', to_jsonb(p)) $$;
-- the five base products used by most blocks
create function pg_temp.base(p_a1_price numeric default 5, p_a2_n30 numeric default 0, p_a3_qty numeric default 0, p_a3_n30 numeric default 0) returns jsonb language sql as $$
  select pg_temp.pay(pg_temp.prod('A1', 10, p_a1_price, 3), pg_temp.prod('A2', 3, 9, p_a2_n30), pg_temp.prod('A3', p_a3_qty, 4, p_a3_n30),
                     pg_temp.prod('A4', 6, 2), pg_temp.prod('A5', 8, 7)) $$;
create function pg_temp.upd() returns bigint language sql as $$ select pg_stat_get_xact_tuples_updated('public.inventory_products'::regclass) $$;
create function pg_temp.ins() returns bigint language sql as $$ select pg_stat_get_xact_tuples_inserted('public.inventory_products'::regclass) $$;
create function pg_temp.del() returns bigint language sql as $$ select pg_stat_get_xact_tuples_deleted('public.inventory_products'::regclass) $$;
create function pg_temp.entries(j jsonb) returns int language sql as $$ select jsonb_array_length(j -> 'rows') + jsonb_array_length(j -> 'removed') $$;

insert into auth.users(id, email) values
  ('00000000-0000-0000-0000-0000000000a1','a@t'),
  ('00000000-0000-0000-0000-0000000000b1','j@t');
select public.bootstrap_first_admin('00000000-0000-0000-0000-0000000000a1','owner','Test Owner');
insert into public.staff(id, full_name) values ('10000000-0000-0000-0000-000000000001','J One');
insert into public.profiles(user_id, staff_id, username, role_template) values
  ('00000000-0000-0000-0000-0000000000b1','10000000-0000-0000-0000-000000000001','junior1','junior');

do $t$ declare
  r jsonb; j jsonb; n int; n0 bigint; u0 bigint; i0 bigint; d0 bigint; s0 bigint; q0 bigint; t0 timestamptz;
  since bigint; total int; codes text[]; allcodes text[]; pages int; ps bigint; row_ record; msg text;
begin
  -- ── 0. the state row exists and starts at zero on an empty table ──
  perform pg_temp.ok((select count(*) from public.inventory_sync_state) = 1, 'there is exactly one sync-state row');
  perform pg_temp.ok((select seq_stock from public.inventory_sync_state) = 0 and (select seq_sales from public.inventory_sync_state) = 0, 'counters start at zero');
  begin insert into public.inventory_sync_state(id) values (2); perform pg_temp.ok(false, 'a second state row must be refused');
  exception when check_violation or unique_violation then perform pg_temp.ok(true, 'a second state row is refused (pass: refused)'); end;

  -- ── 1. first sync loads everything, one counter step per new row ──
  set local role service_role;
  r := public.inventory_apply_sync(pg_temp.base(), 'dropbox', null, false, 'hash-1');
  reset role;
  perform pg_temp.ok(r->>'result' = 'changed' and (r->>'count')::int = 5 and (r->>'added')::int = 5, 'first sync: five products added');
  perform pg_temp.ok((select seq_stock from public.inventory_sync_state) = 5 and (select seq_sales from public.inventory_sync_state) = 5, 'first sync: both counters moved by five');
  perform pg_temp.ok((select seq_stock from public.inventory_products where code = 'A1') = 1 and (select seq_stock from public.inventory_products where code = 'A5') = 5, 'first sync: every row got its own counter value');
  perform pg_temp.ok((select content_hash from public.inventory_sync_state) = 'hash-1', 'the file hash is remembered');
  perform pg_temp.ok((select active_count from public.inventory_sync_state) = 5, 'the active count is five');
  perform pg_temp.ok((select count(*) from public.inventory_products where row_hash_stock is not null and row_hash_sales is not null) = 5, 'every row carries both hashes');

  -- ── 2. an identical second sync changes nothing at all ──
  u0 := pg_temp.upd(); i0 := pg_temp.ins(); d0 := pg_temp.del();
  select seq_stock, seq_sales into s0, q0 from public.inventory_sync_state;
  set local role service_role;
  r := public.inventory_apply_sync(pg_temp.base(), 'dropbox', null, false, 'hash-1');
  reset role;
  perform pg_temp.ok(r->>'result' = 'unchanged' and (r->>'changed')::int = 0 and (r->>'added')::int = 0 and (r->>'removed')::int = 0 and (r->>'unchanged')::int = 5, 'identical sync: result is unchanged, five rows unchanged');
  perform pg_temp.ok(pg_temp.upd() = u0 and pg_temp.ins() = i0 and pg_temp.del() = d0, 'identical sync: not one product row was written');
  perform pg_temp.ok((select seq_stock from public.inventory_sync_state) = s0 and (select seq_sales from public.inventory_sync_state) = q0, 'identical sync: counters did not move');
  perform pg_temp.ok((select count(*) from public.inventory_sync_log where status = 'ok') = 2 and (select result from public.inventory_sync_log order by synced_at desc, id desc limit 1) = 'unchanged', 'identical sync: still leaves one log row, marked unchanged');

  -- ── 3. the same numbers written differently, and a code with stray spaces, are not changes ──
  set local role service_role;
  r := public.inventory_apply_sync(pg_temp.pay(
         jsonb_build_object('code', ' A1 ', 'name', 'Item A1', 'qty', 10.0, 'price', 5.00, 'net_qty_30_days', 3.0),
         pg_temp.prod('A2', 3, 9, 0), pg_temp.prod('A3', 0, 4, 0), pg_temp.prod('A4', 6, 2), pg_temp.prod('A5', 8, 7)), 'dropbox', null, false, 'hash-1');
  reset role;
  perform pg_temp.ok(r->>'result' = 'unchanged' and (r->>'changed')::int = 0, '10 and 10.0, 5 and 5.00, and " A1 " and "A1" are the same');

  -- ── 4. one price change moves only that row's stock counter ──
  select seq_stock, seq_sales into s0, q0 from public.inventory_sync_state;
  u0 := pg_temp.upd();
  set local role service_role;
  r := public.inventory_apply_sync(pg_temp.base(p_a1_price => 6), 'dropbox', null, false, 'hash-2');
  reset role;
  perform pg_temp.ok((r->>'changed')::int = 1 and (r->>'unchanged')::int = 4 and r->>'result' = 'changed', 'price change: one row changed, four unchanged');
  perform pg_temp.ok((select seq_stock from public.inventory_sync_state) = s0 + 1 and (select seq_sales from public.inventory_sync_state) = q0, 'price change: only the stock counter moved, by one');
  perform pg_temp.ok((select seq_stock from public.inventory_products where code = 'A1') = s0 + 1 and (select seq_sales from public.inventory_products where code = 'A1') = 1, 'price change: A1 moved in stock only');
  perform pg_temp.ok((select seq_stock from public.inventory_products where code = 'A2') = 2, 'price change: A2 was not touched');
  perform pg_temp.ok(pg_temp.upd() = u0 + 1, 'price change: exactly one row was written');
  perform pg_temp.ok((select price from public.inventory_products where code = 'A1') = 6, 'price change: the new price is stored');

  -- ── 5. a sales-only change moves only the sales counter ──
  select seq_stock, seq_sales into s0, q0 from public.inventory_sync_state;
  set local role service_role;
  r := public.inventory_apply_sync(pg_temp.base(p_a1_price => 6, p_a2_n30 => 7), 'dropbox', null, false, 'hash-3');
  reset role;
  perform pg_temp.ok((r->>'changed')::int = 1, 'sales change: one row changed');
  perform pg_temp.ok((select seq_stock from public.inventory_sync_state) = s0 and (select seq_sales from public.inventory_sync_state) = q0 + 1, 'sales change: only the sales counter moved');
  perform pg_temp.ok((select seq_stock from public.inventory_products where code = 'A2') = 2 and (select seq_sales from public.inventory_products where code = 'A2') = q0 + 1, 'sales change: A2 moved in sales only');
  perform pg_temp.ok((select net_qty_30_days from public.inventory_products where code = 'A2') = 7, 'sales change: the new figure is stored');

  -- ── 6. a row that changes in both groups moves both counters ──
  select seq_stock, seq_sales into s0, q0 from public.inventory_sync_state;
  set local role service_role;
  r := public.inventory_apply_sync(pg_temp.base(p_a1_price => 6, p_a2_n30 => 7, p_a3_qty => 2, p_a3_n30 => 5), 'dropbox', null, false, 'hash-4');
  reset role;
  perform pg_temp.ok((r->>'changed')::int = 1, 'both groups: still one changed row');
  perform pg_temp.ok((select seq_stock from public.inventory_products where code = 'A3') = s0 + 1 and (select seq_sales from public.inventory_products where code = 'A3') = q0 + 1, 'both groups: both counters of A3 moved');

  -- ── 7. a product missing from the file becomes a tombstone and vanishes for users ──
  select seq_stock, seq_sales into s0, q0 from public.inventory_sync_state;
  set local role service_role;
  r := public.inventory_apply_sync(pg_temp.pay(pg_temp.prod('A1', 10, 6, 3), pg_temp.prod('A2', 3, 9, 7), pg_temp.prod('A3', 2, 4, 5), pg_temp.prod('A4', 6, 2)), 'dropbox', null, false, 'hash-5');
  reset role;
  perform pg_temp.ok((r->>'removed')::int = 1 and (r->>'count')::int = 4, 'removal: one product removed, four active');
  perform pg_temp.ok((select active from public.inventory_products where code = 'A5') is false, 'removal: the row stays as an inactive tombstone');
  perform pg_temp.ok((select seq_stock from public.inventory_products where code = 'A5') = s0 + 1 and (select seq_sales from public.inventory_products where code = 'A5') = q0 + 1, 'removal: counters moved so devices hear about it');
  perform pg_temp.ok((select deactivated_at from public.inventory_products where code = 'A5') is not null, 'removal: the day it was deactivated is recorded');
  perform pg_temp.ok((select active_count from public.inventory_sync_state) = 4, 'removal: the active count dropped to four');

  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  perform pg_temp.ok((select count(*) from public.inventory_products where code = 'A5') = 0, 'removal: a user cannot read the tombstone');
  perform pg_temp.ok((select count(*) from public.inventory_products) = 4, 'removal: a user sees four products');
  perform pg_temp.ok((select b.found from public.inventory_balances(array['A5']) b) is false, 'removal: balances says not found');
  perform pg_temp.ok((select count(*) from public.inventory_search('item a5')) = 0, 'removal: search no longer finds it');
  j := public.inventory_changes_stock(s0);
  perform pg_temp.ok(j->'removed' = '["A5"]'::jsonb and jsonb_array_length(j->'rows') = 0, 'removal: the stock feed lists A5 as removed');
  reset role;

  -- ── 8. a product that comes back is active again, with new counters ──
  select seq_stock, seq_sales into s0, q0 from public.inventory_sync_state;
  set local role service_role;
  r := public.inventory_apply_sync(pg_temp.base(p_a1_price => 6, p_a2_n30 => 7, p_a3_qty => 2, p_a3_n30 => 5), 'dropbox', null, false, 'hash-6');
  reset role;
  perform pg_temp.ok((select active from public.inventory_products where code = 'A5') is true and (select deactivated_at from public.inventory_products where code = 'A5') is null, 'return: A5 is active again');
  perform pg_temp.ok((select seq_stock from public.inventory_products where code = 'A5') = s0 + 1, 'return: A5 got a fresh counter value');
  perform pg_temp.ok((r->>'count')::int = 5, 'return: five active products');
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  j := public.inventory_changes_stock(s0);
  perform pg_temp.ok(j->'rows'->0->>0 = 'A5' and jsonb_array_length(j->'removed') = 0, 'return: the stock feed sends A5 as a row again');
  reset role;

  -- ── 9. mass-removal guard: more than 20% is refused, 20% is allowed, force overrides ──
  select seq_stock, seq_sales into s0, q0 from public.inventory_sync_state;
  u0 := pg_temp.upd(); d0 := pg_temp.del(); n0 := (select count(*) from public.inventory_sync_log);
  set local role service_role;
  r := public.inventory_apply_sync(pg_temp.pay(pg_temp.prod('A1', 10, 6, 3), pg_temp.prod('A2', 3, 9, 7), pg_temp.prod('A3', 2, 4, 5)), 'dropbox', null, false, 'hash-7');
  reset role;
  perform pg_temp.ok((r->>'ok')::boolean is false and (r->>'refused')::boolean is true, 'guard: removing 2 of 5 (40%) is refused');
  perform pg_temp.ok(pg_temp.upd() = u0 and pg_temp.del() = d0 and (select active_count from public.inventory_sync_state) = 5, 'guard: nothing was written');
  perform pg_temp.ok((select seq_stock from public.inventory_sync_state) = s0 and (select seq_sales from public.inventory_sync_state) = q0, 'guard: counters did not move');
  perform pg_temp.ok((select count(*) from public.inventory_sync_log) = n0 + 1 and (select status || '/' || result from public.inventory_sync_log order by synced_at desc, id desc limit 1) = 'failed/refused', 'guard: the refusal is logged as failed/refused');
  perform pg_temp.ok((select error from public.inventory_sync_log order by synced_at desc, id desc limit 1) like '%2%5%', 'guard: the log says how many would be removed out of how many');
  set local role service_role;
  r := public.inventory_apply_sync(pg_temp.pay(pg_temp.prod('A1', 10, 6, 3), pg_temp.prod('A2', 3, 9, 7), pg_temp.prod('A3', 2, 4, 5), pg_temp.prod('A4', 6, 2)), 'dropbox', null, false, 'hash-8');
  reset role;
  perform pg_temp.ok((r->>'ok')::boolean is true and (r->>'removed')::int = 1, 'guard: removing 1 of 5 (exactly 20%) is allowed');
  set local role service_role;
  r := public.inventory_apply_sync(pg_temp.pay(pg_temp.prod('A1', 10, 6, 3), pg_temp.prod('A2', 3, 9, 7)), 'dropbox', null, true, 'hash-9');
  reset role;
  perform pg_temp.ok((r->>'ok')::boolean is true and (r->>'removed')::int = 2 and (r->>'count')::int = 2, 'guard: p_force lets the owner confirm a big removal');
  set local role service_role;
  r := public.inventory_apply_sync(pg_temp.base(p_a1_price => 6, p_a2_n30 => 7, p_a3_qty => 2, p_a3_n30 => 5), 'dropbox', null, false, 'hash-10');
  reset role;
  perform pg_temp.ok((r->>'count')::int = 5, 'guard: adding products back is never refused');

  -- ── 10. duplicate and blank codes are cleaned and counted ──
  select seq_stock into s0 from public.inventory_sync_state;
  set local role service_role;
  r := public.inventory_apply_sync(pg_temp.pay(pg_temp.prod('A1', 10, 6, 3), pg_temp.prod('A1', 10, 6, 3), pg_temp.prod('A2', 3, 9, 7), pg_temp.prod('A3', 2, 4, 5),
                                    pg_temp.prod('A4', 6, 2), pg_temp.prod('A5', 8, 7), jsonb_build_object('code', '', 'name', 'No code one'),
                                    jsonb_build_object('name', 'No code two'), jsonb_build_object('code', '   ', 'name', 'No code three')), 'dropbox', null, false, 'hash-11');
  reset role;
  perform pg_temp.ok((r->>'duplicates')::int = 1 and (r->>'skippedBlank')::int = 3, 'cleaning: one duplicate and three blank codes were counted');
  perform pg_temp.ok((select count(*) from public.inventory_products where active) = 5 and (select count(*) from public.inventory_products where btrim(code) = '') = 0, 'cleaning: no blank code reached the table');
  perform pg_temp.ok(r->>'result' = 'unchanged', 'cleaning: the clean rows were unchanged');
  begin insert into public.inventory_products(code, name) values ('A1', 'dup'); perform pg_temp.ok(false, 'a duplicate code must be refused');
  exception when unique_violation then perform pg_temp.ok(true, 'cleaning: the table itself refuses a duplicate code (pass: refused)'); end;

  -- ── 11. a failed sync leaves everything, counters included, as it was ──
  select seq_stock, seq_sales into s0, q0 from public.inventory_sync_state;
  u0 := pg_temp.upd();
  set local role service_role;
  begin perform public.inventory_apply_sync(pg_temp.pay(pg_temp.prod('A1', 10, 99, 3), jsonb_build_object('code', 'X')), 'dropbox', null, false, 'hash-bad');
        perform pg_temp.ok(false, 'a product with no name must fail the whole sync');
  exception when others then perform pg_temp.ok(true, 'failure: a product with no name fails the whole sync (pass: refused)'); end;
  begin perform public.inventory_apply_sync('{"products":[]}'::jsonb); perform pg_temp.ok(false, 'an empty list must fail');
  exception when others then perform pg_temp.ok(true, 'failure: an empty product list fails (pass: refused)'); end;
  reset role;
  perform pg_temp.ok((select seq_stock from public.inventory_sync_state) = s0 and (select seq_sales from public.inventory_sync_state) = q0, 'failure: the counters are untouched');
  perform pg_temp.ok((select price from public.inventory_products where code = 'A1') = 6, 'failure: the earlier price survived');
  perform pg_temp.ok((select content_hash from public.inventory_sync_state) = 'hash-11', 'failure: the stored file hash did not change');

  -- ── 12. the old three-argument call (the currently deployed Edge Function) still works ──
  set local role service_role;
  r := public.inventory_apply_sync(p_payload => pg_temp.base(p_a1_price => 6, p_a2_n30 => 7, p_a3_qty => 2, p_a3_n30 => 5), p_source => 'dropbox', p_triggered_by => null);
  reset role;
  perform pg_temp.ok(r ? 'count' and r ? 'paymentSummaryCount' and r ? 'strLineItemCount' and (r->>'count')::int = 5, 'old call shape: still answers with the same keys');

  -- ── 13. "checked, nothing new" is recorded without a log row and without touching counters ──
  select seq_stock, seq_sales into s0, q0 from public.inventory_sync_state;
  n0 := (select count(*) from public.inventory_sync_log); t0 := (select last_checked_at from public.inventory_sync_state);
  set local role service_role;
  r := public.inventory_note_unchanged('hash-11', 'dropbox', null);
  reset role;
  perform pg_temp.ok((select last_checked_at from public.inventory_sync_state) > t0, 'unchanged check: the "checked at" time moved forward');
  perform pg_temp.ok((select seq_stock from public.inventory_sync_state) = s0 and (select seq_sales from public.inventory_sync_state) = q0, 'unchanged check: counters did not move');
  perform pg_temp.ok((select count(*) from public.inventory_sync_log) = n0, 'unchanged check: a scheduled check writes no log row');
  set local role service_role;
  r := public.inventory_note_unchanged('hash-11', 'dropbox', '00000000-0000-0000-0000-0000000000a1');
  reset role;
  perform pg_temp.ok((select count(*) from public.inventory_sync_log) = n0 + 1, 'unchanged check: a manual check by a person is logged');

  -- ── 14. who may call what ──
  set local role anon;
  begin perform public.inventory_apply_sync(pg_temp.base()); perform pg_temp.ok(false, 'anon apply');
  exception when insufficient_privilege then perform pg_temp.ok(true, 'anon cannot apply a sync (pass: refused)'); end;
  begin perform public.inventory_changes_stock(0); perform pg_temp.ok(false, 'anon changes');
  exception when insufficient_privilege then perform pg_temp.ok(true, 'anon cannot read the stock feed (pass: refused)'); end;
  begin perform * from public.inventory_latest_sync(); perform pg_temp.ok(false, 'anon latest');
  exception when insufficient_privilege then perform pg_temp.ok(true, 'anon cannot read the latest-sync interface (pass: refused)'); end;
  begin perform count(*) from public.inventory_sync_state; perform pg_temp.ok(false, 'anon state');
  exception when insufficient_privilege then perform pg_temp.ok(true, 'anon cannot read the sync state (pass: refused)'); end;
  reset role;

  select seq_stock, seq_sales into s0, q0 from public.inventory_sync_state;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  begin perform public.inventory_apply_sync(pg_temp.base()); perform pg_temp.ok(false, 'junior apply');
  exception when insufficient_privilege then perform pg_temp.ok(true, 'a junior cannot apply a sync (pass: refused)'); end;
  begin perform public.inventory_note_unchanged('x', 'dropbox', null); perform pg_temp.ok(false, 'junior note');
  exception when insufficient_privilege then perform pg_temp.ok(true, 'a junior cannot record a check (pass: refused)'); end;
  begin perform public.inventory_prune(); perform pg_temp.ok(false, 'junior prune');
  exception when insufficient_privilege then perform pg_temp.ok(true, 'a junior cannot run the clean-up (pass: refused)'); end;
  begin perform count(*) from public.inventory_sync_state; perform pg_temp.ok(false, 'junior state');
  exception when insufficient_privilege then perform pg_temp.ok(true, 'a junior cannot read the sync state directly (pass: refused)'); end;
  begin perform public.inventory_changes_sales(0); perform pg_temp.ok(false, 'junior sales feed');
  exception when sqlstate '42501' then perform pg_temp.ok(true, 'a junior (no inventory.view) cannot read the sales feed (pass: refused)'); end;
  perform pg_temp.ok(jsonb_array_length(public.inventory_changes_stock(0)->'rows') = 5, 'a junior can read the stock feed');
  -- column privileges: stock columns yes, sales columns and bookkeeping no
  perform pg_temp.ok((select count(*) from (select code, name, qty, price, company, generic, supplier, conversion_factor, creation_date, last_receive_date, last_sale_date from public.inventory_products) q) = 5, 'a junior can read the stock columns directly');
  begin perform net_qty_30_days from public.inventory_products; perform pg_temp.ok(false, 'sales column');
  exception when insufficient_privilege then perform pg_temp.ok(true, 'a junior cannot read a sales column directly (pass: refused)'); end;
  begin perform sale_value_incl_tax_30_days from public.inventory_products; perform pg_temp.ok(false, 'sales value');
  exception when insufficient_privilege then perform pg_temp.ok(true, 'a junior cannot read a sale value directly (pass: refused)'); end;
  begin perform tax_percent from public.inventory_products; perform pg_temp.ok(false, 'tax');
  exception when insufficient_privilege then perform pg_temp.ok(true, 'a junior cannot read the tax column directly (pass: refused)'); end;
  begin perform * from public.inventory_products; perform pg_temp.ok(false, 'select star');
  exception when insufficient_privilege then perform pg_temp.ok(true, 'select * is refused (pass: refused)'); end;
  begin perform seq_stock from public.inventory_products; perform pg_temp.ok(false, 'seq');
  exception when insufficient_privilege then perform pg_temp.ok(true, 'the counters are not readable directly (pass: refused)'); end;
  begin perform row_hash_sales from public.inventory_products; perform pg_temp.ok(false, 'hash');
  exception when insufficient_privilege then perform pg_temp.ok(true, 'the hashes are not readable directly (pass: refused)'); end;
  -- latest sync carries the counters
  select * into row_ from public.inventory_latest_sync();
  perform pg_temp.ok(row_.seq_stock = s0 and row_.seq_sales = q0 and row_.active_count = 5 and row_.schema_version >= 1,
                     'latest sync: counters, active count and schema version are reported');
  perform pg_temp.ok(row_.item_count = 5 and row_.source = 'dropbox' and row_.synced_at is not null, 'latest sync: the old three columns are still there');
  reset role;

  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  j := public.inventory_changes_sales(0);
  perform pg_temp.ok(jsonb_array_length(j->'rows') = 5, 'the owner (aal2, inventory.view) reads the sales feed');
  perform pg_temp.ok(j->'cols' = '["code","n0","n30","n60","n90","vi0","vi30","vi60","vi90","ve0","ve30","ve60","ve90","tax","taxable"]'::jsonb, 'sales feed: the column list is the documented one');
  perform pg_temp.ok((select r2 from jsonb_array_elements(j->'rows') r2 where r2->>0 = 'A2')->>2 = '7', 'sales feed: A2 carries its 30-day quantity');
  perform pg_temp.ok(not exists (select 1 from jsonb_array_elements(j->'rows') r2 where jsonb_array_length(r2) <> 15), 'sales feed: every row has exactly the listed columns (no names, no prices)');
  begin perform net_qty_30_days from public.inventory_products; perform pg_temp.ok(false, 'owner direct sales column');
  exception when insufficient_privilege then perform pg_temp.ok(true, 'even the owner reads sales columns only through the feed (pass: refused)'); end;
  reset role;

  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal1');
  begin perform public.inventory_changes_stock(0); perform pg_temp.ok(false, 'owner no mfa');
  exception when sqlstate '42501' then perform pg_temp.ok(true, 'an owner without MFA gets nothing (pass: refused)'); end;
  reset role;

  -- ── 15. the column list of the stock feed, and pagination, limits and completeness ──
  select seq_stock into s0 from public.inventory_sync_state;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  j := public.inventory_changes_stock(0, 1000);
  perform pg_temp.ok(j->'cols' = '["code","name","qty","price","company","generic","supplier","pack","created","received","sold","packValid"]'::jsonb, 'stock feed: the column list is the documented one');
  perform pg_temp.ok((select r2 from jsonb_array_elements(j->'rows') r2 where r2->>0 = 'A1')->>3 = '6', 'stock feed: A1 carries its price');
  perform pg_temp.ok(not exists (select 1 from jsonb_array_elements(j->'rows') r2 where jsonb_array_length(r2) <> 12), 'stock feed: every row has exactly the listed columns (no sales figures)');
  perform pg_temp.ok((j->>'seq')::bigint = s0 and (j->>'activeCount')::int = 5 and (j->>'done')::boolean is true, 'stock feed: reports the counter, the active count and that it is done');
  reset role;

  set local role service_role;
  r := public.inventory_apply_sync(
         jsonb_build_object('products', (select jsonb_agg(pg_temp.prod('P' || lpad(i::text, 4, '0'), i % 50, 1)) from generate_series(1, 1200) i)),
         'dropbox', null, true, 'hash-big');
  reset role;
  perform pg_temp.ok((r->>'count')::int = 1200 and (r->>'removed')::int = 5 and (r->>'added')::int = 1200, 'big sync: 1,200 added, the five base products removed (forced)');
  select seq_stock into s0 from public.inventory_sync_state;

  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  j := public.inventory_changes_stock(0, 5000);
  perform pg_temp.ok(pg_temp.entries(j) = 1000 and (j->>'done')::boolean is false, 'limits: a page is capped at 1,000 entries and says it is not done');
  perform pg_temp.ok(pg_temp.entries(public.inventory_changes_stock(0, 0)) = 1, 'limits: p_limit 0 is raised to 1');
  perform pg_temp.ok(pg_temp.entries(public.inventory_changes_stock(0, -5)) = 1, 'limits: a negative p_limit is raised to 1');
  perform pg_temp.ok(pg_temp.entries(public.inventory_changes_stock(0, null)) = 1000, 'limits: the default page is 1,000');
  perform pg_temp.ok(pg_temp.entries(public.inventory_changes_stock(0)) = 1000, 'limits: leaving p_limit out gives the default page');
  perform pg_temp.ok(public.inventory_changes_stock(0, 400) = public.inventory_changes_stock(0, 400), 'asking for the same page twice gives the same answer');
  perform pg_temp.ok((public.inventory_changes_stock(null, 10)->>'next') is not null, 'a null counter is treated as zero');
  since := 0; total := 0; allcodes := array[]::text[]; pages := 0;
  loop
    j := public.inventory_changes_stock(since, 400);
    pages := pages + 1; total := total + pg_temp.entries(j);
    allcodes := allcodes
      || coalesce((select array_agg(x ->> 0) from jsonb_array_elements(j -> 'rows') x), array[]::text[])
      || coalesce((select array_agg(x #>> '{}') from jsonb_array_elements(j -> 'removed') x), array[]::text[]);
    exit when (j ->> 'done')::boolean or pages > 20;
    since := (j ->> 'next')::bigint;
  end loop;
  perform pg_temp.ok(pages = 4 and total = 1205, 'paging: 1,205 entries arrive in four pages of at most 400');
  perform pg_temp.ok((select count(distinct c) from unnest(allcodes) c) = 1205, 'paging: every code arrives exactly once (no gap, no repeat)');
  perform pg_temp.ok(allcodes @> array['P0001', 'P1200', 'A1', 'A5'], 'paging: new products and the five removals are all there');
  -- resuming from the middle gives exactly the rest
  j := public.inventory_changes_stock(0, 400);
  since := (j ->> 'next')::bigint;
  perform pg_temp.ok((select count(*) from jsonb_array_elements(public.inventory_changes_stock(since, 1000) -> 'rows')) + jsonb_array_length(public.inventory_changes_stock(since, 1000) -> 'removed') = 805, 'paging: resuming after page one gives the other 805');
  perform pg_temp.ok(pg_temp.entries(public.inventory_changes_stock(s0)) = 0 and (public.inventory_changes_stock(s0)->>'done')::boolean is true,
                     'paging: asking from the current counter gives nothing and done');
  reset role;

  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  since := 0; total := 0; pages := 0;
  loop
    j := public.inventory_changes_sales(since, 500);
    pages := pages + 1; total := total + pg_temp.entries(j);
    exit when (j ->> 'done')::boolean or pages > 20;
    since := (j ->> 'next')::bigint;
  end loop;
  perform pg_temp.ok(pages = 3 and total = 1205, 'sales feed paging: 1,205 entries in three pages of at most 500');
  perform pg_temp.ok(pg_temp.entries(public.inventory_changes_sales(0, 99999)) = 1000, 'sales feed: also capped at 1,000');
  reset role;

  -- ── 16. reset flags and the daily clean-up ──
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  perform pg_temp.ok((public.inventory_changes_stock(0)->>'reset')::boolean is false, 'reset: a fresh device (counter 0) is never told to reset');
  perform pg_temp.ok((public.inventory_changes_stock(s0 + 1000)->>'reset')::boolean is true, 'reset: a device ahead of the server is told to reset');
  reset role;
  select max(seq_stock) into ps from public.inventory_products where code in ('A1', 'A2');
  update public.inventory_products set deactivated_at = now() - interval '31 days' where code in ('A1', 'A2');
  insert into public.inventory_sync_log(synced_at, status, item_count, result)
    select now() - (i || ' minutes')::interval, 'ok', 0, 'unchanged' from generate_series(1, 250) i;
  set local role service_role;
  r := public.inventory_prune();
  reset role;
  perform pg_temp.ok((r->>'tombstonesRemoved')::int = 2, 'clean-up: the two tombstones older than 30 days were deleted');
  perform pg_temp.ok((select count(*) from public.inventory_products where code in ('A1', 'A2')) = 0, 'clean-up: A1 and A2 are really gone');
  perform pg_temp.ok((select count(*) from public.inventory_products where code in ('A3', 'A4', 'A5') and not active) = 3, 'clean-up: younger tombstones stay');
  perform pg_temp.ok((select purged_through_stock from public.inventory_sync_state) = ps, 'clean-up: the state remembers how far removals were purged');
  perform pg_temp.ok((select count(*) from public.inventory_sync_log) = 200, 'clean-up: the log keeps the newest 200 rows');
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  perform pg_temp.ok((public.inventory_changes_stock(ps - 1)->>'reset')::boolean is true, 'reset: a device older than the purge is told to reset');
  perform pg_temp.ok((public.inventory_changes_stock(ps)->>'reset')::boolean is false, 'reset: a device exactly at the purge point is fine');
  perform pg_temp.ok((public.inventory_changes_stock(0)->>'reset')::boolean is false, 'reset: counter 0 is still never told to reset');
  perform pg_temp.ok((select purged_through_stock from public.inventory_latest_sync()) = ps, 'reset: latest sync reports the purge point');
  reset role;

  -- ── 17. the code is protected by a unique constraint and the lock is in the function ──
  perform pg_temp.ok(exists (select 1 from pg_constraint where conrelid = 'public.inventory_products'::regclass and contype = 'u'), 'the product code has a unique constraint');
  perform pg_temp.ok((select prosrc from pg_proc where proname = 'inventory_apply_sync') like '%pg_try_advisory_xact_lock%', 'apply takes an advisory lock (two-session behaviour is checked by hand, see the progress file)');

  -- ── 18. a user whose search permission is taken away gets nothing ──
  delete from public.role_permissions where perm_key = 'inventory.search';
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  begin perform public.inventory_changes_stock(0); perform pg_temp.ok(false, 'no search perm');
  exception when sqlstate '42501' then perform pg_temp.ok(true, 'without inventory.search the stock feed is refused (pass: refused)'); end;
  begin perform * from public.inventory_latest_sync(); perform pg_temp.ok(false, 'no search perm latest');
  exception when sqlstate '42501' then perform pg_temp.ok(true, 'without inventory.search the latest-sync interface is refused (pass: refused)'); end;
  perform pg_temp.ok((select count(*) from public.inventory_products) = 0, 'without inventory.search the table shows nothing');
  reset role;
end $t$;
rollback;
