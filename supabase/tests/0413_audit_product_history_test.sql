-- Tests for 0413_audit_product_history (Audit slice F6). Invented people and products only.
begin;
create function pg_temp.as_user(uid uuid, lvl text default 'aal1') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'aal', lvl, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; raise notice 'pass: %', msg; end $$;
create function pg_temp.refused(sql text, want text, msg text) returns void language plpgsql as $$
declare h text;
begin
  begin execute sql; exception when others then
    get stacked diagnostics h = pg_exception_hint;
    if h is distinct from want then raise exception 'FAIL (code "%", wanted "%", message "%"): %', h, want, sqlerrm, msg; end if;
    raise notice 'pass (refused with %): %', want, msg; return;
  end;
  raise exception 'FAIL (was allowed): %', msg;
end $$;
create function pg_temp.fails(sql text, msg text) returns void language plpgsql as $$
begin
  begin execute sql; exception when others then raise notice 'pass (refused): %', msg; return; end;
  raise exception 'FAIL (was allowed): %', msg;
end $$;

insert into auth.users (id, email) values
 ('00000000-0000-0000-0000-0000000000a1', 'owner@t'), ('00000000-0000-0000-0000-0000000000d1', 'dep1@t'),
 ('00000000-0000-0000-0000-0000000000d2', 'dep2@t'), ('00000000-0000-0000-0000-0000000000c1', 'c1@t'),
 ('00000000-0000-0000-0000-0000000000c2', 'c2@t'), ('00000000-0000-0000-0000-0000000000c3', 'c3@t');
select public.bootstrap_first_admin('00000000-0000-0000-0000-0000000000a1', 'owner', 'Test Owner');
insert into public.staff (id, full_name) values
 ('10000000-0000-0000-0000-0000000000d1', 'Dep One'), ('10000000-0000-0000-0000-0000000000d2', 'Dep Two'),
 ('10000000-0000-0000-0000-0000000000c1', 'Count One'), ('10000000-0000-0000-0000-0000000000c2', 'Count Two'),
 ('10000000-0000-0000-0000-0000000000c3', 'Count Gone');
insert into public.profiles (user_id, staff_id, username, role_template, disabled_at) values
 ('00000000-0000-0000-0000-0000000000d1', '10000000-0000-0000-0000-0000000000d1', 'dep1', 'senior', null),
 ('00000000-0000-0000-0000-0000000000d2', '10000000-0000-0000-0000-0000000000d2', 'dep2', 'senior', null),
 ('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-0000000000c1', 'count1', 'junior', null),
 ('00000000-0000-0000-0000-0000000000c2', '10000000-0000-0000-0000-0000000000c2', 'count2', 'junior', null),
 ('00000000-0000-0000-0000-0000000000c3', '10000000-0000-0000-0000-0000000000c3', 'count3', 'junior', now());
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
select public.set_user_permission('00000000-0000-0000-0000-0000000000c1', 'audit.count', 'grant', 'test');
select public.set_user_permission('00000000-0000-0000-0000-0000000000c1', 'audit.individual', 'grant', 'test');
select public.set_user_permission('00000000-0000-0000-0000-0000000000c2', 'audit.count', 'grant', 'test');
select public.set_user_permission('00000000-0000-0000-0000-0000000000d1', 'audit.templates', 'grant', 'test');
select public.set_user_permission('00000000-0000-0000-0000-0000000000d2', 'audit.individual', 'grant', 'test');
select public.set_user_permission('00000000-0000-0000-0000-0000000000d2', 'audit.count', 'grant', 'test');
reset role;


create or replace function public.inventory_products_for_scope(p_scope jsonb)
returns table (code text, name text, company text, qty numeric, price numeric) language sql as $$
  select v.code, v.name, v.company, v.qty, v.price from (values
    ('A1', 'Alpha one', 'Acme', 10::numeric, 100.50::numeric), ('A2', 'Alpha two', 'Acme', 5::numeric, 20::numeric),
    ('B1', 'Beta one', 'Beta', 8::numeric, 55::numeric), ('C1', 'Cura one', 'Cura', 40::numeric, 3::numeric)
  ) v (code, name, company, qty, price) where (p_scope -> 'codes') ? v.code $$;
create temp table ids (k text primary key, v uuid);
grant all on ids to authenticated;


-- c1 counts A1=9, B1 untouched; c2 counts A1=7. Both rounds compile on submit (0412).
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
select public.set_user_permission('00000000-0000-0000-0000-0000000000c2', 'audit.individual', 'grant', 'test');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
insert into ids select 'r1', (public.audit_individual_start('81000000-0000-0000-0000-000000000001', array['A1', 'B1']) ->> 'round_id')::uuid;
insert into ids select 'a1', (select assignment_id from public.audit_my_assignments() where round_id = (select v from ids where k = 'r1'));
insert into ids select 'i1', (select round_item_id from public.audit_my_items((select v from ids where k = 'a1')) where code = 'A1');
select public.audit_count_batch((select v from ids where k = 'a1'),
  jsonb_build_array(jsonb_build_object('event_id', gen_random_uuid(), 'item', (select v from ids where k = 'i1'), 'qty', 9)));
