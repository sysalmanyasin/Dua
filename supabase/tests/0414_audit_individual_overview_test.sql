-- Tests for 0414_audit_individual_overview (Audit slice F6). Invented people and products only.
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
-- c1 has a second round still counting (r2) so the unfinished case is covered
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
insert into ids select 'r2', (public.audit_individual_start('81000000-0000-0000-0000-000000000002', array['A1']) ->> 'round_id')::uuid;
reset role;

select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select pg_temp.refused($q$select * from public.audit_individual_overview()$q$, 'not_allowed', 'a counter without a viewing key is refused');
reset role;
set local role anon;
select pg_temp.fails($q$select * from public.audit_individual_overview()$q$, 'anon cannot call it');
reset role;

select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
select pg_temp.refused($q$select * from public.audit_individual_overview('2026-13')$q$, 'invalid_month', 'a bad month is refused');
select pg_temp.refused($q$select * from public.audit_individual_overview('soon')$q$, 'invalid_month', 'text is refused');
select pg_temp.ok((select count(*) from public.audit_individual_overview()) = 3, 'the current month lists all three Individual rounds');
select pg_temp.ok((select count(*) from public.audit_individual_overview(to_char(now() at time zone 'Asia/Karachi', 'YYYY-MM'))) = 3, 'naming the month gives the same');
select pg_temp.ok((select count(*) from public.audit_individual_overview('2020-01')) = 0, 'another month is empty');
select pg_temp.ok((select person_name from public.audit_individual_overview() limit 1) = 'Count One', 'people are listed A to Z (Count One first)');
select pg_temp.ok((select count(distinct person_id) from public.audit_individual_overview()) = 2, 'two people counted');
select pg_temp.ok((select variance_count from public.audit_individual_overview() where round_id = (select v from ids where k = 'r1')) = 2, 'a compiled round shows its variance count');
select pg_temp.ok((select variance_value from public.audit_individual_overview() where round_id = (select v from ids where k = 'r1')) = -(100.50 + 8 * 55), 'and its variance value (A1 1 short, B1 untouched)');
select pg_temp.ok((select item_count from public.audit_individual_overview() where round_id = (select v from ids where k = 'r1')) = 2, 'and its item count');
select pg_temp.ok((select variance_count is null and variance_value is null and item_count is null and state = 'counting'
                   from public.audit_individual_overview() where round_id = (select v from ids where k = 'r2')), 'a round still counting has no variance yet (null, not 0)');
select pg_temp.ok((select bool_and(started_at <= prev) from (select started_at, lag(started_at) over () as prev
                   from public.audit_individual_overview() where person_id = '00000000-0000-0000-0000-0000000000c1') z where prev is not null),
                   'a person''s rounds never go from newer to older in the wrong direction');
reset role;

-- a viewer who is not a member sees nothing; a member sees the engagement
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
select public.set_user_permission('00000000-0000-0000-0000-0000000000d1', 'audit.view', 'grant', 'test');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
select pg_temp.ok((select count(*) from public.audit_individual_overview()) = 0, 'a viewer outside the engagement sees nothing');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
select public.audit_member_set((select engagement_id from public.audit_rounds where id = (select v from ids where k = 'r1')),
  '00000000-0000-0000-0000-0000000000d1', 'observer');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
select pg_temp.ok((select count(*) from public.audit_individual_overview()) = 3, 'a member viewer sees the month');
reset role;

rollback;
