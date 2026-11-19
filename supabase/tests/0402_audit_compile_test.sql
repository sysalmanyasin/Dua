-- Tests for 0402_audit_counting_compile (Audit slice A2). Invented people and products only.
-- Part 1 runs every shared fixture case (tests/fixtures/audit/compile-cases.json) through the real functions:
-- the same cases the browser maths in js/modules/audit/domain/compile.js runs, so both must agree to the paisa.
-- Part 2 proves counting, submission, reopen, recompile, immutability and who may see what.
\set ON_ERROR_STOP on
\set cases `cat ../../tests/fixtures/audit/compile-cases.json`
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
create function pg_temp.fails(sql text, msg text, part text default null) returns void language plpgsql as $$
begin
  begin execute sql; exception when others then
    if part is not null and sqlerrm not like '%' || part || '%' then raise exception 'FAIL (wrong error "%"): %', sqlerrm, msg; end if;
    raise notice 'pass (refused): %', msg; return;
  end;
  raise exception 'FAIL (was allowed): %', msg;
end $$;

insert into auth.users (id, email) values
 ('00000000-0000-0000-0000-0000000000a1', 'owner@t'), ('00000000-0000-0000-0000-0000000000d1', 'dep1@t'),
 ('00000000-0000-0000-0000-0000000000d2', 'dep2@t'), ('00000000-0000-0000-0000-0000000000c1', 'c1@t'),
 ('00000000-0000-0000-0000-0000000000c2', 'c2@t');
select public.bootstrap_first_admin('00000000-0000-0000-0000-0000000000a1', 'owner', 'Test Owner');
insert into public.staff (id, full_name) values
 ('10000000-0000-0000-0000-0000000000d1', 'Dep One'), ('10000000-0000-0000-0000-0000000000d2', 'Dep Two'),
 ('10000000-0000-0000-0000-0000000000c1', 'Count One'), ('10000000-0000-0000-0000-0000000000c2', 'Count Two');
insert into public.profiles (user_id, staff_id, username, role_template) values
 ('00000000-0000-0000-0000-0000000000d1', '10000000-0000-0000-0000-0000000000d1', 'dep1', 'senior'),
 ('00000000-0000-0000-0000-0000000000d2', '10000000-0000-0000-0000-0000000000d2', 'dep2', 'senior'),
 ('00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-0000000000c1', 'count1', 'junior'),
 ('00000000-0000-0000-0000-0000000000c2', '10000000-0000-0000-0000-0000000000c2', 'count2', 'junior');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
select public.set_user_permission('00000000-0000-0000-0000-0000000000d1', 'audit.view', 'grant', 'test');
select public.set_user_permission('00000000-0000-0000-0000-0000000000d1', 'audit.review', 'grant', 'test');
select public.set_user_permission('00000000-0000-0000-0000-0000000000d2', 'audit.view', 'grant', 'test');
reset role;

-- test-only stand-in for the Inventory interface: it serves whatever the test put into fx_items
create table public.fx_items (scope text, ord int, code text, name text, company text, qty numeric, price numeric);
create or replace function public.inventory_products_for_scope(p_scope jsonb)
returns table (code text, name text, company text, qty numeric, price numeric) language sql as $$
  select f.code, f.name, f.company, f.qty, f.price from public.fx_items f where f.scope = p_scope ->> 'fx' order by f.ord $$;

-- ───────── part 1: the shared cases ─────────
create function pg_temp.run_cases(p_cases jsonb) returns void language plpgsql as $$
declare
  c jsonb; rd jsonb; asg jsonb; sub jsonb; ev jsonb; w jsonb; k text; kk int; n int := 0; m int;
  owner uuid := '00000000-0000-0000-0000-0000000000a1'; eng uuid; rid uuid; aid uuid; v_aud uuid; v_item uuid;
  res jsonb; h text; scope text; ver int; got record;
