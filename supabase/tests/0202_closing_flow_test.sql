-- Tests for 0202_closing_flow: drafts, carry-forward, submit, correction, permissions.
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
    if part is not null and sqlerrm not like '%' || part || '%' and sqlstate <> part then raise exception 'FAIL (wrong error "%" / %): %', sqlerrm, sqlstate, msg; end if;
    raise notice 'pass (refused): %', msg; return;
  end;
  raise exception 'FAIL (was allowed): %', msg;
end $$;
create temp table memo (k text primary key, v text);
grant all on memo to authenticated;

insert into auth.users(id, email) values
 ('00000000-0000-0000-0000-0000000000a1','a@t'),('00000000-0000-0000-0000-0000000000b1','j@t'),('00000000-0000-0000-0000-0000000000b2','j2@t');
select public.bootstrap_first_admin('00000000-0000-0000-0000-0000000000a1','owner','Test Owner');
insert into public.staff(id, full_name) values
 ('10000000-0000-0000-0000-000000000001','J One'),('10000000-0000-0000-0000-000000000002','J Two');
insert into public.profiles(user_id, staff_id, username, role_template) values
 ('00000000-0000-0000-0000-0000000000b1','10000000-0000-0000-0000-000000000001','junior1','junior'),
 ('00000000-0000-0000-0000-0000000000b2','10000000-0000-0000-0000-000000000002','junior2','junior');

-- 0. the opening closing (CLS-10): an admin enters the first closing; everything else follows it
do $t$ declare r jsonb; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  r := public.closing_start_opening('e0000000-0000-0000-0000-000000000001', current_date - 6, 'evening');
  insert into memo values ('opening', r ->> 'closing_id');
  -- the till holds exactly the Rs 45,000 float (9 x 5000), so the opening's Liquid is 0 and the next closing carries 0 cash
  perform public.closing_save_draft('e0000000-0000-0000-0000-000000000001', current_date - 6, 'evening', 'final', '{"till": [9,0,0,0,0,0,0,0]}');
  perform public.closing_submit('e0000000-0000-0000-0000-000000000001');
  reset role;
end $t$;

