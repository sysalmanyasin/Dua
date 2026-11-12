-- Tests for 0203_closing_hardening: refusal codes, opening closing (CLS-10), no skipped slots (CLS-6), draft versions (CLS-13),
-- carry guard (CLS-12), reopen as revision (CLS-7), staff choices and my recent closings (CLS-14, G7).
-- Every figure below is worked out by hand in the comment next to it.
\set ON_ERROR_STOP on
begin;
create function pg_temp.as_user(uid uuid, lvl text default 'aal1') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'aal', lvl, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; raise notice 'pass: %', msg; end $$;
-- the statement must be refused AND carry this machine code in its hint
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
-- the statement must be refused with a permission error (42501): used for grants, where the database itself refuses
create function pg_temp.denied(sql text, msg text) returns void language plpgsql as $$
begin
  begin execute sql; exception when others then
    if sqlstate <> '42501' then raise exception 'FAIL (wrong error % "%"): %', sqlstate, sqlerrm, msg; end if;
    raise notice 'pass (denied): %', msg; return;
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

-- 1. nothing can be entered before the opening closing; only an admin starts it (CLS-10)
do $t$ declare r jsonb; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  perform pg_temp.refused($q$select public.closing_save_draft('a0000000-0000-0000-0000-000000000001', current_date - 5, 'night', 'shift', '{}')$q$, 'opening_required', 'no closing before the opening exists (shift)');
  perform pg_temp.refused($q$select public.closing_save_draft('a0000000-0000-0000-0000-000000000001', current_date - 5, 'night', 'final', '{}')$q$, 'opening_required', 'no closing before the opening exists (Final either)');
  perform pg_temp.refused($q$select public.closing_start_opening('e0000000-0000-0000-0000-000000000001', current_date - 6, 'evening')$q$, 'not_allowed', 'ordinary staff cannot start the opening closing');
  reset role;

  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  perform pg_temp.refused($q$select public.closing_start_opening('e0000000-0000-0000-0000-000000000001', current_date - 6, 'handover')$q$, 'invalid_slot_kind', 'the opening is Night, Morning or Evening');
  perform pg_temp.refused($q$select public.closing_start_opening('e0000000-0000-0000-0000-000000000001', current_date + 30, 'evening')$q$, 'date_out_of_range', 'a far-future opening date is refused');
  r := public.closing_start_opening('e0000000-0000-0000-0000-000000000001', current_date - 6, 'evening');
  insert into memo values ('opening', r ->> 'closing_id');
  perform pg_temp.ok(r ->> 'status' = 'draft' and (r ->> 'already') = 'false' and (r ->> 'version') = '1', 'the admin starts the opening as a draft');
  perform pg_temp.ok((public.closing_start_opening('e0000000-0000-0000-0000-000000000001', current_date - 6, 'evening') ->> 'already') = 'true', 'starting it again with the same key is a harmless retry');
  perform pg_temp.refused($q$select public.closing_start_opening('e0000000-0000-0000-0000-000000000002', current_date - 6, 'morning')$q$, 'opening_exists', 'there is only one opening closing');
  perform pg_temp.ok((select mode from public.closings where is_opening) = 'final' and (select is_opening from public.closings), 'it is a Final closing flagged as the opening');
  -- typed carried-in figures (card, credit, deposits, cash) plus the till holding exactly the float
  r := public.closing_save_draft('e0000000-0000-0000-0000-000000000001', current_date - 6, 'evening', 'final',
    '{"opening": {"cc": 1000, "credit": 2500, "deposits": 700, "cash": 0}, "till": [9,0,0,0,0,0,0,0], "sys_cash": 0, "last_bill_no": 500}');
  perform pg_temp.ok((r ->> 'version') = '2', 'saving the opening works and raises the version');
  perform pg_temp.ok((select prev_cc from public.closings where is_opening) = 1000 and (select prev_credit from public.closings where is_opening) = 2500
    and (select prev_deposits from public.closings where is_opening) = 700, 'the typed card, credit and deposits are kept (not overwritten by the carry)');
  perform pg_temp.refused($q$select public.closing_save_draft('e0000000-0000-0000-0000-000000000001', current_date - 6, 'evening', 'shift', '{}', null, 2)$q$, 'invalid_mode', 'the opening cannot be switched to a shift closing');
  reset role;

  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  perform pg_temp.refused($q$select public.closing_save_draft('e0000000-0000-0000-0000-000000000001', current_date - 6, 'evening', 'final', '{}', null, 2)$q$, 'not_allowed', 'staff cannot edit the opening draft');
  perform pg_temp.refused($q$select public.closing_submit('e0000000-0000-0000-0000-000000000001')$q$, 'not_allowed', 'staff cannot submit the opening');
  perform pg_temp.refused($q$select public.closing_save_draft('a0000000-0000-0000-0000-000000000001', current_date - 5, 'night', 'shift', '{}')$q$, 'opening_required', 'still no closings until the opening is SUBMITTED');
  reset role;

  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  r := public.closing_submit('e0000000-0000-0000-0000-000000000001'); -- the audit gate is ON here: an opening is exempt
  -- hand-worked: grand = till 45000 + card 1000 + credit 2500 + deposits 700 = 49200; liquid = 49200 - 45000 float = 4200
  perform pg_temp.ok((r -> 'result' ->> 'cc_total')::numeric = 1000 and (r -> 'result' ->> 'debt_e')::numeric = 2500
    and (r -> 'result' ->> 'deposits_f')::numeric = 700 and (r -> 'result' ->> 'grand')::numeric = 49200 and (r -> 'result' ->> 'liquid')::numeric = 4200,
    'the opening is submitted without the audit card; its stored figures match the hand-worked ones');
  perform pg_temp.refused($q$select public.closing_start_opening('e0000000-0000-0000-0000-000000000003', current_date - 8, 'evening')$q$, 'opening_not_first', 'a second opening is refused once closings exist');
  reset role;
  perform pg_temp.ok((select count(*) from public.activity_log where action = 'closing.opening_submitted') = 1, 'the opening is logged');
