-- Tests for 0218_closing_mode_change: only the Owner (admin at MFA level 2) changes a closing's mode; the database refuses every
-- other route; a draft keeps all its figures and rows; a submitted closing goes through reopen -> edit -> normal submit and the
-- original is untouched until then (CLS-7); CLS-6 holds; every change is in the activity log.
-- Hand-worked figures are in the comments.
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
    raise notice 'pass (denied): %', msg; return;
  end;
  raise exception 'FAIL (was allowed): %', msg;
end $$;
-- a fingerprint of every child row of a closing (ids that are generated per copy are left out; the stable ids are kept)
create function pg_temp.fp(x uuid) returns text language sql stable as $$
  select md5(concat_ws('|',
    (select coalesce(string_agg(label || ':' || amount || ':' || sort || ':' || (deleted_at is not null), ',' order by sort), '') from public.closing_hs_rows where closing_id = x),
    (select coalesce(string_agg(label || ':' || price || ':' || qty || ':' || sort, ',' order by sort), '') from public.closing_strip_lines where closing_id = x),
    (select coalesce(string_agg(area || ':' || denomination || ':' || qty, ',' order by area, denomination), '') from public.closing_cash_counts where closing_id = x),
    (select coalesce(string_agg(line_id || ':' || kind || ':' || label || ':' || amount || ':' || sort, ',' order by sort, line_id), '') from public.closing_credit_lines where closing_id = x),
    (select coalesce(string_agg(label || ':' || amount || ':' || sort, ',' order by sort), '') from public.closing_deposits where closing_id = x),
    (select coalesce(string_agg(bill_no || ':' || collected || ':' || pharmacy_bill || ':' || sort, ',' order by sort), '') from public.closing_mediq_orders where closing_id = x),
    (select coalesce(string_agg(charge_id || ':' || label || ':' || amount || ':' || sort, ',' order by sort, charge_id), '') from public.closing_misc_rows where closing_id = x)))
$$;
create temp table memo (k text primary key, v text);
grant all on memo to authenticated;
create function pg_temp.m(k text) returns text language sql stable as $$ select v from memo where memo.k = $1 $$;

insert into auth.users(id, email) values
 ('00000000-0000-0000-0000-0000000000a1','a@t'),('00000000-0000-0000-0000-0000000000b1','j@t'),
 ('00000000-0000-0000-0000-0000000000b2','j2@t'),('00000000-0000-0000-0000-0000000000c1','s@t');
select public.bootstrap_first_admin('00000000-0000-0000-0000-0000000000a1','owner','Test Owner');
insert into public.staff(id, full_name) values
 ('10000000-0000-0000-0000-000000000001','J One'),('10000000-0000-0000-0000-000000000002','J Two'),('10000000-0000-0000-0000-000000000003','S One');
insert into public.profiles(user_id, staff_id, username, role_template) values
 ('00000000-0000-0000-0000-0000000000b1','10000000-0000-0000-0000-000000000001','junior1','junior'),
 ('00000000-0000-0000-0000-0000000000b2','10000000-0000-0000-0000-000000000002','junior2','junior'),
 ('00000000-0000-0000-0000-0000000000c1','10000000-0000-0000-0000-000000000003','senior1','senior');
-- a senior who was handed the powerful closing keys by hand: still not the Owner
insert into public.user_permissions(user_id, perm_key, effect) values
 ('00000000-0000-0000-0000-0000000000c1','closing.correct','grant'),('00000000-0000-0000-0000-0000000000c1','closing.review','grant'),
 ('00000000-0000-0000-0000-0000000000c1','closing.settings','grant'),('00000000-0000-0000-0000-0000000000c1','closing.enter_own','grant');