-- 1. drafts: idempotent, private, validated
do $t$ declare r jsonb; r2 jsonb; n int; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  r := public.closing_save_draft('a0000000-0000-0000-0000-000000000001', current_date - 5, 'night', 'shift',
    '{"sys_cash": 100000, "last_bill_no": 500, "alfalah": 3000, "comp_sale": 2000,
      "till": [10,0,0,0,0,0,0,0], "hs": [{"label":"h","amount":100}],
      "credit": {"named":[{"label":"X","amount":2500,"line_id":"c0000000-0000-0000-0000-000000000001"}],"tier":[{"label":"T","amount":0}]},
      "deposits": [{"label":"d","amount":700}],
      "misc": [{"label":"Gas","amount":300,"charge_id":"d0000000-0000-0000-0000-000000000001"}]}');
  insert into memo values ('night', r ->> 'closing_id');
  perform pg_temp.ok(r ->> 'status' = 'draft', 'first save creates a draft');
  r2 := public.closing_save_draft('a0000000-0000-0000-0000-000000000001', current_date - 5, 'night', 'shift', '{"sys_cash": 100000}');
  perform pg_temp.ok(r2 ->> 'closing_id' = r ->> 'closing_id', 'saving again with the same key is the same closing');
  select count(*) into n from public.closing_slots; perform pg_temp.ok(n = 2, 'and still one slot for it (plus the opening''s)');
  select count(*) into n from public.closing_credit_lines; perform pg_temp.ok(n = 2, 'a save that omits a section keeps its rows (1 named + 1 tier)');
  perform pg_temp.ok((select responsible_staff_id from public.closings where not is_opening) = '10000000-0000-0000-0000-000000000001', 'responsible staff defaults to the person entering');
  perform pg_temp.ok((select prev_cash from public.closings where not is_opening) = 0 and (select source_closing_id from public.closings where not is_opening) = (select v::uuid from memo where k = 'opening'), 'the first closing after an opening with 0 Liquid carries zeros, from the opening');
  reset role;

  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
  perform pg_temp.fails($q$select public.closing_save_draft('a0000000-0000-0000-0000-000000000001', current_date - 5, 'night', 'shift', '{}')$q$, 'another staff member cannot use that key', '42501');
  perform pg_temp.fails($q$select public.closing_save_draft('a0000000-0000-0000-0000-000000000002', current_date - 5, 'night', 'shift', '{}')$q$, 'nor start a second closing in the same slot', 'already exists');
  perform pg_temp.fails($q$select public.closing_submit('a0000000-0000-0000-0000-000000000001')$q$, 'nor submit it', '42501');
  reset role;

  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  perform pg_temp.fails($q$select public.closing_save_draft('a0000000-0000-0000-0000-000000000001', current_date - 5, 'night', 'shift', '{"sys_cash": "abc"}', null, 2)$q$, 'a non-number amount is refused, not turned into 0', 'invalid amount');
  perform pg_temp.fails($q$select public.closing_save_draft('a0000000-0000-0000-0000-000000000001', current_date - 5, 'night', 'shift', '{"sys_cash": 1e12}', null, 2)$q$, 'an absurd amount is refused', 'too large');
  perform pg_temp.fails($q$select public.closing_save_draft('a0000000-0000-0000-0000-000000000001', current_date - 5, 'night', 'shift', '{"till": [1,2,3,4,5,6,7,8,9]}', null, 2)$q$, 'more than 8 denominations is refused', 'invalid cash');
  perform pg_temp.fails($q$select public.closing_save_draft('a0000000-0000-0000-0000-000000000001', current_date - 5, 'night', 'shift', '{"till": [-1,0,0,0,0,0,0,0]}', null, 2)$q$, 'a negative note count is refused', 'invalid quantity');
  perform pg_temp.fails($q$select public.closing_save_draft('a0000000-0000-0000-0000-000000000001', current_date - 5, 'night', 'shift', '{"hs": "nope"}', null, 2)$q$, 'rows that are not a list are refused', 'invalid rows');
  perform pg_temp.fails($q$select public.closing_save_draft('a0000000-0000-0000-0000-000000000001', current_date - 5, 'night', 'shift', '{"credit": {"tier": [{},{},{},{}]}}', null, 2)$q$, 'a fourth tier slot is refused', 'at most 3');
  perform pg_temp.fails($q$select public.closing_save_draft('a0000000-0000-0000-0000-000000000009', current_date + 30, 'night', 'shift', '{}')$q$, 'a far-future date is refused', 'out of range');
  perform pg_temp.fails($q$select public.closing_save_draft('a0000000-0000-0000-0000-000000000009', current_date - 5, 'lunch', 'shift', '{}')$q$, 'an unknown slot kind is refused', 'invalid slot');
  perform pg_temp.fails($q$select public.closing_save_draft('a0000000-0000-0000-0000-000000000001', current_date - 4, 'night', 'shift', '{}')$q$, 'a key cannot be moved to another slot', 'another slot');
  perform pg_temp.fails($q$select public.closing_save_draft('a0000000-0000-0000-0000-000000000009', current_date - 5, 'morning', 'final', '{"responsible_staff_id":"99999999-0000-0000-0000-000000000000"}')$q$, 'an unknown responsible staff member is refused', 'not found');
  select count(*) into n from public.closings; perform pg_temp.ok(n = 1, 'a refused save leaves no stray closing behind (the junior sees only their own)');
  reset role;
end $t$;

