-- Tests for 0407_audit_review_followup (Audit slice B1). Invented people and products only.
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
insert into ids select 'eng', public.audit_engagement_create('70000000-0000-0000-0000-000000000001', 'Review audit', 'full');
select public.audit_member_set((select v from ids where k = 'eng'), '00000000-0000-0000-0000-0000000000d1', 'deputy');
insert into ids select 'r1', public.audit_round_create('70000000-0000-0000-0000-000000000002', (select v from ids where k = 'eng'), 'item',
  '{"codes": ["A1", "A2", "B1", "C1", "C2", "D1"]}');
select public.audit_assign_auto((select v from ids where k = 'r1'), array['00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000c2']::uuid[], 'volume');
select public.audit_round_lock((select v from ids where k = 'r1'));
select public.audit_round_start((select v from ids where k = 'r1'));
reset role;
insert into ids select 'a1', id from public.audit_assignments where auditor_id = '00000000-0000-0000-0000-0000000000c1' and round_id = (select v from ids where k = 'r1');
insert into ids select 'a2', id from public.audit_assignments where auditor_id = '00000000-0000-0000-0000-0000000000c2' and round_id = (select v from ids where k = 'r1');

-- ── Force Submit ──
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select pg_temp.count_all((select v from ids where k = 'a1'), 1);
select public.audit_submit((select v from ids where k = 'a1'));
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c2');
select pg_temp.refused(format($q$select public.audit_force_submit(%L, 'match', 'because')$q$, (select v from ids where k = 'a2')), 'not_allowed', 'a counter cannot force submit');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
select pg_temp.refused(format($q$select public.audit_force_submit(%L, 'match', 'because')$q$, (select v from ids where k = 'a2')), 'not_allowed', 'a deputy cannot force submit');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
select pg_temp.refused(format($q$select public.audit_force_submit(%L, 'bad', 'because')$q$, (select v from ids where k = 'a2')), 'invalid_mode', 'the mode must be as_counted or match');
select pg_temp.refused(format($q$select public.audit_force_submit(%L, 'match', ' ')$q$, (select v from ids where k = 'a2')), 'reason_required', 'a reason is required');
select pg_temp.refused(format($q$select public.audit_force_submit(%L, 'match', 'because')$q$, (select v from ids where k = 'a1')), 'assignment_submitted', 'a submitted assignment cannot be forced');
select pg_temp.ok((public.audit_force_submit((select v from ids where k = 'a2'), 'match', 'counter unreachable') ->> 'matched')::int
  = (select count(*) from public.audit_assignment_items where assignment_id = (select v from ids where k = 'a2')), 'match mode records every uncounted item as matching');
select pg_temp.refused(format($q$select public.audit_force_submit(%L, 'match', 'again')$q$, (select v from ids where k = 'a2')), 'assignment_submitted', 'forcing twice is refused');
reset role;
select pg_temp.ok((select forced from public.audit_submissions where assignment_id = (select v from ids where k = 'a2')), 'the submission is marked forced');
select pg_temp.ok((select bool_and(auto_matched) from public.audit_submission_lines l join public.audit_submissions s on s.id = l.submission_id
  where s.assignment_id = (select v from ids where k = 'a2')), 'forced rows stay marked auto-matched');
select pg_temp.ok(exists (select 1 from public.activity_log where action = 'audit.force_submitted' and reason = 'counter unreachable'), 'force submit is logged with its reason');

-- ── compile, then corrections ──
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
select public.audit_compile_round((select v from ids where k = 'r1'));
reset role;
insert into ids select 'a1item', cr.round_item_id from public.audit_compiled_rows cr join public.audit_compilations c on c.id = cr.compilation_id
  where c.round_id = (select v from ids where k = 'r1') and cr.code = 'A1';
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select pg_temp.refused(format($q$select public.audit_correction_propose(%L, %L, 9, 'recount')$q$, (select v from ids where k = 'r1'), (select v from ids where k = 'a1item')), 'not_allowed', 'a counter cannot propose a correction');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
select pg_temp.refused(format($q$select public.audit_correction_propose(%L, %L, -1, 'recount')$q$, (select v from ids where k = 'r1'), (select v from ids where k = 'a1item')), 'invalid_qty', 'a negative quantity is refused');
select pg_temp.refused(format($q$select public.audit_correction_propose(%L, gen_random_uuid(), 9, 'recount')$q$, (select v from ids where k = 'r1')), 'item_not_in_round', 'the item must be in the round');
select pg_temp.refused(format($q$select public.audit_correction_propose(%L, %L, 9, '')$q$, (select v from ids where k = 'r1'), (select v from ids where k = 'a1item')), 'reason_required', 'a reason is required');
insert into ids select 'corr', public.audit_correction_propose((select v from ids where k = 'r1'), (select v from ids where k = 'a1item'), 6, 'recounted on the shelf');
select pg_temp.refused(format($q$select public.audit_correction_propose(%L, %L, 8, 'again')$q$, (select v from ids where k = 'r1'), (select v from ids where k = 'a1item')), 'correction_pending', 'one proposal at a time per item');
select pg_temp.refused(format($q$select public.audit_correction_decide(%L, true)$q$, (select v from ids where k = 'corr')), 'not_allowed', 'a deputy cannot decide');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
select pg_temp.refused(format($q$select public.audit_correction_decide(%L, false)$q$, (select v from ids where k = 'corr')), 'reason_required', 'a rejection needs a reason');
select pg_temp.ok((public.audit_correction_decide((select v from ids where k = 'corr'), true) ->> 'status') = 'approved', 'the owner can approve');
select pg_temp.refused(format($q$select public.audit_correction_decide(%L, true)$q$, (select v from ids where k = 'corr')), 'correction_decided', 'a decided correction cannot be decided again');
reset role;
select pg_temp.ok((select counted_qty from public.audit_compiled_rows cr join public.audit_compilations c on c.id = cr.compilation_id
  where c.round_id = (select v from ids where k = 'r1') and cr.code = 'A1' and c.revision = 1) <> 6, 'an approved correction does not change the compiled result by itself');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
