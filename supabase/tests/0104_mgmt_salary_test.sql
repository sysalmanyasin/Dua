-- Tests for 0104_mgmt_salary. Maths cases are shared with the browser tests (tests/fixtures/manager-*-cases.json).
-- All people and figures here are invented.
\set ON_ERROR_STOP on
\set gcases `cat ../../tests/fixtures/manager-generic-cases.json`
\set scases `cat ../../tests/fixtures/manager-salary-cases.json`
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

create temp table case_data as select :'gcases'::jsonb as g, :'scases'::jsonb as s;
grant select on case_data to authenticated;

insert into auth.users(id, email) values
 ('00000000-0000-0000-0000-0000000000a1','a@t'), ('00000000-0000-0000-0000-0000000000b1','b@t'),
 ('00000000-0000-0000-0000-0000000000c1','c@t'), ('00000000-0000-0000-0000-0000000000d1','d@t'),
 ('00000000-0000-0000-0000-0000000000e1','e@t'), ('00000000-0000-0000-0000-0000000000f1','f@t');
select public.bootstrap_first_admin('00000000-0000-0000-0000-0000000000a1','owner','Test Owner');
insert into public.staff(id, full_name, active) values
 ('10000000-0000-0000-0000-00000000000b','Test Junior B', true), ('10000000-0000-0000-0000-00000000000c','Test Viewer C', true),
 ('10000000-0000-0000-0000-00000000000d','Test Salary D', true), ('10000000-0000-0000-0000-00000000000e','Test Closer E', true),
 ('10000000-0000-0000-0000-00000000000f','Test Rates F', true),
 ('10000000-0000-0000-0000-0000000000a1','Test Person A', true), ('10000000-0000-0000-0000-0000000000a2','Test Person B2', true),
 ('10000000-0000-0000-0000-0000000000a3','Test Person Left', false), ('10000000-0000-0000-0000-0000000000a4','Test Person Left With Row', false);
insert into public.profiles(user_id, staff_id, username, role_template) values
 ('00000000-0000-0000-0000-0000000000b1','10000000-0000-0000-0000-00000000000b','junior_b','junior'),
 ('00000000-0000-0000-0000-0000000000c1','10000000-0000-0000-0000-00000000000c','viewer_c','junior'),
 ('00000000-0000-0000-0000-0000000000d1','10000000-0000-0000-0000-00000000000d','salary_d','junior'),
 ('00000000-0000-0000-0000-0000000000e1','10000000-0000-0000-0000-00000000000e','closer_e','junior'),
 ('00000000-0000-0000-0000-0000000000f1','10000000-0000-0000-0000-00000000000f','rates_f','junior');
insert into public.user_permissions(user_id, perm_key, effect)
  select '00000000-0000-0000-0000-0000000000b1', key, 'grant' from public.permissions where key not like 'mgmt.%' and key not like 'credit.%';
insert into public.user_permissions(user_id, perm_key, effect) values
 ('00000000-0000-0000-0000-0000000000c1','mgmt.salary_view','grant'),
 ('00000000-0000-0000-0000-0000000000d1','mgmt.salary','grant'),
 ('00000000-0000-0000-0000-0000000000e1','mgmt.close_month','grant'),
 ('00000000-0000-0000-0000-0000000000f1','mgmt.rates','grant');

