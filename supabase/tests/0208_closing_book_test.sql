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
 ('00000000-0000-0000-0000-0000000000a1','a@t'), ('00000000-0000-0000-0000-0000000000b1','j@t'), ('00000000-0000-0000-0000-0000000000b3','v@t');
select public.bootstrap_first_admin('00000000-0000-0000-0000-0000000000a1','owner','Test Owner');
insert into public.staff(id, full_name) values ('10000000-0000-0000-0000-000000000001','J One'), ('10000000-0000-0000-0000-000000000003','J Three');
insert into public.profiles(user_id, staff_id, username, role_template) values
 ('00000000-0000-0000-0000-0000000000b1','10000000-0000-0000-0000-000000000001','junior1','junior'),
 ('00000000-0000-0000-0000-0000000000b3','10000000-0000-0000-0000-000000000003','viewer','junior');
insert into public.user_permissions(user_id, perm_key, effect) values ('00000000-0000-0000-0000-0000000000b3','closing.view_all','grant');

do $t$ begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  perform public.settings_set('closing.require_inventory_audit', 'false', 'test rollout');
  perform public.closing_start_opening('e0000000-0000-0000-0000-000000000001', current_date - 6, 'evening');
  perform public.closing_save_draft('e0000000-0000-0000-0000-000000000001', current_date - 6, 'evening', 'final', '{"till": [9,0,0,0,0,0,0,0], "last_bill_no": 500}');
  perform public.closing_submit('e0000000-0000-0000-0000-000000000001');
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  perform public.closing_save_draft('a0000000-0000-0000-0000-000000000001', current_date - 5, 'night', 'shift',
    '{"sys_cash": 10000, "last_bill_no": 520, "till": [10,0,0,0,0,0,0,0], "vault": [0,1,0,0,0,0,0,0],
      "hs": [{"label": "HS A", "amount": 100}, {"label": "HS struck", "amount": 5, "deleted": true}],
      "deposits": [{"label": "Bank", "amount": 2000}],
      "mediq": [{"bill_no": "B1", "collected": 300, "pharmacy_bill": 250}],
      "credit": {"free": [{"label": "Ali", "amount": 400}]}, "misc": [{"label": "Courier", "amount": 500}]}');
  perform public.closing_submit('a0000000-0000-0000-0000-000000000001');
  perform public.closing_save_draft('a0000000-0000-0000-0000-000000000003', current_date - 5, 'morning', 'shift', '{"hs": [{"label": "Draft only", "amount": 9}]}');
  reset role;
end $t$;

do $t$ declare j jsonb; n jsonb; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  j := public.closing_book();
  perform pg_temp.ok(jsonb_array_length(j) = 2, 'B1: one page per submitted closing (opening, Night); the draft Morning is not a page');
  n := j -> 0;
  perform pg_temp.ok(n ->> 'kind' = 'night' and (j -> 1 ->> 'is_opening')::boolean, 'B1: newest first');
  perform pg_temp.ok(jsonb_array_length(n -> 'hs') = 1 and n -> 'hs' -> 0 ->> 'label' = 'HS A' and not (j::text like '%HS struck%') and not (j::text like '%Draft only%'),
    'B1: struck rows and drafts are left out');
  perform pg_temp.ok(n -> 'deposits' -> 0 ->> 'label' = 'Bank' and (n -> 'deposits' -> 0 ->> 'amount')::numeric = 2000, 'B1: deposits are on the page');
  perform pg_temp.ok(n -> 'mediq' -> 0 ->> 'bill_no' = 'B1' and (n -> 'mediq' -> 0 ->> 'collected')::numeric = 300 and (n -> 'mediq' -> 0 ->> 'pharmacy_bill')::numeric = 250, 'B1: MEDIQ orders are on the page');
  perform pg_temp.ok(n -> 'credit' -> 0 ->> 'label' = 'Ali' and n -> 'misc' -> 0 ->> 'label' = 'Courier', 'B1: credit and misc rows are on the page');
  perform pg_temp.ok(jsonb_array_length(n -> 'cash') >= 2 and exists (select 1 from jsonb_array_elements(n -> 'cash') e where e ->> 'area' = 'vault'), 'B1: till and vault counts are on the page');
  perform pg_temp.ok((n -> 'inputs' ->> 'sys_cash')::numeric = 10000 and (n -> 'inputs' ->> 'last_bill_no')::int = 520, 'B1: the typed figures are on the page');
  perform pg_temp.ok((n -> 'results' ->> 'net_sale')::numeric = (select net_sale from public.closing_results where closing_id = (n ->> 'closing_id')::uuid)
    and (n -> 'results' ->> 'net_cash')::numeric = (select net_cash from public.closing_results where closing_id = (n ->> 'closing_id')::uuid), 'B1: results are the stored figures');
  perform pg_temp.ok(not (n -> 'inputs' ? 'idempotency_key') and not (n -> 'inputs' ? 'entered_by'), 'B1: no internal keys leak into the page');
  perform pg_temp.ok(jsonb_array_length(public.closing_book(current_date - 5, current_date - 5)) = 1, 'B1: date range works');
  perform pg_temp.ok(jsonb_array_length(public.closing_book(null, null, 1)) = 1, 'B1: limit works');
  reset role;
end $t$;

-- a correction makes a new revision: the book shows only the current one
do $t$ declare nid uuid; begin
  select id into nid from public.closings where idempotency_key = 'a0000000-0000-0000-0000-000000000001';
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  perform public.closing_correct(nid, 'HS A was 150', '{"hs": [{"label": "HS A", "amount": 150}]}', 'a0000000-0000-0000-0000-000000000031');
  perform pg_temp.ok(jsonb_array_length(public.closing_book()) = 2 and (public.closing_book() -> 0 ->> 'revision')::int = 2
    and (public.closing_book() -> 0 -> 'hs' -> 0 ->> 'amount')::numeric = 150 and public.closing_book() -> 0 ->> 'correction_reason' = 'HS A was 150',
    'B2: after a correction the page is the corrected revision, with its reason');
  reset role;
end $t$;

do $t$ begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  perform pg_temp.refused('select public.closing_book()', 'not_allowed', 'a cashier cannot open the Closing Book');
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b3');
  perform pg_temp.ok(jsonb_array_length(public.closing_book()) = 2, 'a closing.view_all reader can open the Closing Book');
  reset role;
  set local role anon;
  perform pg_temp.denied('select public.closing_book()', 'anon cannot call the Closing Book');
  reset role;
end $t$;
rollback;
