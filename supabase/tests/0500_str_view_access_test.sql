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

-- invented feed rows (what Candela's export would have landed)
insert into public.str_headers (str_id, str_number, dispatch_status, receive_status, str_date, direction, dispatch_branch, receive_branch)
values (1, 'T-1', 'Dispatched', '', current_date, 'in', 'Warehouse', 'Test Branch'),
       (2, 'T-2', '', '', current_date, 'out', 'Test Branch', 'Warehouse');
insert into public.str_line_items (str_id, str_item_id, product_code, product_name, str_qty, dispatch_qty, receive_qty, product_price, cost_price)
values (1, 1, 'P1', 'Test Syrup', 10, 10, null, 100, 60), (1, 2, 'P2', 'Test Tablet', 5, 0, null, 50, 30), (2, 1, 'P1', 'Test Syrup', 3, null, null, 100, 60);

select pg_temp.ok(exists (select 1 from public.permissions where key = 'str.view'), 'str.view is seeded');
select pg_temp.ok(not exists (select 1 from public.role_permissions where perm_key = 'str.view'), 'no role preset carries str.view');

do $t$ declare n int; begin
  -- plain staff: nothing
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
  select count(*) into n from public.str_headers; perform pg_temp.ok(n = 0, 'a user without str.view reads no headers');
  select count(*) into n from public.str_line_items; perform pg_temp.ok(n = 0, 'a user without str.view reads no lines');
  perform pg_temp.fails($q$insert into public.str_headers (str_id) values (99)$q$, 'no direct insert', '42501');
  perform pg_temp.fails($q$update public.str_headers set comments = 'x'$q$, 'no direct update', '42501');
  perform pg_temp.fails($q$delete from public.str_line_items$q$, 'no direct delete', '42501');
  reset role;

  -- str.create and str.approve do not open reading any more
  insert into public.user_permissions(user_id, perm_key, effect) values ('00000000-0000-0000-0000-0000000000b2','str.approve','grant'),('00000000-0000-0000-0000-0000000000b2','str.create','grant');
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
  select count(*) into n from public.str_headers; perform pg_temp.ok(n = 0, 'str.approve and str.create no longer open the feed tables');
  reset role;

  -- the viewer reads, but not cost
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  select count(*) into n from public.str_headers; perform pg_temp.ok(n = 2, 'a viewer reads the headers');
  select count(*) into n from public.str_line_items; perform pg_temp.ok(n = 3, 'a viewer reads the lines');
  perform pg_temp.fails($q$select cost_price from public.str_line_items$q$, 'cost_price is not selectable', '42501');
  perform pg_temp.fails($q$select * from public.str_line_items$q$, 'select * is refused', '42501');
  select count(product_price) into n from public.str_line_items; perform pg_temp.ok(n = 3, 'the retail price is readable');
  perform pg_temp.fails($q$update public.str_line_items set str_qty = 1$q$, 'a viewer cannot write', '42501');
  reset role;

  -- a deny beats the grant
  update public.user_permissions set effect = 'deny' where user_id = '00000000-0000-0000-0000-0000000000b1' and perm_key = 'str.view';
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  select count(*) into n from public.str_headers; perform pg_temp.ok(n = 0, 'a deny overrides the grant');
  reset role;

  -- owner needs the second factor
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal1');
  select count(*) into n from public.str_headers; perform pg_temp.ok(n = 0, 'owner without MFA reads nothing');
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  select count(*) into n from public.str_headers; perform pg_temp.ok(n = 2, 'owner with MFA reads everything');
  reset role;

  -- anon
  set local role anon;
  perform pg_temp.fails($q$select count(*) from public.str_headers$q$, 'anon cannot read headers', '42501');
  perform pg_temp.fails($q$select count(*) from public.str_line_items$q$, 'anon cannot read lines', '42501');
  reset role;
end $t$;
rollback;
