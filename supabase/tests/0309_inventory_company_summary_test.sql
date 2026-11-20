\set ON_ERROR_STOP on
-- 0309: inventory_company_summary. All data below is invented.
begin;
create function pg_temp.as_user(uid uuid, lvl text default 'aal1') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'aal', lvl, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; raise notice 'pass: %', msg; end $$;

insert into auth.users(id, email) values ('00000000-0000-0000-0000-0000000000a1','a@t'), ('00000000-0000-0000-0000-0000000000b1','j@t');
select public.bootstrap_first_admin('00000000-0000-0000-0000-0000000000a1','owner','Test Owner');
insert into public.staff(id, full_name) values ('10000000-0000-0000-0000-000000000001','J One');
insert into public.profiles(user_id, staff_id, username, role_template) values
  ('00000000-0000-0000-0000-0000000000b1','10000000-0000-0000-0000-000000000001','junior1','junior');

do $t$ declare n int; r record; msg text; begin
  set local role service_role;
  perform public.inventory_apply_sync(jsonb_build_object('products', jsonb_build_array(
    jsonb_build_object('code','A1','name','Alpha one','qty',10,'price',100.5,'company','Acme'),
    jsonb_build_object('code','A2','name','Alpha two','qty',5,'price',20,'company','Acme'),
    jsonb_build_object('code','B1','name','Beta one','qty',8,'price',55,'company','Beta'),
    jsonb_build_object('code','N1','name','No company','qty',1,'price',9))));
  reset role;

  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  select count(*) into n from public.inventory_company_summary();
  perform pg_temp.ok(n = 3, 'each company appears once');
  perform pg_temp.ok((select array_agg(company) from public.inventory_company_summary()) = array['Acme','Beta','Unassigned Manufacturer'], 'companies come in name order');
  select * into r from public.inventory_company_summary() where company = 'Acme';
  perform pg_temp.ok(r.skus = 2, 'Acme has 2 products');
  perform pg_temp.ok(r.value = 10 * 100.5 + 5 * 20, 'Acme value is quantity times price, summed');
  select * into r from public.inventory_company_summary() where company = 'Unassigned Manufacturer';
  perform pg_temp.ok(r.skus = 1 and r.value = 9, 'a product with no company sits under Unassigned Manufacturer');
  perform pg_temp.ok((select array_agg(company order by company) from public.inventory_company_summary())
                   = (select array_agg(company order by company) from public.inventory_companies()), 'same companies as inventory_companies()');

  -- a junior holds inventory.search, so may read; revoke every key that allows it and the call is refused
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  select count(*) into n from public.inventory_company_summary();
  perform pg_temp.ok(n = 3, 'a person with inventory.search can read the summary');
  reset role;
  delete from public.role_permissions where role = 'junior' and perm_key in ('inventory.search', 'audit.manage', 'audit.compile', 'audit.individual');
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  begin perform * from public.inventory_company_summary(); msg := 'none'; exception when others then msg := sqlerrm; end;
  perform pg_temp.ok(msg = 'not allowed', 'without inventory.search or an audit key the call is refused');
  perform pg_temp.ok(not has_function_privilege('anon', 'public.inventory_company_summary()', 'execute'), 'anon cannot execute it');
end $t$;
rollback;
