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

insert into auth.users(id, email) values ('00000000-0000-0000-0000-0000000000a1','a@t'), ('00000000-0000-0000-0000-0000000000b1','j@t');
select public.bootstrap_first_admin('00000000-0000-0000-0000-0000000000a1','owner','Test Owner');
insert into public.staff(id, full_name) values ('10000000-0000-0000-0000-000000000001','J One');
insert into public.profiles(user_id, staff_id, username, role_template) values ('00000000-0000-0000-0000-0000000000b1','10000000-0000-0000-0000-000000000001','junior1','junior');

-- a day: opening Final (day -6), then Night, Morning, Evening on day -5, each with figures the period rules pick up
do $t$ begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  perform public.settings_set('closing.require_inventory_audit', 'false', 'test rollout');
  perform public.closing_start_opening('e0000000-0000-0000-0000-000000000001', current_date - 6, 'evening');
  perform public.closing_save_draft('e0000000-0000-0000-0000-000000000001', current_date - 6, 'evening', 'final', '{"sys_cash": 5000, "last_bill_no": 500, "till": [9,0,0,0,0,0,0,0]}');
  perform public.closing_submit('e0000000-0000-0000-0000-000000000001');
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  perform public.closing_save_draft('a0000000-0000-0000-0000-000000000001', current_date - 5, 'night', 'shift',
    '{"sys_cash": 20000, "last_bill_no": 520, "book_bill_1": 100, "ret_manual_1": 30, "extra_cash": 40, "till": [10,0,0,0,0,0,0,0]}');
  perform public.closing_submit('a0000000-0000-0000-0000-000000000001');
  perform public.closing_save_draft('a0000000-0000-0000-0000-000000000002', current_date - 5, 'morning', 'shift',
    '{"sys_cash": 35000, "last_bill_no": 560, "book_bill_1": 200, "ret_manual_1": 50, "ret_system": 5, "extra_cash": 60, "till": [11,0,0,0,0,0,0,0]}');
  perform public.closing_submit('a0000000-0000-0000-0000-000000000002');
  perform public.closing_save_draft('a0000000-0000-0000-0000-000000000003', current_date - 5, 'evening', 'shift',
    '{"sys_cash": 60000, "last_bill_no": 620, "book_bill_2": 300, "ret_manual_2": 20, "final_sys_returns": 7, "hs": [{"label": "HS", "amount": 70}], "till": [12,0,0,0,0,0,0,0]}');
  perform public.closing_submit('a0000000-0000-0000-0000-000000000003');
  reset role;
end $t$;

create function pg_temp.page(k uuid) returns jsonb language sql as $$
  select e from jsonb_array_elements(public.closing_book()) e where e ->> 'closing_id' = (select id::text from public.closings where idempotency_key = k) $$;

do $t$ declare ev jsonb; ni jsonb; mo jsonb; op jsonb; fp jsonb; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  ev := pg_temp.page('a0000000-0000-0000-0000-000000000003'); ni := pg_temp.page('a0000000-0000-0000-0000-000000000001');
  mo := pg_temp.page('a0000000-0000-0000-0000-000000000002'); op := pg_temp.page('e0000000-0000-0000-0000-000000000001');
  fp := ev -> 'final_part';
  perform pg_temp.ok(ev ->> 'kind' = 'evening' and (ev ->> 'day_no')::int = 3 and (ni ->> 'day_no')::int = 1 and (mo ->> 'day_no')::int = 2 and (op ->> 'day_no')::int = 1,
    'K1: day_no is the slot''s place in its day (Night 1, Morning 2, Evening 3)');
  perform pg_temp.ok(ev -> 'shop' ->> 'title' = 'Fazal Din''s Pharma Plus' and ev -> 'shop' ->> 'branch' = 'Bahria Town Branch', 'K1: the shop name and branch are on the page');
  perform pg_temp.ok((ev ->> 'hs_plus_strips')::numeric = 70, 'K1: HS + strips is carried');
  perform pg_temp.ok((fp -> 'ties' ->> 'sale')::boolean and (fp -> 'ties' ->> 'cash')::boolean, 'K2: the Evening''s Final lines add up to the stored final figures');
  perform pg_temp.ok((ni -> 'final_part' -> 'ties' ->> 'sale')::boolean and (ni -> 'final_part' -> 'ties' ->> 'cash')::boolean
    and (mo -> 'final_part' -> 'ties' ->> 'sale')::boolean and (mo -> 'final_part' -> 'ties' ->> 'cash')::boolean
    and (op -> 'final_part' -> 'ties' ->> 'sale')::boolean and (op -> 'final_part' -> 'ties' ->> 'cash')::boolean,
    'K2: so do the Night, the Morning and the opening Final');
  perform pg_temp.ok((fp -> 'part1' ->> 'book_bills')::numeric = 600, 'K3: book bills are the period total (100 + 200 + 300)');
  perform pg_temp.ok((fp -> 'part1' ->> 'manual_returns')::numeric = 100, 'K3: manual returns are the period total (30 + 50 + 20)');
  perform pg_temp.ok((fp -> 'part1' ->> 'system_returns')::numeric = 5 and (fp -> 'part1' ->> 'additional_system_returns')::numeric = 7, 'K3: system returns and the extra system returns are separate lines');
  perform pg_temp.ok((fp -> 'part2' ->> 'extra_cash')::numeric = 100, 'K3: extra cash is the period total (40 + 60)');
  perform pg_temp.ok((fp -> 'part2' ->> 'pre_date_pos')::numeric = (op -> 'results' ->> 'shift_sale')::numeric and (op -> 'results' ->> 'shift_sale')::numeric > 0,
    'K3: the earlier-date sale is the last Final''s own sale');
  perform pg_temp.ok((fp -> 'part1' ->> 'net_final_sale')::numeric = (ev -> 'results' ->> 'final_net_sale')::numeric
    and (fp -> 'part2' ->> 'net_final_cash')::numeric = (ev -> 'results' ->> 'final_net_cash')::numeric
    and (fp -> 'part2' ->> 'target_net_sale')::numeric = (fp -> 'part1' ->> 'net_final_sale')::numeric, 'K3: the totals printed are the stored ones');
  perform pg_temp.ok(jsonb_array_length(fp -> 'period') = 3 and fp -> 'period' -> 0 ->> 'kind' = 'night' and fp -> 'period' -> 2 ->> 'kind' = 'evening'
    and (fp -> 'last_final' ->> 'business_date')::date = current_date - 6, 'K4: the period is the three closings since the opening Final');
  perform pg_temp.ok(jsonb_array_length(ni -> 'final_part' -> 'period') = 1 and jsonb_array_length(op -> 'final_part' -> 'period') = 1 and op -> 'final_part' -> 'last_final' = 'null'::jsonb,
    'K4: a Night is its own period; a Final is its own period with no earlier Final');
  reset role;