begin
  for c in select x from jsonb_array_elements(p_cases -> 'cases') x loop
    n := n + 1; m := 0;
    perform pg_temp.as_user(owner, 'aal2');
    eng := public.audit_engagement_create(gen_random_uuid(), 'Case ' || n, 'full');
    reset role;
    for rd in select x from jsonb_array_elements(c -> 'rounds') x loop
      m := m + 1; scope := n || '-' || m;
      insert into public.fx_items (scope, ord, code, name, company, qty, price)
        select scope, (i.ord)::int, i.it ->> 'code', i.it ->> 'name', i.it ->> 'company', (i.it ->> 'qty')::numeric, ((i.it ->> 'price_paisa')::numeric) / 100
        from jsonb_array_elements(rd -> 'items') with ordinality i(it, ord);
      perform pg_temp.as_user(owner, 'aal2');
      rid := public.audit_round_create(gen_random_uuid(), eng, 'company', jsonb_build_object('fx', scope));
      reset role;
      -- assignments are set up directly (their own functions are tested in 0401)
      for asg in select x from jsonb_array_elements(rd -> 'assignments') x loop
        v_aud := case asg ->> 'auditor' when 'c1' then '00000000-0000-0000-0000-0000000000c1'::uuid else '00000000-0000-0000-0000-0000000000c2'::uuid end;
        insert into public.audit_assignments (round_id, engagement_id, auditor_id, created_by) values (rid, eng, v_aud, owner) returning id into aid;
        insert into public.audit_assignment_items (assignment_id, round_id, engagement_id, round_item_id)
          select aid, rid, eng, ri.id from jsonb_array_elements_text(asg -> 'items') ix
          join public.audit_round_items ri on ri.round_id = rid and ri.name = (rd -> 'items' -> (ix.value)::int ->> 'name');
      end loop;
      perform pg_temp.as_user(owner, 'aal2');
      perform public.audit_round_lock(rid);
      perform public.audit_round_start(rid);
      reset role;
      for asg in select x from jsonb_array_elements(rd -> 'assignments') x loop
        v_aud := case asg ->> 'auditor' when 'c1' then '00000000-0000-0000-0000-0000000000c1'::uuid else '00000000-0000-0000-0000-0000000000c2'::uuid end;
        select id into aid from public.audit_assignments where round_id = rid and auditor_id = v_aud;
        kk := 0;
        for sub in select x from jsonb_array_elements(asg -> 'submissions') x loop
          kk := kk + 1;
          if kk > 1 then
            perform pg_temp.as_user(owner, 'aal2'); perform public.audit_reopen(aid, 'fixture: second revision'); reset role;
          end if;
          ev := '[]'::jsonb;
          for k in select jsonb_object_keys(coalesce(sub -> 'counts', '{}'::jsonb)) loop
            select id into v_item from public.audit_round_items where round_id = rid and name = (rd -> 'items' -> (k)::int ->> 'name');
            ev := ev || jsonb_build_array(jsonb_build_object('event_id', gen_random_uuid(), 'item', v_item, 'qty', sub -> 'counts' -> k));
          end loop;
          for k in select jsonb_array_elements_text(coalesce(sub -> 'auto', '[]'::jsonb)) loop
            select id into v_item from public.audit_round_items where round_id = rid and name = (rd -> 'items' -> (k)::int ->> 'name');
            ev := ev || jsonb_build_array(jsonb_build_object('event_id', gen_random_uuid(), 'item', v_item, 'auto', true, 'qty', 999));
          end loop;
          perform pg_temp.as_user(v_aud);
          perform public.audit_count_batch(aid, ev);
          perform public.audit_submit(aid, sub ->> 'extraNote');
          reset role;
        end loop;
      end loop;
      for k in select jsonb_object_keys(coalesce(rd -> 'corrections', '{}'::jsonb)) loop
        select id into v_item from public.audit_round_items where round_id = rid and name = (rd -> 'items' -> (k)::int ->> 'name');
        insert into public.audit_corrections (round_id, engagement_id, round_item_id, counted_qty, status, proposed_by, decided_by, decided_at)
          values (rid, eng, v_item, (rd -> 'corrections' ->> k)::numeric, 'approved', owner, owner, now());
      end loop;

      w := rd -> 'expect';
      perform pg_temp.as_user(owner, 'aal2');
      if w ? 'refused' then
        begin
          perform public.audit_compile_round(rid, coalesce((rd ->> 'allowMissing')::boolean, false));
          raise exception 'FAIL: case "%" compiled but should have been refused', c ->> 'name';
        exception when others then
          get stacked diagnostics h = pg_exception_hint;
          if h is distinct from (w ->> 'refused') then raise exception 'FAIL: case "%" refused with "%" not "%"', c ->> 'name', h, w ->> 'refused'; end if;
        end;
        reset role;
        raise notice 'pass (refused with %): %', w ->> 'refused', c ->> 'name';
        continue;
      end if;
      res := public.audit_compile_round(rid, coalesce((rd ->> 'allowMissing')::boolean, false));
      reset role;
      for ev in select x from jsonb_array_elements(w -> 'rows') x loop
        select r.* into got from public.audit_compiled_rows r
          where r.compilation_id = (res ->> 'compilation_id')::uuid and r.name = (rd -> 'items' -> (ev ->> 'item')::int ->> 'name');
        if got.counted_qty is distinct from (ev ->> 'counted')::numeric or got.variance is distinct from (ev ->> 'variance')::numeric
           or got.variance_value * 100 is distinct from (ev ->> 'value_paisa')::numeric or got.missing is distinct from (ev ->> 'missing')::boolean
           or got.auto_matched is distinct from (ev ->> 'auto')::boolean or (got.corrected_by is not null) is distinct from (ev ->> 'corrected')::boolean then
          raise exception 'FAIL: case "%" item %: got counted %, variance %, value %, missing %, auto %, corrected %', c ->> 'name', ev ->> 'item',
            got.counted_qty, got.variance, got.variance_value, got.missing, got.auto_matched, got.corrected_by is not null;
        end if;
      end loop;
      if (res ->> 'variances')::int <> (w ->> 'variances')::int then raise exception 'FAIL: case "%" variances % wanted %', c ->> 'name', res ->> 'variances', w ->> 'variances'; end if;
      if (res ->> 'variance_value')::numeric * 100 <> (w ->> 'value_paisa')::numeric then raise exception 'FAIL: case "%" value % wanted % paisa', c ->> 'name', res ->> 'variance_value', w ->> 'value_paisa'; end if;
      if (res ->> 'with_missing')::boolean <> (w ->> 'withMissing')::boolean then raise exception 'FAIL: case "%" with_missing', c ->> 'name'; end if;
      if jsonb_array_length(res -> 'missing_assignments') <> (w ->> 'missingAssignments')::int then raise exception 'FAIL: case "%" missing assignments', c ->> 'name'; end if;
      if (res ->> 'conflicts')::int <> (w ->> 'conflicts')::int then raise exception 'FAIL: case "%" conflicts % wanted %', c ->> 'name', res ->> 'conflicts', w ->> 'conflicts'; end if;
      if w ? 'notes' and (select jsonb_array_length(auditor_notes) from public.audit_compilations where id = (res ->> 'compilation_id')::uuid) <> (w ->> 'notes')::int then
        raise exception 'FAIL: case "%" notes', c ->> 'name';
      end if;
    end loop;
    raise notice 'pass: %', c ->> 'name';
  end loop;
