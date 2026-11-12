-- Tests for 0102_mgmt_credit. Maths cases are shared with the browser tests (tests/fixtures/manager-credit-cases.json).
-- All people and figures here are invented.
\set ON_ERROR_STOP on
\set cases `cat ../../tests/fixtures/manager-credit-cases.json`
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

create temp table case_data as select :'cases'::jsonb as j;
grant select on case_data to authenticated;

insert into auth.users(id, email) values
 ('00000000-0000-0000-0000-0000000000a1','a@t'), ('00000000-0000-0000-0000-0000000000b1','b@t'),
 ('00000000-0000-0000-0000-0000000000c1','c@t'), ('00000000-0000-0000-0000-0000000000d1','d@t'),
 ('00000000-0000-0000-0000-0000000000f1','f@t');
select public.bootstrap_first_admin('00000000-0000-0000-0000-0000000000a1','owner','Test Owner');
insert into public.staff(id, full_name) values
 ('10000000-0000-0000-0000-00000000000b','Test Junior B'), ('10000000-0000-0000-0000-00000000000c','Test Viewer C'),
 ('10000000-0000-0000-0000-00000000000d','Test Manager D'), ('10000000-0000-0000-0000-00000000000f','Test Opener F'),
 ('10000000-0000-0000-0000-0000000000a1','Test Person A'), ('10000000-0000-0000-0000-0000000000a2','Test Person B2');
insert into public.profiles(user_id, staff_id, username, role_template) values
 ('00000000-0000-0000-0000-0000000000b1','10000000-0000-0000-0000-00000000000b','junior_b','junior'),
 ('00000000-0000-0000-0000-0000000000c1','10000000-0000-0000-0000-00000000000c','viewer_c','junior'),
 ('00000000-0000-0000-0000-0000000000d1','10000000-0000-0000-0000-00000000000d','manager_d','junior'),
 ('00000000-0000-0000-0000-0000000000f1','10000000-0000-0000-0000-00000000000f','opener_f','junior');
insert into public.user_permissions(user_id, perm_key, effect)
  select '00000000-0000-0000-0000-0000000000b1', key, 'grant' from public.permissions
  where key not like 'mgmt.%' and key not like 'credit.%';
insert into public.user_permissions(user_id, perm_key, effect) values
 ('00000000-0000-0000-0000-0000000000c1','credit.view','grant'),
 ('00000000-0000-0000-0000-0000000000d1','mgmt.credit_manage','grant'),
 ('00000000-0000-0000-0000-0000000000f1','mgmt.openings','grant');

-- 1. the maths: every shared fixture case, through the real function
do $t$ declare c jsonb; sid uuid; o jsonb; rw jsonb; e jsonb; got record; found_row boolean; i int := 0; mth date;
begin
  for c in select * from jsonb_array_elements((select j from case_data)) loop
    i := i + 1; sid := gen_random_uuid();
    insert into public.staff(id, full_name, active) values (sid, 'Fixture ' || i, coalesce((c ->> 'active')::boolean, true));
    o := c -> 'opening';
    if o is not null and o <> 'null'::jsonb then
      insert into public.mgmt_credit_openings(staff_id, effective_month, amount, reason) values (sid, (o ->> 'month')::date, (o ->> 'amount')::numeric, 'fixture');
    end if;
    for rw in select * from jsonb_array_elements(c -> 'rows') loop
      insert into public.mgmt_credit_entries(staff_id, entry_date, kind, amount) values (sid, (rw ->> 'date')::date, rw ->> 'kind', (rw ->> 'amount')::numeric);
    end loop;
    mth := (c ->> 'month')::date; e := c -> 'expect';
    perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
    select * into got from public.mgmt_credit_month(mth) m where m.staff_id = sid;
    found_row := got.staff_id is not null;
    perform pg_temp.ok(found_row = (e ->> 'listed')::boolean, 'fixture listed: ' || (c ->> 'name'));
    if found_row then
      perform pg_temp.ok(got.prev_balance = (e ->> 'prev')::numeric and got.entries_total = (e ->> 'entries')::numeric
        and got.salary_deduction = (e ->> 'salary_deduction')::numeric and got.generic_deduction = (e ->> 'generic_deduction')::numeric
        and got.net = (e ->> 'net')::numeric, 'fixture maths: ' || (c ->> 'name'));
    end if;
    reset role;
  end loop;
