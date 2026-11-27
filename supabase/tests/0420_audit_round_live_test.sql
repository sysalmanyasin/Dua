-- Tests for 0420_audit_round_live (Audit slice F8): the live round view and Force Submit on an Individual round. Invented people and products only.
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
select public.set_user_permission('00000000-0000-0000-0000-0000000000c2', 'audit.count', 'grant', 'test');
select public.set_user_permission('00000000-0000-0000-0000-0000000000d1', 'audit.view', 'grant', 'test');
select public.set_user_permission('00000000-0000-0000-0000-0000000000d1', 'audit.suggest', 'grant', 'test');
reset role;

create or replace function public.inventory_products_for_scope(p_scope jsonb)
returns table (code text, name text, company text, qty numeric, price numeric) language sql as $$
  select v.code, v.name, v.company, v.qty, v.price from (values
    ('A1', 'Alpha one', 'Acme', 10::numeric, 100.50::numeric), ('A2', 'Alpha two', 'Acme', 5::numeric, 20::numeric),
    ('B1', 'Beta one', 'Beta', 8::numeric, 55::numeric), ('C1', 'Cura one', 'Cura', 40::numeric, 3::numeric),
    ('C2', 'Cura two', 'Cura', 7::numeric, 10::numeric), ('D1', 'Dova one', 'Dova', 2::numeric, 200::numeric)
  ) v (code, name, company, qty, price) where (p_scope -> 'codes') ? v.code $$;
create temp table ids (k text primary key, v uuid);
grant all on ids to authenticated, anon;
-- a counter counts every item of their assignment as the system quantity minus p_minus (not below zero)
create function pg_temp.count_all(p_asg uuid, p_minus numeric) returns void language plpgsql as $$
declare r record; ev jsonb := '[]';
begin
  for r in select * from public.audit_my_items(p_asg) loop
    ev := ev || jsonb_build_array(jsonb_build_object('event_id', gen_random_uuid(), 'item', r.round_item_id, 'qty', greatest(r.system_qty - p_minus, 0)));
  end loop;
  perform public.audit_count_batch(p_asg, ev);
end $$;

-- ── setup: one engagement, round 1 with six items split over two counters, started ──
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
insert into ids select 'eng', public.audit_engagement_create('70000000-0000-0000-0000-000000000001', 'Final audit', 'full');
select public.audit_member_set((select v from ids where k = 'eng'), '00000000-0000-0000-0000-0000000000d1', 'deputy');
insert into ids select 'r1', public.audit_round_create('70000000-0000-0000-0000-000000000002', (select v from ids where k = 'eng'), 'item',
  '{"codes": ["A1", "A2", "B1", "C1", "C2", "D1"]}');
select public.audit_assign_auto((select v from ids where k = 'r1'), array['00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000c2']::uuid[], 'volume');
select public.audit_round_lock((select v from ids where k = 'r1'));
select public.audit_round_start((select v from ids where k = 'r1'));
reset role;
insert into ids select 'a1', id from public.audit_assignments where auditor_id = '00000000-0000-0000-0000-0000000000c1' and round_id = (select v from ids where k = 'r1');
insert into ids select 'a2', id from public.audit_assignments where auditor_id = '00000000-0000-0000-0000-0000000000c2' and round_id = (select v from ids where k = 'r1');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
select public.set_user_permission('00000000-0000-0000-0000-0000000000d2', 'audit.report', 'grant', 'test');
reset role;


select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
select public.set_user_permission('00000000-0000-0000-0000-0000000000c1', 'audit.individual', 'grant', 'test');
reset role;
create function pg_temp.live(r uuid) returns jsonb language sql as $$ select public.audit_round_live(r) $$;

-- c1 counts every item of theirs one short; c2 counts one item as the system quantity and leaves the rest
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select pg_temp.count_all((select v from ids where k = 'a1'), 1);
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c2');
insert into ids select 'c2item', (select round_item_id from public.audit_my_items((select v from ids where k = 'a2')) order by code limit 1);
select public.audit_count_batch((select v from ids where k = 'a2'), jsonb_build_array(jsonb_build_object('event_id', gen_random_uuid(), 'item',
  (select v from ids where k = 'c2item'), 'qty', (select system_qty from public.audit_my_items((select v from ids where k = 'a2')) where round_item_id = (select v from ids where k = 'c2item')))));