end $$;
select pg_temp.run_cases(:'cases'::jsonb);

-- ───────── part 2: counting, submission, reopen, recompile, visibility ─────────
create temp table ids (k text primary key, v uuid);
grant all on ids to authenticated, anon;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
insert into ids select 'eng', public.audit_engagement_create('70000000-0000-0000-0000-000000000001', 'Hand audit', 'full');
select public.audit_member_set((select v from ids where k = 'eng'), '00000000-0000-0000-0000-0000000000d1', 'deputy');
reset role;
insert into public.fx_items values ('h', 1, 'H1', 'Hand one', 'Hand', 10, 2.00), ('h', 2, 'H2', 'Hand two', 'Hand', 5, 4.00),
  ('h', 3, 'H3', 'Hand three', 'Other', 8, 1.00);
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
insert into ids select 'r', public.audit_round_create('70000000-0000-0000-0000-000000000002', (select v from ids where k = 'eng'), 'company', '{"fx":"h"}');
reset role;
insert into public.audit_assignments (round_id, engagement_id, auditor_id, created_by)
  select (select v from ids where k = 'r'), (select v from ids where k = 'eng'), u, '00000000-0000-0000-0000-0000000000a1'
  from (values ('00000000-0000-0000-0000-0000000000c1'::uuid), ('00000000-0000-0000-0000-0000000000c2'::uuid)) t(u);