-- 0. set-up: the opening (Final, typed figures), the audit gate off for the test, and the Night of day -5
do $t$ declare r jsonb; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  r := public.closing_start_opening('e0000000-0000-0000-0000-000000000001', current_date - 6, 'evening');
  perform public.closing_save_draft('e0000000-0000-0000-0000-000000000001', current_date - 6, 'evening', 'final',
    '{"opening": {"cc": 1000, "credit": 2500, "deposits": 700, "cash": 0}, "till": [9,0,0,0,0,0,0,0], "sys_cash": 0, "last_bill_no": 500}');
  perform public.closing_submit('e0000000-0000-0000-0000-000000000001');
  insert into memo values ('opening', r ->> 'closing_id');
  perform public.settings_set('closing.require_inventory_audit', 'false', 'test set-up');
  reset role;

  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  r := public.closing_save_draft('a0000000-0000-0000-0000-000000000001', current_date - 5, 'night', 'shift',
    '{"sys_cash": 100000, "last_bill_no": 520, "alfalah": 3000, "comp_sale": 2000, "till": [10,0,0,0,0,0,0,0],
      "hs": [{"label":"tea","amount":300}], "deposits": [{"label":"bank","amount":500}], "misc": [{"label":"ongoing","amount":200}],
      "credit": {"named": [{"label":"Ali","amount":400}]}}');
  insert into memo values ('night', r ->> 'closing_id');
  perform public.closing_submit('a0000000-0000-0000-0000-000000000001');
  reset role;
  perform pg_temp.ok((select status from public.closings where id = pg_temp.m('night')::uuid) = 'submitted', 'set-up: the Night is submitted');
end $t$;

-- 1. a draft Morning (Shift) with rows in several sections
do $t$ declare r jsonb; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  r := public.closing_save_draft('a0000000-0000-0000-0000-000000000002', current_date - 5, 'morning', 'shift',
    '{"sys_cash": 150000, "last_bill_no": 560, "till": [8,0,0,0,0,0,0,0], "vault": [1,0,0,0,0,0,0,0],
      "hs": [{"label":"h1","amount":100},{"label":"h2","amount":50}], "deposits": [{"label":"d1","amount":250}],
      "mediq": [{"bill_no":"M1","collected":1000,"pharmacy_bill":800}], "misc": [{"label":"m1","amount":75}],
      "credit": {"named": [{"label":"Bo","amount":60}], "tier": [{"label":"t","amount":10}]}}');
  insert into memo values ('morning', r ->> 'closing_id');
  reset role;
  perform pg_temp.ok((select mode from public.closings where id = pg_temp.m('morning')::uuid) = 'shift', 'the Morning draft starts as Shift');
end $t$;

-- 2. who may change a mode: nobody but the Owner (admin + MFA); the trigger refuses every other route
do $t$ begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  perform pg_temp.refused(format($q$select public.closing_change_mode(%L, 'final', 'because', null)$q$, pg_temp.m('morning')), 'mode_change_owner_only', 'a junior cannot change the mode');
  perform pg_temp.refused($q$select public.closing_save_draft('a0000000-0000-0000-0000-000000000002', current_date - 5, 'morning', 'final', '{}', null, 1)$q$, 'mode_change_owner_only', 'a junior cannot change the mode through the ordinary save either (the trigger refuses)');
  perform pg_temp.ok((select mode from public.closings where id = pg_temp.m('morning')::uuid) = 'shift', 'the refused save left the mode alone');
  perform pg_temp.denied(format($q$update public.closings set mode = 'final' where id = %L$q$, pg_temp.m('morning')), 'no browser role has UPDATE on closings');
  perform pg_temp.denied($q$select public.closing_is_admin_owner()$q$, 'the owner check is internal');
  perform pg_temp.denied($q$select public.closing_mode_guard()$q$, 'the guard function is internal');
  reset role;

  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  perform pg_temp.refused(format($q$select public.closing_change_mode(%L, 'final', 'because', null)$q$, pg_temp.m('morning')), 'mode_change_owner_only', 'a senior holding closing.correct / review / settings is still not the Owner');
  reset role;

  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal1');
  perform pg_temp.refused(format($q$select public.closing_change_mode(%L, 'final', 'because', null)$q$, pg_temp.m('morning')), 'mode_change_owner_only', 'the admin without MFA (aal1) cannot');
  reset role;

  -- an admin that is disabled is not the Owner
  update public.profiles set disabled_at = now() where username = 'owner';
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  perform pg_temp.refused(format($q$select public.closing_change_mode(%L, 'final', 'because', null)$q$, pg_temp.m('morning')), 'mode_change_owner_only', 'a disabled admin cannot');
  reset role;
  update public.profiles set disabled_at = null where username = 'owner';

  -- not even the database owner role can slip a mode change past the guard: no Owner token, no change.
  -- (reset role does not clear the JWT claims of the last as_user, so they are cleared here: this session is signed in as nobody)
  perform set_config('request.jwt.claims', '', true);
  perform pg_temp.refused(format($q$update public.closings set mode = 'final' where id = %L$q$, pg_temp.m('morning')), 'mode_change_owner_only', 'a plain UPDATE with no Owner session is refused by the trigger');
  perform set_config('dua.closing_mode_change', 'on', true);
  perform pg_temp.refused(format($q$update public.closings set mode = 'final' where id = %L$q$, pg_temp.m('morning')), 'mode_change_owner_only', 'a guessed token does not work');
  perform set_config('dua.closing_mode_change', pg_current_xact_id()::text, true);
  perform pg_temp.refused(format($q$update public.closings set mode = 'final' where id = %L$q$, pg_temp.m('morning')), 'mode_change_owner_only', 'even the right token without the Owner''s signed-in session does not work');
  perform set_config('dua.closing_mode_change', '', true);
  perform pg_temp.ok((select mode from public.closings where id = pg_temp.m('morning')::uuid) = 'shift', 'still Shift after every refused attempt');
  perform pg_temp.ok((select count(*) from public.activity_log where action = 'closing.mode_changed') = 0, 'refused attempts leave no audit row');
