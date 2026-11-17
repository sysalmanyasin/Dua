-- Tests for 0108_mgmt_inbox (the Credit Inbox). All people and figures are invented.
-- Closing's feed is replaced INSIDE this transaction by a stub with the same columns that reads a temp table; the transaction
-- is rolled back, so the real function is never changed. (The real feed is tested in 0206.)
\set ON_ERROR_STOP on
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

-- the stub: same signature and columns as closing_credit_feed (0206), same permission rule
create table public.fake_feed (
  line_id uuid primary key, business_date date, slot_kind text, slot_seq int, kind text, label text, amount numeric,
  closing_id uuid, revision int, submitted_at timestamptz, changed_after_first boolean, removed boolean, account_id uuid);
grant select on public.fake_feed to authenticated;
create or replace function public.closing_credit_feed(p_after timestamptz default null)
returns table (line_id uuid, business_date date, slot_kind text, slot_seq int, kind text, label text, amount numeric,
               closing_id uuid, revision int, submitted_at timestamptz, changed_after_first boolean, removed boolean, account_id uuid)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not public.has_perm('credit.view') then raise exception 'not allowed' using errcode = '42501', hint = 'not_allowed'; end if;
  return query select f.* from public.fake_feed f where p_after is null or f.submitted_at > p_after order by f.business_date, f.slot_seq;
end $$;

insert into auth.users(id, email) values
 ('00000000-0000-0000-0000-0000000000a1','a@t'), ('00000000-0000-0000-0000-0000000000b1','b@t'),
 ('00000000-0000-0000-0000-0000000000c1','c@t'), ('00000000-0000-0000-0000-0000000000d1','d@t'),
 ('00000000-0000-0000-0000-0000000000e1','e@t'), ('00000000-0000-0000-0000-0000000000f1','f@t'),
 ('00000000-0000-0000-0000-000000000091','g@t');
select public.bootstrap_first_admin('00000000-0000-0000-0000-0000000000a1','owner','Test Owner');
insert into public.staff(id, full_name) values
 ('10000000-0000-0000-0000-00000000000b','Test Junior B'), ('10000000-0000-0000-0000-00000000000c','Test Viewer C'),
 ('10000000-0000-0000-0000-00000000000d','Test Credit D'), ('10000000-0000-0000-0000-00000000000e','Test Ledger E'),
 ('10000000-0000-0000-0000-00000000000f','Test Nokey F'), ('10000000-0000-0000-0000-000000000091','Test Noview G'),
 ('10000000-0000-0000-0000-0000000000a2','Test Person One'), ('10000000-0000-0000-0000-0000000000a3','Test Person Two');
insert into public.profiles(user_id, staff_id, username, role_template) values
 ('00000000-0000-0000-0000-0000000000b1','10000000-0000-0000-0000-00000000000b','junior_b','junior'),
 ('00000000-0000-0000-0000-0000000000c1','10000000-0000-0000-0000-00000000000c','viewer_c','junior'),
 ('00000000-0000-0000-0000-0000000000d1','10000000-0000-0000-0000-00000000000d','credit_d','junior'),
 ('00000000-0000-0000-0000-0000000000e1','10000000-0000-0000-0000-00000000000e','ledger_e','junior'),
 ('00000000-0000-0000-0000-0000000000f1','10000000-0000-0000-0000-00000000000f','nokey_f','junior'),
 ('00000000-0000-0000-0000-000000000091','10000000-0000-0000-0000-000000000091','noview_g','junior');
-- junior B holds every normal permission but no Manager / credit key
insert into public.user_permissions(user_id, perm_key, effect)
  select '00000000-0000-0000-0000-0000000000b1', key, 'grant' from public.permissions where key not like 'mgmt.%' and key not like 'credit.%';