end $t$;

-- 2. refusal codes the screens will map (G3) and the audit gate
do $t$ declare r jsonb; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  r := public.closing_save_draft('a0000000-0000-0000-0000-000000000001', current_date - 5, 'night', 'shift',
    '{"sys_cash": 100000, "last_bill_no": 520, "alfalah": 3000, "comp_sale": 2000, "till": [10,0,0,0,0,0,0,0]}');
  insert into memo values ('night', r ->> 'closing_id');
  -- carried in from the opening: card 1000, credit 2500, deposits 700, cash = the opening's Liquid 4200
  perform pg_temp.ok((select prev_cc from public.closings where id = (r ->> 'closing_id')::uuid) = 1000
    and (select prev_credit from public.closings where id = (r ->> 'closing_id')::uuid) = 2500
    and (select prev_deposits from public.closings where id = (r ->> 'closing_id')::uuid) = 700
    and (select prev_cash from public.closings where id = (r ->> 'closing_id')::uuid) = 4200
    and (select source_closing_id from public.closings where id = (r ->> 'closing_id')::uuid) = (select v::uuid from memo where k = 'opening'),
    'the first Night carries the opening''s card, credit, deposits and Liquid');
  perform pg_temp.refused($q$select public.closing_save_draft('a0000000-0000-0000-0000-000000000001', current_date - 5, 'night', 'shift', '{"sys_cash": "abc"}', null, 1)$q$, 'invalid_amount', 'a non-number is refused with its code');
  perform pg_temp.refused($q$select public.closing_save_draft('a0000000-0000-0000-0000-000000000001', current_date - 5, 'night', 'shift', '{"sys_cash": 1e12}', null, 1)$q$, 'amount_too_large', 'an absurd amount has its own code');
  perform pg_temp.refused($q$select public.closing_save_draft('a0000000-0000-0000-0000-000000000001', current_date - 5, 'night', 'shift', '{"till": [-1,0,0,0,0,0,0,0]}', null, 1)$q$, 'invalid_quantity', 'a negative note count has its code');
  perform pg_temp.refused($q$select public.closing_save_draft('a0000000-0000-0000-0000-000000000001', current_date - 5, 'night', 'shift', '{"hs": "x"}', null, 1)$q$, 'invalid_rows', 'rows that are not a list have their code');
  perform pg_temp.refused($q$select public.closing_save_draft('a0000000-0000-0000-0000-000000000001', current_date - 5, 'night', 'shift', '{"till": [1,2,3,4,5,6,7,8,9]}', null, 1)$q$, 'invalid_cash_count', 'too many denominations has its code');
  perform pg_temp.refused($q$select public.closing_save_draft('a0000000-0000-0000-0000-000000000001', current_date - 5, 'night', 'shift', '{"credit": {"tier": [{},{},{},{}]}}', null, 1)$q$, 'too_many_tiers', 'a fourth tier slot has its code');
  perform pg_temp.refused($q$select public.closing_save_draft('a0000000-0000-0000-0000-000000000001', current_date - 5, 'night', 'shift', '{"hs": [{"label": 5}]}', null, 1)$q$, 'invalid_text', 'a non-text label has its code');
  perform pg_temp.refused($q$select public.closing_save_draft('a0000000-0000-0000-0000-000000000001', current_date - 4, 'night', 'shift', '{}', null, 1)$q$, 'key_other_slot', 'a key cannot be moved to another slot');
  perform pg_temp.refused($q$select public.closing_save_draft('a0000000-0000-0000-0000-000000000001', current_date - 5, 'night', 'shift', '{"opening": {"cc": 5}}', null, 1)$q$, 'opening_only', 'opening figures are refused on an ordinary closing');
  perform pg_temp.refused($q$select public.closing_save_draft('a0000000-0000-0000-0000-000000000009', current_date + 30, 'night', 'shift', '{}')$q$, 'date_out_of_range', 'a far-future date has its code');
  perform pg_temp.refused($q$select public.closing_save_draft('a0000000-0000-0000-0000-000000000009', current_date - 5, 'lunch', 'shift', '{}')$q$, 'invalid_slot_kind', 'an unknown slot kind has its code');
  perform pg_temp.refused($q$select public.closing_save_draft('a0000000-0000-0000-0000-000000000009', current_date - 5, 'night', 'weird', '{}')$q$, 'invalid_mode', 'an unknown mode has its code');
  perform pg_temp.refused($q$select public.closing_save_draft('a0000000-0000-0000-0000-000000000009', current_date - 5, 'night', 'shift', '{}')$q$, 'slot_taken', 'a second closing in a slot has its code');
  perform pg_temp.refused($q$select public.closing_save_draft('a0000000-0000-0000-0000-000000000009', current_date - 5, 'morning', 'final', '{"responsible_staff_id":"99999999-0000-0000-0000-000000000000"}')$q$, 'responsible_not_found', 'an unknown responsible person has its code');
  perform pg_temp.refused($q$select public.closing_submit('a0000000-0000-0000-0000-000000000001')$q$, 'audit_not_verified', 'the audit gate has its code');
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
  perform pg_temp.refused($q$select public.closing_save_draft('a0000000-0000-0000-0000-000000000001', current_date - 5, 'night', 'shift', '{}', null, 1)$q$, 'not_allowed', 'another staff member cannot use that key');
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  perform pg_temp.refused(format($q$select public.closing_correct(%L, '  ', '{}', gen_random_uuid())$q$, (select v from memo where k = 'night')), 'reason_required', 'a blank reason has its code');
  perform pg_temp.refused(format($q$select public.closing_correct(%L, 'typo', '{}', gen_random_uuid())$q$, (select v from memo where k = 'night')), 'not_current', 'correcting a draft has its code');
  perform public.settings_set('closing.require_inventory_audit', 'false', 'test rollout');
  reset role;
