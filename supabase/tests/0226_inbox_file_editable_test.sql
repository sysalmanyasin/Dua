-- Tests for 0226_inbox_file_editable (Audit 0, T4): the Credit Inbox may correct the date and amount of the entry it files, while the
-- filing snapshot keeps what Closing said. Same fixture as 0108 (Closing's feed is stubbed inside the transaction, then rolled back). Invented people.
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
  d uuid := '00000000-0000-0000-0000-0000000000d1'; c uuid := '00000000-0000-0000-0000-0000000000c1';
  p1 uuid := '10000000-0000-0000-0000-0000000000a2';
  l1 uuid := '20000000-0000-0000-0000-000000000001'; l2 uuid := '20000000-0000-0000-0000-000000000002'; l3 uuid := '20000000-0000-0000-0000-000000000003';
  d1 date := today - 5; d2 date := today - 4; r jsonb; ce record; fl record;
begin
  insert into public.fake_feed values
   (l1, d1, 'day', 1, 'named', 'Test Customer X', 1500, gen_random_uuid(), 0, now(), false, false, null),
   (l2, d2, 'day', 1, 'tier', 'Tier 200', 200, gen_random_uuid(), 0, now(), false, false, null),
   (l3, d2, 'day', 2, 'free', 'Test Bill', 750, gen_random_uuid(), 0, now(), false, false, null);

  perform pg_temp.ok((select count(*) from pg_proc where proname = 'mgmt_inbox_file') = 1, 'exactly one mgmt_inbox_file exists (the old 8-argument one was replaced)');
  perform pg_temp.ok(not has_function_privilege('anon', 'public.mgmt_inbox_file(uuid,text,uuid,uuid,uuid,text,text,uuid,date,numeric)', 'execute'), 'the visitor role cannot file');

  perform pg_temp.as_user(d);
  r := public.mgmt_inbox_file(l1, 'credit', p1, null, null, null, 'Fixed by owner', gen_random_uuid(), d1 + 1, 1400);
  reset role;
  select * into ce from public.mgmt_credit_entries where id = (r ->> 'entry_id')::uuid;
  perform pg_temp.ok(ce.entry_date = d1 + 1 and ce.amount = 1400 and ce.description = 'Fixed by owner', 'the entry takes the corrected date, amount and description');
  select * into fl from public.mgmt_credit_filings where line_id = l1;
  perform pg_temp.ok(fl.business_date = d1 and fl.amount = 1500, 'the filing keeps what Closing said (original date and amount)');
  perform pg_temp.as_user(d);
  perform pg_temp.ok(not (select changed_after_filing from public.mgmt_inbox_lines() where line_id = l1), 'a corrected entry is not flagged as changed after filing');

  r := public.mgmt_inbox_file(l2, 'credit', p1, null, null, null, null, gen_random_uuid());
  reset role;
  select * into ce from public.mgmt_credit_entries where id = (r ->> 'entry_id')::uuid;
  perform pg_temp.ok(ce.entry_date = d2 and ce.amount = 200, 'without a correction the line''s own date and amount are used');

  perform pg_temp.as_user(d);
  perform pg_temp.fails(format('select public.mgmt_inbox_file(%L, ''credit'', %L, null, null, null, null, gen_random_uuid(), null, 0)', l3, p1), 'a zero corrected amount is refused', 'cannot be zero');
  perform pg_temp.fails(format('select public.mgmt_inbox_file(%L, ''credit'', %L, null, null, null, null, gen_random_uuid(), %L)', l3, p1, today + 1), 'a future date is refused', 'out of range');
  perform pg_temp.fails(format('select public.mgmt_inbox_file(%L, ''credit'', %L, null, null, null, null, gen_random_uuid(), %L)', l3, p1, date '1999-12-31'), 'a date before 2000 is refused', 'out of range');
  perform pg_temp.ok((select count(*) from public.mgmt_credit_filings) = 2, 'the refused attempts filed nothing');
  r := public.mgmt_inbox_file(l3, 'credit', p1, null, null, null, null, gen_random_uuid(), today, 5);
  perform pg_temp.ok(r ->> 'target' = 'credit', 'today is an allowed date');

  perform pg_temp.as_user(c);
  perform pg_temp.fails(format('select public.mgmt_inbox_file(%L, ''credit'', %L, null, null, null, null, gen_random_uuid(), %L, 1)', l3, p1, today), 'a viewer without the staff-credit key still cannot file, corrected values or not', '42501');
  reset role;
end $t$;
rollback;