reset role;

-- who may ask
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select pg_temp.refused(format('select public.audit_round_live(%L)', (select v from ids where k = 'r1')), 'not_allowed', 'a counter is refused: they must not see system quantities');
reset role;
set local role anon;
select pg_temp.fails(format('select public.audit_round_live(%L)', (select v from ids where k = 'r1')), 'the visitor role cannot call it');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d2', 'aal1');
select pg_temp.refused(format('select public.audit_round_live(%L)', (select v from ids where k = 'r1')), 'not_allowed', 'a person outside the engagement is refused');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
select pg_temp.refused($q$select public.audit_round_live('99999999-0000-0000-0000-000000000000')$q$, 'round_not_found', 'an unknown round is refused');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1', 'aal1');
select pg_temp.ok(jsonb_array_length(public.audit_round_live((select v from ids where k = 'r1')) -> 'items') = 6, 'a member who may see results gets the round');
reset role;

-- the round as the owner sees it
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
select pg_temp.ok(pg_temp.live((select v from ids where k = 'r1')) -> 'round' ->> 'state' = 'counting', 'it carries the round state');
select pg_temp.ok(jsonb_array_length(pg_temp.live((select v from ids where k = 'r1')) -> 'items') = 6, 'all six items are listed');
select pg_temp.ok((select array_agg(i ->> 'name' order by ord) from jsonb_array_elements(pg_temp.live((select v from ids where k = 'r1')) -> 'items') with ordinality t(i, ord))
  = (select array_agg(name order by lower(name)) from public.audit_round_items where round_id = (select v from ids where k = 'r1')), 'items come A to Z by name');
select pg_temp.ok((select count(*) from jsonb_array_elements(pg_temp.live((select v from ids where k = 'r1')) -> 'items') i where (i ->> 'counted')::boolean) =
  (select count(*) from public.audit_assignment_items where assignment_id = (select v from ids where k = 'a1')) + 1, 'counted = all of c1 plus the one item c2 counted');
select pg_temp.ok(not exists (select 1 from jsonb_array_elements(pg_temp.live((select v from ids where k = 'r1')) -> 'items') i
  where not (i ->> 'counted')::boolean and (i ->> 'qty' is not null or i ->> 'difference' is not null or i ->> 'difference_value' is not null)), 'an item not counted has no quantity and no difference (not zero)');
select pg_temp.ok(not exists (select 1 from jsonb_array_elements(pg_temp.live((select v from ids where k = 'r1')) -> 'items') i
  join public.audit_round_items ri on ri.id = (i ->> 'round_item_id')::uuid where (i ->> 'system_qty')::numeric <> ri.system_qty), 'each item carries its system quantity');
select pg_temp.ok(not exists (select 1 from jsonb_array_elements(pg_temp.live((select v from ids where k = 'r1')) -> 'items') i
  join public.audit_round_items ri on ri.id = (i ->> 'round_item_id')::uuid
  where (i ->> 'counted')::boolean and ((i ->> 'difference')::numeric <> (i ->> 'qty')::numeric - ri.system_qty
        or (i ->> 'difference_value')::numeric <> round(((i ->> 'qty')::numeric - ri.system_qty) * ri.retail_price, 2))), 'difference = counted - system, valued at the retail price');
select pg_temp.ok((select count(*) from jsonb_array_elements(pg_temp.live((select v from ids where k = 'r1')) -> 'items') i where (i ->> 'difference')::numeric = -1) =
  (select count(*) from public.audit_assignment_items where assignment_id = (select v from ids where k = 'a1')), 'every item c1 counted one short shows -1');
select pg_temp.ok((select (i ->> 'difference')::numeric from jsonb_array_elements(pg_temp.live((select v from ids where k = 'r1')) -> 'items') i
  where i ->> 'round_item_id' = (select v::text from ids where k = 'c2item')) = 0, 'the item c2 counted as the system quantity shows 0');