select public.audit_submit((select v from ids where k = 'a1'), null);
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c2');
insert into ids select 'r3', (public.audit_individual_start('81000000-0000-0000-0000-000000000003', array['A1']) ->> 'round_id')::uuid;
insert into ids select 'a3', (select assignment_id from public.audit_my_assignments() where round_id = (select v from ids where k = 'r3'));
insert into ids select 'i3', (select round_item_id from public.audit_my_items((select v from ids where k = 'a3')) where code = 'A1');
select public.audit_count_batch((select v from ids where k = 'a3'),
  jsonb_build_array(jsonb_build_object('event_id', gen_random_uuid(), 'item', (select v from ids where k = 'i3'), 'qty', 7)));
select public.audit_submit((select v from ids where k = 'a3'), null);
reset role;

-- who may ask
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select pg_temp.refused($q$select * from public.audit_product_history('alpha')$q$, 'not_allowed', 'a counter without a viewing key is refused');
reset role;
set local role anon;
select pg_temp.fails($q$select * from public.audit_product_history('alpha')$q$, 'anon cannot call it');
reset role;

-- the administrator sees both rounds, newest first, with exact figures
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
select pg_temp.ok((select count(*) from public.audit_product_history('alpha')) = 2, 'a name search finds the product in both rounds');
select pg_temp.ok((select count(*) from public.audit_product_history('ALPHA')) = 2, 'the search ignores case');
select pg_temp.ok((select count(*) from public.audit_product_history('a1')) = 2, 'a code prefix finds it');
select pg_temp.ok((select count(*) from public.audit_product_history('A')) >= 3, 'one letter matches by code prefix and name');
select pg_temp.ok((select counted_qty from public.audit_product_history('alpha') where round_id = (select v from ids where k = 'r1')) = 9, 'round 1 counted 9');
select pg_temp.ok((select variance from public.audit_product_history('alpha') where round_id = (select v from ids where k = 'r1')) = -1, 'round 1 variance is -1');
select pg_temp.ok((select variance_value from public.audit_product_history('alpha') where round_id = (select v from ids where k = 'r1')) = -100.50, 'round 1 variance value is -100.50');
select pg_temp.ok((select variance_value from public.audit_product_history('alpha') where round_id = (select v from ids where k = 'r3')) = -301.50, 'round 3 variance value is -301.50');
select pg_temp.ok((select not_counted from public.audit_product_history('beta')), 'a product nobody counted is marked not counted');
select pg_temp.ok((select total from public.audit_product_history('alpha') limit 1) = 2, 'total reports the matches');
select pg_temp.ok((select count(*) from public.audit_product_history('alpha', 1)) = 1, 'the limit applies');
select pg_temp.ok((select count(*) from public.audit_product_history('alpha', 0)) = 1, 'a limit below 1 is raised to 1');
select pg_temp.ok((select count(*) from public.audit_product_history('')) = 0, 'empty text returns nothing');
select pg_temp.ok((select count(*) from public.audit_product_history('   ')) = 0, 'blank text returns nothing');
select pg_temp.ok((select count(*) from public.audit_product_history(null)) = 0, 'null text returns nothing');
select pg_temp.ok((select count(*) from public.audit_product_history('%')) = 0, 'a percent sign is a plain character');
select pg_temp.ok((select count(*) from public.audit_product_history('_lpha')) = 0, 'an underscore is a plain character');
select pg_temp.ok((select count(*) from public.audit_product_history('zzz')) = 0, 'no match returns nothing');
select pg_temp.ok((select round_label from public.audit_product_history('alpha') where round_id = (select v from ids where k = 'r1')) = '1', 'the round label is readable');

-- a viewer who is not a member sees nothing; once a member, sees it
select public.set_user_permission('00000000-0000-0000-0000-0000000000d1', 'audit.view', 'grant', 'test');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
select pg_temp.ok((select count(*) from public.audit_product_history('alpha')) = 0, 'a viewer outside the engagement sees nothing');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
select public.audit_member_set((select engagement_id from public.audit_rounds where id = (select v from ids where k = 'r1')),
  '00000000-0000-0000-0000-0000000000d1', 'observer');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
select pg_temp.ok((select count(*) from public.audit_product_history('alpha')) = 2, 'a member viewer sees the engagement''s rounds');
reset role;

-- a final round answers from its frozen lines
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
select public.audit_finalize((select v from ids where k = 'r3'));
select pg_temp.ok((select state from public.audit_product_history('alpha') where round_id = (select v from ids where k = 'r3')) = 'final', 'a finalised round reports final');
select pg_temp.ok((select counted_qty from public.audit_product_history('alpha') where round_id = (select v from ids where k = 'r3')) = 7, 'and its final quantity');
select pg_temp.ok((select count(*) from public.audit_product_history('alpha')) = 2, 'each round still appears once');
reset role;

rollback;
