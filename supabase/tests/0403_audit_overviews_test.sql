-- Tests for 0403_audit_overviews (Audit slice A4). Invented people and products only.
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
drop function if exists public.inventory_products_for_scope(jsonb);
create function public.inventory_products_for_scope(p_scope jsonb)
returns table (code text, name text, company text, qty numeric, price numeric) language sql as $$
  select f.code, f.name, f.company, f.qty, f.price from public.fx_items f where f.scope = p_scope ->> 'fx' order by f.ord $$;
insert into public.fx_items values ('s', 1, 'A1', 'Acme one', 'Acme', 10, 2), ('s', 2, 'A2', 'Acme two', 'Acme', 5, 2),
  ('s', 3, 'B1', 'Beta one', 'Beta', 8, 1), ('s', 4, 'B2', 'Beta two', 'Beta', 8, 1), ('s', 5, 'C1', 'Cura one', 'Cura', 3, 4);

create temp table ids (k text primary key, v uuid);
grant all on ids to authenticated, anon;

select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
insert into ids select 'eng', public.audit_engagement_create('70000000-0000-0000-0000-000000000001', 'Overview audit', 'full');
insert into ids select 'r', public.audit_round_create('70000000-0000-0000-0000-000000000002', (select v from ids where k = 'eng'), 'company', '{"fx":"s"}');
select public.audit_member_set((select v from ids where k = 'eng'), '00000000-0000-0000-0000-0000000000d1', 'deputy');
reset role;

-- who may ask
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select pg_temp.refused('select * from public.audit_people()', 'not_allowed', 'a counter cannot list people');
select pg_temp.refused(format($q$select public.audit_engagement_overview(%L)$q$, (select v from ids where k = 'eng')), 'not_allowed', 'a counter cannot read an audit overview');
select pg_temp.refused(format($q$select public.audit_round_overview(%L)$q$, (select v from ids where k = 'r')), 'not_allowed', 'a counter cannot read a round overview');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d2');
select pg_temp.refused(format($q$select public.audit_engagement_overview(%L)$q$, (select v from ids where k = 'eng')), 'not_allowed', 'a deputy who is not a member cannot read the overview');
select pg_temp.refused(format($q$select public.audit_round_overview(%L)$q$, (select v from ids where k = 'r')), 'not_allowed', 'a deputy who is not a member cannot read a round');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
select pg_temp.refused('select * from public.audit_people()', 'not_allowed', 'a viewing deputy cannot list people');
select pg_temp.ok((public.audit_engagement_overview((select v from ids where k = 'eng')) -> 'engagement' ->> 'name') = 'Overview audit', 'a member deputy can read the overview');
reset role;
set local role anon;
select pg_temp.fails('select * from public.audit_people()', 'anon cannot list people');
select pg_temp.fails(format($q$select public.audit_round_overview(%L)$q$, (select v from ids where k = 'r')), 'anon cannot read a round');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
select pg_temp.refused(format($q$select public.audit_engagement_overview(%L)$q$, gen_random_uuid()), 'engagement_not_found', 'an unknown audit is reported');
select pg_temp.refused(format($q$select public.audit_round_overview(%L)$q$, gen_random_uuid()), 'round_not_found', 'an unknown round is reported');

-- people
select pg_temp.ok((select count(*) from public.audit_people()) = 5, 'people lists every active account (owner, two deputies, two counters) and not the disabled one');
select pg_temp.ok(not exists (select 1 from public.audit_people() where username = 'count3'), 'a disabled account is not listed');
select pg_temp.ok((select can_count from public.audit_people() where username = 'count1'), 'a junior can count by preset');
select pg_temp.ok(not (select can_count from public.audit_people() where username = 'count2'), 'a personal deny removes counting');
select pg_temp.ok((select full_name from public.audit_people() where username = 'count1') = 'Count One', 'people carry the staff name');

-- engagement overview
select pg_temp.ok(jsonb_array_length(public.audit_engagement_overview((select v from ids where k = 'eng')) -> 'members') = 1, 'the overview lists the one member');
select pg_temp.ok((public.audit_engagement_overview((select v from ids where k = 'eng')) -> 'members' -> 0 ->> 'name') = 'Dep One', 'a member is shown by name');
select pg_temp.ok((public.audit_engagement_overview((select v from ids where k = 'eng')) -> 'rounds' -> 0 ->> 'items')::int = 5, 'the round shows its item count');
select pg_temp.ok((public.audit_engagement_overview((select v from ids where k = 'eng')) -> 'rounds' -> 0 ->> 'state') = 'draft', 'the round shows its state');

-- round overview, before and after assignment
select pg_temp.ok((public.audit_round_overview((select v from ids where k = 'r')) -> 'companies' -> 0 ->> 'unassigned')::int = 2, 'before assigning, Acme shows 2 unassigned');
select pg_temp.ok(jsonb_array_length(public.audit_round_overview((select v from ids where k = 'r')) -> 'assignments') = 0, 'before assigning, nobody has a part');
select public.audit_assign_auto((select v from ids where k = 'r'), array['00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000c2']::uuid[], 'company');
select pg_temp.ok((select sum((x ->> 'unassigned')::int) from jsonb_array_elements(public.audit_round_overview((select v from ids where k = 'r')) -> 'companies') x) = 0, 'after auto-assign nothing is unassigned');
select pg_temp.ok((select sum((x ->> 'items')::int) from jsonb_array_elements(public.audit_round_overview((select v from ids where k = 'r')) -> 'assignments') x) = 5, 'the assignments cover every item');
select pg_temp.ok((public.audit_round_overview((select v from ids where k = 'r')) -> 'assignments' -> 0 ->> 'name') = 'Count One', 'an assignment is shown by name');
-- a revoked assignment drops out of the list and its items show as unassigned again
select public.audit_assign_revoke((select (x ->> 'id')::uuid from jsonb_array_elements(public.audit_round_overview((select v from ids where k = 'r')) -> 'assignments') x limit 1), 'test');
select pg_temp.ok(jsonb_array_length(public.audit_round_overview((select v from ids where k = 'r')) -> 'assignments') = 1, 'a revoked assignment is no longer listed');
select pg_temp.ok((select sum((x ->> 'unassigned')::int) from jsonb_array_elements(public.audit_round_overview((select v from ids where k = 'r')) -> 'companies') x) > 0, 'its items are unassigned again');
reset role;
rollback;