end $t$;

-- 3. CLS-6: no skipped slots; Final is the way past a gap; nothing is filled in behind a later closing
do $t$ declare r jsonb; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  perform pg_temp.refused($q$select public.closing_save_draft(gen_random_uuid(), current_date - 5, 'morning', 'shift', '{}')$q$, 'previous_slot_open', 'Morning is refused while the Night is only a draft');
  perform pg_temp.refused($q$select public.closing_save_draft(gen_random_uuid(), current_date - 5, 'evening', 'shift', '{}')$q$, 'previous_slot_open', 'Evening is refused while there is no submitted Morning');
  perform pg_temp.refused($q$select public.closing_save_draft(gen_random_uuid(), current_date - 5, 'handover', 'shift', '{}')$q$, 'previous_slot_open', 'a handover is refused while there is no submitted Morning');
  perform pg_temp.refused($q$select public.closing_save_draft(gen_random_uuid(), current_date - 4, 'night', 'shift', '{}')$q$, 'previous_slot_open', 'the next day''s Night is refused while yesterday''s Evening is missing');
  perform pg_temp.refused($q$select public.closing_save_draft(gen_random_uuid(), current_date - 7, 'night', 'final', '{}')$q$, 'slot_in_past', 'a closing before the opening cannot be added');
  perform pg_temp.refused($q$select public.closing_save_draft(gen_random_uuid(), current_date - 6, 'morning', 'final', '{}')$q$, 'slot_in_past', 'nor one earlier than a submitted closing on the same day');
  r := public.closing_submit('a0000000-0000-0000-0000-000000000001');
  -- hand-worked: grand = card (1000 + 3000 - 2000 = 2000) + till 50000 + credit 2500 + deposits 700 = 55200; liquid 10200
  perform pg_temp.ok((r -> 'result' ->> 'grand')::numeric = 55200 and (r -> 'result' ->> 'liquid')::numeric = 10200, 'the Night submits (the opening before it is submitted); Liquid is 10200');
  reset role;