select pg_temp.ok((public.audit_compile_round((select v from ids where k = 'r1')) ->> 'revision')::int = 2, 'recompiling makes revision 2');
reset role;
select pg_temp.ok((select counted_qty from public.audit_compiled_rows cr join public.audit_compilations c on c.id = cr.compilation_id
  where c.round_id = (select v from ids where k = 'r1') and cr.code = 'A1' and c.revision = 2) = 6, 'the next compile applies the approved correction');
select pg_temp.ok((select corrected_by is not null from public.audit_compiled_rows cr join public.audit_compilations c on c.id = cr.compilation_id
  where c.round_id = (select v from ids where k = 'r1') and cr.code = 'A1' and c.revision = 2), 'and shows who approved it');
select pg_temp.ok((select count(*) from public.audit_compilations where round_id = (select v from ids where k = 'r1')) = 2, 'revision 1 is still kept');

-- ── follow-up rounds ──
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
select pg_temp.refused(format($q$select public.audit_round_next(gen_random_uuid(), %L, 'differences')$q$, (select v from ids where k = 'r1')), 'not_allowed', 'a deputy cannot make the next round');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
select pg_temp.refused(format($q$select public.audit_round_next(gen_random_uuid(), %L, 'nope')$q$, (select v from ids where k = 'r1')), 'invalid_mode', 'the mode must be a known one');
select pg_temp.refused(format($q$select public.audit_round_next(gen_random_uuid(), %L, 'spot', 0)$q$, (select v from ids where k = 'r1')), 'invalid_sample', 'a spot check needs a sample size');
insert into ids select 'r1a', (public.audit_round_next('71000000-0000-0000-0000-000000000001', (select v from ids where k = 'r1'), 'differences') ->> 'round_id')::uuid;
select pg_temp.ok((public.audit_round_next('71000000-0000-0000-0000-000000000001', (select v from ids where k = 'r1'), 'differences') ->> 'replay')::boolean, 'the same key makes no second round');
reset role;
select pg_temp.ok((select round_suffix from public.audit_rounds where id = (select v from ids where k = 'r1a')) = 'A', 'the first follow-up is 1A');
select pg_temp.ok((select count(*) from public.audit_round_items where round_id = (select v from ids where k = 'r1a'))
  = (select count(*) from public.audit_compiled_rows cr join public.audit_compilations c on c.id = cr.compilation_id
     where c.round_id = (select v from ids where k = 'r1') and c.revision = 2 and cr.variance <> 0), 'differences mode carries exactly the differing items');
select pg_temp.ok((select bool_and(prev_variance <> 0 and source_item_id is not null) from public.audit_round_items where round_id = (select v from ids where k = 'r1a')), 'each carries its earlier difference and its source item');
select pg_temp.ok((select state from public.audit_rounds where id = (select v from ids where k = 'r1a')) = 'draft', 'the new round starts as a draft');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
select pg_temp.refused(format($q$select public.audit_round_next(gen_random_uuid(), %L, 'differences')$q$, (select v from ids where k = 'r1a')), 'round_not_compiled', 'only a compiled round can lead to the next');
insert into ids select 'r1b', (public.audit_round_next(gen_random_uuid(), (select v from ids where k = 'r1'), 'company') ->> 'round_id')::uuid;
insert into ids select 'r1c', (public.audit_round_next(gen_random_uuid(), (select v from ids where k = 'r1'), 'spot', 3, 'fixed-seed') ->> 'round_id')::uuid;
insert into ids select 'r1d', (public.audit_round_next(gen_random_uuid(), (select v from ids where k = 'r1'), 'spot', 3, 'fixed-seed') ->> 'round_id')::uuid;
reset role;
select pg_temp.ok((select count(*) from public.audit_round_items where round_id = (select v from ids where k = 'r1b'))
  = (select count(*) from public.audit_compiled_rows cr join public.audit_compilations c on c.id = cr.compilation_id
     where c.round_id = (select v from ids where k = 'r1') and c.revision = 2
       and cr.company in (select x.company from public.audit_compiled_rows x where x.compilation_id = c.id and x.variance <> 0)), 'company mode carries every item of a company with a difference');
