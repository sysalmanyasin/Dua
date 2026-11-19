-- Tests for 0107_mgmt_ledgers. Running-balance cases are shared with the browser tests (tests/fixtures/manager-ledger-cases.json).
-- All people and figures here are invented.
\set ON_ERROR_STOP on
\set lcases `cat ../../tests/fixtures/manager-ledger-cases.json`
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
create temp table case_data as select :'lcases'::jsonb as j;
grant select on case_data to authenticated;

insert into auth.users(id, email) values
 ('00000000-0000-0000-0000-0000000000a1','a@t'), ('00000000-0000-0000-0000-0000000000b1','b@t'),
 ('00000000-0000-0000-0000-0000000000c1','c@t'), ('00000000-0000-0000-0000-0000000000d1','d@t');
select public.bootstrap_first_admin('00000000-0000-0000-0000-0000000000a1','owner','Test Owner');
insert into public.staff(id, full_name) values
 ('10000000-0000-0000-0000-00000000000b','Test Junior B'), ('10000000-0000-0000-0000-00000000000c','Test Ledger C'), ('10000000-0000-0000-0000-00000000000d','Test Salary D');
insert into public.profiles(user_id, staff_id, username, role_template) values
 ('00000000-0000-0000-0000-0000000000b1','10000000-0000-0000-0000-00000000000b','junior_b','junior'),
 ('00000000-0000-0000-0000-0000000000c1','10000000-0000-0000-0000-00000000000c','ledger_c','junior'),
 ('00000000-0000-0000-0000-0000000000d1','10000000-0000-0000-0000-00000000000d','salary_d','junior');
insert into public.user_permissions(user_id, perm_key, effect)
  select '00000000-0000-0000-0000-0000000000b1', key, 'grant' from public.permissions where key not like 'mgmt.%' and key not like 'credit.%';
insert into public.user_permissions(user_id, perm_key, effect) values
 ('00000000-0000-0000-0000-0000000000c1','mgmt.ledgers','grant'),
 ('00000000-0000-0000-0000-0000000000d1','mgmt.salary','grant'),
 ('00000000-0000-0000-0000-0000000000d1','mgmt.salary_view','grant');