insert into public.user_permissions(user_id, perm_key, effect) values
 -- C sees the inbox only
 ('00000000-0000-0000-0000-0000000000c1','mgmt.inbox_file','grant'), ('00000000-0000-0000-0000-0000000000c1','credit.view','grant'),
 -- D files into staff credit only
 ('00000000-0000-0000-0000-0000000000d1','mgmt.inbox_file','grant'), ('00000000-0000-0000-0000-0000000000d1','credit.view','grant'),
 ('00000000-0000-0000-0000-0000000000d1','mgmt.credit_manage','grant'),
 -- E files into ledgers only
 ('00000000-0000-0000-0000-0000000000e1','mgmt.inbox_file','grant'), ('00000000-0000-0000-0000-0000000000e1','credit.view','grant'),
 ('00000000-0000-0000-0000-0000000000e1','mgmt.ledgers','grant'),
 -- F has the target keys and credit.view but NOT mgmt.inbox_file
 ('00000000-0000-0000-0000-0000000000f1','credit.view','grant'), ('00000000-0000-0000-0000-0000000000f1','mgmt.credit_manage','grant'),
 ('00000000-0000-0000-0000-0000000000f1','mgmt.ledgers','grant'),
 -- G has the inbox key and the credit key but NOT credit.view (Closing's feed key)
 ('00000000-0000-0000-0000-000000000091','mgmt.inbox_file','grant'), ('00000000-0000-0000-0000-000000000091','mgmt.credit_manage','grant');

do $t$ declare
  today date := (now() at time zone 'Asia/Karachi')::date;
  a uuid := '00000000-0000-0000-0000-0000000000a1'; j uuid := '00000000-0000-0000-0000-0000000000b1';
  c uuid := '00000000-0000-0000-0000-0000000000c1'; d uuid := '00000000-0000-0000-0000-0000000000d1';
  e uuid := '00000000-0000-0000-0000-0000000000e1'; f uuid := '00000000-0000-0000-0000-0000000000f1';
  p1 uuid := '10000000-0000-0000-0000-0000000000a2'; p2 uuid := '10000000-0000-0000-0000-0000000000a3';
  l1 uuid := '20000000-0000-0000-0000-000000000001'; l2 uuid := '20000000-0000-0000-0000-000000000002';
  l3 uuid := '20000000-0000-0000-0000-000000000003'; l4 uuid := '20000000-0000-0000-0000-000000000004';
  l5 uuid := '20000000-0000-0000-0000-000000000005'; l6 uuid := '20000000-0000-0000-0000-000000000006';
  d1 date := today - 5; d2 date := today - 4; d3 date := today - 3; d4 date := today - 2; d5 date := today - 1;
  ex uuid; jz uuid; c_bill uuid; c_recv uuid; r jsonb; r2 jsonb; k uuid; n int; row_ record; ce record; le record; rid uuid; eid uuid; sec uuid; c_put uuid;
begin
  insert into public.fake_feed values
   (l1, d1, 'day', 1, 'named', 'Test Customer X', 1500, gen_random_uuid(), 0, now(), false, false, null),
   (l2, d2, 'day', 1, 'tier', 'Tier 200', 200, gen_random_uuid(), 0, now(), false, false, null),
   (l3, d3, 'night', 2, 'free', 'Bill from supplier', 750, gen_random_uuid(), 1, now(), true, false, null),
   (l4, d4, 'day', 1, 'adjustment', 'Credit adjustment', -300, gen_random_uuid(), 0, now(), false, false, null),
   (l5, d5, 'day', 1, 'free', 'Jazz cash in', 400, gen_random_uuid(), 0, now(), false, false, null),
   (l6, d5, 'day', 2, 'free', 'Gone line', 90, gen_random_uuid(), 2, now(), true, true, null);

  -- 1. who may open the inbox at all
  perform pg_temp.as_user(j);
  perform pg_temp.fails('select * from public.mgmt_inbox_lines()', 'a junior with every normal permission sees no inbox', '42501');
  perform pg_temp.fails('select public.mgmt_inbox_count()', 'a junior cannot count the inbox', '42501');
  perform pg_temp.fails(format('select public.mgmt_inbox_file(%L, ''credit'', %L, null, null, null, null, gen_random_uuid())', l1, p1), 'a junior cannot file', '42501');
  perform pg_temp.fails(format('select public.mgmt_inbox_dismiss(%L, ''not needed'', gen_random_uuid())', l1), 'a junior cannot dismiss', '42501');
  perform pg_temp.fails(format('select public.mgmt_inbox_reopen(%L, ''mistake'', gen_random_uuid())', l1), 'a junior cannot reopen', '42501');
  perform pg_temp.ok((select count(*) from public.mgmt_credit_filings) = 0, 'a junior reads no filing rows');
  reset role;
  perform pg_temp.as_user(f);
  perform pg_temp.fails('select * from public.mgmt_inbox_lines()', 'credit.view and the target keys WITHOUT mgmt.inbox_file see no inbox', '42501');
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-000000000091');
  perform pg_temp.fails('select * from public.mgmt_inbox_lines()', 'mgmt.inbox_file WITHOUT credit.view (Closing''s feed key) sees no inbox', '42501');
  perform pg_temp.fails(format('select public.mgmt_inbox_file(%L, ''credit'', %L, null, null, null, null, gen_random_uuid())', l1, p1), 'filing also needs credit.view', '42501');
  perform pg_temp.fails('select public.mgmt_inbox_count()', 'the count also needs credit.view', '42501');
  reset role;
  perform pg_temp.as_user(a, 'aal1');
  perform pg_temp.fails('select * from public.mgmt_inbox_lines()', 'the owner without MFA sees no inbox', '42501');
  reset role;
  set local role anon;
  perform pg_temp.fails('select * from public.mgmt_inbox_lines()', 'anon cannot call the inbox');
  perform pg_temp.fails('select count(*) from public.mgmt_credit_filings', 'anon cannot read the filing table');
  reset role;

  -- 2. the owner sees every line, unfiled, newest first
  perform pg_temp.as_user(a, 'aal2');
  select count(*) into n from public.mgmt_inbox_lines();
  perform pg_temp.ok(n = 6, 'the owner sees all 6 lines');
  perform pg_temp.ok((select count(*) from public.mgmt_inbox_lines('unfiled')) = 6, 'every line starts unfiled');
  perform pg_temp.ok((select line_id from public.mgmt_inbox_lines() limit 1) in (l5, l6), 'lines come newest business date first');
  perform pg_temp.ok(public.mgmt_inbox_count() = 5, 'the count leaves out the line Closing removed');
  perform pg_temp.fails('select * from public.mgmt_inbox_lines(''nonsense'')', 'an unknown state filter is refused', 'unknown state');
  reset role;

  -- 3. one person who only SEES the inbox
  perform pg_temp.as_user(c);
  perform pg_temp.ok((select count(*) from public.mgmt_inbox_lines()) = 6, 'inbox_file + credit.view can see the inbox');
  perform pg_temp.fails(format('select public.mgmt_inbox_file(%L, ''credit'', %L, null, null, null, null, gen_random_uuid())', l1, p1), 'seeing is not filing: the staff-credit key is also needed', '42501');
  reset role;
  select id into ex from public.mgmt_ledgers where code = 'expense';
  select id into jz from public.mgmt_ledgers where code = 'jazzcash';
  select id into c_bill from public.mgmt_ledger_categories where ledger_id = ex and name = 'Bill';
  select id into c_recv from public.mgmt_ledger_categories where ledger_id = jz and name = 'Received';
  perform pg_temp.as_user(c);
  perform pg_temp.fails(format('select public.mgmt_inbox_file(%L, ''ledger'', null, %L, %L, null, null, gen_random_uuid())', l3, ex, c_bill), 'seeing is not filing: the ledger key is also needed', '42501');
  reset role;

  -- 4. file into staff credit (person D holds inbox_file + credit_manage)
  perform pg_temp.as_user(d);
  perform pg_temp.fails(format('select public.mgmt_inbox_file(%L, ''ledger'', null, %L, %L, null, null, gen_random_uuid())', l3, ex, c_bill), 'the credit-only person cannot file into a ledger', '42501');
  k := gen_random_uuid();
  r := public.mgmt_inbox_file(l1, 'credit', p1, null, null, null, null, k);
  perform pg_temp.ok(r ->> 'target' = 'credit', 'a line is filed into staff credit');
  r2 := public.mgmt_inbox_file(l1, 'credit', p1, null, null, null, null, k);
  perform pg_temp.ok(r2 = r, 'a retry with the same key returns the same answer');
  perform pg_temp.ok((select count(*) from public.mgmt_credit_entries where source = 'closing_inbox') = 1, '... and adds exactly one entry');
  perform pg_temp.fails(format('select public.mgmt_inbox_file(%L, ''credit'', %L, null, null, null, null, gen_random_uuid())', l1, p2), 'a filed line cannot be filed again with a new key', 'already filed');
  reset role;
  select * into ce from public.mgmt_credit_entries where source = 'closing_inbox';
  perform pg_temp.ok(ce.amount = 1500 and ce.entry_date = d1 and ce.staff_id = p1 and ce.kind = 'entry', 'the entry takes the line''s amount and business date, for the chosen person');
  perform pg_temp.ok(ce.description = 'Test Customer X', 'the description defaults to the line''s label');
  perform pg_temp.as_user(d);
  select * into row_ from public.mgmt_inbox_lines() where line_id = l1;
  perform pg_temp.ok(row_.state = 'filed' and row_.target_kind = 'credit' and row_.target_label = 'Staff credit · Test Person One', 'the line shows as filed, with where it went');
  perform pg_temp.ok(not row_.changed_after_filing, 'a line that did not change is not flagged');
  perform pg_temp.ok(public.mgmt_inbox_count() = 4, 'the count drops to 4');
  perform pg_temp.ok((select count(*) from public.mgmt_inbox_lines('filed')) = 1, 'the filed tab holds the line');
  reset role;
  perform pg_temp.as_user(a, 'aal2');
  perform pg_temp.ok((select entries_total from public.mgmt_credit_month(date_trunc('month', d1)::date) where staff_id = p1) >= 1500
                     or (select entries_total from public.mgmt_credit_month(date_trunc('month', d1)::date) where staff_id = p1) is not null, 'the entry is in that person''s credit month');
  reset role;

  -- 5. negative line to staff credit, edited description, date before the opening month
  perform pg_temp.as_user(d);
  r := public.mgmt_inbox_file(l4, 'credit', p2, null, null, null, 'Edited note for adjustment', gen_random_uuid());
  reset role;
  select * into ce from public.mgmt_credit_entries where id = (r ->> 'entry_id')::uuid;
  perform pg_temp.ok(ce.amount = -300 and ce.description = 'Edited note for adjustment', 'a negative line keeps its sign and the description can be edited');
  perform pg_temp.as_user(a, 'aal2');
  perform public.mgmt_credit_set_opening(p1, date_trunc('month', today)::date, 100, 'opening for test', gen_random_uuid());
  reset role;
  insert into public.fake_feed values ('20000000-0000-0000-0000-000000000009', today - 40, 'day', 1, 'free', 'Old line', 55, gen_random_uuid(), 0, now(), false, false, null);
  perform pg_temp.as_user(d);
  perform pg_temp.fails(format('select public.mgmt_inbox_file(%L, ''credit'', %L, null, null, null, null, gen_random_uuid())', '20000000-0000-0000-0000-000000000009', p1), 'a line dated before the person''s opening month is refused', 'opening');
  perform pg_temp.fails(format('select public.mgmt_inbox_file(%L, ''credit'', null, null, null, null, null, gen_random_uuid())', l2), 'a person must be chosen', 'pick a person');
  perform pg_temp.fails(format('select public.mgmt_inbox_file(%L, ''nowhere'', null, null, null, null, null, gen_random_uuid())', l2), 'a target must be chosen', 'pick where');
  perform pg_temp.fails(format('select public.mgmt_inbox_file(%L, ''credit'', %L, null, null, null, null, gen_random_uuid())', gen_random_uuid(), p1), 'an unknown line is refused', 'unknown line');
  reset role;

  -- 6. file into ledgers (person E holds inbox_file + ledgers)
  insert into public.fake_feed values ('20000000-0000-0000-0000-000000000007', d4, 'day', 3, 'adjustment', 'Small negative', -50, gen_random_uuid(), 0, now(), false, false, null);
  perform pg_temp.as_user(e);
  perform pg_temp.fails(format('select public.mgmt_inbox_file(%L, ''credit'', %L, null, null, null, null, gen_random_uuid())', l2, p1), 'the ledger-only person cannot file into staff credit', '42501');
  perform pg_temp.fails(format('select public.mgmt_inbox_file(%L, ''ledger'', null, %L, %L, null, null, gen_random_uuid())', '20000000-0000-0000-0000-000000000007', ex, c_bill), 'a negative line cannot go into a ledger', 'negative');
  perform pg_temp.fails(format('select public.mgmt_inbox_file(%L, ''ledger'', null, %L, %L, ''Morning'', null, gen_random_uuid())', l3, ex, c_bill), 'a ledger without shifts refuses a shift', 'no shifts');
  perform pg_temp.fails(format('select public.mgmt_inbox_file(%L, ''ledger'', null, %L, %L, null, null, gen_random_uuid())', l5, jz, c_recv), 'Jazz Cash needs a shift', 'shift');
  perform pg_temp.fails(format('select public.mgmt_inbox_file(%L, ''ledger'', null, %L, %L, null, null, gen_random_uuid())', l3, ex, c_recv), 'a category of another ledger is refused', 'does not belong');
  r := public.mgmt_inbox_file(l3, 'ledger', null, ex, c_bill, null, null, gen_random_uuid());
  r2 := public.mgmt_inbox_file(l5, 'ledger', null, jz, c_recv, 'Evening', 'Cash from counter', gen_random_uuid());
  reset role;
  select * into le from public.mgmt_ledger_entries where id = (r ->> 'entry_id')::uuid;
  perform pg_temp.ok(le.amount = 750 and le.entry_date = d3 and le.effect = 1 and le.source = 'closing_inbox' and le.ledger_id = ex,
                     'an Expense line keeps the line''s amount and date, and the category''s direction (Bill adds)');
  select * into le from public.mgmt_ledger_entries where id = (r2 ->> 'entry_id')::uuid;
  perform pg_temp.ok(le.shift = 'Evening' and le.effect = 1 and le.description = 'Cash from counter', 'a Jazz Cash line keeps its shift, direction and edited description');
  perform pg_temp.as_user(a, 'aal2');
  perform pg_temp.ok((select balance from public.mgmt_ledgers_list() where code = 'expense') = 750, 'the ledger balance includes the filed line');
  reset role;

  -- 7. dismiss
  perform pg_temp.as_user(a, 'aal2');
  perform pg_temp.fails(format('select public.mgmt_inbox_dismiss(%L, ''ab'', gen_random_uuid())', l2), 'a dismissal needs a reason of 3 characters', 'reason');
  r := public.mgmt_inbox_dismiss(l2, 'Duplicate of another line', gen_random_uuid());
  select * into row_ from public.mgmt_inbox_lines() where line_id = l2;
  perform pg_temp.ok(row_.state = 'dismissed' and row_.reason = 'Duplicate of another line', 'a dismissed line shows its reason');
  perform pg_temp.fails(format('select public.mgmt_inbox_dismiss(%L, ''again please'', gen_random_uuid())', l2), 'a dismissed line cannot be dismissed twice', 'already dismissed');
  perform pg_temp.fails(format('select public.mgmt_inbox_file(%L, ''credit'', %L, null, null, null, null, gen_random_uuid())', l2, p1), 'a dismissed line must be reopened before filing', 'reopen');
  perform pg_temp.fails(format('select public.mgmt_inbox_dismiss(%L, ''filed already'', gen_random_uuid())', l1), 'a filed line cannot be dismissed', 'reopen');
  select count(*) into n from public.mgmt_inbox_lines('unfiled') where not removed;
  perform pg_temp.ok(n = public.mgmt_inbox_count(), 'the count equals the unfiled tab');
  reset role;

  -- 8. Closing changes a line after it was filed / dismissed: the inbox shows it, nothing moves by itself
  update public.fake_feed set amount = 1800, label = 'Test Customer X (corrected)' where line_id = l1;
  update public.fake_feed set amount = 250 where line_id = l2;
  perform pg_temp.as_user(a, 'aal2');
  select * into row_ from public.mgmt_inbox_lines() where line_id = l1;
  perform pg_temp.ok(row_.changed_after_filing and row_.amount = 1800 and row_.filed_amount = 1500, 'a filed line that Closing changed is flagged, with both amounts');
  perform pg_temp.ok((select changed_after_filing from public.mgmt_inbox_lines() where line_id = l2), 'a dismissed line that Closing changed is flagged too');
  reset role;
  perform pg_temp.ok((select amount from public.mgmt_credit_entries where source = 'closing_inbox' and staff_id = p1) = 1500, 'the filed entry is untouched (the owner decides)');

  -- 9. reopen a changed filed line: the entry is reversed, the line is open again, and it can be filed again
  perform pg_temp.as_user(e);
  perform pg_temp.fails(format('select public.mgmt_inbox_reopen(%L, ''Closing corrected it'', gen_random_uuid())', l1), 'reopening a staff-credit filing needs the staff-credit key too', '42501');
  reset role;
  perform pg_temp.as_user(d);
  perform pg_temp.fails(format('select public.mgmt_inbox_reopen(%L, ''x'', gen_random_uuid())', l1), 'reopening needs a reason', 'reason');
  r := public.mgmt_inbox_reopen(l1, 'Closing corrected it', gen_random_uuid());
  perform pg_temp.ok(r ->> 'reversal_id' is not null, 'reopening a filed line reverses its entry');
  select * into row_ from public.mgmt_inbox_lines() where line_id = l1;
  perform pg_temp.ok(row_.state = 'unfiled' and not row_.changed_after_filing, 'the line is open again');
  perform pg_temp.fails(format('select public.mgmt_inbox_reopen(%L, ''twice please'', gen_random_uuid())', l1), 'an open line cannot be reopened', 'already open');
  r := public.mgmt_inbox_file(l1, 'credit', p2, null, null, null, null, gen_random_uuid());
  reset role;
  select * into ce from public.mgmt_credit_entries where id = (r ->> 'entry_id')::uuid;
  perform pg_temp.ok(ce.amount = 1800 and ce.staff_id = p2, 'filing again uses the corrected amount, for the new person');
  perform pg_temp.ok((select sum(amount) from public.mgmt_credit_entries where staff_id = p1 and kind = 'entry' and entry_date = d1) = 0, 'the first filing and its reversal cancel out in that month');
  perform pg_temp.ok((select count(*) from public.mgmt_credit_entries where staff_id = p1 and entry_date = d1) = 2, '... and both lines stay visible');

  -- 10. reopen a ledger filing needs the ledger key
  perform pg_temp.as_user(d);
  perform pg_temp.fails(format('select public.mgmt_inbox_reopen(%L, ''wrong ledger'', gen_random_uuid())', l3), 'reopening a ledger filing needs the ledger key', '42501');
  reset role;
  perform pg_temp.as_user(e);
  r := public.mgmt_inbox_reopen(l3, 'Wrong ledger, will refile', gen_random_uuid());
  perform pg_temp.ok((select state from public.mgmt_inbox_lines() where line_id = l3) = 'unfiled', 'a reopened ledger filing is open again');
  reset role;
  perform pg_temp.as_user(a, 'aal2');
  perform pg_temp.ok((select balance from public.mgmt_ledgers_list() where code = 'expense') = 0, 'the ledger balance is back to zero');
  -- a dismissed line reopens without any reversal
  r := public.mgmt_inbox_reopen(l2, 'Dismissed by mistake', gen_random_uuid());
  perform pg_temp.ok(r ->> 'reversal_id' is null and (select state from public.mgmt_inbox_lines() where line_id = l2) = 'unfiled', 'reopening a dismissed line adds no entry');
  reset role;

  -- 11. reversing the filed entry on the Staff Credit page puts the line back in the inbox with a note
  perform pg_temp.as_user(a, 'aal2');
  select credit_entry_id into eid from public.mgmt_inbox_lines() where line_id = l4;
  perform public.mgmt_credit_reverse(eid, 'Wrong person', gen_random_uuid());
  select * into row_ from public.mgmt_inbox_lines() where line_id = l4;
  perform pg_temp.ok(row_.state = 'unfiled' and row_.entry_reversed, 'an entry reversed on the Staff Credit page returns its line to the inbox, marked');
  r := public.mgmt_inbox_file(l4, 'credit', p1, null, null, null, null, gen_random_uuid());
  perform pg_temp.ok((select state from public.mgmt_inbox_lines() where line_id = l4) = 'filed', '... and it can be filed again');
  reset role;

  -- 12. a line Closing removed cannot be filed, but can be dismissed
  perform pg_temp.as_user(a, 'aal2');
  perform pg_temp.fails(format('select public.mgmt_inbox_file(%L, ''credit'', %L, null, null, null, null, gen_random_uuid())', l6, p1), 'a removed line cannot be filed', 'removed');
  perform public.mgmt_inbox_dismiss(l6, 'Removed in Closing', gen_random_uuid());
  perform pg_temp.ok((select state from public.mgmt_inbox_lines() where line_id = l6) = 'dismissed', 'a removed line can be dismissed');
  reset role;

  -- 13. nothing is ever edited or deleted, by anyone
  perform pg_temp.as_user(a, 'aal2');
  perform pg_temp.fails('update public.mgmt_credit_filings set reason = ''x''', 'even the owner cannot edit a filing row');
  perform pg_temp.fails('delete from public.mgmt_credit_filings', 'even the owner cannot delete a filing row');
  perform pg_temp.fails('insert into public.mgmt_credit_filings(line_id, action, business_date, amount) values (gen_random_uuid(), ''dismissed'', current_date, 1)', 'even the owner cannot write the filing table directly');
  reset role;
  perform pg_temp.fails('update public.mgmt_credit_filings set reason = ''x''', 'the database owner cannot edit a filing row either', 'append-only');
  perform pg_temp.fails('delete from public.mgmt_credit_filings', 'the database owner cannot delete a filing row either', 'append-only');
  perform pg_temp.fails('insert into public.mgmt_credit_filings(line_id, action, business_date, amount) values (gen_random_uuid(), ''filed'', current_date, 1)', 'a filed event must say where it went', 'check');
  perform pg_temp.fails('insert into public.mgmt_credit_filings(line_id, action, business_date, amount) values (gen_random_uuid(), ''dismissed'', current_date, 1)', 'a dismissal row must carry a reason', 'check');

  -- 14. the log carries ids and amounts, never names
  perform pg_temp.ok((select count(*) from public.activity_log where action = 'mgmt.inbox_filed') >= 5, 'every filing is logged');
  perform pg_temp.ok((select count(*) from public.activity_log where action in ('mgmt.inbox_dismissed', 'mgmt.inbox_reopened')) >= 4, 'dismissals and reopenings are logged with their reasons');
  perform pg_temp.ok(not exists (select 1 from public.activity_log where action like 'mgmt.inbox_%' and (coalesce(new_value::text, '') || coalesce(old_value::text, '')) ilike '%Test Customer%'), 'the log holds no customer or person names');

  -- 15. reads follow the key (RLS on the filing table itself)
  perform pg_temp.as_user(c);
  perform pg_temp.ok((select count(*) from public.mgmt_credit_filings) > 0, 'a person with mgmt.inbox_file reads the filing rows');
  reset role;
  perform pg_temp.as_user(f);
  perform pg_temp.ok((select count(*) from public.mgmt_credit_filings) = 0, 'a person without mgmt.inbox_file reads none');
  reset role;
end $t$;
rollback;
