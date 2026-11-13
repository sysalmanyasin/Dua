-- Tests for 0201_closing_tables. Fixture cases are shared with the browser tests (tests/fixtures/closing-cases.json).
\set ON_ERROR_STOP on
\set cases `cat ../../tests/fixtures/closing-cases.json`
begin;
create function pg_temp.as_user(uid uuid, lvl text default 'aal1') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'aal', lvl, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; raise notice 'pass: %', msg; end $$;
create function pg_temp.fails(sql text, msg text, part text default null) returns void language plpgsql as $$
begin
  begin execute sql; exception when others then
    if part is not null and sqlerrm not like '%' || part || '%' and sqlstate <> part then raise exception 'FAIL (wrong error "%"): %', sqlerrm, msg; end if;
    raise notice 'pass (refused): %', msg; return;
  end;
  raise exception 'FAIL (was allowed): %', msg;
end $$;

insert into auth.users(id, email) values
 ('00000000-0000-0000-0000-0000000000a1','a@t'),('00000000-0000-0000-0000-0000000000b1','j@t'),
 ('00000000-0000-0000-0000-0000000000b2','j2@t'),('00000000-0000-0000-0000-0000000000b3','j3@t');
select public.bootstrap_first_admin('00000000-0000-0000-0000-0000000000a1','owner','Test Owner');
insert into public.staff(id, full_name) values
 ('10000000-0000-0000-0000-000000000001','J One'),('10000000-0000-0000-0000-000000000002','J Two'),('10000000-0000-0000-0000-000000000003','J Three');
insert into public.profiles(user_id, staff_id, username, role_template) values
 ('00000000-0000-0000-0000-0000000000b1','10000000-0000-0000-0000-000000000001','junior1','junior'),
 ('00000000-0000-0000-0000-0000000000b2','10000000-0000-0000-0000-000000000002','junior2','junior'),
 ('00000000-0000-0000-0000-0000000000b3','10000000-0000-0000-0000-000000000003','junior3','junior');
-- junior3 has had the closing permission taken away
do $t$ begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  perform public.set_user_permission('00000000-0000-0000-0000-0000000000b3', 'closing.enter_own', 'deny', 'test');
  reset role;
end $t$;