insert into public.audit_assignment_items (assignment_id, round_id, engagement_id, round_item_id)
  select a.id, a.round_id, a.engagement_id, ri.id from public.audit_assignments a join public.audit_round_items ri on ri.round_id = a.round_id
  where (a.auditor_id = '00000000-0000-0000-0000-0000000000c1' and ri.company = 'Hand') or (a.auditor_id = '00000000-0000-0000-0000-0000000000c2' and ri.company = 'Other');
insert into ids select 'a1', id from public.audit_assignments where auditor_id = '00000000-0000-0000-0000-0000000000c1' and round_id = (select v from ids where k = 'r');
insert into ids select 'a2', id from public.audit_assignments where auditor_id = '00000000-0000-0000-0000-0000000000c2' and round_id = (select v from ids where k = 'r');
insert into ids select 'i1', id from public.audit_round_items where name = 'Hand one' and round_id = (select v from ids where k = 'r');
insert into ids select 'i2', id from public.audit_round_items where name = 'Hand two' and round_id = (select v from ids where k = 'r');
insert into ids select 'i3', id from public.audit_round_items where name = 'Hand three' and round_id = (select v from ids where k = 'r');

-- before counting opens
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select pg_temp.refused(format($q$select public.audit_count_batch(%L, '[]')$q$, (select v from ids where k = 'a1')), 'round_not_counting', 'counting is refused before the round starts');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
select pg_temp.refused(format($q$select public.audit_round_start(%L)$q$, (select v from ids where k = 'r')), 'round_not_locked', 'a draft round cannot start');
select public.audit_round_lock((select v from ids where k = 'r'));
select pg_temp.refused(format($q$select public.audit_compile_round(%L)$q$, (select v from ids where k = 'r')), 'round_not_compilable', 'a locked round cannot be compiled');
select public.audit_round_start((select v from ids where k = 'r'));
reset role;

-- who may count
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c2');
select pg_temp.refused(format($q$select public.audit_count_batch(%L, '[]')$q$, (select v from ids where k = 'a1')), 'not_allowed', 'another counter cannot count my assignment');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
select pg_temp.refused(format($q$select public.audit_count_batch(%L, '[]')$q$, (select v from ids where k = 'a1')), 'not_allowed', 'a deputy who is not the assigned counter cannot count');
reset role;
set local role anon;
select pg_temp.fails(format($q$select public.audit_count_batch(%L, '[]')$q$, (select v from ids where k = 'a1')), 'anon cannot count', 'permission denied');
reset role;

-- count batch rules
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select pg_temp.refused(format($q$select public.audit_count_batch(%L, jsonb_build_array(jsonb_build_object('event_id', gen_random_uuid(), 'item', %L, 'qty', 1)))$q$,
  (select v from ids where k = 'a1'), (select v from ids where k = 'i3')), 'item_not_assigned', 'an item outside my assignment is refused');
select pg_temp.refused(format($q$select public.audit_count_batch(%L, jsonb_build_array(jsonb_build_object('event_id', gen_random_uuid(), 'item', %L, 'qty', -1)))$q$,
  (select v from ids where k = 'a1'), (select v from ids where k = 'i1')), 'invalid_qty', 'a negative quantity is refused');
select pg_temp.refused(format($q$select public.audit_count_batch(%L, jsonb_build_array(jsonb_build_object('event_id', gen_random_uuid(), 'item', %L)))$q$,
  (select v from ids where k = 'a1'), (select v from ids where k = 'i1')), 'invalid_qty', 'a count with no quantity is refused');
