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

-- people (invented): owner, a viewer with str.view, a plain staff member, a viewer who may also see cost
insert into auth.users(id, email) values ('00000000-0000-0000-0000-0000000000a1','a@t'),('00000000-0000-0000-0000-0000000000b1','v@t'),
  ('00000000-0000-0000-0000-0000000000b2','n@t'),('00000000-0000-0000-0000-0000000000b3','c@t');
select public.bootstrap_first_admin('00000000-0000-0000-0000-0000000000a1','owner','Test Owner');
insert into public.staff(id, full_name) values ('10000000-0000-0000-0000-000000000001','Viewer'),('10000000-0000-0000-0000-000000000002','Plain'),('10000000-0000-0000-0000-000000000003','Coster');
insert into public.profiles(user_id, staff_id, username, role_template) values
 ('00000000-0000-0000-0000-0000000000b1','10000000-0000-0000-0000-000000000001','viewer','junior'),
 ('00000000-0000-0000-0000-0000000000b2','10000000-0000-0000-0000-000000000002','plain','junior'),
 ('00000000-0000-0000-0000-0000000000b3','10000000-0000-0000-0000-000000000003','coster','junior');
insert into public.user_permissions(user_id, perm_key, effect) values
 ('00000000-0000-0000-0000-0000000000b1','str.view','grant'),
 ('00000000-0000-0000-0000-0000000000b3','str.view','grant'),
 ('00000000-0000-0000-0000-0000000000b3','inventory.view_cost','grant');

