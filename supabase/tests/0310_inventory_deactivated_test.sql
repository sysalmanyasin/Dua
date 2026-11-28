-- Tests for 0310_inventory_deactivated (Audit 0): the list of deactivated products. Invented products and people.
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

insert into auth.users(id, email) values ('00000000-0000-0000-0000-0000000000a1','a@t'),('00000000-0000-0000-0000-0000000000b1','v@t'),('00000000-0000-0000-0000-0000000000b2','n@t');
select public.bootstrap_first_admin('00000000-0000-0000-0000-0000000000a1','owner','Test Owner');
insert into public.staff(id, full_name) values ('10000000-0000-0000-0000-000000000001','Viewer'),('10000000-0000-0000-0000-000000000002','Plain');
insert into public.profiles(user_id, staff_id, username, role_template) values
 ('00000000-0000-0000-0000-0000000000b1','10000000-0000-0000-0000-000000000001','viewer','junior'),
 ('00000000-0000-0000-0000-0000000000b2','10000000-0000-0000-0000-000000000002','plain','junior');
insert into public.user_permissions(user_id, perm_key, effect) values
 ('00000000-0000-0000-0000-0000000000b1','inventory.view','grant'), ('00000000-0000-0000-0000-0000000000b2','inventory.view','deny');
insert into public.inventory_products(code, name, company, qty, price, active, deactivated_at) values
 ('D1', 'Test Old Syrup',  'Co A', 5, 10, false, now() - interval '10 days'),
 ('D2', 'Test Newer Drop', 'Co A', 0, 20, false, now() - interval '1 day'),
 ('D3', 'Test No Date',    'Co B', 1, 30, false, null),
 ('L1', 'Test Live Item',  'Co A', 9, 40, true,  null);

do $t$ declare v uuid := '00000000-0000-0000-0000-0000000000b1'; n uuid := '00000000-0000-0000-0000-0000000000b2'; r text[]; begin
  perform pg_temp.as_user(v);
  perform pg_temp.ok((select array_agg(code) from public.inventory_deactivated()) = array['D2', 'D1', 'D3'], 'lists only deactivated products, newest deactivation first, undated last');
  perform pg_temp.ok(not exists (select 1 from public.inventory_deactivated() where code = 'L1'), 'an active product is never listed');
  perform pg_temp.ok((select count(*) from public.inventory_deactivated(2, 0)) = 2 and (select array_agg(code) from public.inventory_deactivated(2, 2)) = array['D3'], 'limit and offset page through the list');
  perform pg_temp.ok((select count(*) from public.inventory_deactivated(0, 0)) = 1, 'a limit of 0 is raised to 1');
  perform pg_temp.ok((select count(*) from public.inventory_deactivated(-5, -5)) = 1 and (select code from public.inventory_deactivated(-5, -5)) = 'D2', 'negative limit and offset are clamped, not an error');
  perform pg_temp.ok((select count(*) from public.inventory_deactivated(null, null)) = 3, 'null limit and offset use the defaults');
  perform pg_temp.ok((select count(*) from public.inventory_deactivated(999999, 0)) = 3, 'a huge limit is capped but still answers');
  perform pg_temp.ok((select count(*) from public.inventory_deactivated(10, 999999999)) = 0, 'an offset past the end gives an empty list');
  perform pg_temp.as_user(n);
  perform pg_temp.fails('select * from public.inventory_deactivated()', 'a person denied inventory.view is refused', '42501');
  reset role;
  perform pg_temp.ok(not has_function_privilege('anon', 'public.inventory_deactivated(integer,integer)', 'execute'), 'the visitor role cannot call it');
  perform pg_temp.ok((select prosecdef and provolatile = 's' from pg_proc where proname = 'inventory_deactivated'), 'a stable security-definer read');
end $t$;
rollback;