end $t$;

-- 4. drafts have versions (CLS-13) and the carry guard (CLS-12), using a Morning that is saved before the Night is corrected
do $t$ declare r jsonb; m uuid; c public.closings; h text; d text; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  r := public.closing_save_draft('a0000000-0000-0000-0000-000000000011', current_date - 5, 'morning', 'shift', '{"sys_cash": 120000, "last_bill_no": 560}');
  m := (r ->> 'closing_id')::uuid;
  insert into memo values ('morning', m::text);
  perform pg_temp.ok((r ->> 'version') = '1', 'the first save is version 1');
  perform pg_temp.ok((select prev_cash from public.closings where id = m) = 10200 and (select prev_cc from public.closings where id = m) = 1000,
    'the Morning carries the Night''s Liquid 10200 and the Night''s opening card figure 1000');
  r := public.closing_save_draft('a0000000-0000-0000-0000-000000000011', current_date - 5, 'morning', 'shift', '{}', null, 1);
  perform pg_temp.ok((r ->> 'version') = '2', 'saving with the version it last saw makes version 2');
  perform pg_temp.refused($q$select public.closing_save_draft('a0000000-0000-0000-0000-000000000011', current_date - 5, 'morning', 'shift', '{"sys_cash": 1}', null, 1)$q$, 'draft_conflict', 'an older save is refused');
  perform pg_temp.refused($q$select public.closing_save_draft('a0000000-0000-0000-0000-000000000011', current_date - 5, 'morning', 'shift', '{"sys_cash": 1}')$q$, 'draft_conflict', 'a save with no version is refused once the draft has moved on');
  begin perform public.closing_save_draft('a0000000-0000-0000-0000-000000000011', current_date - 5, 'morning', 'shift', '{}', null, 1);
  exception when others then get stacked diagnostics d = pg_exception_detail; end;
  perform pg_temp.ok(d = 'version=2', 'the refusal tells the browser the current version');
  perform pg_temp.ok((select sys_cash from public.closings where id = m) = 120000, 'and the refused save changed nothing');
  r := public.closing_save_draft('a0000000-0000-0000-0000-000000000011', current_date - 5, 'morning', 'shift', '{}', null, 2);
  perform pg_temp.ok((r ->> 'version') = '3', 'the right version is accepted');
  reset role;

  -- the Night is corrected (recount: 11 x 5000 instead of 10) after the cashier last saved the Morning
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  r := public.closing_correct((select v::uuid from memo where k = 'night'), 'recount of the till', '{"till": [11,0,0,0,0,0,0,0]}', 'a0000000-0000-0000-0000-000000000031');
  insert into memo values ('night2', r ->> 'closing_id');
  -- hand-worked: grand 55200 + 5000 = 60200; liquid 15200
  perform pg_temp.ok((r -> 'result' ->> 'liquid')::numeric = 15200, 'the corrected Night has Liquid 15200');
  reset role;

  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  perform pg_temp.refused($q$select public.closing_submit('a0000000-0000-0000-0000-000000000011')$q$, 'carry_changed', 'submit is refused when the carried-in figures changed since the last save');
  perform pg_temp.ok((select prev_cash from public.closings where id = m) = 10200, 'the refusal leaves the draft as the cashier saw it');
  r := public.closing_save_draft('a0000000-0000-0000-0000-000000000011', current_date - 5, 'morning', 'shift', '{}', null, 3);
  perform pg_temp.ok((select prev_cash from public.closings where id = m) = 15200 and (select source_closing_id from public.closings where id = m) = (select v::uuid from memo where k = 'night2'),
    'the next save pulls in the corrected Night (a later draft picks up the correction)');
  r := public.closing_submit('a0000000-0000-0000-0000-000000000011');
  perform pg_temp.ok(r ->> 'status' = 'submitted', 'after reviewing, the Morning submits');
  -- shift sale = 120000 - the Night's 100000 (same day) = 20000; customers = 560 - 520 = 40
  perform pg_temp.ok((r -> 'result' ->> 'shift_sale')::numeric = 20000 and (r -> 'result' ->> 'customers')::numeric = 40, 'its shift sale and customers are worked from the Night');
  reset role;