end $t$;

-- 3. the Owner changes a DRAFT: figures and rows stay, carried-in figures follow the mode, the version goes up
do $t$ declare r jsonb; before_fp text; before_ver int; night_liquid numeric; night_dep numeric; k jsonb; begin
  select liquid, deposits_f into night_liquid, night_dep from public.closing_results where closing_id = pg_temp.m('night')::uuid;
  before_fp := pg_temp.fp(pg_temp.m('morning')::uuid);
  select draft_version into before_ver from public.closings where id = pg_temp.m('morning')::uuid;
  perform pg_temp.ok((select prev_cash from public.closings where id = pg_temp.m('morning')::uuid) = night_liquid
    and (select prev_deposits from public.closings where id = pg_temp.m('morning')::uuid) = night_dep and night_liquid > 0 and night_dep = 1200,
    'as Shift the Morning carries the Night''s Liquid and deposits (deposits 700 + 500 = 1200)');

  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  -- Shift: shift sale = 150000 - the Night's 100000 = 50000
  perform pg_temp.ok(((public.closing_compute(pg_temp.m('morning')::uuid)) ->> 'shift_sale')::numeric = 50000, 'as Shift the sale is 150000 - 100000 = 50000');
  perform pg_temp.refused(format($q$select public.closing_change_mode(%L, 'weird', 'because', null)$q$, pg_temp.m('morning')), 'invalid_mode', 'an unknown mode is refused');
  perform pg_temp.refused(format($q$select public.closing_change_mode(%L, null, 'because', null)$q$, pg_temp.m('morning')), 'invalid_mode', 'a missing mode is refused');
  perform pg_temp.refused(format($q$select public.closing_change_mode(%L, 'final', '  ', null)$q$, pg_temp.m('morning')), 'reason_required', 'a blank reason is refused');
  perform pg_temp.refused(format($q$select public.closing_change_mode(%L, 'final', 'ab', null)$q$, pg_temp.m('morning')), 'reason_required', 'a two-letter reason is refused');
  perform pg_temp.refused(format($q$select public.closing_change_mode(%L, 'shift', 'because', null)$q$, pg_temp.m('morning')), 'mode_unchanged', 'changing to the mode it already has is refused');
  perform pg_temp.refused($q$select public.closing_change_mode('99999999-0000-0000-0000-000000000000', 'final', 'because', null)$q$, 'not_allowed', 'an unknown closing is refused');

  r := public.closing_change_mode(pg_temp.m('morning')::uuid, 'final', 'Day ends here, closing for the night', null);
  perform pg_temp.ok(r ->> 'old_mode' = 'shift' and r ->> 'new_mode' = 'final' and r ->> 'status' = 'draft' and (r ->> 'already') = 'false'
    and r -> 'original_closing_id' = 'null'::jsonb and (r ->> 'version')::int = before_ver + 1, 'the draft is now Final; the version went up by one; no original (it was a draft)');
  perform pg_temp.ok((select mode from public.closings where id = pg_temp.m('morning')::uuid) = 'final', 'stored as Final');
  perform pg_temp.ok(pg_temp.fp(pg_temp.m('morning')::uuid) = before_fp, 'every child row is exactly as it was (hs, strips, cash counts, credit, deposits, MEDIQ, misc)');
  perform pg_temp.ok((select sys_cash from public.closings where id = pg_temp.m('morning')::uuid) = 150000
    and (select last_bill_no from public.closings where id = pg_temp.m('morning')::uuid) = 560, 'the typed figures are kept');
  perform pg_temp.ok((select count(*) from public.closing_hs_rows where closing_id = pg_temp.m('morning')::uuid) = 2
    and (select count(*) from public.closing_credit_lines where closing_id = pg_temp.m('morning')::uuid) = 2, 'row counts are unchanged');
  -- Final: starts cash and deposits at 0, keeps credit and card; the whole POS figure is the sale
  perform pg_temp.ok((select prev_cash from public.closings where id = pg_temp.m('morning')::uuid) = 0
    and (select prev_deposits from public.closings where id = pg_temp.m('morning')::uuid) = 0, 'as Final the carried cash and deposits are 0 (CLS-11)');
  -- credit comes from the Night's result (2500 + Ali 400 = 2900 + Bo is this shift's), card is the Night's own carried-in card (1000)
  perform pg_temp.ok((select prev_credit from public.closings where id = pg_temp.m('morning')::uuid) = (select debt_e from public.closing_results where closing_id = pg_temp.m('night')::uuid)
    and (select prev_cc from public.closings where id = pg_temp.m('morning')::uuid) = (select prev_cc from public.closings where id = pg_temp.m('night')::uuid)
    and (select prev_credit from public.closings where id = pg_temp.m('morning')::uuid) = 2900 and (select prev_cc from public.closings where id = pg_temp.m('morning')::uuid) = 1000,
    'credit (2900) and card (1000) are still carried, exactly as for Shift');
  perform pg_temp.ok(((public.closing_compute(pg_temp.m('morning')::uuid)) ->> 'shift_sale')::numeric = 150000, 'as Final the sale is the whole 150000 (the calculation engine is the existing one)');
  perform pg_temp.refused(format($q$select public.closing_change_mode(%L, 'final', 'again', null)$q$, pg_temp.m('morning')), 'mode_unchanged', 'a second Final is refused');

  -- another device that last saw the old version is told, by the existing conflict rule
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  perform pg_temp.refused(format($q$select public.closing_save_draft('a0000000-0000-0000-0000-000000000002', current_date - 5, 'morning', 'final', '{}', null, %s)$q$, before_ver), 'draft_conflict', 'a device holding the old version gets draft_conflict and reloads');
  reset role;

  -- and back to Shift: the carried-in cash and deposits come back, nothing typed is lost
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  r := public.closing_change_mode(pg_temp.m('morning')::uuid, 'shift', 'Mistake, it is a normal shift', null);
  perform pg_temp.ok(r ->> 'new_mode' = 'shift' and (r ->> 'version')::int = before_ver + 2, 'back to Shift');
  perform pg_temp.ok((select prev_cash from public.closings where id = pg_temp.m('morning')::uuid) = night_liquid
    and (select prev_deposits from public.closings where id = pg_temp.m('morning')::uuid) = night_dep, 'the Night''s Liquid and deposits are carried again');
  perform pg_temp.ok(pg_temp.fp(pg_temp.m('morning')::uuid) = before_fp, 'the rows are still exactly as they were after the round trip');
  perform pg_temp.ok(((public.closing_compute(pg_temp.m('morning')::uuid)) ->> 'shift_sale')::numeric = 50000, 'the sale is 50000 again');
  reset role;

  -- the audit trail: both changes, with old mode, new mode, the Owner, the reason and the revision
  perform pg_temp.ok((select count(*) from public.activity_log where action = 'closing.mode_changed' and entity_id = pg_temp.m('morning')) = 2, 'two audit rows');
  select to_jsonb(a) into k from public.activity_log a where action = 'closing.mode_changed' and entity_id = pg_temp.m('morning') order by id limit 1;
  perform pg_temp.ok(k ->> 'user_id' = '00000000-0000-0000-0000-0000000000a1' and k -> 'old_value' ->> 'mode' = 'shift' and k -> 'new_value' ->> 'mode' = 'final'
    and k ->> 'reason' = 'Day ends here, closing for the night' and (k -> 'new_value' ->> 'revision')::int = 1 and k -> 'old_value' ->> 'status' = 'draft'
    and k -> 'new_value' ->> 'reopened' = 'false', 'the first row names the Owner, Shift -> Final, the reason, revision 1 and that it was a draft');
  perform pg_temp.ok((select count(*) from public.activity_log where action = 'closing.reopened') = 0, 'a draft change reopens nothing');
