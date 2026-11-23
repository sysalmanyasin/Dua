-- Tests for 0409_audit_final_reports (Audit slice B2). Invented people and products only.
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

-- ── round 1: counted by two people, compiled ──
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select pg_temp.count_all((select v from ids where k = 'a1'), 1);
select public.audit_submit((select v from ids where k = 'a1'));
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c2');
select pg_temp.count_all((select v from ids where k = 'a2'), 1);
select public.audit_submit((select v from ids where k = 'a2'));
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
select public.audit_compile_round((select v from ids where k = 'r1'));
reset role;
insert into ids select 'a1item', cr.round_item_id from public.audit_compiled_rows cr join public.audit_compilations c on c.id = cr.compilation_id
  where c.round_id = (select v from ids where k = 'r1') and cr.code = 'A1';

-- ── alerts ──
select pg_temp.ok(exists (select 1 from public.notifications where kind = 'audit.submitted'), 'a submission queues an owner alert');
select pg_temp.ok((select count(*) from public.notifications where kind = 'audit.submitted') = 1, 'two submissions in one round give one alert while it is unacknowledged');
select pg_temp.ok(exists (select 1 from public.notifications where kind = 'audit.compiled'), 'a compile queues an owner alert');
select pg_temp.ok(not exists (select 1 from public.notifications where kind like 'audit.%' and exists (select 1 from jsonb_object_keys(payload) k where k <> 'dedupe_key')),
  'alerts carry nothing but their key: no names or amounts');
create temp table round_alert as select public.audit_round_alert_json((select id from public.audit_compilations where round_id = (select v from ids where k = 'r1') order by revision desc limit 1)) as j;
select pg_temp.ok(exists (select 1 from public.notifications n join public.audit_compilations c on n.payload ->> 'dedupe_key' = 'audit.compiled:' || c.id::text
  where n.kind = 'audit.compiled' and c.round_id = (select v from ids where k = 'r1')), 'the compile alert is keyed by the compilation, so a recompile alerts again');
select pg_temp.ok((select (j ->> 'round')::int from round_alert) = (select round_number from public.audit_rounds where id = (select v from ids where k = 'r1')), 'the round alert names the round');
select pg_temp.ok((select (j ->> 'variance_count')::int from round_alert) = (select count(*) from public.audit_compiled_rows where compilation_id = (select id from public.audit_compilations where round_id = (select v from ids where k = 'r1') order by revision desc limit 1) and variance <> 0), 'the round alert counts the items that differ');
select pg_temp.ok((select coalesce(sum((i ->> 'value')::numeric), 0) from round_alert, jsonb_array_elements(j -> 'companies') c, jsonb_array_elements(c -> 'items') i) = (select (j ->> 'net')::numeric from round_alert), 'the listed differences add up to the net');
select pg_temp.ok((select (j ->> 'short')::numeric + (j ->> 'over')::numeric from round_alert) = (select (j ->> 'net')::numeric from round_alert), 'short plus over is the net');

-- ── finalize guards ──
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select pg_temp.refused(format($q$select public.audit_finalize(%L)$q$, (select v from ids where k = 'r1')), 'not_allowed', 'a counter cannot finalize');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
select pg_temp.refused(format($q$select public.audit_finalize(%L)$q$, (select v from ids where k = 'r1')), 'not_allowed', 'a deputy cannot finalize');
insert into ids select 'corr', public.audit_correction_propose((select v from ids where k = 'r1'), (select v from ids where k = 'a1item'), 6, 'recounted on the shelf');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
select pg_temp.refused(format($q$select public.audit_finalize(%L)$q$, (select v from ids where k = 'r1')), 'corrections_pending', 'a waiting correction blocks the final');
select pg_temp.refused(format($q$select public.audit_finalize(%L, 999)$q$, (select v from ids where k = 'r1')), 'version_conflict', 'a stale version is refused');
select pg_temp.refused(format($q$select public.audit_finalize(%L)$q$, gen_random_uuid()), 'round_not_found', 'an unknown round is refused');
select public.audit_correction_decide((select v from ids where k = 'corr'), true);
reset role;
-- tests run in one transaction, so clocks are equal: place the decision just after the compile
update public.audit_corrections set decided_at = decided_at + interval '1 minute' where id = (select v from ids where k = 'corr');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
select pg_temp.refused(format($q$select public.audit_finalize(%L)$q$, (select v from ids where k = 'r1')), 'compile_stale', 'an approved correction not yet compiled blocks the final');
select public.audit_compile_round((select v from ids where k = 'r1'));
reset role;
update public.audit_corrections set decided_at = decided_at - interval '1 minute' where id = (select v from ids where k = 'corr');