end $t$;

-- an earlier closing is corrected AFTER the Evening was submitted: the Evening's lines no longer add up, and the sheet can say so
do $t$ declare nid uuid; ev jsonb; begin
  select id into nid from public.closings where idempotency_key = 'a0000000-0000-0000-0000-000000000001';
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  perform public.closing_correct(nid, 'book bill was 150', '{"book_bill_1": 150}', 'a0000000-0000-0000-0000-000000000031');
  ev := pg_temp.page('a0000000-0000-0000-0000-000000000003');
  perform pg_temp.ok((ev -> 'final_part' -> 'part1' ->> 'book_bills')::numeric = 650, 'K5: the period lines follow the corrected Night (650)');
  perform pg_temp.ok(not (ev -> 'final_part' -> 'ties' ->> 'sale')::boolean, 'K5: and the Evening''s lines are flagged as no longer adding up to what it stored');
  perform pg_temp.ok((ev -> 'final_part' -> 'part1' ->> 'net_final_sale')::numeric = (select final_net_sale from public.closing_results where closing_id = (ev ->> 'closing_id')::uuid), 'K5: the printed total is still the stored one');
  reset role;
end $t$;

-- the sheet text settings
do $t$ begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  perform public.closing_settings_set('closing.sheet_title', '"Test Pharma"', 'rename for the test');
  perform pg_temp.ok(public.closing_book() -> 0 -> 'shop' ->> 'title' = 'Test Pharma', 'T1: the sheet title can be changed and the book shows it');
  perform pg_temp.refused($q$select public.closing_settings_set('closing.sheet_title', '5', 'x')$q$, 'bad_value', 'T1: a number is not a title');
  perform pg_temp.refused($q$select public.closing_settings_set('closing.sheet_branch', '""', 'x')$q$, 'bad_value', 'T1: an empty branch is refused');
  perform pg_temp.refused($q$select public.closing_settings_set('till_float', '"abc"', 'x')$q$, 'bad_value', 'T1: a number setting still needs a number');
  perform pg_temp.refused($q$select public.closing_settings_set('closing.require_inventory_audit', 'true', 'x')$q$, 'unknown_setting', 'T1: no other setting is reachable');
  perform public.closing_settings_set('closing.sheet_branch', '"Main Branch"', 'rename');
  perform pg_temp.ok(public.closing_book() -> 0 -> 'shop' ->> 'branch' = 'Main Branch', 'T1: the branch can be changed too');
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  perform pg_temp.denied($q$select public.closing_final_breakdown(id) from public.closings limit 1$q$, 'the internal breakdown is not callable by signed-in users');
  perform pg_temp.refused($q$select public.closing_settings_set('closing.sheet_title', '"Hack"', 'x')$q$, 'not_allowed', 'a cashier cannot rename the shop');
  reset role;
end $t$;
rollback;