-- 2. submit: audit card gate, idempotent, result stored, logged
do $t$ declare r jsonb; r2 jsonb; n int; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  perform pg_temp.fails($q$select public.closing_submit('a0000000-0000-0000-0000-000000000001')$q$, 'submit is refused until the inventory audit is verified', 'inventory audit');
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  perform public.settings_set('closing.require_inventory_audit', 'false', 'test rollout');
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  r := public.closing_submit('a0000000-0000-0000-0000-000000000001');
  perform pg_temp.ok(r ->> 'status' = 'submitted' and (r ->> 'already') = 'false', 'submit works once the gate is off');
  -- hand-worked: grand 54600 = 100 + 300 + cc 1000 + till 50000 + credit 2500 + deposits 700; liquid 9600
  perform pg_temp.ok((r -> 'result' ->> 'cc_total')::numeric = 1000 and (r -> 'result' ->> 'debt_e')::numeric = 2500
    and (r -> 'result' ->> 'deposits_f')::numeric = 700 and (r -> 'result' ->> 'grand')::numeric = 54600
    and (r -> 'result' ->> 'liquid')::numeric = 9600, 'the stored result matches the hand-worked figures');
  r2 := public.closing_submit('a0000000-0000-0000-0000-000000000001');
  perform pg_temp.ok((r2 ->> 'already') = 'true' and r2 ->> 'closing_id' = r ->> 'closing_id', 'submitting again returns the same answer');
  select count(*) into n from public.closing_results; perform pg_temp.ok(n = 1, 'and stores only one result for it (the junior sees only their own)');
  perform pg_temp.fails($q$select public.closing_save_draft('a0000000-0000-0000-0000-000000000001', current_date - 5, 'night', 'shift', '{"sys_cash": 1}')$q$, 'a submitted closing cannot be saved over', 'locked');
  reset role;
  select count(*) into n from public.activity_log where action = 'closing.submitted'; perform pg_temp.ok(n = 1, 'the submit is logged exactly once');
end $t$;

-- 3. carry-forward (Morning from Night; Evening Final skipping an unsubmitted Morning; next day Night from the Evening)
do $t$ declare r jsonb; c public.closings; n int; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  r := public.closing_save_draft('a0000000-0000-0000-0000-000000000011', current_date - 5, 'morning', 'shift', '{"sys_cash": 120000}');
  select * into c from public.closings where id = (r ->> 'closing_id')::uuid;
  perform pg_temp.ok(c.source_closing_id = (select v::uuid from memo where k = 'night'), 'Morning carries from the Night');
  perform pg_temp.ok(c.prev_cash = 9600 and c.prev_credit = 2500 and c.prev_deposits = 700 and c.prev_cc = 0, 'Morning carries cash 9600, credit 2500, deposits 700, card 0');
  select count(*) into n from public.closing_misc_rows where closing_id = c.id and charge_id = 'd0000000-0000-0000-0000-000000000001' and amount = 300;
  perform pg_temp.ok(n = 1, 'an open misc charge carries on with the same charge id');

  -- the Morning stays a draft; the Evening Final carries from the Night (CLS-6) and drops cash and deposits
  r := public.closing_save_draft('a0000000-0000-0000-0000-000000000012', current_date - 5, 'evening', 'final',
    '{"sys_cash": 200000, "alfalah": 5000, "comp_sale": 1000, "till": [10,0,0,0,0,0,0,0]}');
  select * into c from public.closings where id = (r ->> 'closing_id')::uuid;
  perform pg_temp.ok(c.source_closing_id = (select v::uuid from memo where k = 'night'), 'an unsubmitted Morning is skipped (drafts never carry)');
  perform pg_temp.ok(c.prev_cash = 0 and c.prev_deposits = 0 and c.prev_credit = 2500, 'Final mode starts cash and deposits at 0 but keeps credit');
  insert into memo values ('evening', c.id::text);
  perform public.closing_submit('a0000000-0000-0000-0000-000000000012');
  perform pg_temp.ok((select cc_total from public.closing_results where closing_id = c.id) = 4000, 'Evening card total = night card 0 + (5000 - 1000)');
  perform pg_temp.ok((select final_variance from public.closing_results where closing_id = c.id) is not null, 'a Final closing stores its final variance');
  perform pg_temp.ok((select final_variance from public.closing_results where closing_id = (select v::uuid from memo where k = 'night')) is null, 'a shift closing does not');

  -- the next day's Night takes the Evening's card total
  r := public.closing_save_draft('a0000000-0000-0000-0000-000000000013', current_date - 4, 'night', 'shift', '{}');
  select * into c from public.closings where id = (r ->> 'closing_id')::uuid;
  perform pg_temp.ok(c.prev_cc = 4000 and c.source_closing_id = (select v::uuid from memo where k = 'evening'), 'next-day Night carries the previous Evening''s card total');
  reset role;
end $t$;

-- 4. handover slots and the slot calendar
do $t$ declare r jsonb; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  perform public.closing_save_draft('a0000000-0000-0000-0000-000000000021', current_date - 3, 'handover', 'final', '{}');
  perform public.closing_save_draft('a0000000-0000-0000-0000-000000000022', current_date - 3, 'handover', 'final', '{}');
  perform pg_temp.ok((select array_agg(seq order by seq) from public.closing_slots where business_date = current_date - 3) = array[30, 40], 'handovers take positions 30 and 40');
  reset role;