end $t$;

do $t$ declare
  today date := (now() at time zone 'Asia/Karachi')::date; m0 date := date_trunc('month', (now() at time zone 'Asia/Karachi')::date)::date;
  pa uuid := '10000000-0000-0000-0000-0000000000a1'; pb uuid := '10000000-0000-0000-0000-0000000000a2';
  a uuid := '00000000-0000-0000-0000-0000000000a1'; j uuid := '00000000-0000-0000-0000-0000000000b1';
  r jsonb; r2 jsonb; k uuid; eid uuid; rid uuid; n int; tbl text; m record;
begin
  -- 2. opening balance
  perform pg_temp.as_user(a, 'aal2');
  perform pg_temp.fails(format($q$select public.mgmt_credit_set_opening(%L, %L, 5000, 'start', gen_random_uuid())$q$, pa, m0 + 3), 'an opening not on the 1st is refused', 'first day');
  perform pg_temp.fails(format($q$select public.mgmt_credit_set_opening(%L, %L, 5000, 'start', gen_random_uuid())$q$, pa, (m0 + interval '1 month')::date), 'an opening in a future month is refused', 'future');
  perform pg_temp.fails(format($q$select public.mgmt_credit_set_opening(%L, %L, 5000, 'x', gen_random_uuid())$q$, pa, m0), 'an opening without a real reason is refused', 'reason');
  perform pg_temp.fails(format($q$select public.mgmt_credit_set_opening(%L, %L, 5000.123, 'start', gen_random_uuid())$q$, pa, m0), 'three decimals are refused', '2 decimals');
  perform pg_temp.fails(format($q$select public.mgmt_credit_set_opening(%L, %L, 5000, 'start', gen_random_uuid())$q$, gen_random_uuid(), m0), 'an unknown person is refused', 'unknown staff');
  perform pg_temp.fails(format($q$select public.mgmt_credit_set_opening(%L, %L, 5000, 'start', null)$q$, pa, m0), 'a missing key is refused', 'idempotency key');
  k := gen_random_uuid();
  r := public.mgmt_credit_set_opening(pa, m0, 5000, 'opening at start of use', k);
  perform pg_temp.ok(public.mgmt_credit_set_opening(pa, m0, 5000, 'opening at start of use', k) = r and (select count(*) from public.mgmt_credit_openings where staff_id = pa) = 1, 'the same key twice sets one opening');
  select * into m from public.mgmt_credit_month(m0) where staff_id = pa;
  perform pg_temp.ok(m.prev_balance = 5000 and m.net = 5000, 'the opening is the previous balance of its own month');

  -- 3. add an entry
  k := gen_random_uuid();
  r := public.mgmt_credit_add(pa, today, 'Advance for test', 2000, k);
  eid := (r ->> 'id')::uuid;
  perform pg_temp.ok(public.mgmt_credit_add(pa, today, 'Advance for test', 2000, k) = r and (select count(*) from public.mgmt_credit_entries where staff_id = pa) = 1, 'the same key twice adds one entry');
  select * into m from public.mgmt_credit_month(m0) where staff_id = pa;
  perform pg_temp.ok(m.entries_total = 2000 and m.net = 7000 and jsonb_array_length(m.entries) = 1, 'an entry raises the net');
  perform pg_temp.fails(format($q$select public.mgmt_credit_add(%L, %L, 'x', 100, gen_random_uuid())$q$, pa, today + 1), 'a future date is refused', 'future');
  perform pg_temp.fails(format($q$select public.mgmt_credit_add(%L, %L, 'x', 100, gen_random_uuid())$q$, pa, m0 - 1), 'a date before the opening month is refused', 'opening balance month');
  perform pg_temp.fails(format($q$select public.mgmt_credit_add(%L, %L, 'x', 0, gen_random_uuid())$q$, pa, today), 'a zero amount is refused', 'amount');
  perform pg_temp.fails(format($q$select public.mgmt_credit_add(%L, %L, 'x', 10.005, gen_random_uuid())$q$, pa, today), 'three decimals are refused', '2 decimals');
  perform pg_temp.fails(format($q$select public.mgmt_credit_add(%L, %L, 'x', 2000000000, gen_random_uuid())$q$, pa, today), 'a huge amount is refused', 'out of range');
  perform pg_temp.fails(format($q$select public.mgmt_credit_add(%L, %L, 'x', 100, gen_random_uuid())$q$, gen_random_uuid(), today), 'an unknown person is refused', 'unknown staff');
  perform pg_temp.fails(format($q$select public.mgmt_credit_add(%L, %L, %L, 100, gen_random_uuid())$q$, pa, today, repeat('x', 201)), 'a 201-character description is refused', 'too long');
  perform pg_temp.ok((select count(*) from public.mgmt_credit_entries where staff_id = pa) = 1, 'refused entries left nothing behind');

  -- 4. reverse
  perform pg_temp.fails(format($q$select public.mgmt_credit_reverse(%L, 'no', gen_random_uuid())$q$, eid), 'a reversal without a real reason is refused', 'reason');
  perform pg_temp.fails($q$select public.mgmt_credit_reverse(gen_random_uuid(), 'wrong person', gen_random_uuid())$q$, 'an unknown entry is refused', 'unknown entry');
  k := gen_random_uuid();
  r := public.mgmt_credit_reverse(eid, 'typed for the wrong person', k);
  rid := (r ->> 'id')::uuid;
  perform pg_temp.ok(public.mgmt_credit_reverse(eid, 'typed for the wrong person', k) = r, 'the same key twice returns the same reversal');
  select * into m from public.mgmt_credit_month(m0) where staff_id = pa;
  perform pg_temp.ok(m.net = 5000 and m.entries_total = 0 and jsonb_array_length(m.entries) = 2, 'the reversal cancels the entry and both lines stay visible');
  perform pg_temp.ok((m.entries -> 0 ->> 'reversed_by')::uuid = rid and (m.entries -> 1 ->> 'reverses_id')::uuid = eid, 'the month shows which line reversed which');
  perform pg_temp.ok((select entry_date from public.mgmt_credit_entries where id = rid) = today and (select amount from public.mgmt_credit_entries where id = rid) = -2000, 'the reversal has the original date and the opposite sign');
  perform pg_temp.fails(format($q$select public.mgmt_credit_reverse(%L, 'again please', gen_random_uuid())$q$, eid), 'an entry cannot be reversed twice', 'already reversed');
  perform pg_temp.fails(format($q$select public.mgmt_credit_reverse(%L, 'undo the undo', gen_random_uuid())$q$, rid), 'a reversal cannot be reversed', 'cannot be reversed');

  -- 5. deductions (the old typed fields)
  perform public.mgmt_credit_add(pa, today, 'Second advance', 3000, gen_random_uuid());
  r := public.mgmt_credit_set_deduction(pa, m0, 'salary_deduction', 1500, null, gen_random_uuid());
  select * into m from public.mgmt_credit_month(m0) where staff_id = pa;
  perform pg_temp.ok(m.salary_deduction = 1500 and m.net = 5000 + 3000 - 1500, 'a salary deduction lowers the net (old formula)');
  r2 := public.mgmt_credit_set_deduction(pa, m0, 'salary_deduction', 1500, null, gen_random_uuid());
  perform pg_temp.ok((r2 ->> 'unchanged') = 'true' and (select count(*) from public.mgmt_credit_entries where staff_id = pa and kind = 'salary_deduction') = 1, 'setting the same number adds no row');
  perform pg_temp.fails(format($q$select public.mgmt_credit_set_deduction(%L, %L, 'salary_deduction', 2000, null, gen_random_uuid())$q$, pa, m0), 'changing a deduction needs a reason', 'reason');
  perform public.mgmt_credit_set_deduction(pa, m0, 'salary_deduction', 2000, 'corrected after check', gen_random_uuid());
  perform public.mgmt_credit_set_deduction(pa, m0, 'generic_deduction', 400, null, gen_random_uuid());
  select * into m from public.mgmt_credit_month(m0) where staff_id = pa;
  perform pg_temp.ok(m.salary_deduction = 2000 and m.generic_deduction = 400 and m.net = 5000 + 3000 - 2000 - 400 and m.entries_total = 3000 + 0, 'raising a deduction adds a delta row; the month shows one number each');
  perform public.mgmt_credit_set_deduction(pa, m0, 'salary_deduction', 0, 'not deducted after all', gen_random_uuid());
  select * into m from public.mgmt_credit_month(m0) where staff_id = pa;
  perform pg_temp.ok(m.salary_deduction = 0 and (select count(*) from public.mgmt_credit_entries where staff_id = pa and kind = 'salary_deduction') = 3, 'a deduction can go back to zero; the history stays');
  perform pg_temp.ok(jsonb_array_length(m.entries) = 3, 'deduction rows are not listed among the entries');
  perform pg_temp.fails(format($q$select public.mgmt_credit_set_deduction(%L, %L, 'salary_deduction', 100, null, gen_random_uuid())$q$, pa, (m0 + interval '1 month')::date), 'a future month is refused', 'not started');
  perform pg_temp.fails(format($q$select public.mgmt_credit_set_deduction(%L, %L, 'salary_deduction', 100, null, gen_random_uuid())$q$, pa, (m0 - interval '1 month')::date), 'a month before the opening month is refused', 'opening balance month');
  perform pg_temp.fails(format($q$select public.mgmt_credit_set_deduction(%L, %L, 'salary_deduction', -5, null, gen_random_uuid())$q$, pa, m0), 'a negative deduction is refused', 'deduction must');
  perform pg_temp.fails(format($q$select public.mgmt_credit_set_deduction(%L, %L, 'bonus', 5, null, gen_random_uuid())$q$, pa, m0), 'an unknown deduction type is refused', 'unknown deduction');
  perform pg_temp.fails(format($q$select public.mgmt_credit_set_deduction(%L, %L, 'salary_deduction', 5, null, gen_random_uuid())$q$, pa, m0 + 4), 'a month not on the 1st is refused', 'first day');

  -- 6. a later opening supersedes, the history stays; entries before the new month block it
  perform public.mgmt_credit_set_opening(pa, m0, 6000, 'corrected opening', gen_random_uuid());
  select * into m from public.mgmt_credit_month(m0) where staff_id = pa;
  perform pg_temp.ok(m.opening_amount = 6000 and m.prev_balance = 6000 and (select count(*) from public.mgmt_credit_openings where staff_id = pa) = 2, 'the latest opening wins and the old one stays in the history');
  reset role;
  insert into public.mgmt_credit_entries(staff_id, entry_date, kind, amount, description) values (pb, m0 - 70, 'entry', 100, 'old row');
  perform pg_temp.as_user(a, 'aal2');
  perform pg_temp.fails(format($q$select public.mgmt_credit_set_opening(%L, %L, 0, 'start later', gen_random_uuid())$q$, pb, m0), 'an opening later than existing rows is refused', 'before that month');
  perform public.mgmt_credit_set_opening(pb, (date_trunc('month', m0 - 70))::date, 0, 'start at the old row', gen_random_uuid());

  -- 7. the log
  reset role;
  perform pg_temp.ok((select count(*) from public.activity_log where action in ('mgmt.credit_added','mgmt.credit_reversed','mgmt.credit_deduction_set','mgmt.credit_opening_set')) >= 8, 'entries, reversals, deductions and openings are logged');
  perform pg_temp.ok((select count(*) from public.activity_log where action = 'mgmt.credit_reversed' and reason = 'typed for the wrong person') = 1, 'the reversal reason is in the log');

  -- 8. append-only, even for the database owner
  perform pg_temp.fails($q$update public.mgmt_credit_entries set amount = 1$q$, 'an entry cannot be changed', 'append-only');
  perform pg_temp.fails($q$delete from public.mgmt_credit_entries$q$, 'an entry cannot be deleted', 'append-only');
  perform pg_temp.fails($q$update public.mgmt_credit_openings set amount = 1$q$, 'an opening cannot be changed', 'append-only');
  perform pg_temp.fails($q$delete from public.mgmt_credit_openings$q$, 'an opening cannot be deleted', 'append-only');
  perform pg_temp.fails(format($q$insert into public.mgmt_credit_entries(staff_id, entry_date, kind, amount, reverses_id, reason) values (%L, %L, 'entry', -2000, %L, 'sneaky second reversal')$q$, pa, today, eid), 'even a direct insert cannot reverse an entry twice', 'unique');
  perform pg_temp.fails(format($q$insert into public.mgmt_credit_entries(staff_id, entry_date, kind, amount, reverses_id) values (%L, %L, 'entry', -1, %L)$q$, pa, today, (select id from public.mgmt_credit_entries where staff_id = pa and kind = 'generic_deduction' limit 1)), 'a reversal row must carry a reason', 'check');
  perform pg_temp.fails(format($q$delete from public.staff where id = %L$q$, pa), 'a person with credit rows can never be deleted', 'foreign key');

  -- 9. a junior with every normal permission, an owner without MFA, anon, direct writes
  perform pg_temp.as_user(j);
  foreach tbl in array array['mgmt_credit_entries','mgmt_credit_openings'] loop
    execute format('select count(*) from public.%I', tbl) into n;
    perform pg_temp.ok(n = 0, 'junior with every normal permission reads no rows of ' || tbl);
  end loop;
  perform pg_temp.fails(format($q$select * from public.mgmt_credit_month(%L)$q$, m0), 'junior cannot open the month', '42501');
  perform pg_temp.fails(format($q$select public.mgmt_credit_add(%L, %L, 'x', 5, gen_random_uuid())$q$, pa, today), 'junior cannot add an entry', '42501');
  perform pg_temp.fails(format($q$select public.mgmt_credit_reverse(%L, 'try it', gen_random_uuid())$q$, eid), 'junior cannot reverse', '42501');
  perform pg_temp.fails(format($q$select public.mgmt_credit_set_deduction(%L, %L, 'salary_deduction', 5, null, gen_random_uuid())$q$, pa, m0), 'junior cannot set a deduction', '42501');
  perform pg_temp.fails(format($q$select public.mgmt_credit_set_opening(%L, %L, 5, 'try it', gen_random_uuid())$q$, pb, m0), 'junior cannot set an opening', '42501');
  reset role;
  perform pg_temp.as_user(a, 'aal1');
  perform pg_temp.fails(format($q$select * from public.mgmt_credit_month(%L)$q$, m0), 'an owner without MFA cannot open the month', '42501');
  perform pg_temp.fails(format($q$select public.mgmt_credit_add(%L, %L, 'x', 5, gen_random_uuid())$q$, pa, today), 'an owner without MFA cannot add', '42501');
  perform pg_temp.ok((select count(*) from public.mgmt_credit_entries) = 0, 'an owner without MFA reads no rows');
  reset role;
  set local role anon;
  perform pg_temp.fails($q$select * from public.mgmt_credit_entries$q$, 'anon cannot read entries', 'permission denied');
  perform pg_temp.fails($q$select * from public.mgmt_credit_openings$q$, 'anon cannot read openings', 'permission denied');
  perform pg_temp.fails(format($q$select * from public.mgmt_credit_month(%L)$q$, m0), 'anon cannot call the month', 'permission denied');
  reset role;
  perform pg_temp.as_user(a, 'aal2');
  perform pg_temp.fails($q$insert into public.mgmt_credit_entries(staff_id, entry_date, kind, amount) values (gen_random_uuid(), current_date, 'entry', 1)$q$, 'direct insert refused for the owner too', 'permission denied');
  perform pg_temp.fails($q$update public.mgmt_credit_entries set amount = 1$q$, 'direct update refused for the owner too', 'permission denied');
  perform pg_temp.fails($q$delete from public.mgmt_credit_entries$q$, 'direct delete refused for the owner too', 'permission denied');
  perform pg_temp.fails($q$insert into public.mgmt_credit_openings(staff_id, effective_month, amount, reason) values (gen_random_uuid(), current_date, 1, 'abc')$q$, 'direct opening insert refused for the owner too', 'permission denied');
  reset role;

  -- 10. sharing one key at a time
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');                      -- credit.view only
  perform pg_temp.ok((select net from public.mgmt_credit_month(m0) where staff_id = pa) = 6000 + 3000 - 400, 'credit.view can read the month');
  perform pg_temp.ok((select count(*) from public.mgmt_credit_entries) > 0, 'credit.view can read the rows');
  perform pg_temp.fails(format($q$select public.mgmt_credit_add(%L, %L, 'x', 5, gen_random_uuid())$q$, pa, today), 'credit.view cannot add', '42501');
  perform pg_temp.fails(format($q$select public.mgmt_credit_reverse(%L, 'try it', gen_random_uuid())$q$, (select id from public.mgmt_credit_entries where kind = 'entry' and reverses_id is null and amount = 3000 limit 1)), 'credit.view cannot reverse', '42501');
  perform pg_temp.fails(format($q$select public.mgmt_credit_set_deduction(%L, %L, 'salary_deduction', 5, null, gen_random_uuid())$q$, pa, m0), 'credit.view cannot set a deduction', '42501');
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');                      -- credit_manage only
  perform pg_temp.ok((public.mgmt_credit_add(pa, today, 'Shared add', 10, gen_random_uuid()) ->> 'id') is not null, 'credit_manage can add');
  perform pg_temp.ok((select count(*) from public.mgmt_credit_month(m0) where staff_id = pa) = 1, 'credit_manage can also read (editing implies reading)');
  perform pg_temp.fails(format($q$select public.mgmt_credit_set_opening(%L, %L, 1, 'try it', gen_random_uuid())$q$, pb, m0), 'credit_manage cannot set an opening', '42501');
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');                      -- openings only
  perform pg_temp.ok((public.mgmt_credit_set_opening('10000000-0000-0000-0000-00000000000c'::uuid, m0, 0, 'zero opening', gen_random_uuid()) ->> 'id') is not null, 'mgmt.openings alone can set an opening');
  perform pg_temp.fails(format($q$select * from public.mgmt_credit_month(%L)$q$, m0), 'but cannot read the month', '42501');
  perform pg_temp.fails(format($q$select public.mgmt_credit_add(%L, %L, 'x', 5, gen_random_uuid())$q$, pa, today), 'and cannot add entries', '42501');
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
  perform pg_temp.fails(format($q$select public.mgmt_credit_add(%L, %L, 'x', 5, %L)$q$, pa, today, k), 'another person cannot reuse a key', '42501');
  reset role;