-- 1. the running balance: every shared case, through the real view, on a fresh Misc Section
do $t$ declare c jsonb; i int := 0; e jsonb; lid uuid; cat_up uuid; cat_dn uuid; idx int; got numeric; x record;
begin
  for c in select * from jsonb_array_elements((select j from case_data)) loop
    i := i + 1;
    perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
    lid := (public.mgmt_ledger_section_create('Fixture section ' || i, '[{"name":"Up","direction":1},{"name":"Down","direction":-1}]'::jsonb, gen_random_uuid()) ->> 'id')::uuid;
    reset role;
    select id into cat_up from public.mgmt_ledger_categories where ledger_id = lid and name = 'Up';
    select id into cat_dn from public.mgmt_ledger_categories where ledger_id = lid and name = 'Down';
    idx := 0;
    for e in select * from jsonb_array_elements(c -> 'entries') loop
      insert into public.mgmt_ledger_entries(ledger_id, category_id, entry_date, description, amount, effect)
        values (lid, case when (e ->> 'effect')::int = 1 then cat_up else cat_dn end, (e ->> 'date')::date, idx::text, (e ->> 'amount')::numeric, (e ->> 'effect')::int);
      idx := idx + 1;
    end loop;
    perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
    idx := 0;
    for e in select * from jsonb_array_elements(c -> 'balances') loop
      select balance_after into got from public.mgmt_ledger_view(lid) where description = idx::text;
      perform pg_temp.ok(got = (e #>> '{}')::numeric, 'ledger fixture: ' || (c ->> 'name') || ' [entry ' || idx || ' = ' || got || ']');
      idx := idx + 1;
    end loop;
    reset role;
  end loop;
end $t$;

do $t$ declare
  today date := (now() at time zone 'Asia/Karachi')::date;
  a uuid := '00000000-0000-0000-0000-0000000000a1'; j uuid := '00000000-0000-0000-0000-0000000000b1';
  ex uuid; jz uuid; c_bill uuid; c_ho uuid; c_recv uuid; c_xfer uuid; r jsonb; r2 jsonb; k uuid; n int; tbl text; got record; sqls text[]; eid uuid; rid uuid; sec uuid; c_s1 uuid; c_s2 uuid;
  acc uuid; acc2 uuid; accs jsonb;
begin
  perform pg_temp.as_user(a, 'aal2');
  select ledger_id into ex from public.mgmt_ledgers_list() where code = 'expense';
  select ledger_id into jz from public.mgmt_ledgers_list() where code = 'jazzcash';

  -- 2. the starting data
  perform pg_temp.ok((select count(*) from public.mgmt_ledger_categories c join public.mgmt_ledgers l on l.id = c.ledger_id where l.code in ('expense','jazzcash')) = 12, 'the two built-in ledgers start with 12 categories');
  select id into c_bill from public.mgmt_ledger_categories where ledger_id = ex and name = 'Bill';
  select id into c_ho from public.mgmt_ledger_categories where ledger_id = ex and name = 'Cash received from Head Office';
  select id into c_recv from public.mgmt_ledger_categories where ledger_id = jz and name = 'Received';
  select id into c_xfer from public.mgmt_ledger_categories where ledger_id = jz and name = 'Transfer';
  perform pg_temp.ok((select direction from public.mgmt_ledger_categories where id = c_bill) = 1 and (select direction from public.mgmt_ledger_categories where id = c_ho) = -1, 'Expense: a bill ADDS, cash from Head Office REDUCES (the owner''s rule)');
  perform pg_temp.ok((select direction from public.mgmt_ledger_categories where id = c_recv) = 1 and (select direction from public.mgmt_ledger_categories where id = c_xfer) = -1, 'Jazz Cash: Received ADDS, Transfer REDUCES');
  perform pg_temp.ok((select count(*) from public.mgmt_ledger_categories where ledger_id = jz and name in ('Patty Incentive','Generic Incentive','Strips/Adjustments') and direction = -1) = 3, 'the other Jazz Cash outgoings reduce too');
  perform pg_temp.ok((select balance from public.mgmt_ledgers_list() where code = 'expense') = 0 and (select balance from public.mgmt_ledgers_list() where code = 'jazzcash') = 0, 'every ledger starts at zero');
  perform pg_temp.ok((select count(*) from public.mgmt_tally_accounts_list()) = 6, 'the tally starts with 6 accounts');

  -- 3. Expense: the first entry may be cash from Head Office
  k := gen_random_uuid();
  r := public.mgmt_ledger_add(ex, c_ho, today - 3, null, 'Test cash from HO', 24500, k);
  perform pg_temp.ok(public.mgmt_ledger_add(ex, c_ho, today - 3, null, 'Test cash from HO', 24500, k) = r and (select count(*) from public.mgmt_ledger_entries where ledger_id = ex) = 1, 'the same key twice adds one entry');
  perform pg_temp.ok((select balance from public.mgmt_ledgers_list() where code = 'expense') = -24500, 'cash from Head Office first gives -24,500: the branch holds their cash');
  perform public.mgmt_ledger_add(ex, c_bill, today - 2, null, 'Test bill', 50, gen_random_uuid());
  perform public.mgmt_ledger_add(ex, c_bill, today - 1, null, 'Test bill', 300, gen_random_uuid());
  perform pg_temp.ok((select balance from public.mgmt_ledgers_list() where code = 'expense') = -24150, 'expenses add (-24,500 + 50 + 300 = -24,150)');
  perform pg_temp.ok((select array_agg(balance_after order by entry_date, entry_id) from public.mgmt_ledger_view(ex)) = array[-24500, -24450, -24150]::numeric[], 'the view carries a running balance');
  select * into got from public.mgmt_ledger_view(ex) where description = 'Test cash from HO';
  perform pg_temp.ok(got.effect = -1 and got.category_direction = -1 and got.amount = 24500, 'an entry stores its amount as positive and its direction as made');
  perform pg_temp.ok((select balance_after from public.mgmt_ledger_view(ex, today - 1, today) where description = 'Test bill') = -24150, 'a date range keeps the balance from earlier entries');
  perform pg_temp.ok((select count(*) from public.mgmt_ledger_view(ex, today - 1, today)) = 1, 'and only lists entries inside it');

  -- 4. Jazz Cash: shift rules
  perform pg_temp.fails(format($q$select public.mgmt_ledger_add(%L, %L, %L, null, 'x', 100, gen_random_uuid())$q$, jz, c_recv, today), 'Jazz Cash needs a shift', 'pick a shift');
  perform pg_temp.fails(format($q$select public.mgmt_ledger_add(%L, %L, %L, 'Midnight', 'x', 100, gen_random_uuid())$q$, jz, c_recv, today), 'an unknown shift is refused', 'unknown shift');
  perform pg_temp.fails(format($q$select public.mgmt_ledger_add(%L, %L, %L, 'Morning', 'x', 100, gen_random_uuid())$q$, ex, c_bill, today), 'Expense has no shifts', 'no shifts');
  perform public.mgmt_ledger_add(jz, c_recv, today - 1, 'Morning', 'Test received', 53796, gen_random_uuid());
  perform public.mgmt_ledger_add(jz, c_xfer, today - 1, 'Evening', 'Test transfer', 78942, gen_random_uuid());
  perform pg_temp.ok((select balance from public.mgmt_ledgers_list() where code = 'jazzcash') = -25146, 'Jazz Cash: received adds, transfer reduces (53,796 - 78,942 = -25,146)');
  -- an entry dated AFTER the tally date, so a count must use the balance as of its own date, not today's
  perform public.mgmt_ledger_add(jz, c_recv, today, 'Night', 'Test later received', 7, gen_random_uuid());

  -- 5. validation
  perform pg_temp.fails(format($q$select public.mgmt_ledger_add(%L, %L, %L, null, 'x', 0, gen_random_uuid())$q$, ex, c_bill, today), 'zero is refused', 'above zero');
  perform pg_temp.fails(format($q$select public.mgmt_ledger_add(%L, %L, %L, null, 'x', -5, gen_random_uuid())$q$, ex, c_bill, today), 'a negative amount is refused (direction comes from the category)', 'above zero');
  perform pg_temp.fails(format($q$select public.mgmt_ledger_add(%L, %L, %L, null, 'x', 10.005, gen_random_uuid())$q$, ex, c_bill, today), 'three decimals are refused', '2 decimals');
  perform pg_temp.fails(format($q$select public.mgmt_ledger_add(%L, %L, %L, null, 'x', 2000000000, gen_random_uuid())$q$, ex, c_bill, today), 'a huge amount is refused', 'out of range');
  perform pg_temp.fails(format($q$select public.mgmt_ledger_add(%L, %L, %L, null, 'x', 5, gen_random_uuid())$q$, ex, c_bill, today + 1), 'a future date is refused', 'future');
  perform pg_temp.fails(format($q$select public.mgmt_ledger_add(%L, %L, %L, null, %L, 5, gen_random_uuid())$q$, ex, c_bill, today, repeat('x', 201)), 'a 201-character description is refused', 'too long');
  perform pg_temp.fails(format($q$select public.mgmt_ledger_add(%L, %L, %L, null, 'x', 5, gen_random_uuid())$q$, ex, c_recv, today), 'a category of another ledger is refused', 'does not belong');
  perform pg_temp.fails(format($q$select public.mgmt_ledger_add(%L, %L, %L, null, 'x', 5, gen_random_uuid())$q$, gen_random_uuid(), c_bill, today), 'an unknown ledger is refused', 'unknown ledger');
  perform pg_temp.fails(format($q$select public.mgmt_ledger_add(%L, %L, %L, null, 'x', 5, null)$q$, ex, c_bill, today), 'a missing key is refused', 'idempotency key');
  perform pg_temp.ok((select count(*) from public.mgmt_ledger_entries where ledger_id = ex) = 3, 'refused entries left nothing behind');

  -- 6. reversals
  select entry_id into eid from public.mgmt_ledger_view(ex) where description = 'Test bill' and amount = 300;
  perform pg_temp.fails(format($q$select public.mgmt_ledger_reverse(%L, 'no', gen_random_uuid())$q$, eid), 'a reversal needs a real reason', 'reason');
  perform pg_temp.fails($q$select public.mgmt_ledger_reverse(gen_random_uuid(), 'wrong one', gen_random_uuid())$q$, 'an unknown entry is refused', 'unknown entry');
  k := gen_random_uuid();
  r := public.mgmt_ledger_reverse(eid, 'typed twice by mistake', k);
  rid := (r ->> 'id')::uuid;
  perform pg_temp.ok(public.mgmt_ledger_reverse(eid, 'typed twice by mistake', k) = r, 'the same key twice returns the same reversal');
  perform pg_temp.ok((select balance from public.mgmt_ledgers_list() where code = 'expense') = -24450, 'a reversal cancels the entry (balance back to -24,450)');
  select * into got from public.mgmt_ledger_view(ex) where entry_id = rid;
  perform pg_temp.ok(got.effect = -1 and got.amount = 300 and got.reverses_id = eid and got.entry_date = today - 1, 'the reversal has the same date and amount with the opposite direction');
  perform pg_temp.ok((select reversed_by from public.mgmt_ledger_view(ex) where entry_id = eid) = rid, 'the original shows which line reversed it');
  perform pg_temp.fails(format($q$select public.mgmt_ledger_reverse(%L, 'again please', gen_random_uuid())$q$, eid), 'an entry cannot be reversed twice', 'already reversed');
  perform pg_temp.fails(format($q$select public.mgmt_ledger_reverse(%L, 'undo the undo', gen_random_uuid())$q$, rid), 'a reversal cannot be reversed', 'cannot be reversed');

  -- 7. Misc Sections and categories
  r := public.mgmt_ledger_section_create('Test shop sundries', '[{"name":"Stock in","direction":1},{"name":"Stock out","direction":-1}]'::jsonb, gen_random_uuid());
  sec := (r ->> 'id')::uuid;
  perform pg_temp.ok((select count(*) from public.mgmt_ledgers_list() where kind = 'misc' and name = 'Test shop sundries') = 1 and (select jsonb_array_length(categories) from public.mgmt_ledgers_list() where name = 'Test shop sundries') = 2, 'a Misc Section is created with its categories');

  perform pg_temp.fails($q$select public.mgmt_ledger_section_create('  test SHOP sundries ', '[{"name":"A","direction":1}]'::jsonb, gen_random_uuid())$q$, 'a duplicate section name is refused', 'already exists');
  perform pg_temp.fails($q$select public.mgmt_ledger_section_create('Bad direction', '[{"name":"A","direction":2}]'::jsonb, gen_random_uuid())$q$, 'a direction other than adds or reduces is refused', 'adds (1) or reduces');
  perform pg_temp.fails($q$select public.mgmt_ledger_section_create('No categories', '[]'::jsonb, gen_random_uuid())$q$, 'a section needs categories', '1 to 20');
  perform pg_temp.fails($q$select public.mgmt_ledger_section_create('Twin names', '[{"name":"A","direction":1},{"name":" a ","direction":-1}]'::jsonb, gen_random_uuid())$q$, 'two categories with one name are refused', 'same name');
  perform pg_temp.fails($q$select public.mgmt_ledger_section_create('', '[{"name":"A","direction":1}]'::jsonb, gen_random_uuid())$q$, 'a section needs a name', '1 to 40');
  perform pg_temp.ok((select count(*) from public.mgmt_ledgers where name in ('Bad direction','No categories','Twin names')) = 0, 'refused sections left nothing behind');
  select id into c_s1 from public.mgmt_ledger_categories where ledger_id = sec and name = 'Stock in';
  select id into c_s2 from public.mgmt_ledger_categories where ledger_id = sec and name = 'Stock out';
  perform public.mgmt_ledger_add(sec, c_s1, today, null, 'Test stock in', 700, gen_random_uuid());
  perform public.mgmt_ledger_add(sec, c_s2, today, null, 'Test stock out', 200, gen_random_uuid());
  perform pg_temp.ok((select balance from public.mgmt_ledgers_list() where name = 'Test shop sundries') = 500, 'a Misc Section balances by the owner''s own directions');
  r := public.mgmt_ledger_category_add(sec, 'Wastage', -1, gen_random_uuid());
  perform pg_temp.ok((r ->> 'id') is not null and (select jsonb_array_length(categories) from public.mgmt_ledgers_list() where name = 'Test shop sundries') = 3, 'a category can be added to a ledger');
  perform pg_temp.fails(format($q$select public.mgmt_ledger_category_add(%L, 'wastage', 1, gen_random_uuid())$q$, sec), 'a duplicate category name is refused', 'already exists');
  perform pg_temp.fails(format($q$select public.mgmt_ledger_category_add(%L, 'X', 0, gen_random_uuid())$q$, sec), 'a bad direction is refused', 'adds (1) or reduces');
  perform public.mgmt_ledger_category_retire((r ->> 'id')::uuid, gen_random_uuid());
  perform pg_temp.fails(format($q$select public.mgmt_ledger_add(%L, %L, %L, null, 'x', 5, gen_random_uuid())$q$, sec, (r ->> 'id')::uuid, today), 'a retired category cannot take new entries', 'retired');
  perform pg_temp.fails(format($q$select public.mgmt_ledger_category_retire(%L, gen_random_uuid())$q$, (r ->> 'id')::uuid), 'a category cannot be retired twice', 'already retired');
  perform public.mgmt_ledger_category_retire(c_s2, gen_random_uuid());
  perform pg_temp.fails(format($q$select public.mgmt_ledger_category_retire(%L, gen_random_uuid())$q$, c_s1), 'the last category of a ledger cannot be retired', 'at least one');
  perform pg_temp.ok((select count(*) from public.mgmt_ledger_view(sec) where category_name = 'Stock out') = 1, 'a retired category keeps its past entries');
  reset role;
  perform pg_temp.fails(format($q$update public.mgmt_ledger_categories set direction = 1 where id = %L$q$, c_ho), 'a category direction can never be flipped (even by the database owner)', 'only be retired');
  perform pg_temp.fails(format($q$update public.mgmt_ledger_categories set name = 'Renamed' where id = %L$q$, c_ho), 'a category is never renamed', 'only be retired');
  perform pg_temp.fails(format($q$delete from public.mgmt_ledger_categories where id = %L$q$, c_ho), 'a category is never deleted', 'cannot be deleted');
  perform pg_temp.fails(format($q$update public.mgmt_ledgers set name = 'Renamed' where id = %L$q$, ex), 'a ledger never changes', 'append-only');
  perform pg_temp.fails($q$update public.mgmt_ledger_entries set amount = 1$q$, 'an entry cannot be changed', 'append-only');
  perform pg_temp.fails($q$delete from public.mgmt_ledger_entries$q$, 'an entry cannot be deleted', 'append-only');
  perform pg_temp.fails(format($q$insert into public.mgmt_ledger_entries(ledger_id, category_id, entry_date, amount, effect, reverses_id, reason) values (%L, %L, current_date, 300, -1, %L, 'sneaky second reversal')$q$, ex, c_bill, eid), 'even a direct insert cannot reverse an entry twice', 'unique');
  perform pg_temp.fails(format($q$insert into public.mgmt_ledger_entries(ledger_id, category_id, entry_date, amount, effect) values (%L, %L, current_date, -5, 1)$q$, ex, c_bill), 'the table itself refuses a negative amount', 'check');
  perform pg_temp.as_user(a, 'aal2');

  -- 8. Balance Tally
  select account_id into acc from public.mgmt_tally_accounts_list() where name = 'ABL';
  select account_id into acc2 from public.mgmt_tally_accounts_list() where name = 'Cash in Hand';
  perform pg_temp.ok(not (select has_snapshot from public.mgmt_tally_get(today - 1)) and (select total from public.mgmt_tally_get(today - 1)) = -25146, 'a date with no count shows the Jazz Cash balance live');
  accs := jsonb_build_array(jsonb_build_object('account_id', acc, 'amount', 20000), jsonb_build_object('account_id', acc2, 'amount', 5146.5));
  k := gen_random_uuid();
  r := public.mgmt_tally_save(today - 1, accs, 100, null, k);
  perform pg_temp.ok(public.mgmt_tally_save(today - 1, accs, 100, null, k) = r, 'the same key twice saves one count');
  select * into got from public.mgmt_tally_get(today - 1);
  perform pg_temp.ok(got.has_snapshot and got.revision = 0 and got.ledger_balance = -25146 and got.total = 0.5 and got.difference = -99.5 and got.app_total = 100, 'tally: ledger -25,146 + 20,000 + 5,146.50 = 0.50; against the app total 100 it is 99.50 short');
  perform pg_temp.ok((got.accounts -> 0 ->> 'name') = 'ABL', 'the account names are stored with the count');
  r2 := public.mgmt_tally_save(today - 1, accs, 100, null, gen_random_uuid());
  perform pg_temp.ok((r2 ->> 'unchanged') = 'true', 'saving the same count adds nothing');
  perform pg_temp.fails(format($q$select public.mgmt_tally_save(%L, %L::jsonb, 150, null, gen_random_uuid())$q$, today - 1, accs::text), 'changing a date that already has a count needs a reason', 'reason is required');
  perform public.mgmt_tally_save(today - 1, accs, 150, 'the app figure was read wrongly', gen_random_uuid());
  select * into got from public.mgmt_tally_get(today - 1);
  perform pg_temp.ok(got.revision = 1 and got.difference = -149.5, 'a revision is added and the old count stays');
  perform pg_temp.ok((select count(*) from public.mgmt_tally_snapshots where snap_date = today - 1) = 2, 'both revisions are kept');
  -- a backdated ledger entry moves the live balance but never the saved count
  perform public.mgmt_ledger_add(jz, c_recv, today - 1, 'Night', 'Test late received', 1000, gen_random_uuid());
  select * into got from public.mgmt_tally_get(today - 1);
  perform pg_temp.ok(got.ledger_balance = -25146 and got.live_ledger_balance = -24146, 'a later entry does not change a saved count; the live balance moves on');
  perform pg_temp.ok((select count(*) from public.mgmt_tally_list(10)) = 1 and (select revision from public.mgmt_tally_list(10)) = 1, 'the history lists the latest count of each date');
  perform pg_temp.fails(format($q$select public.mgmt_tally_save(%L, '[]'::jsonb, 0, null, gen_random_uuid())$q$, today + 1), 'a future date is refused', 'future');
  perform pg_temp.fails(format($q$select public.mgmt_tally_save(%L, '[{"account_id":"%s","amount":1}]'::jsonb, 0, null, gen_random_uuid())$q$, today, gen_random_uuid()), 'an unknown account is refused', 'unknown or retired');
  perform pg_temp.fails(format($q$select public.mgmt_tally_save(%L, '[{"account_id":"%s","amount":"abc"}]'::jsonb, 0, null, gen_random_uuid())$q$, today, acc), 'a non-number is refused', 'numbers');
  perform pg_temp.fails(format($q$select public.mgmt_tally_save(%L, '[{"account_id":"%s","amount":1},{"account_id":"%s","amount":2}]'::jsonb, 0, null, gen_random_uuid())$q$, today, acc, acc), 'an account listed twice is refused', 'twice');
  perform pg_temp.fails(format($q$select public.mgmt_tally_save(%L, %L::jsonb, 5000000000, null, gen_random_uuid())$q$, today, accs::text), 'a huge app total is refused', 'out of range');
  perform pg_temp.fails(format($q$select public.mgmt_tally_save(%L, '"nope"'::jsonb, 0, null, gen_random_uuid())$q$, today), 'accounts must be a list', 'list');
  r := public.mgmt_tally_account_add('Test Wallet', gen_random_uuid());
  perform pg_temp.ok((select count(*) from public.mgmt_tally_accounts_list()) = 7, 'an account can be added');
  perform pg_temp.fails($q$select public.mgmt_tally_account_add(' test wallet ', gen_random_uuid())$q$, 'a duplicate account name is refused', 'already exists');
  perform public.mgmt_tally_account_retire((r ->> 'id')::uuid, gen_random_uuid());
  perform pg_temp.ok((select count(*) from public.mgmt_tally_accounts_list()) = 6, 'an account can be retired');
  perform pg_temp.fails(format($q$select public.mgmt_tally_account_retire(%L, gen_random_uuid())$q$, (r ->> 'id')::uuid), 'it cannot be retired twice', 'already retired');
  perform pg_temp.fails(format($q$select public.mgmt_tally_save(%L, '[{"account_id":"%s","amount":1}]'::jsonb, 0, null, gen_random_uuid())$q$, today, (r ->> 'id')), 'a retired account cannot be counted', 'unknown or retired');
  perform pg_temp.ok((select count(*) from public.activity_log where action like 'mgmt.ledger%' and (new_value::text like '%Test cash%' or new_value::text like '%Test bill%')) = 0, 'entry descriptions never reach the activity log');
  reset role;
  perform pg_temp.fails($q$update public.mgmt_tally_snapshots set app_total = 1$q$, 'a count cannot be changed', 'append-only');
  perform pg_temp.fails($q$delete from public.mgmt_tally_snapshots$q$, 'a count cannot be deleted', 'append-only');
  perform pg_temp.fails($q$update public.mgmt_tally_accounts set name = 'x'$q$, 'an account is never renamed', 'only be retired');
  perform pg_temp.fails($q$delete from public.mgmt_tally_accounts$q$, 'an account is never deleted', 'cannot be deleted');

  -- 9. permissions
  sqls := array['select * from public.mgmt_ledgers_list()', format('select * from public.mgmt_ledger_view(%L)', ex),
    format('select public.mgmt_ledger_add(%L, %L, %L, null, ''x'', 5, gen_random_uuid())', ex, c_bill, today), format('select public.mgmt_ledger_reverse(%L, ''try it'', gen_random_uuid())', eid),
    'select public.mgmt_ledger_section_create(''Nope'', ''[{"name":"A","direction":1}]''::jsonb, gen_random_uuid())',
    format('select public.mgmt_ledger_category_add(%L, ''Nope'', 1, gen_random_uuid())', ex), format('select public.mgmt_ledger_category_retire(%L, gen_random_uuid())', c_bill),
    'select * from public.mgmt_tally_accounts_list()', 'select public.mgmt_tally_account_add(''Nope'', gen_random_uuid())', format('select public.mgmt_tally_account_retire(%L, gen_random_uuid())', acc),
    format('select * from public.mgmt_tally_get(%L)', today), 'select * from public.mgmt_tally_list(5)', format('select public.mgmt_tally_save(%L, ''[]''::jsonb, 0, null, gen_random_uuid())', today)];
  perform pg_temp.as_user(j);
  foreach tbl in array array['mgmt_ledgers','mgmt_ledger_categories','mgmt_ledger_entries','mgmt_tally_accounts','mgmt_tally_snapshots'] loop
    execute format('select count(*) from public.%I', tbl) into n;
    perform pg_temp.ok(n = 0, 'junior with every normal permission reads no rows of ' || tbl);
  end loop;
  foreach tbl in array sqls loop perform pg_temp.fails(tbl, 'junior is refused: ' || left(tbl, 50), '42501'); end loop;
  reset role;
  perform pg_temp.as_user(a, 'aal1');
  foreach tbl in array sqls loop perform pg_temp.fails(tbl, 'owner without MFA is refused: ' || left(tbl, 50), '42501'); end loop;
  perform pg_temp.ok((select count(*) from public.mgmt_ledger_entries) = 0, 'an owner without MFA reads no rows');
  reset role;
  set local role anon;
  foreach tbl in array array['mgmt_ledgers','mgmt_ledger_categories','mgmt_ledger_entries','mgmt_tally_accounts','mgmt_tally_snapshots'] loop
    perform pg_temp.fails(format('select * from public.%I', tbl), 'anon cannot read ' || tbl, 'permission denied');
  end loop;
  perform pg_temp.fails(sqls[1], 'anon cannot call the ledger list', 'permission denied');
  reset role;
  perform pg_temp.as_user(a, 'aal2');
  foreach tbl in array array['mgmt_ledgers','mgmt_ledger_categories','mgmt_ledger_entries','mgmt_tally_accounts','mgmt_tally_snapshots'] loop
    perform pg_temp.fails(format('delete from public.%I', tbl), 'direct delete refused on ' || tbl, 'permission denied');
    perform pg_temp.fails(format('update public.%I set created_at = now()', tbl), 'direct update refused on ' || tbl, 'permission denied');
  end loop;
  perform pg_temp.fails($q$insert into public.mgmt_ledger_entries(ledger_id, category_id, entry_date, amount, effect) values (gen_random_uuid(), gen_random_uuid(), current_date, 1, 1)$q$, 'direct entry insert refused for the owner too', 'permission denied');
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');                       -- salary edit + view: NOT ledgers
  perform pg_temp.ok((select count(*) from public.mgmt_ledger_entries) = 0, 'salary editors cannot read the ledgers');
  foreach tbl in array sqls loop perform pg_temp.fails(tbl, 'salary rights do not open the ledgers: ' || left(tbl, 50), '42501'); end loop;
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');                       -- the ledgers key alone
  k := gen_random_uuid();
  perform pg_temp.ok((select count(*) from public.mgmt_ledgers_list()) >= 3 and (select count(*) from public.mgmt_ledger_entries) > 0, 'the ledgers key alone can read');
  perform pg_temp.ok(((public.mgmt_ledger_add(ex, c_bill, today, null, 'Test shared entry', 25, k)) ->> 'id') is not null, 'and add an entry');
  perform pg_temp.ok(((public.mgmt_tally_save(today, '[]'::jsonb, 0, null, gen_random_uuid())) ->> 'id') is not null, 'and count the tally');
  perform pg_temp.fails(format('select * from public.mgmt_salary_month(%L)', date_trunc('month', today)::date), 'but cannot read salaries', '42501');
  perform pg_temp.fails(format('select * from public.mgmt_petty_month(%L)', date_trunc('month', today)::date), 'or petty cash', '42501');
  reset role;
  perform pg_temp.as_user(a, 'aal2');
  perform pg_temp.fails(format('select public.mgmt_ledger_add(%L, %L, %L, null, ''x'', 5, %L)', ex, c_bill, today, k), 'another person cannot reuse a key', '42501');
  reset role;
end $t$;
rollback;
