-- Tests for 0416_audit_assignment_progress (Audit slice F7). Invented people and products only.
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

-- c1 counts only one of their items (twice: the later count wins, the earlier stays in the log), with a note
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
insert into ids select 'first', (select round_item_id from public.audit_my_items((select v from ids where k = 'a1')) order by code limit 1);
select public.audit_count_batch((select v from ids where k = 'a1'), jsonb_build_array(
  jsonb_build_object('event_id', gen_random_uuid(), 'item', (select v from ids where k = 'first'), 'qty', 3),
  jsonb_build_object('event_id', gen_random_uuid(), 'item', (select v from ids where k = 'first'), 'qty', 4, 'note', 'checked twice')));
reset role;

-- who may ask
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select pg_temp.refused(format('select public.audit_assignment_progress(%L)', (select v from ids where k = 'a1')), 'not_allowed', 'a counter without a viewing key is refused');
reset role;
set local role anon;
select pg_temp.fails(format('select public.audit_assignment_progress(%L)', (select v from ids where k = 'a1')), 'anon cannot call it');
reset role;

select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
select pg_temp.refused($q$select public.audit_assignment_progress('99999999-0000-0000-0000-000000000000')$q$, 'assignment_not_found', 'an unknown assignment is refused');
select pg_temp.ok((public.audit_assignment_progress((select v from ids where k = 'a1')) -> 'assignment' ->> 'name') = 'Count One', 'it names the person');
select pg_temp.ok((public.audit_assignment_progress((select v from ids where k = 'a1')) -> 'assignment' ->> 'status') = 'counting', 'and the status');
select pg_temp.ok((public.audit_assignment_progress((select v from ids where k = 'a1')) -> 'assignment' ->> 'round_state') = 'counting', 'and the round state');
select pg_temp.ok(jsonb_array_length(public.audit_assignment_progress((select v from ids where k = 'a1')) -> 'items')
  = (select count(*) from public.audit_assignment_items where assignment_id = (select v from ids where k = 'a1')), 'every item given to the person is listed');
select pg_temp.ok((select count(*) from jsonb_array_elements(public.audit_assignment_progress((select v from ids where k = 'a1')) -> 'items') i where (i ->> 'counted')::boolean) = 1,
  'exactly one is counted');
select pg_temp.ok((select (i ->> 'qty')::numeric from jsonb_array_elements(public.audit_assignment_progress((select v from ids where k = 'a1')) -> 'items') i
  where i ->> 'round_item_id' = (select v::text from ids where k = 'first')) = 4, 'the latest count wins');
select pg_temp.ok((select i ->> 'note' from jsonb_array_elements(public.audit_assignment_progress((select v from ids where k = 'a1')) -> 'items') i
  where i ->> 'round_item_id' = (select v::text from ids where k = 'first')) = 'checked twice', 'and its note');
select pg_temp.ok((select count(*) from jsonb_array_elements(public.audit_assignment_progress((select v from ids where k = 'a1')) -> 'items') i where (i ->> 'qty') is null and not (i ->> 'counted')::boolean) =
  jsonb_array_length(public.audit_assignment_progress((select v from ids where k = 'a1')) -> 'items') - 1, 'items not counted have no quantity (not 0)');
select pg_temp.ok(not (public.audit_assignment_progress((select v from ids where k = 'a1')) -> 'items' -> 0) ? 'system_qty', 'system quantities are not returned');
select pg_temp.ok((select count(*) from public.audit_count_events where assignment_id = (select v from ids where k = 'a1')) = 2, 'the earlier count is still in the log');
select pg_temp.ok((public.audit_assignment_progress((select v from ids where k = 'a2')) -> 'assignment' ->> 'name') = 'Count Two', 'the other assignment is the other person');
reset role;

-- a viewer outside the engagement is refused; as a member the same viewer sees it
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d2', 'aal1');
select pg_temp.refused(format('select public.audit_assignment_progress(%L)', (select v from ids where k = 'a1')), 'not_allowed', 'a report key alone is not enough');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
select public.set_user_permission('00000000-0000-0000-0000-0000000000d2', 'audit.view', 'grant', 'test');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d2', 'aal1');
select pg_temp.refused(format('select public.audit_assignment_progress(%L)', (select v from ids where k = 'a1')), 'not_allowed', 'a viewer who is not a member is refused');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1', 'aal1');
select pg_temp.ok((public.audit_assignment_progress((select v from ids where k = 'a1')) -> 'assignment' ->> 'name') = 'Count One', 'a member viewer sees it');
reset role;

rollback;
