-- Tests for 0406_audit_counting_reads_individual (Audit slice A5). Invented people and products only.
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


-- ── 0412: Individual rounds compile themselves on submit ──
-- c1 and c2 are Individual counters, d1 holds audit.manage/assign/compile style rights through the owner.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
select public.set_user_permission('00000000-0000-0000-0000-0000000000c2', 'audit.individual', 'grant', 'test');
reset role;

-- c1 starts and counts A1 = 9 (system 10)
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
insert into ids select 'r1', (public.audit_individual_start('81000000-0000-0000-0000-000000000001', array['A1', 'B1']) ->> 'round_id')::uuid;
insert into ids select 'a1', (select assignment_id from public.audit_my_assignments() where round_id = (select v from ids where k = 'r1'));
insert into ids select 'i1', (select round_item_id from public.audit_my_items((select v from ids where k = 'a1')) where code = 'A1');
select public.audit_count_batch((select v from ids where k = 'a1'),
  jsonb_build_array(jsonb_build_object('event_id', gen_random_uuid(), 'item', (select v from ids where k = 'i1'), 'qty', 9)));
select pg_temp.refused(format($q$select public.audit_compile_round(%L)$q$, (select v from ids where k = 'r1')), 'not_allowed',
  'a counter still cannot compile by hand');
select pg_temp.fails(format($q$select public.audit_compile_round_core(%L, false, null)$q$, (select v from ids where k = 'r1')),
  'the internal core is not callable by a counter');
reset role;
select pg_temp.ok((select state from public.audit_rounds where id = (select v from ids where k = 'r1')) = 'counting', 'before submit the round is counting');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
create temp table sub1 (j jsonb); grant all on sub1 to authenticated;
insert into sub1 select public.audit_submit((select v from ids where k = 'a1'), 'done');
reset role;
select pg_temp.ok((select (j ->> 'compiled')::boolean from sub1), 'submit reports the round was compiled');
select pg_temp.ok((select state from public.audit_rounds where id = (select v from ids where k = 'r1')) = 'compiled', 'the individual round is compiled at once');
select pg_temp.ok((select count(*) from public.audit_compilations where round_id = (select v from ids where k = 'r1')) = 1, 'one compilation exists');
select pg_temp.ok((select variance_count from public.audit_compilations where round_id = (select v from ids where k = 'r1')) = 2, 'variances are computed (A1 is 1 short; untouched B1 reads as 0, 8 short)');
select pg_temp.ok((select compiled_by from public.audit_compilations where round_id = (select v from ids where k = 'r1')) = '00000000-0000-0000-0000-0000000000c1', 'the compile is attributed to the counter who submitted');

-- the person can start the next one straight away
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
insert into ids select 'r2', (public.audit_individual_start('81000000-0000-0000-0000-000000000002', array['A1']) ->> 'round_id')::uuid;
reset role;
select pg_temp.ok((select state from public.audit_rounds where id = (select v from ids where k = 'r2')) = 'counting', 'the next Individual Audit starts without waiting');

-- a replayed submit changes nothing
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select public.audit_submit((select v from ids where k = 'a1'), null);
reset role;
select pg_temp.ok((select count(*) from public.audit_compilations where round_id = (select v from ids where k = 'r1')) = 1, 'a replayed submit does not compile again');

-- c2 counts the same product differently in the same month: no conflict is raised
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c2');
insert into ids select 'r3', (public.audit_individual_start('81000000-0000-0000-0000-000000000003', array['A1']) ->> 'round_id')::uuid;
insert into ids select 'a3', (select assignment_id from public.audit_my_assignments() where round_id = (select v from ids where k = 'r3'));
insert into ids select 'i3', (select round_item_id from public.audit_my_items((select v from ids where k = 'a3')) where code = 'A1');
select public.audit_count_batch((select v from ids where k = 'a3'),
  jsonb_build_array(jsonb_build_object('event_id', gen_random_uuid(), 'item', (select v from ids where k = 'i3'), 'qty', 7)));
select public.audit_submit((select v from ids where k = 'a3'), null);
reset role;
select pg_temp.ok((select state from public.audit_rounds where id = (select v from ids where k = 'r3')) = 'compiled', 'the second person auto-compiled too');
select pg_temp.ok((select count(*) from public.audit_conflicts) = 0, 'no conflict is raised between individual rounds counted differently');

-- reopen: refused while that person has another open self-pick (c1 has r2 open), allowed once it is submitted
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
select pg_temp.refused(format($q$select public.audit_reopen(%L, 'recount it')$q$, (select v from ids where k = 'a1')), 'self_pick_open',
  'reopen is refused while the person has another open Individual Audit');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
insert into ids select 'a2', (select assignment_id from public.audit_my_assignments() where round_id = (select v from ids where k = 'r2'));
select public.audit_submit((select v from ids where k = 'a2'), null);
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
select public.audit_reopen((select v from ids where k = 'a1'), 'recount it');
reset role;
select pg_temp.ok((select state from public.audit_rounds where id = (select v from ids where k = 'r1')) = 'counting', 'reopen puts a compiled individual round back to counting');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select public.audit_submit((select v from ids where k = 'a1'), null);
reset role;
select pg_temp.ok((select max(revision) from public.audit_compilations where round_id = (select v from ids where k = 'r1')) = 2, 're-submitting after a reopen adds compile revision 2');
select pg_temp.ok((select state from public.audit_rounds where id = (select v from ids where k = 'r1')) = 'compiled', 'and the round is compiled again');


rollback;