end $t$;

-- 5. CLS-6 continued: handover, Evening, and Final past a gap
do $t$ declare r jsonb; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  perform public.closing_save_draft('a0000000-0000-0000-0000-000000000021', current_date - 5, 'handover', 'shift', '{}');
  perform pg_temp.ok((select seq from public.closing_slots where business_date = current_date - 5 and kind = 'handover') = 30, 'a handover is allowed once the Morning is submitted');
  perform pg_temp.refused($q$select public.closing_save_draft('a0000000-0000-0000-0000-000000000022', current_date - 5, 'evening', 'shift', '{}')$q$, 'previous_slot_open', 'the Evening waits for the handover before it');
  r := public.closing_save_draft('a0000000-0000-0000-0000-000000000022', current_date - 5, 'evening', 'final',
    '{"sys_cash": 200000, "alfalah": 5000, "comp_sale": 1000, "till": [10,0,0,0,0,0,0,0]}');
  insert into memo values ('evening', r ->> 'closing_id');
  perform pg_temp.ok((select prev_cash from public.closings where id = (r ->> 'closing_id')::uuid) = 0 and (select prev_credit from public.closings where id = (r ->> 'closing_id')::uuid) = 2500
    and (select source_closing_id from public.closings where id = (r ->> 'closing_id')::uuid) = (select v::uuid from memo where k = 'morning'),
    'a Final goes past the open handover: it carries credit from the last submitted closing and starts cash at 0');
  r := public.closing_submit('a0000000-0000-0000-0000-000000000022');
  perform pg_temp.ok(r ->> 'status' = 'submitted', 'the Final Evening submits');
  insert into memo values ('evening_result', (select to_jsonb(x)::text from public.closing_results x where closing_id = (select v::uuid from memo where k = 'evening')));
  perform pg_temp.ok(public.closing_save_draft('a0000000-0000-0000-0000-000000000023', current_date - 4, 'night', 'shift', '{}') ->> 'status' = 'draft', 'the next day''s Night starts once the Evening is submitted');
  reset role;
end $t$;

