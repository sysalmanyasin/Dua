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

-- stage: the one definition
select pg_temp.ok(public.str_stage('Dispatched', 'Received') = 'received', 'received beats dispatched');
select pg_temp.ok(public.str_stage('Dispatched', '') = 'dispatched', 'dispatched');
select pg_temp.ok(public.str_stage('', '') = 'awaited', 'blank statuses are awaited');
select pg_temp.ok(public.str_stage('', 'Received') = 'received', 'received without a dispatch status is still received');
select pg_temp.ok(public.str_stage(null, null) = 'awaited', 'null statuses are awaited');
select pg_temp.ok(public.str_stage('Pending', 'Pending') = 'awaited', 'unknown statuses are awaited');

do $t$ declare r jsonb; n int; d date := (now() at time zone 'Asia/Karachi')::date; begin
  -- feed round 1
  insert into public.str_headers (str_id, str_number, dispatch_status, receive_status, str_date, direction, comments)
    values (1, 'T-1', '', '', d, 'in', 'first'), (2, 'T-2', 'Dispatched', '', d, 'out', '');
  insert into public.str_line_items (str_id, str_item_id, product_code, product_name, str_qty, dispatch_qty, cost_price)
    values (1, 1, 'P1', 'Test Syrup', 10, null, 60), (1, 2, 'P2', 'Test Tablet', 5, null, 30), (2, 1, 'P3', 'Test Drops', 4, 4, 5);
  r := public.str_archive_sync();
  perform pg_temp.ok((r ->> 'headers')::int = 2 and (r ->> 'lines')::int = 3, 'first sync copies 2 headers and 3 lines');
  r := public.str_archive_sync();
  perform pg_temp.ok((select count(*) from public.str_archive_headers) = 2 and (select count(*) from public.str_archive_lines) = 3, 'a second sync changes nothing (idempotent)');

  -- feed round 2: STR 1 moves on, a line changes and one disappears; STR 2 leaves the feed
  update public.str_headers set dispatch_status = 'Dispatched', comments = 'second' where str_id = 1;
  update public.str_line_items set dispatch_qty = 10, str_qty = 12 where str_id = 1 and str_item_id = 1;
  delete from public.str_line_items where str_id = 1 and str_item_id = 2;
  delete from public.str_headers where str_id = 2;
  perform public.str_archive_sync();
  perform pg_temp.ok((select dispatch_status from public.str_archive_headers where str_id = 1) = 'Dispatched' and (select comments from public.str_archive_headers where str_id = 1) = 'second', 'the newest version of an STR wins');
  perform pg_temp.ok((select str_qty from public.str_archive_lines where str_id = 1 and str_item_id = 1) = 12, 'a changed line follows the feed');
  perform pg_temp.ok(not exists (select 1 from public.str_archive_lines where str_id = 1 and str_item_id = 2), 'a line removed in the feed is removed');
  perform pg_temp.ok(exists (select 1 from public.str_archive_headers where str_id = 2) and exists (select 1 from public.str_archive_lines where str_id = 2), 'an STR that left the feed stays in the history');

  -- a header that arrives without lines does not wipe kept lines
  insert into public.str_headers (str_id, str_number, str_date) values (3, 'T-3', d);
  insert into public.str_line_items (str_id, str_item_id, product_code, product_name, str_qty) values (3, 1, 'P9', 'Kept', 1);
  perform public.str_archive_sync();
  delete from public.str_line_items where str_id = 3;
  perform public.str_archive_sync();
  perform pg_temp.ok((select count(*) from public.str_archive_lines where str_id = 3) = 1, 'a header with no lines in the feed keeps its archived lines');

  -- a duplicated (str_id, str_item_id) in the feed cannot break the copy
  insert into public.str_line_items (str_id, str_item_id, product_code, product_name, str_qty) values (3, 5, 'D1', 'Dup A', 1), (3, 5, 'D1', 'Dup B', 2);
  perform public.str_archive_sync();
  perform pg_temp.ok((select count(*) from public.str_archive_lines where str_id = 3 and str_item_id = 5) = 1, 'duplicate item ids in the feed give one archived line');
  delete from public.str_line_items where str_id = 3;

  -- retention: one month by default, set by the setting
  insert into public.str_archive_headers (str_id, str_number, str_date, synced_at) values
    (10, 'OLD', d - 40, now()), (11, 'EDGE-IN', d - 28, now()), (12, 'NODATE', null, now());
  insert into public.str_archive_lines (str_id, str_item_id, product_code, product_name) values (10, 1, 'X', 'old line'), (11, 1, 'Y', 'edge line');
  n := public.str_archive_prune();
  perform pg_temp.ok(n = 1 and not exists (select 1 from public.str_archive_headers where str_id = 10), 'an STR older than a month is removed');
  perform pg_temp.ok(exists (select 1 from public.str_archive_headers where str_id in (11, 12)), 'a recent STR and one with no date (archived today) are kept');
  perform pg_temp.ok(not exists (select 1 from public.str_archive_lines where str_id = 10) and exists (select 1 from public.str_archive_lines where str_id = 11), 'lines follow their header');
  insert into public.str_archive_headers (str_id, str_number, str_date, synced_at) values (13, 'OLD2', d - 40, now());
  update public.settings set value = '3' where key = 'str.history_months';
  perform public.str_archive_prune();
  perform pg_temp.ok(exists (select 1 from public.str_archive_headers where str_id = 13), 'the setting widens the history to three months');
  update public.settings set value = '1' where key = 'str.history_months';
  perform public.str_archive_prune();
  perform pg_temp.ok(not exists (select 1 from public.str_archive_headers where str_id = 13), 'and back to one month');
end $t$;

-- security of the archive
insert into public.str_archive_headers (str_id, str_number, str_date, synced_at) values (20, 'ARC', current_date, now());
insert into public.str_archive_lines (str_id, str_item_id, product_code, product_name, cost_price) values (20, 1, 'P1', 'Arc line', 9);
do $t$ declare n int; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
  select count(*) into n from public.str_archive_headers; perform pg_temp.ok(n = 0, 'plain staff read no archived headers');
  select count(*) into n from public.str_archive_lines; perform pg_temp.ok(n = 0, 'plain staff read no archived lines');
  perform pg_temp.fails($q$insert into public.str_archive_headers (str_id, synced_at) values (77, now())$q$, 'no direct insert into the archive', '42501');
  perform pg_temp.fails($q$delete from public.str_archive_lines$q$, 'no direct delete from the archive', '42501');
  perform pg_temp.fails($q$select public.str_archive_sync()$q$, 'staff cannot run the archive copy', '42501');
  perform pg_temp.fails($q$select public.str_archive_prune()$q$, 'staff cannot run the prune', '42501');
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  select count(*) into n from public.str_archive_headers where str_id = 20; perform pg_temp.ok(n = 1, 'a viewer reads archived headers');
  perform pg_temp.fails($q$select cost_price from public.str_archive_lines$q$, 'archived cost is not selectable', '42501');
  select count(*) into n from public.str_archive_lines where str_id = 20; perform pg_temp.ok(n = 1, 'a viewer reads archived lines');
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  perform pg_temp.fails($q$select public.str_archive_sync()$q$, 'even the owner cannot call the copy from the app', '42501');
  reset role;
  set local role anon;
  perform pg_temp.fails($q$select count(*) from public.str_archive_headers$q$, 'anon cannot read the archive', '42501');
  reset role;
end $t$;
rollback;