-- 1. the formula in the database gives the same answers as the browser fixtures
create temp table case_data as select :'cases'::jsonb as j;
grant select on case_data to authenticated;
do $t$ declare c jsonb; r jsonb; k text; want jsonb; begin
  for c in select * from jsonb_array_elements((select j from case_data)) loop
    r := public.closing_calc(c -> 'input');
    for k, want in select * from jsonb_each(c -> 'expect') loop
      if jsonb_typeof(want) = 'null' then
        perform pg_temp.ok(jsonb_typeof(r -> k) = 'null', (c ->> 'name') || ' / ' || k || ' is empty');
      else
        perform pg_temp.ok((r ->> k)::numeric = (want #>> '{}')::numeric,
          (c ->> 'name') || ' / ' || k || ' = ' || (want #>> '{}') || ' (got ' || coalesce(r ->> k, 'null') || ')');
      end if;
    end loop;
  end loop;
  perform pg_temp.fails($q$select public.closing_calc('{"mode":"shift"}')$q$, 'no settings, no calculation', 'settings');
end $t$;

-- 2. slot rules
insert into public.closing_slots (id, business_date, kind, seq) values
 ('20000000-0000-0000-0000-000000000001', date '2030-01-01', 'night', 10),
 ('20000000-0000-0000-0000-000000000002', date '2030-01-02', 'night', 10),
 ('20000000-0000-0000-0000-000000000003', date '2030-01-02', 'handover', 30);
select pg_temp.fails($q$insert into public.closing_slots (business_date, kind, seq) values (date '2030-01-03', 'night', 20)$q$, 'night must be seq 10', 'check');
select pg_temp.fails($q$insert into public.closing_slots (business_date, kind, seq) values (date '2030-01-02', 'night', 10)$q$, 'one night slot per date', 'unique');
select pg_temp.fails($q$insert into public.closing_slots (business_date, kind, seq) values (date '2030-01-02', 'handover', 30)$q$, 'two handovers cannot share a position', 'unique');
select pg_temp.fails($q$insert into public.closing_slots (business_date, kind, seq) values (date '2030-01-04', 'handover', 9999)$q$, 'a handover cannot take the evening position', 'check');

-- 3. a closing saved in tables gives the same figures as fixture B (the table reader builds the same input)
-- previous slot: the evening before (sys cash 400000, last bill 1100)
insert into public.closings (id, slot_id, entered_by, idempotency_key, sys_cash, last_bill_no, status, submitted_at) values
 ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b1',
  '40000000-0000-0000-0000-000000000001', 400000, 1100, 'submitted', now());
insert into public.closings (id, slot_id, entered_by, idempotency_key, sys_cash, last_bill_no, comp_sale, alfalah, keenu,
  ret_manual_1, ret_manual_2, ret_manual_3, ret_system, book_bill_1, credit_adj, prev_cc, prev_credit, prev_deposits, prev_cash, source_closing_id) values
 ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000b1',
  '40000000-0000-0000-0000-000000000002', 150000, 1250, 24000, 20000, 5000, 1000, 0, 500, 2000, 3000, 100, 7000, 20000, 5000, 100000,
  '30000000-0000-0000-0000-000000000001');
insert into public.closing_hs_rows (closing_id, amount, deleted_at) values
 ('30000000-0000-0000-0000-000000000002', 500, null), ('30000000-0000-0000-0000-000000000002', 200, null), ('30000000-0000-0000-0000-000000000002', 900, now());
insert into public.closing_strip_lines (closing_id, price, qty, deleted_at) values
 ('30000000-0000-0000-0000-000000000002', 50, 10, null), ('30000000-0000-0000-0000-000000000002', 120, 3, null), ('30000000-0000-0000-0000-000000000002', 10, 5, now());
insert into public.closing_mediq_orders (closing_id, collected, pharmacy_bill, deleted_at) values
 ('30000000-0000-0000-0000-000000000002', 1500, 1200, null), ('30000000-0000-0000-0000-000000000002', 999, 0, now());
insert into public.closing_cash_counts (closing_id, area, denomination, qty) values
 ('30000000-0000-0000-0000-000000000002', 'till', 5000, 10), ('30000000-0000-0000-0000-000000000002', 'till', 1000, 20),
 ('30000000-0000-0000-0000-000000000002', 'till', 500, 30), ('30000000-0000-0000-0000-000000000002', 'till', 100, 40),
 ('30000000-0000-0000-0000-000000000002', 'till', 50, 50), ('30000000-0000-0000-0000-000000000002', 'till', 20, 60),
 ('30000000-0000-0000-0000-000000000002', 'till', 10, 70), ('30000000-0000-0000-0000-000000000002', 'till', 1, 80),
 ('30000000-0000-0000-0000-000000000002', 'vault', 5000, 2), ('30000000-0000-0000-0000-000000000002', 'vault', 1000, 10);
insert into public.closing_credit_lines (closing_id, kind, tier_slot, label, amount, deleted_at) values
 ('30000000-0000-0000-0000-000000000002', 'named', null, 'Account X', 3000, null),
 ('30000000-0000-0000-0000-000000000002', 'named', null, 'Account X', 500, now()),
 ('30000000-0000-0000-0000-000000000002', 'tier', 1, 'Person A', 1000, null),
 ('30000000-0000-0000-0000-000000000002', 'tier', 2, '', 0, null),
 ('30000000-0000-0000-0000-000000000002', 'tier', 3, 'Person C', 250, null),
 ('30000000-0000-0000-0000-000000000002', 'free', null, 'Walk-in', 400, null),
 ('30000000-0000-0000-0000-000000000002', 'free', null, 'Struck', 99, now());
insert into public.closing_deposits (closing_id, amount, deleted_at) values
 ('30000000-0000-0000-0000-000000000002', 10000, null), ('30000000-0000-0000-0000-000000000002', 500, now());
insert into public.closing_misc_rows (closing_id, amount, deleted_at) values
 ('30000000-0000-0000-0000-000000000002', 1000, null), ('30000000-0000-0000-0000-000000000002', 200, null), ('30000000-0000-0000-0000-000000000002', 77, now());

do $t$ declare r jsonb; want jsonb; k text; w jsonb; begin
  select j -> 1 -> 'expect' into want from case_data;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  r := public.closing_compute('30000000-0000-0000-0000-000000000002');
  for k, w in select * from jsonb_each(want) loop
    if jsonb_typeof(w) = 'null' then perform pg_temp.ok(jsonb_typeof(r -> k) = 'null', 'from saved rows: ' || k || ' is empty');
    else perform pg_temp.ok((r ->> k)::numeric = (w #>> '{}')::numeric, 'from saved rows: ' || k || ' = ' || (w #>> '{}')); end if;
  end loop;
  reset role;
end $t$;

-- 4. who can see and compute what
do $t$ declare n int; begin
  -- owner (aal2) sees both closings; owner without MFA sees none
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  select count(*) into n from public.closings; perform pg_temp.ok(n = 2, 'owner with MFA sees every closing');
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal1');
  select count(*) into n from public.closings; perform pg_temp.ok(n = 0, 'owner without MFA sees nothing');
  reset role;
  -- a staff member sees only their own
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  select count(*) into n from public.closings; perform pg_temp.ok(n = 2, 'staff see their own closings');
  select count(*) into n from public.closing_hs_rows; perform pg_temp.ok(n = 3, 'and their own child rows');
  select count(*) into n from public.closing_slots; perform pg_temp.ok(n = 3, 'and the slot list');
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
  select count(*) into n from public.closings; perform pg_temp.ok(n = 0, 'another staff member sees none of them');
  select count(*) into n from public.closing_credit_lines; perform pg_temp.ok(n = 0, 'nor their credit lines');
  select count(*) into n from public.closing_results; perform pg_temp.ok(n = 0, 'nor results');
  perform pg_temp.fails($q$select public.closing_compute('30000000-0000-0000-0000-000000000002')$q$, 'nor compute them', '42501');
  reset role;
  -- permission removed: nothing at all
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b3');
  select count(*) into n from public.closing_slots; perform pg_temp.ok(n = 0, 'no closing permission: no slots');
  select count(*) into n from public.closing_strips; perform pg_temp.ok(n = 0, 'no closing permission: no configuration');
  perform pg_temp.fails($q$select public.closing_compute('30000000-0000-0000-0000-000000000002')$q$, 'no closing permission: no compute', '42501');
  reset role;
  -- view_all given to a second member shows everything
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  perform public.set_user_permission('00000000-0000-0000-0000-0000000000b2', 'closing.view_all', 'grant', null);
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
  select count(*) into n from public.closings; perform pg_temp.ok(n = 2, 'closing.view_all sees everyone''s closings');
  reset role;
end $t$;

-- 5. anon has nothing; nobody can write directly
do $t$ begin
  set local role anon;
  perform pg_temp.fails('select count(*) from public.closings', 'anon cannot read closings', '42501');
  perform pg_temp.fails('select count(*) from public.closing_results', 'anon cannot read results', '42501');
  perform pg_temp.fails($q$select public.closing_calc('{}')$q$, 'anon cannot call the calculation', '42501');
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  perform pg_temp.fails($q$insert into public.closings (slot_id, entered_by, idempotency_key) values ('20000000-0000-0000-0000-000000000001', auth.uid(), gen_random_uuid())$q$, 'no direct insert of a closing', '42501');
  perform pg_temp.fails($q$update public.closings set sys_cash = 1 where id = '30000000-0000-0000-0000-000000000002'$q$, 'no direct update of a closing', '42501');
  perform pg_temp.fails($q$delete from public.closings where id = '30000000-0000-0000-0000-000000000002'$q$, 'no direct delete of a closing', '42501');
  perform pg_temp.fails($q$insert into public.closing_hs_rows (closing_id, amount) values ('30000000-0000-0000-0000-000000000002', 1)$q$, 'no direct insert of a row', '42501');
  perform pg_temp.fails($q$insert into public.closing_slots (business_date, kind, seq) values (date '2031-01-01', 'night', 10)$q$, 'no direct slot creation', '42501');
  perform pg_temp.fails($q$insert into public.closing_strips (label, price) values ('x', 1)$q$, 'no direct configuration change', '42501');
  perform pg_temp.fails($q$select public.closing_write_result('30000000-0000-0000-0000-000000000002')$q$, 'the result writer is not callable', '42501');
  perform pg_temp.fails($q$select public.closing_build_input('30000000-0000-0000-0000-000000000002')$q$, 'the input builder is not callable', '42501');
  reset role;
end $t$;

-- 6. submitted closings are locked (D-12); even a database-level write fails
do $t$ begin
  perform pg_temp.fails($q$update public.closings set sys_cash = 1 where id = '30000000-0000-0000-0000-000000000001'$q$, 'a submitted closing cannot be edited', 'locked');
  perform pg_temp.fails($q$delete from public.closings where id = '30000000-0000-0000-0000-000000000001'$q$, 'a submitted closing cannot be deleted', 'locked');
  perform pg_temp.fails($q$update public.closings set status = 'draft', submitted_at = null where id = '30000000-0000-0000-0000-000000000001'$q$, 'a submitted closing cannot be reopened', 'locked');
  perform pg_temp.fails($q$update public.closings set status = 'superseded', sys_cash = 5 where id = '30000000-0000-0000-0000-000000000001'$q$, 'superseding cannot change anything else', 'locked');
  perform pg_temp.fails($q$insert into public.closing_hs_rows (closing_id, amount) values ('30000000-0000-0000-0000-000000000001', 1)$q$, 'no row can be added to a submitted closing', 'locked');
  perform pg_temp.fails($q$insert into public.closing_cash_counts values ('30000000-0000-0000-0000-000000000001', 'till', 100, 1)$q$, 'no cash count on a submitted closing', 'locked');
  perform pg_temp.fails($q$insert into public.closing_credit_lines (closing_id, kind, amount) values ('30000000-0000-0000-0000-000000000001', 'free', 5)$q$, 'no credit line on a submitted closing', 'locked');
  -- a draft can be edited and its rows follow it
  update public.closings set sys_cash = 150001 where id = '30000000-0000-0000-0000-000000000002';
  insert into public.closing_hs_rows (closing_id, amount) values ('30000000-0000-0000-0000-000000000002', 1);
  update public.closing_hs_rows set amount = 2 where closing_id = '30000000-0000-0000-0000-000000000002' and amount = 1;
  delete from public.closing_hs_rows where closing_id = '30000000-0000-0000-0000-000000000002' and amount = 2;
  perform pg_temp.ok((select sys_cash from public.closings where id = '30000000-0000-0000-0000-000000000002') = 150001, 'a draft and its rows can be changed');
  update public.closings set sys_cash = 150000 where id = '30000000-0000-0000-0000-000000000002';
  -- a row cannot be moved from a draft to a submitted closing
  insert into public.closing_hs_rows (id, closing_id, amount) values ('50000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', 7);
  perform pg_temp.fails($q$update public.closing_hs_rows set closing_id = '30000000-0000-0000-0000-000000000001' where id = '50000000-0000-0000-0000-000000000001'$q$, 'a row cannot move to another closing', 'cannot move');
  delete from public.closing_hs_rows where id = '50000000-0000-0000-0000-000000000001';
end $t$;

-- 7. results: written once, never changed
select public.closing_write_result('30000000-0000-0000-0000-000000000001');
do $t$ declare n int; begin
  select count(*) into n from public.closing_results; perform pg_temp.ok(n = 1, 'a result row is stored');
  perform pg_temp.ok((select till_float from public.closing_results) = 45000, 'the settings used are stored with the result');
  perform pg_temp.fails($q$update public.closing_results set net_sale = 1$q$, 'results cannot be updated', 'append-only');
  perform pg_temp.fails($q$delete from public.closing_results$q$, 'results cannot be deleted', 'append-only');
  perform pg_temp.fails($q$select public.closing_write_result('30000000-0000-0000-0000-000000000001')$q$, 'a second result for the same closing is refused', 'duplicate');
end $t$;

-- 8. one submitted closing per slot; a correction needs a reason; a superseded one stays
do $t$ begin
  perform pg_temp.fails($q$insert into public.closings (slot_id, entered_by, idempotency_key, revision, supersedes_id, correction_reason, status, submitted_at) values ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b1', gen_random_uuid(), 2, '30000000-0000-0000-0000-000000000001', 'typo', 'submitted', now())$q$, 'a submitted correction cannot sit beside its submitted original (a draft revision may, see 0203)', 'one_submitted');
  perform pg_temp.fails($q$insert into public.closings (slot_id, entered_by, idempotency_key, revision) values ('20000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000b1', gen_random_uuid(), 2)$q$, 'a revision without a reason and a link is refused', 'check');
  perform pg_temp.fails($q$insert into public.closings (slot_id, entered_by, idempotency_key, revision, supersedes_id, correction_reason) values ('20000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000b1', gen_random_uuid(), 2, '30000000-0000-0000-0000-000000000001', '   ')$q$, 'a blank correction reason is refused', 'check');
  perform pg_temp.fails($q$insert into public.closings (slot_id, entered_by, idempotency_key) values ('20000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000b1', '40000000-0000-0000-0000-000000000002')$q$, 'the same idempotency key cannot create a second closing', 'unique');
end $t$;
update public.closings set status = 'superseded' where id = '30000000-0000-0000-0000-000000000001';
do $t$ begin
  perform pg_temp.ok((select status from public.closings where id = '30000000-0000-0000-0000-000000000001') = 'superseded', 'a submitted closing can become superseded (kept for audit)');
  perform pg_temp.fails($q$update public.closings set status = 'submitted' where id = '30000000-0000-0000-0000-000000000001'$q$, 'a superseded closing cannot come back', 'locked');
  -- once the original is superseded, its correction may go live in the same slot
  insert into public.closings (slot_id, entered_by, idempotency_key, revision, supersedes_id, correction_reason, status, submitted_at)
    values ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b1', gen_random_uuid(), 2, '30000000-0000-0000-0000-000000000001', 'typo', 'submitted', now());
  perform pg_temp.ok((select count(*) from public.closings where slot_id = '20000000-0000-0000-0000-000000000001') = 2, 'original and correction are both kept');
end $t$;

rollback;