end $t$;

-- 4. submit the Morning (Shift) and the Evening after it: these are the "later closings" CLS-7 protects
do $t$ declare r jsonb; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  r := public.closing_submit('a0000000-0000-0000-0000-000000000002');
  perform pg_temp.ok(r ->> 'status' = 'submitted', 'the Morning is submitted as Shift');
  r := public.closing_save_draft('a0000000-0000-0000-0000-000000000003', current_date - 5, 'evening', 'shift',
    '{"sys_cash": 200000, "last_bill_no": 600, "till": [6,0,0,0,0,0,0,0]}');
  insert into memo values ('evening', r ->> 'closing_id');
  perform public.closing_submit('a0000000-0000-0000-0000-000000000003');
  reset role;
  perform pg_temp.ok((select status from public.closings where id = pg_temp.m('evening')::uuid) = 'submitted', 'the Evening is submitted');
end $t$;

-- 5. CLS-6: a Final after a gap cannot be made a Shift while the slot before it is open
do $t$ declare r jsonb; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  perform pg_temp.refused($q$select public.closing_save_draft('a0000000-0000-0000-0000-000000000004', current_date - 4, 'morning', 'shift', '{}')$q$, 'previous_slot_open', 'a Shift Morning cannot start when the Night of that day was never closed');
  r := public.closing_save_draft('a0000000-0000-0000-0000-000000000004', current_date - 4, 'morning', 'final', '{"sys_cash": 90000, "last_bill_no": 640, "till": [9,0,0,0,0,0,0,0]}');
  insert into memo values ('gap', r ->> 'closing_id');
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  perform pg_temp.refused(format($q$select public.closing_change_mode(%L, 'shift', 'trying to skip a slot', null)$q$, pg_temp.m('gap')), 'previous_slot_open', 'CLS-6: the Owner cannot turn a gap-crossing Final into a Shift');
  reset role;
  perform pg_temp.ok((select mode from public.closings where id = pg_temp.m('gap')::uuid) = 'final', 'it is still Final');
  perform pg_temp.ok((select count(*) from public.activity_log where action = 'closing.mode_changed' and entity_id = pg_temp.m('gap')) = 0, 'the refusal left no audit row');
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  perform public.closing_submit('a0000000-0000-0000-0000-000000000004');
  reset role;
  perform pg_temp.ok((select status from public.closings where id = pg_temp.m('gap')::uuid) = 'submitted', 'the gap-crossing Final is submitted');
