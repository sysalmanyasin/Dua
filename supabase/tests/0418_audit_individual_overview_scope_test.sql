-- Tests for 0418_audit_individual_overview_scope (template and companies on the Individual overview). Invented people and products only.
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

-- c1 may keep templates; c1 starts one round by products (A1 Acme, B1 Beta) and one from a template (C1 Cura)
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
select public.set_user_permission('00000000-0000-0000-0000-0000000000c1', 'audit.templates', 'grant', 'test');
select public.set_user_permission('00000000-0000-0000-0000-0000000000c2', 'audit.individual', 'grant', 'test');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
insert into ids select 'r1', (public.audit_individual_start('81000000-0000-0000-0000-000000000001', array['A1', 'B1']) ->> 'round_id')::uuid;
insert into ids select 'a1', (select assignment_id from public.audit_my_assignments() where round_id = (select v from ids where k = 'r1'));
insert into ids select 'i1', (select round_item_id from public.audit_my_items((select v from ids where k = 'a1')) where code = 'A1');
select public.audit_count_batch((select v from ids where k = 'a1'),
  jsonb_build_array(jsonb_build_object('event_id', gen_random_uuid(), 'item', (select v from ids where k = 'i1'), 'qty', 9)));
select public.audit_submit((select v from ids where k = 'a1'), null);
insert into ids select 't1', public.audit_template_save(null, 'Morning shelf', array['C1']);
insert into ids select 'r2', (public.audit_individual_start('81000000-0000-0000-0000-000000000002', '{}', (select v from ids where k = 't1')) ->> 'round_id')::uuid;
reset role;

select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
select pg_temp.ok((select template_name is null from public.audit_individual_overview() where round_id = (select v from ids where k = 'r1')),
  'a round started by picking products has no template name');
select pg_temp.ok((select companies from public.audit_individual_overview() where round_id = (select v from ids where k = 'r1')) = array['Acme', 'Beta'],
  'its companies are the distinct companies of its items, A to Z');
select pg_temp.ok((select template_name from public.audit_individual_overview() where round_id = (select v from ids where k = 'r2')) = 'Morning shelf',
  'a round started from a template carries the template name');
select pg_temp.ok((select companies from public.audit_individual_overview() where round_id = (select v from ids where k = 'r2')) = array['Cura'],
  'and its companies, known before anything is counted');
select pg_temp.ok((select state = 'counting' and item_count is null from public.audit_individual_overview() where round_id = (select v from ids where k = 'r2')),
  'a round still counting still has no item count (null, not 0)');
select pg_temp.ok((select variance_count from public.audit_individual_overview() where round_id = (select v from ids where k = 'r1')) = 2,
  'the existing columns are unchanged (variance count of the compiled round)');
select pg_temp.ok((select count(*) from public.audit_individual_overview()) = 2, 'two rounds in the month');
select pg_temp.ok((select round_label from public.audit_individual_overview() limit 1) is not null, 'rows keep their label');
reset role;

-- the same people and the same refusals as before
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c2');
select pg_temp.refused($q$select * from public.audit_individual_overview()$q$, 'not_allowed', 'a counter without a viewing key is still refused');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
select pg_temp.refused($q$select * from public.audit_individual_overview('soon')$q$, 'invalid_month', 'a bad month is still refused');
reset role;
-- the grant survived the drop and create
select pg_temp.ok(has_function_privilege('authenticated', 'public.audit_individual_overview(text)', 'execute'), 'authenticated may execute it');
select pg_temp.ok(not has_function_privilege('anon', 'public.audit_individual_overview(text)', 'execute'), 'anon may not');

rollback;