select pg_temp.ok((select count(*) from public.audit_round_items where round_id = (select v from ids where k = 'r1c')) = 3, 'a spot check draws the sample size');
select pg_temp.ok((select array_agg(code order by code) from public.audit_round_items where round_id = (select v from ids where k = 'r1c'))
  = (select array_agg(code order by code) from public.audit_round_items where round_id = (select v from ids where k = 'r1d')), 'the same seed draws the same items');
select pg_temp.ok((select array_agg(round_suffix order by round_suffix) from public.audit_rounds where engagement_id = (select v from ids where k = 'eng') and round_suffix is not null) = array['A', 'B', 'C', 'D'], 'letters run A, B, C, D');
select pg_temp.ok((select spot_seed from public.audit_rounds where id = (select v from ids where k = 'r1c')) = 'fixed-seed', 'the seed is stored');

-- ── conflicts ──
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
select public.audit_assign_auto((select v from ids where k = 'r1a'), array['00000000-0000-0000-0000-0000000000c2']::uuid[], 'volume');
select public.audit_round_lock((select v from ids where k = 'r1a'));
select public.audit_round_start((select v from ids where k = 'r1a'));
reset role;
insert into ids select 'a1a', id from public.audit_assignments where round_id = (select v from ids where k = 'r1a');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c2');
select pg_temp.count_all((select v from ids where k = 'a1a'), 3);
select public.audit_submit((select v from ids where k = 'a1a'));
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
select pg_temp.ok((public.audit_compile_round((select v from ids where k = 'r1a')) ->> 'conflicts')::int
  = (select count(*) from public.audit_round_items where round_id = (select v from ids where k = 'r1a')), 'recounting differently makes a conflict for every item');
reset role;
insert into ids select 'k1', k.id from public.audit_conflicts k join public.audit_compilations c on c.id = k.compilation_id
  where c.round_id = (select v from ids where k = 'r1a') order by k.code limit 1;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
select pg_temp.refused(format($q$select public.audit_conflict_resolve(%L, 'a', 'because')$q$, (select v from ids where k = 'k1')), 'not_allowed', 'a deputy cannot settle a conflict');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
select pg_temp.refused(format($q$select public.audit_conflict_resolve(%L, 'x', 'because')$q$, (select v from ids where k = 'k1')), 'invalid_side', 'the side must be a or b');
select pg_temp.refused(format($q$select public.audit_conflict_resolve(%L, 'a', '')$q$, (select v from ids where k = 'k1')), 'reason_required', 'a reason is required');
select public.audit_conflict_resolve((select v from ids where k = 'k1'), 'a', 'the recount was done twice');
select pg_temp.refused(format($q$select public.audit_conflict_resolve(%L, 'b', 'changed my mind')$q$, (select v from ids where k = 'k1')), 'conflict_resolved', 'a settled conflict is not changed');
select public.audit_compile_round((select v from ids where k = 'r1a'));
reset role;
select pg_temp.ok((select count(*) from public.audit_conflicts k join public.audit_compilations c on c.id = k.compilation_id
  where c.round_id = (select v from ids where k = 'r1a') and c.revision = 2 and k.resolved_side = 'a') = 1, 'recompiling carries the choice over when the counts are the same');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
select public.audit_compile_round((select v from ids where k = 'r1'));
reset role;
select pg_temp.ok((select count(*) from public.audit_conflicts k join public.audit_compilations c on c.id = k.compilation_id
  where c.round_id = (select v from ids where k = 'r1') and c.revision = 3 and k.resolved_side = 'b' and k.resolved_reason = 'the recount was done twice') = 1,
  'compiling the other round carries it over with the sides swapped');

-- ── the review read ──
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
select pg_temp.ok(jsonb_array_length(public.audit_compile_overview((select v from ids where k = 'r1')) -> 'assignments') = 2, 'the owner sees both assignments');
select pg_temp.ok((public.audit_compile_overview((select v from ids where k = 'r1')) -> 'assignments' -> 0 ->> 'name') = 'Count One', 'with their names');
select pg_temp.ok((public.audit_compile_overview((select v from ids where k = 'r1')) -> 'compilation' ->> 'revision')::int = 3, 'the newest compilation is shown');
select pg_temp.ok(jsonb_array_length(public.audit_compile_overview((select v from ids where k = 'r1')) -> 'history') = 3, 'and the history lists every revision');
select pg_temp.ok(jsonb_array_length(public.audit_compile_overview((select v from ids where k = 'r1')) -> 'corrections') = 1, 'corrections are listed');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
select pg_temp.ok((public.audit_compile_overview((select v from ids where k = 'r1')) -> 'round' ->> 'state') = 'compiled', 'a deputy added to the engagement can read it');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select pg_temp.refused(format($q$select public.audit_compile_overview(%L)$q$, (select v from ids where k = 'r1')), 'not_allowed', 'a counter cannot read the review');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d2');
select pg_temp.fails(format($q$select public.audit_compile_overview(%L)$q$, (select v from ids where k = 'r1')), 'someone outside the engagement cannot read it');
reset role;
rollback;