-- ── finalize round 1 ──
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
select pg_temp.ok((public.audit_finalize((select v from ids where k = 'r1'), null, 'first count') ->> 'items')::int = 6, 'the owner finalizes a compiled round');
select pg_temp.refused(format($q$select public.audit_finalize(%L)$q$, (select v from ids where k = 'r1')), 'round_final', 'a final round cannot be finalized again');
select pg_temp.refused(format($q$select public.audit_compile_round(%L)$q$, (select v from ids where k = 'r1')), 'round_final', 'a final round cannot be recompiled');
reset role;
select pg_temp.ok((select state from public.audit_rounds where id = (select v from ids where k = 'r1')) = 'final', 'the round is final');
select pg_temp.ok((select l.counted_qty = 6 and l.final_qty = 6 and l.variance = -4 and l.variance_value = -402.00 from public.audit_final_lines l join public.audit_finals f on f.id = l.final_id
  where f.round_id = (select v from ids where k = 'r1') and l.code = 'A1'), 'the approved correction is in the snapshot');
select pg_temp.ok((select f.variance_value = c.variance_value and f.variance_count = c.variance_count and f.item_count = c.item_count from public.audit_finals f
  join public.audit_compilations c on c.id = f.compilation_id where f.round_id = (select v from ids where k = 'r1')), 'the snapshot totals equal the newest compilation');
select pg_temp.ok((select ff.variance_value from public.audit_finals ff where ff.round_id = (select v from ids where k = 'r1'))
  = (select sum(l.variance_value) from public.audit_final_lines l join public.audit_finals f on f.id = l.final_id where f.round_id = (select v from ids where k = 'r1')), 'header value equals the sum of its lines');
select pg_temp.ok(exists (select 1 from public.activity_log where action = 'audit.finalized' and reason = 'first count'), 'finalizing is logged with its note');
select pg_temp.ok(exists (select 1 from public.notifications where kind = 'audit.finalized'), 'finalizing queues an owner alert');
select pg_temp.fails(format($q$update public.audit_final_lines set final_qty = 1 where final_id = (select id from public.audit_finals where round_id = %L)$q$, (select v from ids where k = 'r1')), 'a final line never changes');
select pg_temp.fails(format($q$delete from public.audit_finals where round_id = %L$q$, (select v from ids where k = 'r1')), 'a final snapshot is never deleted');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
select pg_temp.fails($q$insert into public.audit_finals (round_id, engagement_id, compilation_id, finalized_by, item_count, variance_count, variance_value, missing_count, conflict_count, conflict_changed) select round_id, engagement_id, compilation_id, finalized_by, 0, 0, 0, 0, 0, 0 from public.audit_finals$q$, 'no direct write to finals');
reset role;

-- ── round 2 disagrees with round 1: conflicts ──
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
select pg_temp.ok((public.audit_compile_round((select v from ids where k = 'r2')) ->> 'conflicts')::int = 2, 'round 2 disagrees with round 1 on two items');
select pg_temp.refused(format($q$select public.audit_final_overview(%L)$q$, (select v from ids where k = 'r2')), 'final_not_found', 'no overview before the final');
select pg_temp.refused(format($q$select public.audit_finalize(%L)$q$, (select v from ids where k = 'r2')), 'conflicts_unresolved', 'unsettled conflicts block the final');
reset role;
select pg_temp.ok(exists (select 1 from public.notifications where kind = 'audit.conflict'), 'a new conflict queues an owner alert');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
select public.audit_conflict_resolve((select id from public.audit_conflicts where code = 'A1' and a_round_id = (select v from ids where k = 'r2')), 'b', 'round 1 recount was on the shelf');
select pg_temp.refused(format($q$select public.audit_finalize(%L)$q$, (select v from ids where k = 'r2')), 'conflicts_unresolved', 'one unsettled conflict still blocks');
select public.audit_conflict_resolve((select id from public.audit_conflicts where code = 'B1' and a_round_id = (select v from ids where k = 'r2')), 'a', 'this round was recounted twice');
select pg_temp.ok((public.audit_finalize((select v from ids where k = 'r2')) ->> 'conflicts_changed')::int = 1, 'finalize reports one row changed by a conflict choice');
reset role;
select pg_temp.refused(format($q$select public.audit_conflict_resolve(%L, 'a', 'too late')$q$, (select id from public.audit_conflicts where code = 'A1' and a_round_id = (select v from ids where k = 'r2'))), 'conflict_resolved', 'a settled conflict stays settled after the final');
select pg_temp.ok((select l.counted_qty = 7 and l.final_qty = 6 and l.variance = -4 and l.variance_value = -402.00 and l.conflict_side = 'b'
  from public.audit_final_lines l join public.audit_finals f on f.id = l.final_id where f.round_id = (select v from ids where k = 'r2') and l.code = 'A1'),
  'choosing the other side sets the final quantity and keeps the original count');