end $t$;

-- 5. correction by revision
do $t$ declare r jsonb; r2 jsonb; n int; nid uuid; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  perform pg_temp.fails(format($q$select public.closing_correct(%L, 'typo', '{}', gen_random_uuid())$q$, (select v from memo where k = 'night')), 'ordinary staff cannot correct', '42501');
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  perform pg_temp.fails(format($q$select public.closing_correct(%L, '  ', '{}', gen_random_uuid())$q$, (select v from memo where k = 'night')), 'a correction needs a reason', 'reason');
  r := public.closing_correct((select v::uuid from memo where k = 'night'), 'cashier typed the system cash wrong', '{"sys_cash": 110000}', 'a0000000-0000-0000-0000-000000000031');
  nid := (r ->> 'closing_id')::uuid;
  perform pg_temp.ok((r ->> 'revision')::int = 2 and (r ->> 'already') = 'false', 'a correction makes revision 2');
  r2 := public.closing_correct((select v::uuid from memo where k = 'night'), 'cashier typed the system cash wrong', '{"sys_cash": 110000}', 'a0000000-0000-0000-0000-000000000031');
  perform pg_temp.ok((r2 ->> 'already') = 'true' and r2 ->> 'closing_id' = nid::text, 'repeating the same correction request changes nothing');
  perform pg_temp.fails(format($q$select public.closing_correct(%L, 'again', '{}', gen_random_uuid())$q$, (select v from memo where k = 'night')), 'the superseded original cannot be corrected again', 'current submitted');
  perform pg_temp.ok((select status from public.closings where id = (select v::uuid from memo where k = 'night')) = 'superseded', 'the original is kept as superseded');
  perform pg_temp.ok((select sys_cash from public.closings where id = nid) = 110000 and (select sys_cash from public.closings where id = (select v::uuid from memo where k = 'night')) = 100000, 'the new revision has the change; the original is untouched');
  perform pg_temp.ok((select shift_sale from public.closing_results where closing_id = nid) = 110000, 'the new revision has its own result');
  select count(*) into n from public.closing_credit_lines where line_id = 'c0000000-0000-0000-0000-000000000001'; perform pg_temp.ok(n = 2, 'a credit line keeps its line id across revisions');
  select count(*) into n from public.closing_misc_rows where charge_id = 'd0000000-0000-0000-0000-000000000001'; perform pg_temp.ok(n >= 2, 'a misc charge keeps its charge id across revisions');
  perform pg_temp.ok((select corrected_by from public.closings where id = nid) = '00000000-0000-0000-0000-0000000000a1', 'who corrected it is kept');
  reset role;
  select count(*) into n from public.activity_log where action = 'closing.corrected' and reason = 'cashier typed the system cash wrong'; perform pg_temp.ok(n = 1, 'the correction and its reason are logged');
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  perform pg_temp.ok((select count(*) from public.closings where id = nid) = 1, 'the staff member still sees their closing after the correction');
  reset role;
end $t$;

-- 6. the browser cannot reach the internals
do $t$ begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  perform pg_temp.fails($q$select public.closing_apply_payload(gen_random_uuid(), '{}')$q$, 'apply_payload is internal', '42501');
  perform pg_temp.fails($q$select public.closing_apply_carry(gen_random_uuid(), true)$q$, 'apply_carry is internal', '42501');
  perform pg_temp.fails($q$select public.closing_previous(gen_random_uuid())$q$, 'previous is internal', '42501');
  set local role anon;
  perform pg_temp.fails($q$select public.closing_save_draft(gen_random_uuid(), current_date, 'night', 'shift', '{}')$q$, 'anon cannot save', '42501');
  perform pg_temp.fails($q$select public.closing_submit(gen_random_uuid())$q$, 'anon cannot submit', '42501');
  perform pg_temp.fails($q$select public.closing_correct(gen_random_uuid(), 'x', '{}', gen_random_uuid())$q$, 'anon cannot correct', '42501');
  reset role;
end $t$;
rollback;