end $t$;
-- 11. exposure guard: no Manager function may be callable by anon, and authenticated may call ONLY this whitelist.
-- (Every future Manager migration that adds a callable function must add it here on purpose.)
do $t$ declare bad text; begin
  select string_agg(p.proname, ', ') into bad from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'mgmt\_%' and has_function_privilege('anon', p.oid, 'execute');
  perform pg_temp.ok(bad is null, 'no Manager function is executable by anon' || coalesce(' (found: ' || bad || ')', ''));
  select string_agg(p.proname, ', ' order by p.proname) into bad from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'mgmt\_%' and has_function_privilege('authenticated', p.oid, 'execute')
     and p.proname not in ('mgmt_staff_list','mgmt_staff_get','mgmt_staff_save','mgmt_note_add','mgmt_note_remove',
                           'mgmt_credit_add','mgmt_credit_reverse','mgmt_credit_set_deduction','mgmt_credit_set_opening','mgmt_credit_month');
  perform pg_temp.ok(bad is null, 'authenticated can execute only the whitelisted Manager functions' || coalesce(' (found: ' || bad || ')', ''));
  perform pg_temp.ok((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'mgmt\_%' and has_function_privilege('authenticated', p.oid, 'execute')) = 10,
    'all ten whitelisted functions exist and are callable');
end $t$;
rollback;
