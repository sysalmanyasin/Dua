-- Tests for 0206_closing_ledgers: the credit feed for Manager, the Credit Ledger and the Misc Ledger. Everything is driven through the
-- real functions (opening, save, submit, correct), so the feed is checked against what a shop would really record.
\set ON_ERROR_STOP on
begin;
create function pg_temp.as_user(uid uuid, lvl text default 'aal1') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'aal', lvl, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; raise notice 'pass: %', msg; end $$;
create function pg_temp.refused(sql text, code text, msg text) returns void language plpgsql as $$
declare h text; m text;
begin
  begin execute sql; exception when others then
    get stacked diagnostics h = pg_exception_hint, m = message_text;
    if h is distinct from code then raise exception 'FAIL (wrong code "%" for "%", wanted "%"): %', h, m, code, msg; end if;
    raise notice 'pass (refused as %): %', code, msg; return;
  end;
  raise exception 'FAIL (was allowed): %', msg;
end $$;
create function pg_temp.denied(sql text, msg text) returns void language plpgsql as $$
begin
  begin execute sql; exception when others then
    if sqlstate <> '42501' then raise exception 'FAIL (wrong error % "%"): %', sqlstate, sqlerrm, msg; end if;
    raise notice 'pass (database refused): %', msg; return;
  end;
  raise exception 'FAIL (was allowed): %', msg;
end $$;
create temp table memo (k text primary key, v text);
grant all on memo to public;

insert into auth.users(id, email) values
 ('00000000-0000-0000-0000-0000000000a1','a@t'), ('00000000-0000-0000-0000-0000000000b1','j@t'),
 ('00000000-0000-0000-0000-0000000000b2','n@t'), ('00000000-0000-0000-0000-0000000000b3','v@t'),
 ('00000000-0000-0000-0000-0000000000b4','c@t');
select public.bootstrap_first_admin('00000000-0000-0000-0000-0000000000a1','owner','Test Owner');
insert into public.staff(id, full_name) values
 ('10000000-0000-0000-0000-000000000001','J One'), ('10000000-0000-0000-0000-000000000002','J Two'),
 ('10000000-0000-0000-0000-000000000003','J Three'), ('10000000-0000-0000-0000-000000000004','J Four');
insert into public.profiles(user_id, staff_id, username, role_template) values
 ('00000000-0000-0000-0000-0000000000b1','10000000-0000-0000-0000-000000000001','junior1','junior'),
 ('00000000-0000-0000-0000-0000000000b2','10000000-0000-0000-0000-000000000002','nobody','junior'),
 ('00000000-0000-0000-0000-0000000000b3','10000000-0000-0000-0000-000000000003','viewer','junior'),
 ('00000000-0000-0000-0000-0000000000b4','10000000-0000-0000-0000-000000000004','creditor','junior');
insert into public.user_permissions(user_id, perm_key, effect) values
 ('00000000-0000-0000-0000-0000000000b2','closing.enter_own','deny'),
 ('00000000-0000-0000-0000-0000000000b3','closing.view_all','grant'),
 ('00000000-0000-0000-0000-0000000000b4','credit.view','grant');