select pg_temp.ok((select l.counted_qty = 5 and l.final_qty = 5 and l.variance = -3 and l.variance_value = -165.00 and l.conflict_side = 'a'
  from public.audit_final_lines l join public.audit_finals f on f.id = l.final_id where f.round_id = (select v from ids where k = 'r2') and l.code = 'B1'),
  'choosing this side keeps the count');

-- ── reads ──
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
select pg_temp.ok((public.audit_final_overview((select v from ids where k = 'r2')) -> 'final' ->> 'variance_count')::int = 2, 'a member with audit.view reads the overview');
select pg_temp.ok(jsonb_array_length(public.audit_final_overview((select v from ids where k = 'r2')) -> 'conflicts') = 2, 'the overview lists the conflict choices');
select pg_temp.ok((select count(*) from public.audit_final_lines_page((select v from ids where k = 'r2'), true)) = 2, 'the lines page lists the differing rows');
select pg_temp.ok((select count(*) from public.audit_final_lines_page((select v from ids where k = 'r2'), false, 1, 1)) = 1 and
  (select max(total) from public.audit_final_lines_page((select v from ids where k = 'r2'), false, 1, 1)) = 2, 'paging returns one row and the total');
select pg_temp.ok(jsonb_array_length(public.audit_report_engagement((select v from ids where k = 'eng')) -> 'rounds') = 2, 'the audit report lists both rounds');
select pg_temp.ok((public.audit_report_engagement((select v from ids where k = 'eng')) -> 'rounds' -> 0 ->> 'final_variance_count') is not null, 'and the final totals');
select pg_temp.refused(format($q$select public.audit_trail(%L)$q$, (select v from ids where k = 'eng')), 'not_allowed', 'audit.view alone does not open the trail');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d2');
select pg_temp.refused(format($q$select public.audit_final_overview(%L)$q$, (select v from ids where k = 'r2')), 'not_allowed', 'a person who is not a member sees nothing, even with audit.report');
select pg_temp.refused(format($q$select * from public.audit_final_lines_page(%L)$q$, (select v from ids where k = 'r2')), 'not_allowed', 'nor the lines');
select pg_temp.refused(format($q$select public.audit_report_engagement(%L)$q$, (select v from ids where k = 'eng')), 'not_allowed', 'nor the report');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select pg_temp.refused(format($q$select public.audit_final_overview(%L)$q$, (select v from ids where k = 'r2')), 'not_allowed', 'a counter cannot read the final overview');
select pg_temp.refused(format($q$select public.audit_trail(%L)$q$, (select v from ids where k = 'eng')), 'not_allowed', 'a counter cannot read the trail');
select pg_temp.ok((select count(*) from public.audit_finals) = 0, 'a counter cannot select the snapshot directly');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
select public.audit_member_set((select v from ids where k = 'eng'), '00000000-0000-0000-0000-0000000000d2', 'observer');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d2');
select pg_temp.ok(jsonb_array_length(public.audit_trail((select v from ids where k = 'eng')) -> 'rows') > 5, 'a member with audit.report reads the trail');
select pg_temp.ok(exists (select 1 from jsonb_array_elements(public.audit_trail((select v from ids where k = 'eng')) -> 'rows') x where x ->> 'action' = 'audit.finalized'), 'the trail shows the final');
select pg_temp.ok(jsonb_array_length(public.audit_trail((select v from ids where k = 'eng'), 2) -> 'rows') = 2, 'the trail honours its limit');
select pg_temp.ok((select min((x ->> 'id')::bigint) from jsonb_array_elements(public.audit_trail((select v from ids where k = 'eng'), 2) -> 'rows') x)
  > (select min((x ->> 'id')::bigint) from jsonb_array_elements(public.audit_trail((select v from ids where k = 'eng'), 50) -> 'rows') x), 'newest first, and the cursor pages back');
reset role;

-- ── other rows are not in this audit's trail ──
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
select pg_temp.ok(not exists (select 1 from jsonb_array_elements(public.audit_trail((select v from ids where k = 'eng'), 200) -> 'rows') x where x ->> 'action' not like 'audit.%'), 'only audit actions appear');
reset role;
rollback;
select 'pass: 0409 complete';