-- ───────── 1. the maths: every shared fixture case, through the real functions ─────────
do $t$ declare c jsonb; sid uuid; i int := 0; got record; mth date; sh uuid; plus_id uuid; minus_id uuid; adv numeric; e jsonb;
begin
  -- generic cases: each case gets its own month and person; the rate is set first
  for c in select * from jsonb_array_elements((select g from case_data)) loop
    i := i + 1; sid := gen_random_uuid(); mth := (date '2020-01-01' + (i || ' month')::interval)::date;
    insert into public.staff(id, full_name) values (sid, 'Gfix ' || i);
    perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
    perform public.mgmt_rate_set('generic_staff', (c ->> 'rate')::numeric, 'fixture ' || i, gen_random_uuid());
    perform public.mgmt_generic_save(mth, jsonb_build_array(jsonb_build_object('staff_id', sid, 'generic_sale', c -> 'sale', 'extra', c -> 'extra')), null, gen_random_uuid());
    select * into got from public.mgmt_generic_month(mth) m where m.staff_id = sid;
    -- a case whose sale and extra both round to zero is never stored (no blank rows), and then shows zeros
    perform pg_temp.ok(got.incentive = (c ->> 'incentive')::numeric and got.final = (c ->> 'final')::numeric, 'generic fixture: ' || (c ->> 'name') || ' (' || got.incentive || ' / ' || got.final || ')');
    reset role;
  end loop;
  -- salary cases
  insert into public.mgmt_sheets(month, kind, rate) values ('2019-12-01', 'generic', 0.04) on conflict do nothing;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  plus_id := (public.mgmt_salary_column_add('Fixture plus', 1, date '2000-01-01', gen_random_uuid()) ->> 'id')::uuid;
  minus_id := (public.mgmt_salary_column_add('Fixture minus', -1, date '2000-01-01', gen_random_uuid()) ->> 'id')::uuid;
  reset role;
  i := 0;
  for c in select * from jsonb_array_elements((select s from case_data)) loop
    i := i + 1; sid := gen_random_uuid(); mth := (date '2023-01-01' + (i || ' month')::interval)::date;
    insert into public.staff(id, full_name) values (sid, 'Sfix ' || i);
    for e in select * from jsonb_array_elements(c -> 'advances') loop
      insert into public.mgmt_credit_entries(staff_id, entry_date, kind, amount) values (sid, mth + 9, 'entry', (e #>> '{}')::numeric);
    end loop;
    if (c ->> 'generic')::numeric <> 0 then
      insert into public.mgmt_sheets(month, kind, rate) values (mth, 'generic', 0.04) returning id into sh;
      insert into public.mgmt_generic_rows(sheet_id, staff_id, revision, generic_sale, extra, incentive, final)
        values (sh, sid, 0, 0, 0, 0, (c ->> 'generic')::numeric);
    end if;
    perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
    perform public.mgmt_salary_save(mth, jsonb_build_array(jsonb_build_object('staff_id', sid, 'ho_salary', c -> 'ho', 'days', 30,
      'extras', jsonb_build_object(plus_id::text, c -> 'plus', minus_id::text, c -> 'minus'))), null, gen_random_uuid());
    select * into got from public.mgmt_salary_month(mth) m where m.staff_id = sid;
    perform pg_temp.ok(got.net = (c ->> 'net')::numeric, 'salary fixture: ' || (c ->> 'name') || ' (net ' || got.net || ')');
    reset role;
    -- the saved net equals the live net
    perform pg_temp.ok((select net from public.mgmt_salary_rows where staff_id = sid order by revision desc limit 1) = (c ->> 'net')::numeric, 'saved net matches: ' || (c ->> 'name'));
  end loop;
end $t$;

-- ───────── 2. behaviour ─────────
do $t$ declare
  today date := (now() at time zone 'Asia/Karachi')::date; m0 date := date_trunc('month', (now() at time zone 'Asia/Karachi')::date)::date;
  m1 date := (date_trunc('month', (now() at time zone 'Asia/Karachi')::date) - interval '1 month')::date;
  m2 date := (date_trunc('month', (now() at time zone 'Asia/Karachi')::date) - interval '2 month')::date;
  a uuid := '00000000-0000-0000-0000-0000000000a1'; j uuid := '00000000-0000-0000-0000-0000000000b1';
  pa uuid := '10000000-0000-0000-0000-0000000000a1'; pb uuid := '10000000-0000-0000-0000-0000000000a2';
  pc uuid := '10000000-0000-0000-0000-0000000000a3'; pd uuid := '10000000-0000-0000-0000-0000000000a4';
  plus_id uuid; minus_id uuid; k uuid; r jsonb; got record; n int; tbl text; fn text; sh uuid;
begin
  -- 2.1 rates
  perform pg_temp.as_user(a, 'aal2');
  perform pg_temp.ok((select count(*) from public.mgmt_rates where reason like 'Starting value%' and rate = 0.04) = 1, 'the generic rate starts at 4%, the old app''s value, as a seeded history row');
  perform public.mgmt_rate_set('generic_staff', 0.04, 'back to the starting value for the tests', gen_random_uuid());
  perform pg_temp.fails($q$select public.mgmt_rate_set('generic_staff', 0.04, 'x', gen_random_uuid())$q$, 'a rate change needs a real reason', 'reason');
  perform pg_temp.fails($q$select public.mgmt_rate_set('generic_staff', 1.5, 'too high', gen_random_uuid())$q$, 'a rate above 100% is refused', 'between 0 and 100');
  perform pg_temp.fails($q$select public.mgmt_rate_set('generic_staff', 0.0412345, 'too precise', gen_random_uuid())$q$, 'a rate with too many decimals is refused', 'between 0 and 100');
  perform pg_temp.fails($q$select public.mgmt_rate_set('nonsense', 0.04, 'unknown key', gen_random_uuid())$q$, 'an unknown rate is refused', 'unknown rate');
  k := gen_random_uuid();
  r := public.mgmt_rate_set('generic_staff', 0.045, 'owner changed the rate', k);
  perform pg_temp.ok(public.mgmt_rate_set('generic_staff', 0.045, 'owner changed the rate', k) = r, 'the same key twice sets one rate');
  perform pg_temp.ok((select rate from public.mgmt_rates_list() where rate_key = 'generic_staff') = 0.045, 'the list shows the latest rate');
  reset role;
  perform pg_temp.ok((select count(*) from public.activity_log where action = 'mgmt.rate_set' and reason = 'owner changed the rate') = 1, 'a rate change is logged with its reason');

  -- 2.2 generic sheet: the month keeps the rate it started with
  perform pg_temp.as_user(a, 'aal2');
  r := public.mgmt_generic_save(m2, jsonb_build_array(jsonb_build_object('staff_id', pa, 'generic_sale', 10000, 'extra', 100)), null, gen_random_uuid());
  select * into got from public.mgmt_generic_month(m2) where staff_id = pa;
  perform pg_temp.ok(got.incentive = 450 and got.final = 550 and got.rate = 0.045 and got.revision = 0, 'generic: 10,000 at 4.5% + 100 extra = 550');
  perform public.mgmt_rate_set('generic_staff', 0.05, 'a later change', gen_random_uuid());
  perform public.mgmt_generic_save(m2, jsonb_build_array(jsonb_build_object('staff_id', pa, 'generic_sale', 20000, 'extra', 100)), null, gen_random_uuid());
  select * into got from public.mgmt_generic_month(m2) where staff_id = pa;
  perform pg_temp.ok(got.rate = 0.045 and got.incentive = 900 and got.revision = 1, 'a rate change does not touch a month that already started (still 4.5%)');
  perform public.mgmt_generic_save(m1, jsonb_build_array(jsonb_build_object('staff_id', pa, 'generic_sale', 20000, 'extra', 0)), null, gen_random_uuid());
  perform pg_temp.ok((select rate from public.mgmt_generic_month(m1) where staff_id = pa) = 0.05, 'a new month takes the new rate');
  perform pg_temp.ok((select count(*) from public.mgmt_generic_rows g join public.mgmt_sheets s on s.id = g.sheet_id where s.month = m2 and g.staff_id = pa) = 2, 'both revisions are kept');
  r := public.mgmt_generic_save(m2, jsonb_build_array(jsonb_build_object('staff_id', pa, 'generic_sale', 20000, 'extra', 100)), null, gen_random_uuid());
  perform pg_temp.ok((r ->> 'changed')::int = 0 and (r ->> 'unchanged')::int = 1, 'saving the same figures adds nothing');
  r := public.mgmt_generic_save(m2, jsonb_build_array(jsonb_build_object('staff_id', pb, 'generic_sale', 0, 'extra', 0)), null, gen_random_uuid());
  perform pg_temp.ok((r ->> 'changed')::int = 0 and not exists (select 1 from public.mgmt_generic_month(m2) where staff_id = pb and has_row), 'a blank row is never stored');
  k := gen_random_uuid();
  r := public.mgmt_generic_save(m2, jsonb_build_array(jsonb_build_object('staff_id', pd, 'generic_sale', 1000, 'extra', 0)), null, k);
  perform pg_temp.ok(public.mgmt_generic_save(m2, jsonb_build_array(jsonb_build_object('staff_id', pd, 'generic_sale', 1000, 'extra', 0)), null, k) = r, 'the same key twice is one save');
  perform pg_temp.ok(exists (select 1 from public.mgmt_generic_month(m2) where staff_id = pd) and not exists (select 1 from public.mgmt_generic_month(m2) where staff_id = pc), 'someone who left is listed only when they have a row that month (MGR-13)');
  perform pg_temp.fails(format($q$select public.mgmt_generic_save(%L, '[]'::jsonb, null, gen_random_uuid())$q$, (m0 + interval '1 month')::date), 'a future month is refused', 'has begun');
  perform pg_temp.fails(format($q$select public.mgmt_generic_save(%L, '[]'::jsonb, null, gen_random_uuid())$q$, m1 + 3), 'a month not on the 1st is refused', 'first of the month');
  perform pg_temp.fails(format($q$select public.mgmt_generic_save(%L, '[{"staff_id":"not-a-uuid","generic_sale":1}]'::jsonb, null, gen_random_uuid())$q$, m1), 'a bad staff id is refused', 'valid staff id');
  perform pg_temp.fails(format($q$select public.mgmt_generic_save(%L, jsonb_build_array(jsonb_build_object('staff_id', gen_random_uuid(), 'generic_sale', 1)), null, gen_random_uuid())$q$, m1), 'an unknown person is refused', 'unknown staff');
  perform pg_temp.fails(format($q$select public.mgmt_generic_save(%L, jsonb_build_array(jsonb_build_object('staff_id', %L, 'generic_sale', 'abc')), null, gen_random_uuid())$q$, m1, pa), 'a non-number is refused', 'numbers');
  perform pg_temp.fails(format($q$select public.mgmt_generic_save(%L, jsonb_build_array(jsonb_build_object('staff_id', %L, 'generic_sale', 2000000000)), null, gen_random_uuid())$q$, m1, pa), 'a huge amount is refused', 'out of range');
  perform pg_temp.fails(format($q$select public.mgmt_generic_save(%L, '{"a":1}'::jsonb, null, gen_random_uuid())$q$, m1), 'rows must be a list', 'list');

  -- 2.3 salary: custom columns
  plus_id := (public.mgmt_salary_column_add('Test bonus', 1, m2, gen_random_uuid()) ->> 'id')::uuid;
  minus_id := (public.mgmt_salary_column_add('Test fine', -1, m2, gen_random_uuid()) ->> 'id')::uuid;
  perform pg_temp.fails(format($q$select public.mgmt_salary_column_add('  TEST BONUS ', 1, %L, gen_random_uuid())$q$, m2), 'a duplicate column name is refused', 'already exists');
  perform pg_temp.fails(format($q$select public.mgmt_salary_column_add('Bad sign', 0, %L, gen_random_uuid())$q$, m2), 'a column either adds or subtracts', 'adds');
  perform pg_temp.fails(format($q$select public.mgmt_salary_column_add('Future', 1, %L, gen_random_uuid())$q$, (m0 + interval '1 month')::date), 'a column cannot start in a future month', 'begun');
  perform pg_temp.fails($q$select public.mgmt_salary_column_add('', 1, date_trunc('month', current_date)::date, gen_random_uuid())$q$, 'a column needs a name', '1 to 40');
  perform pg_temp.ok((select count(*) from public.mgmt_salary_columns(m1) where name in ('Test bonus', 'Test fine')) = 2, 'columns apply to every month from their start');
  perform pg_temp.ok((select count(*) from public.mgmt_salary_columns((m2 - interval '1 month')::date) where name = 'Test bonus') = 0, 'and not before it');

  -- 2.4 salary sheet: advance is the signed sum of the month's credit entries; generic comes from the Generic sheet
  perform public.mgmt_credit_add(pa, m1 + 4, 'Advance', 2000, gen_random_uuid());
  perform public.mgmt_credit_add(pa, m1 + 6, 'Part repayment', -500, gen_random_uuid());
  perform public.mgmt_generic_save(m1, jsonb_build_array(jsonb_build_object('staff_id', pa, 'generic_sale', 20000, 'extra', 100)), null, gen_random_uuid());
  r := public.mgmt_salary_save(m1, jsonb_build_array(jsonb_build_object('staff_id', pa, 'ho_salary', 30000, 'days', 30,
         'extras', jsonb_build_object(plus_id::text, 500, minus_id::text, 250))), null, gen_random_uuid());
  select * into got from public.mgmt_salary_month(m1) where staff_id = pa;
  perform pg_temp.ok(got.advance = 1500 and got.generic = 1100 and got.net = 30000 - 1500 + 1100 + 500 - 250, 'salary: HO - advance(1,500 = 2,000 - 500) + generic(1,100) + bonus - fine');
  perform pg_temp.ok(jsonb_array_length(got.entries) = 2, 'the advance breakdown lists the credit entries');
  perform pg_temp.ok(not got.closed and got.has_row and got.revision = 0 and got.days = 30, 'a saved row is open and revision 0');
  r := public.mgmt_salary_save(m1, jsonb_build_array(jsonb_build_object('staff_id', pa, 'ho_salary', 30000, 'days', 30,
         'extras', jsonb_build_object(plus_id::text, 500, minus_id::text, 250))), null, gen_random_uuid());
  perform pg_temp.ok((r ->> 'changed')::int = 0 and (r ->> 'unchanged')::int = 1, 'saving the same salary adds nothing');
  r := public.mgmt_salary_save(m1, jsonb_build_array(jsonb_build_object('staff_id', pa, 'ho_salary', 31000, 'days', 30,
         'extras', jsonb_build_object(plus_id::text, 500, minus_id::text, 250))), null, gen_random_uuid());
  perform pg_temp.ok((select revision from public.mgmt_salary_month(m1) where staff_id = pa) = 1 and (select count(*) from public.mgmt_salary_rows where staff_id = pa) >= 2, 'a changed salary is a new revision; the old one stays');
  perform pg_temp.ok((select credit_deduction from public.mgmt_salary_month(m1) where staff_id = pa) = 0, 'the credit sheet''s own salary deduction is reported separately (0 until set)');
  perform public.mgmt_credit_set_deduction(pa, m1, 'salary_deduction', 1500, null, gen_random_uuid());
  perform pg_temp.ok((select credit_deduction from public.mgmt_salary_month(m1) where staff_id = pa) = 1500, 'it reports the credit sheet''s deduction so a mismatch can be flagged');
  -- the carried HO salary and the listing rule
  select * into got from public.mgmt_salary_month(m0) where staff_id = pa;
  perform pg_temp.ok(not got.has_row and got.ho_salary = 31000 and got.ho_carried, 'next month starts from the last HO salary, marked as carried (MGR-8)');
  perform pg_temp.ok((select count(*) from public.mgmt_salary_columns(m0) where name = 'Test bonus') = 1, 'and the custom columns carry on by themselves');
  perform pg_temp.ok(not exists (select 1 from public.mgmt_salary_month(m0) where staff_id = pc), 'someone who left with no row is not on the salary sheet');
  perform public.mgmt_salary_save(m1, jsonb_build_array(jsonb_build_object('staff_id', pd, 'ho_salary', 10000)), null, gen_random_uuid());
  perform pg_temp.ok(exists (select 1 from public.mgmt_salary_month(m1) where staff_id = pd and not active), 'someone who left WITH a row that month still shows');
  -- a blank carried row is never forced into the table
  r := public.mgmt_salary_save(m1, jsonb_build_array(jsonb_build_object('staff_id', pb, 'ho_salary', 0)), null, gen_random_uuid());
  perform pg_temp.ok((r ->> 'changed')::int = 0, 'an empty salary row is not stored');
  -- validation
  perform pg_temp.fails(format($q$select public.mgmt_salary_save(%L, jsonb_build_array(jsonb_build_object('staff_id', %L, 'ho_salary', 1, 'days', 32)), null, gen_random_uuid())$q$, m1, pa), 'days above 31 are refused', 'days must');
  perform pg_temp.fails(format($q$select public.mgmt_salary_save(%L, jsonb_build_array(jsonb_build_object('staff_id', %L, 'ho_salary', 1, 'days', 'abc')), null, gen_random_uuid())$q$, m1, pa), 'garbage days are refused with a plain message', 'days must');
  perform pg_temp.fails(format($q$select public.mgmt_salary_save(%L, jsonb_build_array(jsonb_build_object('staff_id', %L, 'ho_salary', 'x')), null, gen_random_uuid())$q$, m1, pa), 'a non-number salary is refused', 'must be a number');
  perform pg_temp.fails(format($q$select public.mgmt_salary_save(%L, jsonb_build_array(jsonb_build_object('staff_id', %L, 'ho_salary', 1, 'extras', jsonb_build_object(gen_random_uuid()::text, 5))), null, gen_random_uuid())$q$, m1, pa), 'an unknown column id is refused', 'unknown or retired');
  perform pg_temp.fails(format($q$select public.mgmt_salary_save(%L, jsonb_build_array(jsonb_build_object('staff_id', %L, 'ho_salary', 1, 'extras', jsonb_build_object(%L, 'abc'))), null, gen_random_uuid())$q$, m1, pa, plus_id::text), 'a non-number column amount is refused', 'numbers');
  perform pg_temp.fails(format($q$select public.mgmt_salary_save(%L, '[]'::jsonb, null, gen_random_uuid())$q$, (m0 + interval '1 month')::date), 'a future month is refused', 'has begun');

  -- 2.5 retiring a column never hides money
  perform pg_temp.fails(format($q$select public.mgmt_salary_column_retire(%L, %L, gen_random_uuid())$q$, plus_id, m1), 'a column with amounts in a month cannot be retired from that month', 'amounts still exist');
  perform pg_temp.fails(format($q$select public.mgmt_salary_column_retire(%L, %L, gen_random_uuid())$q$, plus_id, m2), 'a column cannot be retired from its own first month', 'after it started');
  perform public.mgmt_salary_column_retire(plus_id, m0, gen_random_uuid());
  perform pg_temp.ok((select count(*) from public.mgmt_salary_columns(m0) where name = 'Test bonus') = 0 and (select count(*) from public.mgmt_salary_columns(m1) where name = 'Test bonus') = 1, 'a retired column leaves later months but stays in past ones');
  perform pg_temp.fails(format($q$select public.mgmt_salary_column_retire(%L, %L, gen_random_uuid())$q$, plus_id, m0), 'it cannot be retired twice', 'already retired');
  perform pg_temp.fails(format($q$select public.mgmt_salary_save(%L, jsonb_build_array(jsonb_build_object('staff_id', %L, 'ho_salary', 1, 'extras', jsonb_build_object(%L, 5))), null, gen_random_uuid())$q$, m0, pa, plus_id::text), 'a retired column cannot be used in a month it is gone from', 'unknown or retired');
  reset role;
  perform pg_temp.fails(format($q$update public.mgmt_salary_columns set name = 'Renamed' where id = %L$q$, minus_id), 'a column name never changes', 'only be retired');
  perform pg_temp.fails(format($q$update public.mgmt_salary_columns set sign = 1 where id = %L$q$, minus_id), 'a column sign never flips (the old app needed a migration for that)', 'only be retired');
  perform pg_temp.fails(format($q$delete from public.mgmt_salary_columns where id = %L$q$, minus_id), 'a column is never deleted', 'cannot be deleted');

  -- 2.6 Close month
  perform pg_temp.as_user(a, 'aal2');
  perform pg_temp.fails(format($q$select public.mgmt_sheet_close(%L, 'salary', gen_random_uuid())$q$, m1), 'Salary cannot close before Generic', 'Generic sheet for that month first');
  perform pg_temp.fails(format($q$select public.mgmt_sheet_close(%L, 'salary', gen_random_uuid())$q$, m0 - interval '5 month'), 'a month with nothing saved cannot be closed', 'nothing saved');
  perform pg_temp.fails(format($q$select public.mgmt_sheet_close(%L, 'bonus', gen_random_uuid())$q$, m1), 'an unknown sheet is refused', 'unknown sheet');
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');                       -- mgmt.salary only
  perform pg_temp.fails(format($q$select public.mgmt_sheet_close(%L, 'generic', gen_random_uuid())$q$, m1), 'editing salary does not allow closing a month', '42501');
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');                       -- mgmt.close_month only
  k := gen_random_uuid();
  r := public.mgmt_sheet_close(m1, 'generic', k);
  perform pg_temp.ok(public.mgmt_sheet_close(m1, 'generic', k) = r, 'the same key twice closes once');
  perform pg_temp.fails(format($q$select public.mgmt_sheet_close(%L, 'generic', gen_random_uuid())$q$, m1), 'a month cannot be closed twice', 'already closed');
  perform pg_temp.fails(format($q$select * from public.mgmt_generic_month(%L)$q$, m1), 'closing alone gives no right to read the sheets', '42501');
  reset role;
  perform pg_temp.as_user(a, 'aal2');
  perform pg_temp.fails(format($q$select public.mgmt_generic_save(%L, jsonb_build_array(jsonb_build_object('staff_id', %L, 'generic_sale', 30000, 'extra', 100)), null, gen_random_uuid())$q$, m1, pa), 'a closed month needs a reason to be revised', 'reason is required');
  perform public.mgmt_generic_save(m1, jsonb_build_array(jsonb_build_object('staff_id', pa, 'generic_sale', 30000, 'extra', 100)), 'sale figure corrected after the audit', gen_random_uuid());
  select * into got from public.mgmt_generic_month(m1) where staff_id = pa;
  perform pg_temp.ok(got.closed and got.revision = 2 and got.incentive = 1500 and got.final = 1600 and got.rate = 0.05, 'a closed month is revised, never overwritten (revision 2 after 0 and 1, still the 5% the month started with)');
  perform pg_temp.ok((select reason from public.mgmt_generic_rows g join public.mgmt_sheets s on s.id = g.sheet_id where s.month = m1 and g.staff_id = pa and g.revision = 2) = 'sale figure corrected after the audit', 'the revision keeps its reason');
  -- salary: closing refreshes the saved figures from the (revised) generic sheet
  r := public.mgmt_sheet_close(m1, 'salary', gen_random_uuid());
  perform pg_temp.ok((r ->> 'rows_refreshed')::int >= 1, 'closing Salary refreshes the saved advance and generic');
  select * into got from public.mgmt_salary_month(m1) where staff_id = pa;
  perform pg_temp.ok(got.closed and got.advance = 1500 and got.generic = 1600 and got.net = 31000 - 1500 + 1600 + 500 - 250, 'a closed salary month shows the saved figures (generic 1,600 after the revision)');
  -- the credit ledger moves on; the closed month does not, but the mismatch is visible
  perform public.mgmt_credit_add(pa, m1 + 8, 'Late advance', 700, gen_random_uuid());
  select * into got from public.mgmt_salary_month(m1) where staff_id = pa;
  perform pg_temp.ok(got.advance = 1500 and got.advance_live = 2200 and got.net = 31000 - 1500 + 1600 + 500 - 250, 'after closing, the saved advance holds (1,500) and the live one (2,200) is available to flag the difference');
  perform pg_temp.fails(format($q$select public.mgmt_salary_save(%L, jsonb_build_array(jsonb_build_object('staff_id', %L, 'ho_salary', 31000, 'days', 30, 'extras', jsonb_build_object(%L, 500, %L, 250))), null, gen_random_uuid())$q$, m1, pa, plus_id::text, minus_id::text), 'revising a closed salary month needs a reason', 'reason is required');
  perform public.mgmt_salary_save(m1, jsonb_build_array(jsonb_build_object('staff_id', pa, 'ho_salary', 31000, 'days', 30, 'extras', jsonb_build_object(plus_id::text, 500, minus_id::text, 250))), 'include the late advance', gen_random_uuid());
  select * into got from public.mgmt_salary_month(m1) where staff_id = pa;
  perform pg_temp.ok(got.advance = 2200 and got.net = 31000 - 2200 + 1600 + 500 - 250 and got.revision >= 2, 'the revision picks up the live advance and keeps the old rows');
  reset role;

  -- 2.7 nothing is ever changed or deleted, even by the database owner
  perform pg_temp.fails($q$update public.mgmt_salary_rows set ho_salary = 1$q$, 'a salary row cannot be changed', 'append-only');
  perform pg_temp.fails($q$delete from public.mgmt_salary_rows$q$, 'a salary row cannot be deleted', 'append-only');
  perform pg_temp.fails($q$update public.mgmt_generic_rows set final = 1$q$, 'a generic row cannot be changed', 'append-only');
  perform pg_temp.fails($q$delete from public.mgmt_generic_rows$q$, 'a generic row cannot be deleted', 'append-only');
  perform pg_temp.fails($q$update public.mgmt_rates set rate = 0.5$q$, 'a rate cannot be changed', 'append-only');
  perform pg_temp.fails($q$delete from public.mgmt_rates$q$, 'a rate cannot be deleted', 'append-only');
  perform pg_temp.fails($q$delete from public.mgmt_sheets$q$, 'a sheet cannot be deleted', 'cannot be deleted');
  perform pg_temp.fails(format($q$update public.mgmt_sheets set closed_at = null where month = %L and kind = 'generic'$q$, m1), 'a closed sheet cannot be reopened', 'only be closed, once');
  perform pg_temp.fails(format($q$update public.mgmt_sheets set rate = 0.9 where month = %L and kind = 'generic'$q$, m2), 'a sheet''s rate cannot be changed', 'only be closed, once');
end $t$;

-- ───────── 3. permissions ─────────
do $t$ declare
  today date := (now() at time zone 'Asia/Karachi')::date; m0 date := date_trunc('month', (now() at time zone 'Asia/Karachi')::date)::date;
  m1 date := (date_trunc('month', (now() at time zone 'Asia/Karachi')::date) - interval '1 month')::date;
  a uuid := '00000000-0000-0000-0000-0000000000a1'; j uuid := '00000000-0000-0000-0000-0000000000b1';
  pa uuid := '10000000-0000-0000-0000-0000000000a1'; pb uuid := '10000000-0000-0000-0000-0000000000a2';
  n int; tbl text; k uuid := gen_random_uuid(); sqls text[];
begin
  sqls := array[
    'select * from public.mgmt_rates_list()',
    'select public.mgmt_rate_set(''generic_staff'', 0.04, ''try it'', gen_random_uuid())',
    format('select * from public.mgmt_salary_columns(%L)', m1),
    format('select public.mgmt_salary_column_add(''Nope'', 1, %L, gen_random_uuid())', m1),
    format('select public.mgmt_salary_column_retire(gen_random_uuid(), %L, gen_random_uuid())', m1),
    format('select * from public.mgmt_generic_month(%L)', m1),
    format('select public.mgmt_generic_save(%L, ''[]''::jsonb, null, gen_random_uuid())', m1),
    format('select * from public.mgmt_salary_month(%L)', m1),
    format('select public.mgmt_salary_save(%L, ''[]''::jsonb, null, gen_random_uuid())', m1),
    format('select public.mgmt_sheet_close(%L, ''generic'', gen_random_uuid())', m1)];

  -- a junior holding EVERY normal permission sees and does nothing
  perform pg_temp.as_user(j);
  foreach tbl in array array['mgmt_rates','mgmt_sheets','mgmt_salary_columns','mgmt_salary_rows','mgmt_generic_rows'] loop
    execute format('select count(*) from public.%I', tbl) into n;
    perform pg_temp.ok(n = 0, 'junior with every normal permission reads no rows of ' || tbl);
  end loop;
  foreach tbl in array sqls loop perform pg_temp.fails(tbl, 'junior is refused: ' || left(tbl, 60), '42501'); end loop;
  reset role;
  -- the owner without MFA holds nothing
  perform pg_temp.as_user(a, 'aal1');
  foreach tbl in array sqls loop perform pg_temp.fails(tbl, 'owner without MFA is refused: ' || left(tbl, 60), '42501'); end loop;
  perform pg_temp.ok((select count(*) from public.mgmt_salary_rows) = 0 and (select count(*) from public.mgmt_rates) = 0, 'an owner without MFA reads no rows');
  reset role;
  -- anon
  set local role anon;
  foreach tbl in array array['mgmt_rates','mgmt_sheets','mgmt_salary_columns','mgmt_salary_rows','mgmt_generic_rows'] loop
    perform pg_temp.fails(format('select * from public.%I', tbl), 'anon cannot read ' || tbl, 'permission denied');
  end loop;
  perform pg_temp.fails(format('select * from public.mgmt_salary_month(%L)', m1), 'anon cannot call the salary month', 'permission denied');
  reset role;
  -- direct writes are refused even for the owner at MFA level 2
  perform pg_temp.as_user(a, 'aal2');
  foreach tbl in array array['mgmt_rates','mgmt_sheets','mgmt_salary_columns','mgmt_salary_rows','mgmt_generic_rows'] loop
    perform pg_temp.fails(format('delete from public.%I', tbl), 'direct delete refused on ' || tbl, 'permission denied');
    perform pg_temp.fails(format('update public.%I set created_at = now()', tbl), 'direct update refused on ' || tbl, 'permission denied');
  end loop;
  perform pg_temp.fails($q$insert into public.mgmt_rates(rate_key, rate, reason) values ('generic_staff', 0.9, 'sneaky')$q$, 'direct rate insert refused', 'permission denied');
  perform pg_temp.fails($q$insert into public.mgmt_generic_rows(sheet_id, staff_id, revision, generic_sale, incentive, final) values (gen_random_uuid(), gen_random_uuid(), 0, 1, 1, 1)$q$, 'direct generic insert refused', 'permission denied');
  reset role;

  -- sharing one key at a time
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');                       -- mgmt.salary_view only
  perform pg_temp.ok((select count(*) from public.mgmt_salary_month(m1)) > 0 and (select count(*) from public.mgmt_generic_month(m1)) > 0, 'salary_view can read both sheets');
  perform pg_temp.ok((select count(*) from public.mgmt_rates_list()) = 1 and (select count(*) from public.mgmt_salary_columns(m1)) > 0, 'and the rates and columns');
  perform pg_temp.ok((select count(*) from public.mgmt_salary_rows) > 0, 'and the rows');
  perform pg_temp.fails(format('select public.mgmt_rate_set(''generic_staff'', 0.04, ''try it'', gen_random_uuid())'), 'salary_view cannot change a rate', '42501');
  perform pg_temp.fails(format('select public.mgmt_salary_save(%L, ''[]''::jsonb, null, gen_random_uuid())', m1), 'salary_view cannot save a salary', '42501');
  perform pg_temp.fails(format('select public.mgmt_generic_save(%L, ''[]''::jsonb, null, gen_random_uuid())', m1), 'salary_view cannot save the generic sheet', '42501');
  perform pg_temp.fails(format('select public.mgmt_salary_column_add(''Nope'', 1, %L, gen_random_uuid())', m1), 'salary_view cannot add a column', '42501');
  perform pg_temp.fails(format('select public.mgmt_sheet_close(%L, ''salary'', gen_random_uuid())', m1), 'salary_view cannot close a month', '42501');
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');                       -- mgmt.salary only
  perform public.mgmt_salary_save(m0, jsonb_build_array(jsonb_build_object('staff_id', pb, 'ho_salary', 5000)), null, k);
  perform pg_temp.ok((select ho_salary from public.mgmt_salary_month(m0) where staff_id = pb) = 5000, 'salary (edit) can save and also read');
  perform pg_temp.ok((public.mgmt_salary_column_add('Shared column', 1, m0, gen_random_uuid()) ->> 'id') is not null, 'salary (edit) can add a column');
  perform pg_temp.fails(format('select public.mgmt_rate_set(''generic_staff'', 0.04, ''try it'', gen_random_uuid())'), 'salary (edit) cannot change a rate', '42501');
  perform pg_temp.fails(format('select public.mgmt_sheet_close(%L, ''salary'', gen_random_uuid())', m0), 'salary (edit) cannot close a month', '42501');
  reset role;
  perform pg_temp.as_user(a, 'aal2');
  perform pg_temp.fails(format('select public.mgmt_salary_save(%L, jsonb_build_array(jsonb_build_object(''staff_id'', %L, ''ho_salary'', 1)), null, %L)', m0, pa, k), 'another person cannot reuse a key', '42501');
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');                       -- mgmt.rates only
  perform pg_temp.ok((public.mgmt_rate_set('generic_staff', 0.04, 'rates key alone', gen_random_uuid()) ->> 'id') is not null, 'the rates key alone can change a rate');
  perform pg_temp.ok((select count(*) from public.mgmt_rates_list()) = 1, 'and see the rates');
  perform pg_temp.fails(format('select * from public.mgmt_salary_month(%L)', m1), 'but not the salary sheet', '42501');
  reset role;
end $t$;
rollback;