select pg_temp.refused(format($q$select public.audit_count_batch(%L, jsonb_build_array(jsonb_build_object('item', %L, 'qty', 1)))$q$,
  (select v from ids where k = 'a1'), (select v from ids where k = 'i1')), 'invalid_events', 'an event with no id is refused');
select pg_temp.refused(format($q$select public.audit_count_batch(%L, (select jsonb_agg(jsonb_build_object('event_id', gen_random_uuid(), 'item', %L, 'qty', 1)) from generate_series(1, 501)))$q$,
  (select v from ids where k = 'a1'), (select v from ids where k = 'i1')), 'batch_too_large', 'a batch over 500 events is refused');
select pg_temp.ok((select count(*) from public.audit_count_events where round_id = (select v from ids where k = 'r')) = 0, 'refused batches left nothing behind');
reset role;

select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
insert into ids select 'batch1', gen_random_uuid();
select public.audit_count_batch((select v from ids where k = 'a1'), jsonb_build_array(
  jsonb_build_object('event_id', (select v from ids where k = 'batch1'), 'item', (select v from ids where k = 'i1'), 'qty', 7, 'row_seconds', 5000, 'note', 'dusty')));
select pg_temp.ok((select (public.audit_count_batch((select v from ids where k = 'a1'), jsonb_build_array(
  jsonb_build_object('event_id', (select v from ids where k = 'batch1'), 'item', (select v from ids where k = 'i1'), 'qty', 7))) ->> 'duplicates')::int) = 1,
  'replaying an event reports a duplicate');
select pg_temp.ok((select count(*) from public.audit_count_events where round_id = (select v from ids where k = 'r')) = 1, 'a replayed event is stored once');
select pg_temp.ok((select row_seconds from public.audit_count_events where round_id = (select v from ids where k = 'r')) = 600, 'row time is capped at 600 seconds');
select pg_temp.ok((select status from public.audit_assignments where id = (select v from ids where k = 'a1')) = 'counting', 'the first batch moves the assignment to counting');
-- a later count of the same item replaces the earlier one; an auto-match takes the system quantity whatever the client sends
select public.audit_count_batch((select v from ids where k = 'a1'), jsonb_build_array(
  jsonb_build_object('event_id', gen_random_uuid(), 'item', (select v from ids where k = 'i1'), 'qty', 9),
  jsonb_build_object('event_id', gen_random_uuid(), 'item', (select v from ids where k = 'i2'), 'auto', true, 'qty', 999)));
select pg_temp.ok((select qty from public.audit_count_events where round_item_id = (select v from ids where k = 'i2')) = 5, 'an auto-match takes the system quantity on the server');
select pg_temp.ok((select count(*) from public.audit_count_events where round_id = (select v from ids where k = 'r')) = 3, 'every count is kept as its own event');
reset role;
select pg_temp.fails($q$update public.audit_count_events set qty = 1$q$, 'a count event cannot be updated (even by the database owner)', 'never change');
select pg_temp.fails($q$delete from public.audit_count_events$q$, 'a count event cannot be deleted', 'never change');

