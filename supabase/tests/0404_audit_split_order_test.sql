-- Tests for 0404_audit_split_order (Audit slice A4). Invented people and products only.
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
select public.set_user_permission('00000000-0000-0000-0000-0000000000d1', 'audit.view', 'grant', 'test');
select public.set_user_permission('00000000-0000-0000-0000-0000000000d2', 'audit.view', 'grant', 'test');
select public.set_user_permission('00000000-0000-0000-0000-0000000000c2', 'audit.count', 'deny', 'test');
reset role;

create table public.fx_items (scope text, ord int, code text, name text, company text, qty numeric, price numeric);
create function public.inventory_products_for_scope(p_scope jsonb)
returns table (code text, name text, company text, qty numeric, price numeric) language sql as $$
  select f.code, f.name, f.company, f.qty, f.price from public.fx_items f where f.scope = p_scope ->> 'fx' order by f.ord $$;
insert into public.fx_items values ('t', 1, 'P1', 'Lower one', 'apple', 1, 1), ('t', 2, 'P2', 'Upper one', 'Zed', 1, 1),
  ('t', 3, 'P3', 'Mid one', 'Mango', 1, 1);
create temp table ids (k text primary key, v uuid);
grant all on ids to authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
insert into ids select 'eng', public.audit_engagement_create('70000000-0000-0000-0000-000000000001', 'Order audit', 'full');
insert into ids select 'r', public.audit_round_create('70000000-0000-0000-0000-000000000002', (select v from ids where k = 'eng'), 'company', '{"fx":"t"}');
-- Three companies of one item each, two counters. Plain character order is Mango, Zed, apple (capitals sort first):
-- Mango -> first counter, Zed -> second, apple -> first counter again (tie goes to the first listed).
select public.audit_assign_auto((select v from ids where k = 'r'), array['00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000c2']::uuid[], 'company');
select pg_temp.ok((select count(*) from public.audit_assignment_items ai join public.audit_assignments a on a.id = ai.assignment_id join public.audit_round_items ri on ri.id = ai.round_item_id
                   where a.auditor_id = '00000000-0000-0000-0000-0000000000c1' and ri.company in ('Mango', 'apple')) = 2, 'equal-sized companies are taken in plain character order: Mango and apple to the first counter');
select pg_temp.ok((select count(*) from public.audit_assignment_items ai join public.audit_assignments a on a.id = ai.assignment_id join public.audit_round_items ri on ri.id = ai.round_item_id
                   where a.auditor_id = '00000000-0000-0000-0000-0000000000c2' and ri.company = 'Zed') = 1, 'Zed goes to the second counter');
reset role;
rollback;