end $t$;

-- 6. a SUBMITTED closing: reopen as a revision, change the mode, edit a figure, resubmit through the normal submit
do $t$ declare r jsonb; v_orig uuid; v_rev uuid; ev_hash text; gap_hash text; orig_hash text; orig_fp text; ver int; begin
  v_orig := pg_temp.m('morning')::uuid;
  select md5(to_jsonb(x)::text) into orig_hash from public.closing_results x where closing_id = v_orig;
  orig_fp := pg_temp.fp(v_orig);
  select md5(to_jsonb(x)::text) into ev_hash from public.closing_results x where closing_id = pg_temp.m('evening')::uuid;
  select md5(to_jsonb(x)::text) into gap_hash from public.closing_results x where closing_id = pg_temp.m('gap')::uuid;

  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  perform pg_temp.refused(format($q$select public.closing_change_mode(%L, 'final', 'because', gen_random_uuid())$q$, v_orig), 'mode_change_owner_only', 'a junior cannot reopen-and-change a submitted closing');
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  perform pg_temp.refused(format($q$select public.closing_change_mode(%L, 'final', 'because', gen_random_uuid())$q$, v_orig), 'mode_change_owner_only', 'nor can a senior with closing.correct');
  reset role;
  perform pg_temp.ok((select count(*) from public.closings where slot_id = (select slot_id from public.closings where id = v_orig) and status = 'draft') = 0, 'those refusals created no revision');

  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  perform pg_temp.refused(format($q$select public.closing_change_mode(%L, 'final', 'because', null)$q$, v_orig), 'invalid_payload', 'a submitted closing needs a request key (the reopen is idempotent on it)');
  r := public.closing_change_mode(v_orig, 'final', 'Owner decided this shift was the last of the day', 'b0000000-0000-0000-0000-000000000001');
  v_rev := (r ->> 'closing_id')::uuid;
  insert into memo values ('rev', v_rev::text);
  perform pg_temp.ok(r ->> 'old_mode' = 'shift' and r ->> 'new_mode' = 'final' and r ->> 'status' = 'draft' and (r ->> 'revision')::int = 2
    and (r ->> 'original_closing_id')::uuid = v_orig and v_rev <> v_orig, 'a new draft revision 2 is made, it is Final, and it points at the original');
  -- the original is preserved, byte for byte, until the correction is submitted
  perform pg_temp.ok((select status from public.closings where id = v_orig) = 'submitted' and (select mode from public.closings where id = v_orig) = 'shift', 'the original is still submitted and still Shift');
  perform pg_temp.ok((select md5(to_jsonb(x)::text) from public.closing_results x where closing_id = v_orig) = orig_hash and pg_temp.fp(v_orig) = orig_fp, 'its stored results and rows are untouched');
  perform pg_temp.ok((select supersedes_id from public.closings where id = v_rev) = v_orig and (select correction_reason from public.closings where id = v_rev) = 'Owner decided this shift was the last of the day'
    and (select corrected_by from public.closings where id = v_rev) = '00000000-0000-0000-0000-0000000000a1' and (select mode from public.closings where id = v_rev) = 'final', 'the revision carries the reason, the Owner and the new mode');
  perform pg_temp.ok(pg_temp.fp(v_rev) = orig_fp, 'the revision has every child row of the original');
  perform pg_temp.ok((select count(*) from public.closings where slot_id = (select slot_id from public.closings where id = v_orig) and status = 'submitted') = 1
    and (select count(*) from public.closings where slot_id = (select slot_id from public.closings where id = v_orig) and status = 'draft') = 1, 'the slot has its one submitted and one draft');
  perform pg_temp.ok((select prev_cash from public.closings where id = v_rev) = 0 and (select prev_deposits from public.closings where id = v_rev) = 0, 'the revision carries cash and deposits as Final does');
  -- a retry with the same key is harmless
  perform pg_temp.ok((public.closing_change_mode(v_orig, 'final', 'Owner decided this shift was the last of the day', 'b0000000-0000-0000-0000-000000000001') ->> 'already') = 'true', 'the same request again does nothing twice');
  perform pg_temp.ok((select count(*) from public.closings where slot_id = (select slot_id from public.closings where id = v_orig)) = 2, 'still only the original and one revision');
  perform pg_temp.refused(format($q$select public.closing_change_mode(%L, 'final', 'a second try', gen_random_uuid())$q$, v_orig), 'revision_open', 'a second revision is refused while one is open');
  reset role;

  -- the revision is the Owner's: a cashier cannot edit or submit it
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  perform pg_temp.refused($q$select public.closing_save_draft('b0000000-0000-0000-0000-000000000001', current_date - 5, 'morning', 'final', '{}', null, 2)$q$, 'not_allowed', 'a cashier cannot edit the revision');
  perform pg_temp.refused($q$select public.closing_submit('b0000000-0000-0000-0000-000000000001')$q$, 'not_allowed', 'nor submit it');
  reset role;

  -- the Owner edits a figure with the normal save and resubmits with the normal submit
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  select draft_version into ver from public.closings where id = v_rev;
  r := public.closing_save_draft('b0000000-0000-0000-0000-000000000001', current_date - 5, 'morning', 'final', '{"sys_cash": 160000}', null, ver);
  perform pg_temp.ok((r ->> 'version')::int = ver + 1, 'the normal save works on the revision (the mode is unchanged, so the guard is not involved)');
  perform pg_temp.ok((select status from public.closings where id = v_orig) = 'submitted', 'the original is STILL submitted while the correction is a draft');
  r := public.closing_submit('b0000000-0000-0000-0000-000000000001');
  perform pg_temp.ok(r ->> 'status' = 'submitted' and (r ->> 'revision')::int = 2, 'the revision is submitted by the existing workflow (no carry_changed refusal: the carried figures match the new mode)');
  reset role;
  perform pg_temp.ok((select status from public.closings where id = v_orig) = 'superseded' and (select mode from public.closings where id = v_orig) = 'shift', 'only now is the original superseded, and it keeps its original mode');
  perform pg_temp.ok((select md5(to_jsonb(x)::text) from public.closing_results x where closing_id = v_orig) = orig_hash, 'and its stored results are still exactly what they were');
  perform pg_temp.ok((select status from public.closings where id = v_rev) = 'submitted' and (select mode from public.closings where id = v_rev) = 'final', 'the revision is the submitted one, Final');
  -- hand-worked: as Final the sale is the whole POS figure 160000 (not 160000 - 100000), and the Final variance is stored
  perform pg_temp.ok((select shift_sale from public.closing_results where closing_id = v_rev) = 160000 and (select final_variance from public.closing_results where closing_id = v_rev) is not null
    and (select final_variance from public.closing_results where closing_id = v_orig) is null, 'the new result is a Final one (sale 160000, Final variance stored); the original had none');
  -- CLS-7: later submitted closings never change
  perform pg_temp.ok((select md5(to_jsonb(x)::text) from public.closing_results x where closing_id = pg_temp.m('evening')::uuid) = ev_hash
    and (select md5(to_jsonb(x)::text) from public.closing_results x where closing_id = pg_temp.m('gap')::uuid) = gap_hash
    and (select status from public.closings where id = pg_temp.m('evening')::uuid) = 'submitted'
    and (select source_closing_id from public.closings where id = pg_temp.m('evening')::uuid) = v_orig, 'CLS-7: the later submitted closings are unchanged (the Evening still points at the closing it was submitted against)');

  -- the audit trail for the whole story
  perform pg_temp.ok((select count(*) from public.activity_log where action = 'closing.reopened' and entity_id = v_rev::text) = 1, 'the reopen is logged by the existing workflow');
  perform pg_temp.ok((select count(*) from public.activity_log where action = 'closing.corrected' and entity_id = v_rev::text and reason = 'Owner decided this shift was the last of the day') = 1, 'the resubmission is logged as a correction with the reason');
  perform pg_temp.ok((select count(*) from public.activity_log where action = 'closing.mode_changed' and entity_id = v_rev::text) = 1, 'one mode-change row for the revision');
  perform pg_temp.ok((select (old_value ->> 'mode') = 'shift' and (new_value ->> 'mode') = 'final' and user_id = '00000000-0000-0000-0000-0000000000a1' and reason = 'Owner decided this shift was the last of the day'
      and (old_value ->> 'revision')::int = 1 and (new_value ->> 'revision')::int = 2 and (new_value ->> 'original_closing_id')::uuid = v_orig and new_value ->> 'reopened' = 'true' and old_value ->> 'status' = 'submitted'
      from public.activity_log where action = 'closing.mode_changed' and entity_id = v_rev::text), 'that row: Shift -> Final, the Owner, the reason, revision 1 -> 2, the original, and that it was reopened from submitted');

  -- a superseded closing cannot be changed
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  perform pg_temp.refused(format($q$select public.closing_change_mode(%L, 'shift', 'old one', gen_random_uuid())$q$, v_orig), 'not_current', 'a superseded revision cannot be changed');
  reset role;