-- compile with one assignment still counting
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
select pg_temp.refused(format($q$select public.audit_compile_round(%L, true)$q$, (select v from ids where k = 'r')), 'not_allowed', 'a deputy without audit.compile cannot compile');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select public.audit_submit((select v from ids where k = 'a1'), 'one carton not in the system');
select pg_temp.ok((select (public.audit_submit((select v from ids where k = 'a1')) ->> 'replay')::boolean), 'submitting twice returns the first submission');
select pg_temp.ok((select count(*) from public.audit_submissions where round_id = (select v from ids where k = 'r')) = 1, 'a double submit made one submission');
select pg_temp.ok((select count(*) from public.audit_submission_lines l join public.audit_submissions s on s.id = l.submission_id where s.round_id = (select v from ids where k = 'r')) = 2, 'the submission froze the latest count of each touched item');
select pg_temp.ok((select qty from public.audit_submission_lines where round_item_id = (select v from ids where k = 'i1')) = 9, 'the latest count wins');
select pg_temp.ok((select row_seconds from public.audit_submission_lines where round_item_id = (select v from ids where k = 'i1')) = 600, 'row time adds up per item');
select pg_temp.refused(format($q$select public.audit_count_batch(%L, '[]')$q$, (select v from ids where k = 'a1')), 'assignment_submitted', 'a submitted assignment takes no more counts');
reset role;
select pg_temp.fails($q$update public.audit_submission_lines set qty = 1$q$, 'a submission line cannot change', 'never change');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
select pg_temp.refused(format($q$select public.audit_compile_round(%L)$q$, (select v from ids where k = 'r')), 'missing_assignments', 'compile needs the missing choice while a counter has not submitted');
select pg_temp.refused(format($q$select public.audit_compile_round(%L, true, 99)$q$, (select v from ids where k = 'r')), 'version_conflict', 'a stale version is refused');
insert into ids select 'comp1', (public.audit_compile_round((select v from ids where k = 'r'), true) ->> 'compilation_id')::uuid;
select pg_temp.ok((select state from public.audit_rounds where id = (select v from ids where k = 'r')) = 'compiled', 'the round is compiled');
select pg_temp.ok((select with_missing from public.audit_compilations where id = (select v from ids where k = 'comp1')), 'compiling with a missing assignment is stored');
select pg_temp.ok((select auditor_notes -> 0 ->> 'note' from public.audit_compilations where id = (select v from ids where k = 'comp1')) = 'one carton not in the system', 'the auditor note is kept');
-- Hand one: counted 9 of 10 at Rs 2.00 = -2.00; Hand two auto-matched; Hand three uncounted 8 x Rs 1.00 = -8.00
select pg_temp.ok((select variance_value from public.audit_compilations where id = (select v from ids where k = 'comp1')) = -10.00, 'the stored total is the sum of the rows');
reset role;

-- reopen, resubmit, recompile
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
select pg_temp.refused(format($q$select public.audit_reopen(%L, '')$q$, (select v from ids where k = 'a1')), 'reason_required', 'a reopen needs a reason');
select pg_temp.refused(format($q$select public.audit_reopen(%L, 'recount')$q$, (select v from ids where k = 'a2')), 'assignment_not_submitted', 'only a submitted assignment can be reopened');
select public.audit_reopen((select v from ids where k = 'a1'), 'recount the top shelf');
select pg_temp.ok((select state from public.audit_rounds where id = (select v from ids where k = 'r')) = 'counting', 'reopening a compiled round sends it back to counting');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select public.audit_count_batch((select v from ids where k = 'a1'), jsonb_build_array(
  jsonb_build_object('event_id', gen_random_uuid(), 'item', (select v from ids where k = 'i1'), 'qty', 10)));
select pg_temp.ok((public.audit_submit((select v from ids where k = 'a1')) ->> 'revision')::int = 2, 'the resubmission is revision 2');
reset role;
select pg_temp.ok((select count(*) from public.audit_submissions where assignment_id = (select v from ids where k = 'a1')) = 2, 'the original submission is kept');
select pg_temp.ok((select qty from public.audit_submission_lines l join public.audit_submissions s on s.id = l.submission_id
                   where s.assignment_id = (select v from ids where k = 'a1') and s.revision = 1 and l.round_item_id = (select v from ids where k = 'i1')) = 9,
                  'the original count is still readable after the resubmission');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