-- 6. CLS-7: reopen a submitted closing; the revision replaces it only when resubmitted; the original is kept
do $t$ declare r jsonb; rev uuid; orig uuid := (select v::uuid from memo where k = 'morning'); n int; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  perform pg_temp.refused(format($q$select public.closing_reopen(%L, 'typo', 'f0000000-0000-0000-0000-000000000001')$q$, orig), 'not_allowed', 'ordinary staff cannot reopen a closing');
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  perform pg_temp.refused(format($q$select public.closing_reopen(%L, ' ', 'f0000000-0000-0000-0000-000000000001')$q$, orig), 'reason_required', 'reopening needs a reason');
  r := public.closing_reopen(orig, 'system cash typed wrong', 'f0000000-0000-0000-0000-000000000001');
  rev := (r ->> 'closing_id')::uuid;
  perform pg_temp.ok((r ->> 'revision') = '2' and r ->> 'status' = 'draft' and (r ->> 'already') = 'false', 'reopening makes a draft revision 2');
  perform pg_temp.ok((select status from public.closings where id = orig) = 'submitted', 'the original stays submitted (and keeps feeding later closings) meanwhile');
  perform pg_temp.ok((public.closing_reopen(orig, 'system cash typed wrong', 'f0000000-0000-0000-0000-000000000001') ->> 'already') = 'true', 'the same request again is a harmless retry');
  perform pg_temp.refused(format($q$select public.closing_reopen(%L, 'again', gen_random_uuid())$q$, orig), 'revision_open', 'only one revision can be open at a time');
  perform pg_temp.refused(format($q$select public.closing_correct(%L, 'again', '{}', gen_random_uuid())$q$, orig), 'revision_open', 'nor a one-step correction beside it');
  reset role;

  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  perform pg_temp.refused($q$select public.closing_save_draft('f0000000-0000-0000-0000-000000000001', current_date - 5, 'morning', 'shift', '{"sys_cash": 1}', null, 1)$q$, 'not_allowed', 'the cashier cannot edit the revision of their own closing');
  perform pg_temp.refused($q$select public.closing_submit('f0000000-0000-0000-0000-000000000001')$q$, 'not_allowed', 'nor submit it');
  perform pg_temp.ok((select count(*) from public.closings where id = rev) = 1, 'but can still see it');
  perform pg_temp.ok(not exists (select 1 from jsonb_array_elements(public.closing_my_recent()) e where e ->> 'closing_id' = rev::text), 'it is not in the cashier''s own list of drafts');
  reset role;

  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  perform pg_temp.ok((select sys_cash from public.closings where id = rev) = 120000, 'the revision starts with the original''s figures');
  r := public.closing_save_draft('f0000000-0000-0000-0000-000000000001', current_date - 5, 'morning', 'shift', '{"sys_cash": 121000}', null, 1);
  perform pg_temp.ok((r ->> 'version') = '2', 'the admin edits the revision');
  r := public.closing_submit('f0000000-0000-0000-0000-000000000001');
  perform pg_temp.ok((select status from public.closings where id = orig) = 'superseded' and (select status from public.closings where id = rev) = 'submitted', 'resubmitting makes the revision current and keeps the original as superseded');
  -- shift sale = 121000 - 100000 = 21000 (the original had 20000)
  perform pg_temp.ok((r -> 'result' ->> 'shift_sale')::numeric = 21000 and (select shift_sale from public.closing_results where closing_id = orig) = 20000, 'the revision has its own result; the original''s result is untouched');
  perform pg_temp.ok((select (to_jsonb(x)::text) from public.closing_results x where closing_id = (select v::uuid from memo where k = 'evening')) = (select v from memo where k = 'evening_result')
    and (select source_closing_id from public.closings where id = (select v::uuid from memo where k = 'evening')) = orig, 'the later submitted Evening is unchanged (CLS-7)');
  reset role;
  perform pg_temp.ok((select count(*) from public.activity_log where action = 'closing.corrected' and reason = 'system cash typed wrong') = 1
    and (select count(*) from public.activity_log where action = 'closing.reopened') = 1, 'the reopen and the correction (with its reason) are logged');

  -- giving up a reopened revision leaves the original as it was
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  r := public.closing_reopen((select v::uuid from memo where k = 'evening'), 'checking', 'f0000000-0000-0000-0000-000000000002');
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  perform pg_temp.refused(format($q$select public.closing_discard_revision(%L)$q$, r ->> 'closing_id'), 'not_allowed', 'staff cannot discard a revision');
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  perform public.closing_discard_revision((r ->> 'closing_id')::uuid);
  perform pg_temp.ok((select count(*) from public.closings where id = (r ->> 'closing_id')::uuid) = 0 and (select status from public.closings where id = (select v::uuid from memo where k = 'evening')) = 'submitted', 'a discarded revision is gone and the original is still submitted');
  perform pg_temp.refused($q$select public.closing_discard_revision(gen_random_uuid())$q$, 'not_allowed', 'only an existing revision can be discarded');
  reset role;
  select count(*) into n from public.closings where status = 'draft' and supersedes_id is not null; perform pg_temp.ok(n = 0, 'no revision draft is left behind');