select pg_temp.ok((select jsonb_array_length(pg_temp.live((select v from ids where k = 'r1')) -> 'assignments')) = 2, 'both counters are listed');
select pg_temp.ok((select (g ->> 'counted')::int from jsonb_array_elements(pg_temp.live((select v from ids where k = 'r1')) -> 'assignments') g where g ->> 'name' = 'Count Two') = 1
  and (select (g ->> 'differences')::int from jsonb_array_elements(pg_temp.live((select v from ids where k = 'r1')) -> 'assignments') g where g ->> 'name' = 'Count Two') = 0, 'per person: Count Two has counted 1 with no differences');
reset role;

-- Force Submit "as matching" for c2: the uncounted items read as counted at the system quantity, flagged as assumed
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
select public.audit_force_submit((select v from ids where k = 'a2'), 'match', 'counter went home');
select pg_temp.ok((select (g ->> 'status') = 'submitted' and (g ->> 'forced')::boolean from jsonb_array_elements(pg_temp.live((select v from ids where k = 'r1')) -> 'assignments') g where g ->> 'name' = 'Count Two'),
  'after the force submit Count Two shows submitted and forced');
select pg_temp.ok((select count(*) from jsonb_array_elements(pg_temp.live((select v from ids where k = 'r1')) -> 'items') i where (i ->> 'counted')::boolean) = 6,
  'every item now counts as counted (c1 counted theirs, c2 was matched)');
select pg_temp.ok(not exists (select 1 from jsonb_array_elements(pg_temp.live((select v from ids where k = 'r1')) -> 'items') i
  join public.audit_assignment_items ai on ai.round_item_id = (i ->> 'round_item_id')::uuid and ai.assignment_id = (select v from ids where k = 'a2')
  where (i ->> 'difference')::numeric <> 0 or (i ->> 'counted')::boolean is not true), 'every item of the forced counter reads as counted with no difference');
select pg_temp.ok((select count(*) from jsonb_array_elements(pg_temp.live((select v from ids where k = 'r1')) -> 'items') i where (i ->> 'auto_matched')::boolean) =
  (select count(*) from public.audit_assignment_items where assignment_id = (select v from ids where k = 'a2')) - 1, 'the matched items stay flagged as assumed');
select pg_temp.ok((select state from public.audit_rounds where id = (select v from ids where k = 'r1')) = 'counting', 'a normal round is NOT compiled by a force submit (the main auditor still does that)');
reset role;

-- Force Submit on an Individual round compiles it, like a normal submit
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
insert into ids select 'ri', (public.audit_individual_start('82000000-0000-0000-0000-000000000001', array['A1', 'B1']) ->> 'round_id')::uuid;
insert into ids select 'ia', (select assignment_id from public.audit_my_assignments() where round_id = (select v from ids where k = 'ri'));
insert into ids select 'ii', (select round_item_id from public.audit_my_items((select v from ids where k = 'ia')) where code = 'A1');
select public.audit_count_batch((select v from ids where k = 'ia'), jsonb_build_array(jsonb_build_object('event_id', gen_random_uuid(), 'item', (select v from ids where k = 'ii'), 'qty', 7)));
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
select pg_temp.ok(jsonb_array_length(pg_temp.live((select v from ids where k = 'ri')) -> 'items') = 2, 'the owner can read an individual round: both its items are listed');
create temp table fs (j jsonb); grant all on fs to authenticated;
insert into fs select public.audit_force_submit((select v from ids where k = 'ia'), 'as_counted', 'person left');
select pg_temp.ok((select (j ->> 'compiled')::boolean from fs), 'force submit reports that the individual round compiled');
select pg_temp.ok((select state from public.audit_rounds where id = (select v from ids where k = 'ri')) = 'compiled', 'the individual round is compiled at once');
select pg_temp.ok((pg_temp.live((select v from ids where k = 'ri')) -> 'round' ->> 'state') = 'compiled', 'the live read then shows it compiled');
select pg_temp.ok((select (i ->> 'difference')::numeric from jsonb_array_elements(pg_temp.live((select v from ids where k = 'ri')) -> 'items') i where i ->> 'code' = 'A1') = -3, 'the counted item shows its difference (7 against 10)');
select pg_temp.ok((select (i ->> 'counted')::boolean from jsonb_array_elements(pg_temp.live((select v from ids where k = 'ri')) -> 'items') i where i ->> 'code' = 'B1') is false, 'the item the person never counted still shows as not counted');
reset role;

rollback;
