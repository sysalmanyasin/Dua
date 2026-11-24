-- Tests for 0417_audit_attention_summary (Audit slice F7). Invented people and products only.
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

create function pg_temp.sz(k text) returns int language sql as $$ select jsonb_array_length(public.audit_attention_summary() -> k) $$;
create function pg_temp.total(k text) returns int language sql as $$ select coalesce(sum((i ->> 'n')::int), 0)::int from jsonb_array_elements(public.audit_attention_summary() -> k) i $$;

-- who may ask
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select pg_temp.refused($q$select public.audit_attention_summary()$q$, 'not_allowed', 'a counter with no audit viewing key is refused');
reset role;
set local role anon;
select pg_temp.fails($q$select public.audit_attention_summary()$q$, 'anon cannot call it');
reset role;

-- one of two counters has submitted: not ready to compile
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select pg_temp.count_all((select v from ids where k = 'a1'), 1);
select public.audit_submit((select v from ids where k = 'a1'));
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
select pg_temp.ok(pg_temp.sz('ready') = 0, 'a round with one assignment still counting is not ready');
reset role;

-- both have submitted
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c2');
select pg_temp.count_all((select v from ids where k = 'a2'), 1);
select public.audit_submit((select v from ids where k = 'a2'));
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
select pg_temp.ok(pg_temp.sz('ready') = 1, 'now the round is ready to compile');
select pg_temp.ok((public.audit_attention_summary() -> 'ready' -> 0 ->> 'round_id') = (select v::text from ids where k = 'r1'), 'and it names the round');
select pg_temp.ok((public.audit_attention_summary() -> 'ready' -> 0 ->> 'engagement_name') = 'Final audit', 'and the audit');
select pg_temp.ok((public.audit_attention_summary() -> 'ready' -> 0 ->> 'round_label') = '1', 'and a readable round label');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
select pg_temp.ok(pg_temp.sz('ready') = 0, 'a viewer without the compile key sees no ready badge');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d2');
select pg_temp.ok(pg_temp.sz('ready') = 0 and pg_temp.sz('conflicts') = 0 and pg_temp.sz('corrections') = 0, 'a report-only person may call it and gets empty lists');
reset role;

-- compile, then a correction waits
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
select public.audit_compile_round((select v from ids where k = 'r1'));
select pg_temp.ok(pg_temp.sz('ready') = 0, 'a compiled round is no longer ready');
select pg_temp.ok(pg_temp.total('corrections') = 0 and pg_temp.total('conflicts') = 0, 'nothing else waits yet');
reset role;
insert into ids select 'a1item', cr.round_item_id from public.audit_compiled_rows cr join public.audit_compilations c on c.id = cr.compilation_id
  where c.round_id = (select v from ids where k = 'r1') and cr.code = 'A1';
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
select public.audit_correction_propose((select v from ids where k = 'r1'), (select v from ids where k = 'a1item'), 6, 'recounted on the shelf');
select pg_temp.ok(pg_temp.total('corrections') = 0, 'a proposer without the review key sees no corrections badge');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
select pg_temp.ok(pg_temp.total('corrections') = 1 and pg_temp.sz('corrections') = 1, 'the reviewer sees one correction waiting');
select pg_temp.ok((public.audit_attention_summary() -> 'corrections' -> 0 ->> 'round_id') = (select v::text from ids where k = 'r1'), 'in the right round');
reset role;

-- round 2 disagrees with round 1: two conflicts
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
insert into ids select 'r2', public.audit_round_create('70000000-0000-0000-0000-000000000009', (select v from ids where k = 'eng'), 'item', '{"codes": ["A1", "B1"]}');
select public.audit_assign_auto((select v from ids where k = 'r2'), array['00000000-0000-0000-0000-0000000000c1']::uuid[], 'volume');
select public.audit_round_lock((select v from ids where k = 'r2'));
select public.audit_round_start((select v from ids where k = 'r2'));
reset role;
insert into ids select 'a1r2', id from public.audit_assignments where round_id = (select v from ids where k = 'r2');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select pg_temp.count_all((select v from ids where k = 'a1r2'), 3);
select public.audit_submit((select v from ids where k = 'a1r2'));
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
select pg_temp.ok(pg_temp.sz('ready') = 1, 'round 2 is ready to compile');
select public.audit_compile_round((select v from ids where k = 'r2'));
select pg_temp.ok(pg_temp.sz('ready') = 0, 'and not after compiling');
select pg_temp.ok(pg_temp.total('conflicts') = 2 and pg_temp.sz('conflicts') = 1, 'two open conflicts in one round');
select pg_temp.ok((public.audit_attention_summary() -> 'conflicts' -> 0 ->> 'round_id') = (select v::text from ids where k = 'r2'), 'in round 2');
select public.audit_conflict_resolve((select id from public.audit_conflicts where code = 'A1' and a_round_id = (select v from ids where k = 'r2')), 'b', 'round 1 was on the shelf');
select pg_temp.ok(pg_temp.total('conflicts') = 1, 'settling one leaves one');
select public.audit_conflict_resolve((select id from public.audit_conflicts where code = 'B1' and a_round_id = (select v from ids where k = 'r2')), 'a', 'recounted twice');
select pg_temp.ok(pg_temp.total('conflicts') = 0 and pg_temp.sz('conflicts') = 0, 'settling both clears the badge');
select public.audit_correction_decide((select id from public.audit_corrections where round_id = (select v from ids where k = 'r1')), true, 'ok');
select pg_temp.ok(pg_temp.total('corrections') = 0, 'a decided correction no longer waits');
reset role;

-- scope: a reviewer outside the engagement sees none of it
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
select public.set_user_permission('00000000-0000-0000-0000-0000000000d2', 'audit.review', 'grant', 'test');
select public.set_user_permission('00000000-0000-0000-0000-0000000000d2', 'audit.compile', 'grant', 'test');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d2');
select pg_temp.ok(pg_temp.sz('ready') = 0 and pg_temp.sz('conflicts') = 0 and pg_temp.sz('corrections') = 0, 'a non-member with the keys sees nothing');
reset role;

rollback;