end $t$;

-- 7. the reads the screens need (CLS-14, G7)
do $t$ declare r jsonb; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  r := public.closing_staff_choices();
  perform pg_temp.ok(jsonb_array_length(r) = 3 and r -> 0 ->> 'name' = 'J One' and r -> 2 ->> 'name' = 'Test Owner', 'a junior can pick any active staff member by name (J One, J Two, the owner)');
  r := public.closing_my_recent();
  perform pg_temp.ok(jsonb_array_length(r) >= 3, 'my recent closings lists my own');
  perform pg_temp.ok(exists (select 1 from jsonb_array_elements(r) e where e ->> 'status' = 'draft' and e ->> 'key' = 'a0000000-0000-0000-0000-000000000023' and (e ->> 'version') = '1'), 'a draft comes with its key and version, so it can be resumed');
  perform pg_temp.ok(not exists (select 1 from jsonb_array_elements(r) e where (e ->> 'is_opening')::boolean), 'and does not include the admin''s opening');
  perform pg_temp.ok(not exists (select 1 from jsonb_array_elements(r) e where e ->> 'status' = 'superseded'), 'nor superseded revisions');
  reset role;
end $t$;
do $t$ begin
  update public.staff set active = false where id = '10000000-0000-0000-0000-000000000002';
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  perform pg_temp.ok(jsonb_array_length(public.closing_staff_choices()) = 2 and not (public.closing_staff_choices()::text like '%J Two%'), 'an inactive staff member is not offered');
  reset role;
  -- a closing with no responsible person cannot be submitted
  update public.closings set responsible_staff_id = null where idempotency_key = 'a0000000-0000-0000-0000-000000000023';
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  perform pg_temp.refused($q$select public.closing_submit('a0000000-0000-0000-0000-000000000023')$q$, 'choose_responsible', 'submit needs a responsible staff member');
  reset role;
end $t$;

-- 8. only signed-in people, and no internals from the browser
do $t$ begin
  set local role anon;
  perform pg_temp.denied($q$select public.closing_staff_choices()$q$, 'anon cannot list staff');
  perform pg_temp.denied($q$select public.closing_my_recent()$q$, 'anon cannot list closings');
  perform pg_temp.denied($q$select public.closing_start_opening(gen_random_uuid(), current_date, 'night')$q$, 'anon cannot start an opening');
  perform pg_temp.denied($q$select public.closing_reopen(gen_random_uuid(), 'x', gen_random_uuid())$q$, 'anon cannot reopen');
  perform pg_temp.denied($q$select public.closing_discard_revision(gen_random_uuid())$q$, 'anon cannot discard');
  perform pg_temp.denied($q$select public.closing_save_draft(gen_random_uuid(), current_date, 'night', 'shift', '{}', null, null)$q$, 'anon cannot save');
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  perform pg_temp.denied($q$select public.closing_previous_slot_submitted(current_date, 'night', 10)$q$, 'the slot-order check is internal');
  perform pg_temp.denied($q$select public.closing_clone_children(gen_random_uuid(), gen_random_uuid())$q$, 'the copy helper is internal');
  perform pg_temp.denied($q$select public.closing_can_edit(null::public.closings)$q$, 'the edit check is internal');
  perform pg_temp.denied($q$select public.closing_apply_payload(gen_random_uuid(), '{}')$q$, 'apply_payload stays internal');
  reset role;
end $t$;
rollback;