end $t$;

-- 7. giving the correction up leaves the original exactly as it was; a refused change rolls the reopen back
do $t$ declare r jsonb; ev uuid; ev_hash text; ev_fp text; v_rev uuid; begin
  ev := pg_temp.m('evening')::uuid;
  select md5(to_jsonb(x)::text) into ev_hash from public.closing_results x where closing_id = ev;
  ev_fp := pg_temp.fp(ev);
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  r := public.closing_change_mode(ev, 'final', 'Trying Final for the Evening', 'b0000000-0000-0000-0000-000000000002');
  v_rev := (r ->> 'closing_id')::uuid;
  perform public.closing_discard_revision(v_rev);
  reset role;
  perform pg_temp.ok((select status from public.closings where id = ev) = 'submitted' and (select mode from public.closings where id = ev) = 'shift'
    and (select md5(to_jsonb(x)::text) from public.closing_results x where closing_id = ev) = ev_hash and pg_temp.fp(ev) = ev_fp, 'after the revision is discarded the original is submitted, Shift and untouched');
  perform pg_temp.ok((select count(*) from public.closings where id = v_rev) = 0, 'the revision is gone');
  perform pg_temp.ok((select count(*) from public.activity_log where action = 'closing.mode_changed' and entity_id = v_rev::text) = 1, 'but the audit row stays (the log is append-only)');

  -- the gap-crossing Final: Final -> Shift is refused by CLS-6, and the revision the call opened is rolled back with it
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  perform pg_temp.refused(format($q$select public.closing_change_mode(%L, 'shift', 'trying to skip a slot', 'b0000000-0000-0000-0000-000000000003')$q$, pg_temp.m('gap')), 'previous_slot_open', 'CLS-6 also holds for a submitted closing');
  reset role;
  perform pg_temp.ok((select count(*) from public.closings where slot_id = (select slot_id from public.closings where id = pg_temp.m('gap')::uuid)) = 1
    and (select status from public.closings where id = pg_temp.m('gap')::uuid) = 'submitted', 'no stray revision was left behind');
  perform pg_temp.ok((select count(*) from public.activity_log where action = 'closing.reopened' and new_value ->> 'original' = pg_temp.m('gap')) = 0, 'and no reopen was logged');

  -- the opening is always Final
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  perform pg_temp.refused(format($q$select public.closing_change_mode(%L, 'shift', 'no way', gen_random_uuid())$q$, pg_temp.m('opening')), 'invalid_mode', 'the opening closing cannot change mode');
  reset role;