do $t$ declare n int; r record; d date := (now() at time zone 'Asia/Karachi')::date; begin
  -- feed: STR 1 (in, dispatched), STR 2 (out, awaited)
  insert into public.str_headers (str_id, str_number, master_str_id, ref_no, comments, dispatch_status, receive_status, str_date, direction, dispatch_branch, receive_branch, issued_by)
    values (1, 'T-100', 'M-7', 'REF-1', 'cold items 100% urgent', 'Dispatched', '', d, 'in', 'Warehouse', 'Test Branch', 'Tester'),
           (2, 'T-200', '', '', '', '', '', d - 1, 'out', 'Test Branch', 'Warehouse', 'Other');
  insert into public.str_line_items (str_id, str_item_id, product_code, product_name, str_qty, dispatch_qty, product_price, cost_price)
    values (1, 1, 'P1', 'Test Syrup', 10, 10, 100, 60), (1, 2, 'P2', 'Test Tablet', 5, 0, 50, 30), (2, 1, 'P3', 'Cough Drops', 4, null, 20, 5);
  -- archive: STR 1 again (old version, must be ignored) and STR 50 (left the feed)
  insert into public.str_archive_headers (str_id, str_number, str_date, dispatch_status, direction, synced_at) values (1, 'T-100-OLD', d, '', 'in', now()), (50, 'T-500', d - 10, 'Dispatched', 'in', now());
  insert into public.str_archive_lines (str_id, str_item_id, product_code, product_name, str_qty, cost_price) values (1, 9, 'OLD', 'Old line', 1, 1), (50, 1, 'P5', 'Archived Gel', 8, 12);

  -- no permission
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
  select count(*) into n from public.str_v_headers; perform pg_temp.ok(n = 0, 'plain staff read no rows from the header view');
  select count(*) into n from public.str_v_lines; perform pg_temp.ok(n = 0, 'plain staff read no rows from the lines view');
  perform pg_temp.fails($q$select * from public.str_search_headers('t')$q$, 'plain staff cannot search', '42501');
  perform pg_temp.fails($q$select * from public.str_line_costs(array[1::bigint])$q$, 'plain staff cannot read costs', '42501');
  reset role;
  set local role anon;
  perform pg_temp.fails($q$select * from public.str_v_headers$q$, 'anon cannot read the header view', '42501');
  perform pg_temp.fails($q$select * from public.str_search_headers('t')$q$, 'anon cannot search', '42501');
  reset role;

  -- viewer
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  select count(*) into n from public.str_v_headers; perform pg_temp.ok(n = 3, 'the view shows 2 feed STRs plus the archived one that left the feed');
  perform pg_temp.ok((select str_number from public.str_v_headers where str_id = 1) = 'T-100', 'the feed version of an STR wins over the archive');
  perform pg_temp.ok((select stage from public.str_v_headers where str_id = 1) = 'dispatched' and (select stage from public.str_v_headers where str_id = 2) = 'awaited', 'the view carries the stage');
  perform pg_temp.ok((select line_count from public.str_v_headers where str_id = 1) = 2 and (select line_count from public.str_v_headers where str_id = 50) = 1, 'line counts come from the right table');
  select count(*) into n from public.str_v_lines; perform pg_temp.ok(n = 4, 'lines: 3 from the feed, 1 from the archived STR, none from the stale archive copy');
  perform pg_temp.fails($q$select cost_price from public.str_v_lines$q$, 'cost is not in the lines view', '42703');
  perform pg_temp.fails($q$select * from public.str_line_costs(array[1::bigint])$q$, 'a viewer without inventory.view_cost cannot read costs', '42501');

  -- search
  select count(*) into n from public.str_search_headers(null); perform pg_temp.ok(n = 3, 'no text lists everything, newest first');
  perform pg_temp.ok((select array_agg(str_id order by str_date desc nulls last, str_id desc) from public.str_search_headers(null)) = array[1, 2, 50]::bigint[], 'ordered by date, newest first');
  select count(*) into n from public.str_search_headers('t-200'); perform pg_temp.ok(n = 1, 'by STR number');
  select count(*) into n from public.str_search_headers('M-7'); perform pg_temp.ok(n = 1, 'by master id');
  select count(*) into n from public.str_search_headers('p3'); perform pg_temp.ok(n = 1, 'by product code');
  select count(*) into n from public.str_search_headers('cough'); perform pg_temp.ok(n = 1, 'by product name');
  select count(*) into n from public.str_search_headers('archived gel'); perform pg_temp.ok(n = 1, 'finds an older STR through its product (history)');
  select count(*) into n from public.str_search_headers('t-100 tablet'); perform pg_temp.ok(n = 1, 'words may be found in the header and in a product');
  select count(*) into n from public.str_search_headers('t-100 gel'); perform pg_temp.ok(n = 0, 'every word must be found');
  select count(*) into n from public.str_search_headers('%'); perform pg_temp.ok(n = 1, 'a percent sign is plain text (only one comment has it)');
  select count(*) into n from public.str_search_headers('_'); perform pg_temp.ok(n = 0, 'an underscore is plain text');
  select count(*) into n from public.str_search_headers(null, d, d); perform pg_temp.ok(n = 1, 'date range, inclusive');
  select count(*) into n from public.str_search_headers(null, null, d - 5); perform pg_temp.ok(n = 1, 'date to');
  select count(*) into n from public.str_search_headers(null, null, null, 'awaited'); perform pg_temp.ok(n = 1, 'stage filter');
  select count(*) into n from public.str_search_headers(null, null, null, null, 'in'); perform pg_temp.ok(n = 2, 'direction filter');
  select count(*) into n from public.str_search_headers(null, null, null, null, null, 1, 0); perform pg_temp.ok(n = 1, 'limit');
  select count(*) into n from public.str_search_headers(null, null, null, null, null, 1, 2); perform pg_temp.ok(n = 1, 'offset pages on');
  perform pg_temp.fails($q$select * from public.str_search_headers(null, null, null, 'bogus')$q$, 'unknown stage refused', '22023');
  perform pg_temp.fails($q$select * from public.str_search_headers(null, null, null, null, 'sideways')$q$, 'unknown direction refused', '22023');
  reset role;

  -- limit is clamped to 50
  insert into public.str_headers (str_id, str_number, str_date) select 1000 + g, 'BULK-' || g, d from generate_series(1, 60) g;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  select count(*) into n from public.str_search_headers('bulk', null, null, null, null, 500); perform pg_temp.ok(n = 50, 'at most 50 rows per call');
  reset role;

  -- costs: both permissions needed
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b3');
  select count(*) into n from public.str_line_costs(array[1::bigint, 50]); perform pg_temp.ok(n = 3, 'a holder of str.view and inventory.view_cost reads feed and archived costs');
  perform pg_temp.ok((select cost_price from public.str_line_costs(array[1::bigint]) where str_item_id = 1) = 60, 'cost value is right, and the stale archive copy is not used');
  perform pg_temp.fails($q$select * from public.str_line_costs((select array_agg(g::bigint) from generate_series(1, 101) g))$q$, 'at most 100 STRs per call', '22023');
  reset role;
  -- cost permission alone is not enough
  insert into public.user_permissions(user_id, perm_key, effect) values ('00000000-0000-0000-0000-0000000000b2', 'inventory.view_cost', 'grant');
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
  perform pg_temp.fails($q$select * from public.str_line_costs(array[1::bigint])$q$, 'inventory.view_cost without str.view cannot read STR costs', '42501');
  reset role;
end $t$;
rollback;