insert into ids select 'comp2', (public.audit_compile_round((select v from ids where k = 'r'), true) ->> 'compilation_id')::uuid;
select pg_temp.ok((select revision from public.audit_compilations where id = (select v from ids where k = 'comp2')) = 2, 'a recompile is revision 2');
select pg_temp.ok((select count(*) from public.audit_compiled_rows where compilation_id = (select v from ids where k = 'comp1')) = 3, 'the first compilation is kept');
select pg_temp.ok((select counted_qty from public.audit_compiled_rows where compilation_id = (select v from ids where k = 'comp1') and name = 'Hand one') = 9, 'the first compilation still shows the old count');
select pg_temp.ok((select counted_qty from public.audit_compiled_rows where compilation_id = (select v from ids where k = 'comp2') and name = 'Hand one') = 10, 'the new compilation shows the new count');
reset role;
select pg_temp.fails($q$update public.audit_compiled_rows set counted_qty = 1$q$, 'a compiled row cannot change', 'never change');
select pg_temp.fails($q$delete from public.audit_compilations$q$, 'a compilation cannot be deleted', 'never change');

-- who sees results
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select pg_temp.ok((select count(*) from public.audit_compiled_rows where compilation_id = (select v from ids where k = 'comp2')) = 2, 'a counter sees the compiled rows of their own items only');
select pg_temp.ok((select count(*) from public.audit_compilations where round_id = (select v from ids where k = 'r')) = 2, 'a counter sees the compilation header of their round');
select pg_temp.ok((select count(*) from public.audit_conflicts where compilation_id in (select id from public.audit_compilations where round_id = (select v from ids where k = 'r'))) = 0, 'a counter sees no conflicts');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c2');
select pg_temp.ok((select count(*) from public.audit_compiled_rows where compilation_id = (select v from ids where k = 'comp2')) = 1, 'the other counter sees only their own item');
select pg_temp.ok((select count(*) from public.audit_count_events where round_id = (select v from ids where k = 'r')) = 0, 'a counter cannot read another counter''s count events');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
select pg_temp.ok((select count(*) from public.audit_compiled_rows where compilation_id = (select v from ids where k = 'comp2')) = 3, 'a member deputy with view sees every row');
select pg_temp.ok((select count(*) from public.audit_submissions where round_id = (select v from ids where k = 'r')) = 2, 'a member deputy sees the submissions');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d2');
select pg_temp.ok((select count(*) from public.audit_compiled_rows) = 0, 'a deputy who is not a member sees nothing');
select pg_temp.ok((select count(*) from public.audit_count_events) = 0, 'a deputy who is not a member sees no count events');
reset role;

-- direct writes are refused on every new table
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
select pg_temp.fails($q$insert into public.audit_count_events (engagement_id, round_id, assignment_id, round_item_id, counter_id, client_event_id, qty)
  select engagement_id, round_id, id, (select v from ids where k = 'i1'), auditor_id, gen_random_uuid(), 1 from public.audit_assignments limit 1$q$, 'the owner cannot write a count directly', 'permission denied');
select pg_temp.fails($q$insert into public.audit_compilations (round_id, engagement_id, revision, compiled_by, item_count, variance_count, variance_value)
  select id, engagement_id, 9, created_by, 0, 0, 0 from public.audit_rounds limit 1$q$, 'the owner cannot write a compilation directly', 'permission denied');
select pg_temp.fails($q$delete from public.audit_corrections$q$, 'the owner cannot delete corrections directly', 'permission denied');
select pg_temp.fails($q$update public.audit_conflicts set resolved_side = 'a'$q$, 'the owner cannot resolve a conflict directly', 'permission denied');
reset role;

-- a final round cannot be compiled or reopened
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
select pg_temp.ok((select state from public.audit_rounds where id = (select v from ids where k = 'r')) = 'compiled', 'the round is compiled again');
reset role;
update public.audit_rounds set state = 'final' where id = (select v from ids where k = 'r');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
select pg_temp.refused(format($q$select public.audit_compile_round(%L, true)$q$, (select v from ids where k = 'r')), 'round_final', 'a final round cannot be compiled');
select pg_temp.refused(format($q$select public.audit_reopen(%L, 'too late')$q$, (select v from ids where k = 'a1')), 'round_final', 'a final round cannot be reopened');
reset role;

-- activity log
select pg_temp.ok((select count(*) from public.activity_log where action in ('audit.round_started', 'audit.submitted', 'audit.reopened', 'audit.compiled', 'audit.recompiled')) >= 5,
  'start, submit, reopen, compile and recompile were logged');
rollback;