-- ── setup: opening Final (credit line + misc charge that must NOT reach the feed), Night, Morning (+ an unsent Evening draft) ──
do $t$ declare r jsonb; mid uuid; cid uuid; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  perform public.settings_set('closing.require_inventory_audit', 'false', 'test rollout');
  perform public.closing_start_opening('e0000000-0000-0000-0000-000000000001', current_date - 6, 'evening');
  perform public.closing_save_draft('e0000000-0000-0000-0000-000000000001', current_date - 6, 'evening', 'final',
    '{"till": [9,0,0,0,0,0,0,0], "last_bill_no": 500, "credit": {"free": [{"label": "Opening debt", "amount": 7777}]}, "misc": [{"label": "Old charge", "amount": 700}]}');
  perform public.closing_submit('e0000000-0000-0000-0000-000000000001');
  reset role;

  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  perform public.closing_save_draft('a0000000-0000-0000-0000-000000000001', current_date - 5, 'night', 'shift', '{}');
  select charge_id into mid from public.closing_misc_rows m join public.closings c on c.id = m.closing_id
   where c.idempotency_key = 'a0000000-0000-0000-0000-000000000001' and m.label = 'Old charge';
  perform pg_temp.ok(mid is not null, 'setup: the Night carried the opening misc charge');
  insert into memo values ('old_charge', mid::text);
  perform public.closing_save_draft('a0000000-0000-0000-0000-000000000001', current_date - 5, 'night', 'shift', format(
    '{"sys_cash": 10000, "last_bill_no": 520, "credit_adj": 25, "till": [10,0,0,0,0,0,0,0],
      "credit": {"named": [{"label": "Ali", "amount": 1000}], "free": [{"label": "Free one", "amount": 300}, {"label": "Struck", "amount": 50, "deleted": true}]},
      "misc": [{"charge_id": "%s", "label": "Old charge", "amount": 700}, {"label": "Courier", "amount": 500}]}', mid)::jsonb);
  perform public.closing_submit('a0000000-0000-0000-0000-000000000001');

  perform public.closing_save_draft('a0000000-0000-0000-0000-000000000002', current_date - 5, 'morning', 'shift', '{}');
  select charge_id into cid from public.closing_misc_rows m join public.closings c on c.id = m.closing_id
   where c.idempotency_key = 'a0000000-0000-0000-0000-000000000002' and m.label = 'Courier';
  perform pg_temp.ok(cid is not null, 'setup: the Morning carried the Courier charge with its stable id');
  insert into memo values ('courier', cid::text);
  perform public.closing_save_draft('a0000000-0000-0000-0000-000000000002', current_date - 5, 'morning', 'shift', format(
    '{"sys_cash": 25000, "last_bill_no": 560, "till": [12,0,0,0,0,0,0,0],
      "credit": {"free": [{"label": "Walk-in", "amount": 200}]},
      "misc": [{"charge_id": "%s", "label": "Old charge", "amount": 700}, {"charge_id": "%s", "label": "Courier", "amount": 500, "deleted": true}, {"label": "Parcel", "amount": 40}]}', mid, cid)::jsonb);
  perform public.closing_submit('a0000000-0000-0000-0000-000000000002');
  -- an Evening that is still a draft: it must never appear anywhere
  perform public.closing_save_draft('a0000000-0000-0000-0000-000000000003', current_date - 5, 'evening', 'shift',
    '{"credit": {"free": [{"label": "Draft only", "amount": 999}]}, "misc": [{"label": "Draft misc", "amount": 11}]}');
  reset role;

  -- the transaction has one clock, so spread the submit times by hand (triggers off for this one superuser update)
  set local session_replication_role = replica;
  update public.closings set submitted_at = now() - interval '4 days' where idempotency_key in ('e0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001');
  update public.closings set submitted_at = now() - interval '1 day' where idempotency_key = 'a0000000-0000-0000-0000-000000000002';
  set local session_replication_role = origin;
  insert into memo select 'night', id::text from public.closings where idempotency_key = 'a0000000-0000-0000-0000-000000000001';
  insert into memo select 'morning', id::text from public.closings where idempotency_key = 'a0000000-0000-0000-0000-000000000002';
end $t$;

-- ── 1. the credit feed, before any correction ──
do $t$ declare n int; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  select count(*) into n from public.closing_credit_feed();
  perform pg_temp.ok(n = 4, 'F1: four credit lines (Ali, Free one, the adjustment, Walk-in); got ' || n);
  perform pg_temp.ok(not exists (select 1 from public.closing_credit_feed() where label in ('Struck', 'Opening debt', 'Draft only')),
    'F1: a struck line, the opening closing''s credit and a draft never appear');
  perform pg_temp.ok((select amount from public.closing_credit_feed() where label = 'Ali') = 1000 and (select kind from public.closing_credit_feed() where label = 'Ali') = 'named',
    'F1: Ali is a named line of 1000');
  perform pg_temp.ok((select kind from public.closing_credit_feed() where label = 'Free one') = 'free', 'F1: a free-label row has kind free');
  perform pg_temp.ok((select amount from public.closing_credit_feed() where kind = 'adjustment') = 25, 'F1: the credit adjustment is a line of 25');
  perform pg_temp.ok((select bool_and(not removed and not changed_after_first) from public.closing_credit_feed()), 'F1: nothing removed or changed yet');
  perform pg_temp.ok((select count(*) from public.closing_credit_feed() where kind = 'adjustment' and business_date = current_date - 5 and slot_kind = 'night') = 1,
    'F1: the adjustment belongs to the Night of its date');
  perform pg_temp.ok((select count(distinct line_id) from public.closing_credit_feed()) = 4, 'F1: every line has its own id');
  -- the zero adjustment of the Morning is not a line
  perform pg_temp.ok(not exists (select 1 from public.closing_credit_feed() where kind = 'adjustment' and slot_kind = 'morning'), 'F1: a zero adjustment is not emitted');
  -- p_after
  select count(*) into n from public.closing_credit_feed(now() - interval '2 days');
  perform pg_temp.ok(n = 1 and (select label from public.closing_credit_feed(now() - interval '2 days')) = 'Walk-in', 'F1: p_after keeps only what was submitted later (Walk-in)');
  perform pg_temp.ok((select count(*) from public.closing_credit_feed(now() + interval '1 day')) = 0, 'F1: p_after in the future returns nothing');
  reset role;
end $t$;

-- ── 2. a correction of the Night: Ali 1000 -> 1200, "Free one" struck out ──
do $t$ declare r jsonb; ali uuid; free1 uuid; begin
  select line_id into ali from public.closing_credit_lines where closing_id = (select v::uuid from memo where k = 'night') and label = 'Ali';
  select line_id into free1 from public.closing_credit_lines where closing_id = (select v::uuid from memo where k = 'night') and label = 'Free one';
  insert into memo values ('ali', ali::text), ('free1', free1::text);
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  r := public.closing_correct((select v::uuid from memo where k = 'night'), 'Ali paid 200 more, Free one was a mistake',
    format('{"credit": {"named": [{"line_id": "%s", "label": "Ali", "amount": 1200}], "free": [{"line_id": "%s", "label": "Free one", "amount": 300, "deleted": true}]}}', ali, free1)::jsonb,
    'a0000000-0000-0000-0000-000000000031');
  reset role;
end $t$;

do $t$ declare n int; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  perform pg_temp.ok((select count(*) from public.closing_credit_feed()) = 4, 'F2: still four lines (a removed line stays in the feed, flagged)');
  perform pg_temp.ok((select amount from public.closing_credit_feed() where label = 'Ali') = 1200
    and (select changed_after_first from public.closing_credit_feed() where label = 'Ali')
    and (select revision from public.closing_credit_feed() where label = 'Ali') = 2
    and (select line_id::text from public.closing_credit_feed() where label = 'Ali') = (select v from memo where k = 'ali'),
    'F2: Ali now shows 1200, changed after first, revision 2, and the SAME line id');
  perform pg_temp.ok((select removed from public.closing_credit_feed() where label = 'Free one')
    and (select amount from public.closing_credit_feed() where label = 'Free one') = 300, 'F2: Free one is flagged removed and keeps its last live amount');
  perform pg_temp.ok(not (select removed or changed_after_first from public.closing_credit_feed() where kind = 'adjustment'), 'F2: the untouched adjustment is neither changed nor removed');
  perform pg_temp.ok((select closing_id::text from public.closing_credit_feed() where label = 'Ali') <> (select v from memo where k = 'night'),
    'F2: the line now points at the corrected closing');
  -- the correction is newer than everything else, so p_after re-emits the Night''s lines and nothing of the Morning
  select count(*) into n from public.closing_credit_feed(now() - interval '2 days');
  perform pg_temp.ok(n = 4, 'F2: p_after two days back: Night (3 lines, re-emitted) and Walk-in; got ' || n);
  perform pg_temp.ok((select count(*) from public.closing_credit_feed(now() - interval '1 hour')) = 3
    and not exists (select 1 from public.closing_credit_feed(now() - interval '1 hour') where label = 'Walk-in'), 'F2: p_after an hour back: only the corrected Night''s lines');
  reset role;
end $t$;

-- ── 3. who may call what ──
do $t$ begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  perform pg_temp.refused('select * from public.closing_credit_feed()', 'not_allowed', 'a cashier cannot read the credit feed');
  perform pg_temp.refused('select public.closing_credit_ledger()', 'not_allowed', 'a cashier cannot read the Credit Ledger');
  perform pg_temp.refused('select public.closing_misc_ledger()', 'not_allowed', 'a cashier cannot read the Misc Ledger');
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
  perform pg_temp.refused('select * from public.closing_credit_feed()', 'not_allowed', 'someone with no closing right cannot read the feed');
  perform pg_temp.refused('select public.closing_credit_ledger()', 'not_allowed', 'someone with no closing right cannot read the Credit Ledger');
  reset role;
  -- view_all sees the ledgers but not the feed; credit.view sees the feed but not the ledgers
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b3');
  perform pg_temp.ok(jsonb_array_length(public.closing_credit_ledger()) = 3, 'a closing.view_all reader sees the Credit Ledger');
  perform pg_temp.ok(public.closing_misc_ledger() -> 'as_of' is not null, 'a closing.view_all reader sees the Misc Ledger');
  perform pg_temp.refused('select * from public.closing_credit_feed()', 'not_allowed', 'closing.view_all alone does not open the credit feed');
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b4');
  perform pg_temp.ok((select count(*) from public.closing_credit_feed()) = 4, 'a credit.view reader sees the feed');
  perform pg_temp.refused('select public.closing_credit_ledger()', 'not_allowed', 'credit.view alone does not open the Credit Ledger');
  reset role;
  -- not signed in
  set local role anon;
  perform pg_temp.denied('select * from public.closing_credit_feed()', 'anon cannot call the feed');
  perform pg_temp.denied('select public.closing_credit_ledger()', 'anon cannot call the Credit Ledger');
  perform pg_temp.denied('select public.closing_misc_ledger()', 'anon cannot call the Misc Ledger');
  reset role;
end $t$;

-- ── 4. Credit Ledger ──
do $t$ declare j jsonb; night jsonb; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  j := public.closing_credit_ledger();
  perform pg_temp.ok(jsonb_array_length(j) = 3, 'L1: one snapshot per current submitted closing (opening, corrected Night, Morning); the superseded Night is not listed');
  perform pg_temp.ok(j -> 0 ->> 'kind' = 'morning' and (j -> 1 ->> 'kind') = 'night' and (j -> 2 ->> 'kind') = 'evening' and (j -> 2 ->> 'is_opening')::boolean,
    'L1: newest first (Morning, Night, then the opening)');
  night := j -> 1;
  perform pg_temp.ok((night ->> 'revision')::int = 2, 'L1: the Night shown is the corrected revision');
  perform pg_temp.ok(jsonb_array_length(night -> 'lines') = 1 and night -> 'lines' -> 0 ->> 'label' = 'Ali' and (night -> 'lines' -> 0 ->> 'amount')::numeric = 1200,
    'L1: struck lines are left out of the snapshot (only Ali, 1200)');
  perform pg_temp.ok((night ->> 'credit_adj')::numeric = 25, 'L1: the credit adjustment is shown');
  perform pg_temp.ok((night ->> 'debt_e')::numeric = (select debt_e from public.closing_results where closing_id = (night ->> 'closing_id')::uuid)
    and (night ->> 'prev_credit')::numeric = (select prev_credit from public.closings where id = (night ->> 'closing_id')::uuid),
    'L1: the running total and the carried-in credit are the stored figures, not recomputed');
  perform pg_temp.ok(not (j::text like '%Draft only%'), 'L1: a draft is not in the ledger');
  perform pg_temp.ok(jsonb_array_length(public.closing_credit_ledger(current_date - 5, current_date - 5)) = 2, 'L1: the date range keeps the two closings of that day');
  perform pg_temp.ok(jsonb_array_length(public.closing_credit_ledger(null, null, 1)) = 1, 'L1: the limit is honoured');
  reset role;
end $t$;

-- ── 5. Misc Ledger ──
do $t$ declare j jsonb; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  j := public.closing_misc_ledger();
  perform pg_temp.ok(j -> 'as_of' ->> 'kind' = 'morning', 'M1: the ledger stands at the latest submitted closing (the Morning)');
  perform pg_temp.ok(jsonb_array_length(j -> 'open') = 2, 'M1: two charges are open (Old charge, Parcel)');
  perform pg_temp.ok(j -> 'open' -> 0 ->> 'label' = 'Old charge' and (j -> 'open' -> 0 ->> 'age_days')::int = 6 and (j -> 'open' -> 0 ->> 'charge_id') = (select v from memo where k = 'old_charge'),
    'M1: Old charge is oldest first, kept its stable id, and is 6 days old (first seen on the opening date)');
  perform pg_temp.ok(j -> 'open' -> 1 ->> 'label' = 'Parcel' and (j -> 'open' -> 1 ->> 'age_days')::int = 5 and (j -> 'open' -> 1 ->> 'amount')::numeric = 40, 'M1: Parcel is 5 days old, amount 40');
  perform pg_temp.ok(jsonb_array_length(j -> 'closed') = 1 and j -> 'closed' -> 0 ->> 'label' = 'Courier' and (j -> 'closed' -> 0 ->> 'charge_id') = (select v from memo where k = 'courier'),
    'M1: Courier (struck in the Morning) is closed, same charge id');
  perform pg_temp.ok((j -> 'closed' -> 0 ->> 'first_date')::date = current_date - 5 and (j -> 'closed' -> 0 ->> 'last_date')::date = current_date - 5, 'M1: Courier first and last seen on the Night date');
  perform pg_temp.ok(not (j::text like '%Draft misc%'), 'M1: a draft misc row is not in the ledger');
  perform pg_temp.ok(jsonb_array_length(public.closing_misc_ledger(1) -> 'closed') = 1, 'M1: the closed limit is honoured');
  reset role;
end $t$;

-- ── 6. read-only: calling the functions changed nothing ──
do $t$ declare before bigint; begin
  select (select count(*) from public.closings) + (select count(*) from public.closing_credit_lines) + (select count(*) from public.closing_misc_rows) + (select count(*) from public.closing_results) into before;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  perform count(*) from public.closing_credit_feed(); perform public.closing_credit_ledger(); perform public.closing_misc_ledger();
  reset role;
  perform pg_temp.ok(before = (select count(*) from public.closings) + (select count(*) from public.closing_credit_lines) + (select count(*) from public.closing_misc_rows) + (select count(*) from public.closing_results), 'R1: the three functions wrote nothing');
end $t$;
rollback;