end $t$;

-- 8. a revision that is still a draft can be switched again in place (no second reopen)
do $t$ declare r jsonb; ev uuid; v_rev uuid; begin
  ev := pg_temp.m('evening')::uuid;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  r := public.closing_change_mode(ev, 'final', 'Evening is the day end', 'b0000000-0000-0000-0000-000000000004');
  v_rev := (r ->> 'closing_id')::uuid;
  r := public.closing_change_mode(v_rev, 'shift', 'No, keep it a shift', null);
  perform pg_temp.ok(r ->> 'old_mode' = 'final' and r ->> 'new_mode' = 'shift' and (r -> 'original_closing_id') = 'null'::jsonb and (r ->> 'revision')::int = 2, 'the open revision is switched in place; this is a draft change, not a second reopen');
  perform pg_temp.ok((select count(*) from public.closings where slot_id = (select slot_id from public.closings where id = ev)) = 2, 'still the original and one revision');
  perform pg_temp.ok((select status from public.closings where id = ev) = 'submitted', 'the original is still submitted');
  reset role;
  perform pg_temp.ok((select count(*) from public.activity_log where action = 'closing.mode_changed' and entity_id = v_rev::text) = 2, 'both changes of that revision are logged');
end $t$;

-- 9. the guard and the new function are attached, and only the right ones are callable
do $t$ begin
  perform pg_temp.ok(exists (select 1 from pg_trigger where tgrelid = 'public.closings'::regclass and tgname = 'closings_mode_guard' and not tgisinternal), 'the guard trigger is attached to closings');
  perform pg_temp.ok(has_function_privilege('authenticated', 'public.closing_change_mode(uuid,text,text,uuid)', 'execute')
    and not has_function_privilege('anon', 'public.closing_change_mode(uuid,text,text,uuid)', 'execute'), 'closing_change_mode: signed-in only (it checks the Owner itself)');
  perform pg_temp.ok(not has_function_privilege('authenticated', 'public.closing_is_admin_owner()', 'execute')
    and not has_function_privilege('authenticated', 'public.closing_mode_guard()', 'execute'), 'the helper and the guard are not callable from the browser');
end $t$;
rollback;
