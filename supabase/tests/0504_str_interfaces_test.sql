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

do $t$ declare n int; d date := (now() at time zone 'Asia/Karachi')::date; begin
  insert into public.str_headers (str_id, str_number, dispatch_status, receive_status, str_status, str_date, direction) values
    (1, 'IN-DISP-A', 'Dispatched', '', 'Open', d, 'in'),
    (2, 'IN-DISP-B', 'Dispatched', '', 'Open', d - 1, 'in'),
    (3, 'IN-RECV', 'Dispatched', 'Received', 'Open', d, 'in'),
    (4, 'IN-AWAIT', '', '', 'Open', d, 'in'),
    (5, 'OUT-DISP', 'Dispatched', '', 'Open', d, 'out'),
    (6, 'IN-CLOSED', 'Dispatched', '', 'Close', d, 'in');
  insert into public.str_line_items (str_id, str_item_id, product_code, product_name, str_qty, dispatch_qty, cost_price) values
    (1, 1, 'P1', 'Syrup', 30, 25, 10), (1, 2, 'P2', 'Tablet', 5, 0, 20), (1, 3, 'P3', 'Drops', 5, null, 0),
    (2, 1, 'P1', 'Syrup', 30, 5, 12),
    (3, 1, 'P4', 'Received item', 9, 9, 7), (4, 1, 'P5', 'Awaited item', 9, null, 7), (5, 1, 'P6', 'Outgoing item', 9, 9, 7), (6, 1, 'P7', 'Closed item', 9, 9, 7);
  insert into public.str_archive_headers (str_id, str_number, str_date, dispatch_status, direction, synced_at) values (50, 'ARC', d - 10, 'Dispatched', 'in', now());
  insert into public.str_archive_lines (str_id, str_item_id, product_code, product_name, str_qty, dispatch_qty, cost_price) values (50, 1, 'P8', 'Archived', 4, 4, 99);

  -- in transit
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  perform pg_temp.ok((select count(*) from public.str_in_transit_lines()) = 1, 'only product P1 is in transit (incoming, dispatched, not received, not closed, dispatch above 0)');
  perform pg_temp.ok((select loose_qty from public.str_in_transit_lines() where code = 'P1') = 30, 'quantities are summed by product in loose units across STRs');
  perform pg_temp.ok(not exists (select 1 from public.str_in_transit_lines() where code in ('P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8')), 'zero or null dispatch, received, awaited, outgoing, closed and archived-only lines are not in transit');
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
  perform pg_temp.fails($q$select * from public.str_in_transit_lines()$q$, 'plain staff cannot read in-transit lines', '42501');
  reset role;
  set local role anon;
  perform pg_temp.fails($q$select * from public.str_in_transit_lines()$q$, 'anon cannot read in-transit lines', '42501');
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  perform pg_temp.ok((select count(*) from public.str_in_transit_lines()) = 1, 'the owner (with MFA) can');
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal1');
  perform pg_temp.fails($q$select * from public.str_in_transit_lines()$q$, 'the owner without MFA cannot', '42501');
  reset role;

  -- cost by code
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b3');
  perform pg_temp.ok((select cost_price from public.str_cost_by_code() where code = 'P1') = 10, 'the latest STR date decides the cost of a product (today 10, not yesterday 12)');
  perform pg_temp.ok(not exists (select 1 from public.str_cost_by_code() where code = 'P3'), 'a zero cost is not a cost');
  perform pg_temp.ok((select cost_price from public.str_cost_by_code() where code = 'P8') = 99, 'archived STRs count');
  perform pg_temp.ok((select count(*) from public.str_cost_by_code(d)) = 6 and not exists (select 1 from public.str_cost_by_code(d) where code = 'P8'), 'the since date filters by STR date');
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  perform pg_temp.fails($q$select * from public.str_cost_by_code()$q$, 'str.view alone cannot read costs', '42501');
  reset role;
  set local role anon;
  perform pg_temp.fails($q$select * from public.str_cost_by_code()$q$, 'anon cannot read costs', '42501');
  reset role;
end $t$;
rollback;
