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
insert into auth.users(id, email) values ('00000000-0000-0000-0000-0000000000a1','a@t'), ('00000000-0000-0000-0000-0000000000b1','j@t'),
 ('00000000-0000-0000-0000-0000000000b2','k@t'), ('00000000-0000-0000-0000-0000000000b3','n@t'), ('00000000-0000-0000-0000-0000000000b4','m@t');
select public.bootstrap_first_admin('00000000-0000-0000-0000-0000000000a1','owner','Test Owner');
insert into public.staff(id, full_name) values ('10000000-0000-0000-0000-000000000001','J One'), ('10000000-0000-0000-0000-000000000002','J Two'),
 ('10000000-0000-0000-0000-000000000003','J Three'), ('10000000-0000-0000-0000-000000000004','J Four');
insert into public.profiles(user_id, staff_id, username, role_template) values
 ('00000000-0000-0000-0000-0000000000b1','10000000-0000-0000-0000-000000000001','junior1','junior'),
 ('00000000-0000-0000-0000-0000000000b2','10000000-0000-0000-0000-000000000002','junior2','junior'),
 ('00000000-0000-0000-0000-0000000000b3','10000000-0000-0000-0000-000000000003','noinv','junior'),
 ('00000000-0000-0000-0000-0000000000b4','10000000-0000-0000-0000-000000000004','noentry','junior');
insert into public.user_permissions(user_id, perm_key, effect) values
 ('00000000-0000-0000-0000-0000000000b3','inventory.search','deny'), ('00000000-0000-0000-0000-0000000000b4','closing.enter_own','deny');

-- the seed: the old app's 31 codes, all active, in the old order
do $t$ begin
  perform pg_temp.ok((select count(*) from public.closing_audit_items) = 31 and (select count(*) from public.closing_audit_items where active) = 31, 'A1: 31 audit codes are seeded and active');
  perform pg_temp.ok((select code from public.closing_audit_items order by sort limit 1) = '894301' and (select code from public.closing_audit_items order by sort desc limit 1) = '894334'
    and not exists (select 1 from public.closing_audit_items where code in ('894319', '894327', '894329')), 'A1: from 894301 to 894334 with the old gaps');
end $t$;

-- shrink the list to four codes we control, give stock to three
insert into public.inventory_products (code, name, qty) values ('894301', 'Item A', 5), ('894302', 'Item B', 0), ('894303', 'Item C', -2);
update public.closing_audit_items set active = false where code not in ('894301', '894302', '894303', '894304');

do $t$ begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  perform public.closing_start_opening('e0000000-0000-0000-0000-000000000001', current_date - 6, 'evening');
  perform public.closing_save_draft('e0000000-0000-0000-0000-000000000001', current_date - 6, 'evening', 'final', '{"sys_cash": 5000, "last_bill_no": 500, "till": [9,0,0,0,0,0,0,0]}');
  perform pg_temp.refused($q$select public.closing_audit_verify('e0000000-0000-0000-0000-000000000001', 'x')$q$, 'audit_not_needed', 'A2: the opening closing has no audit step');
  perform public.closing_submit('e0000000-0000-0000-0000-000000000001');
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  perform public.closing_save_draft('a0000000-0000-0000-0000-000000000001', current_date - 5, 'night', 'shift', '{"sys_cash": 20000, "last_bill_no": 520, "till": [10,0,0,0,0,0,0,0]}');
  perform pg_temp.refused($q$select public.closing_submit('a0000000-0000-0000-0000-000000000001')$q$, 'audit_not_verified', 'A3: with the requirement on, an unverified draft cannot be submitted');
  reset role;
end $t$;

create temp table memo (k text primary key, v text);
grant all on memo to public;

do $t$ declare p jsonb; r jsonb; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  p := public.closing_audit_preview();
  perform pg_temp.ok(jsonb_array_length(p -> 'items') = 2 and p -> 'items' -> 0 ->> 'code' = '894301' and (p -> 'items' -> 0 ->> 'qty')::numeric = 5 and p -> 'items' -> 0 ->> 'name' = 'Item A'
    and p -> 'items' -> 1 ->> 'code' = '894303' and (p -> 'items' -> 1 ->> 'qty')::numeric = -2, 'A4: only non-zero stock is listed, in code order, and a negative balance counts');
  perform pg_temp.ok(p -> 'not_found' = '["894304"]'::jsonb and (p ->> 'codes_checked')::int = 4, 'A4: a code inventory does not know is reported, and 4 codes were checked');
  perform pg_temp.ok(length(p ->> 'digest') = 32, 'A4: the preview carries a digest of what it showed');
  perform pg_temp.refused($q$select public.closing_audit_verify('a0000000-0000-0000-0000-000000000001', 'wrong')$q$, 'audit_changed', 'A5: a digest that is not what the server sees now is refused');
  r := public.closing_audit_verify('a0000000-0000-0000-0000-000000000001', p ->> 'digest');
  perform pg_temp.ok(r ->> 'verified_at' is not null and jsonb_array_length(r -> 'items') = 2 and not (r ? 'digest'), 'A5: verifying returns what was frozen');
  reset role;
  perform pg_temp.ok((select verified_by from public.closing_inventory_audit a join public.closings c on c.id = a.closing_id where c.idempotency_key = 'a0000000-0000-0000-0000-000000000001') = '10000000-0000-0000-0000-000000000001'
    and (select codes_checked from public.closing_inventory_audit a join public.closings c on c.id = a.closing_id where c.idempotency_key = 'a0000000-0000-0000-0000-000000000001') = 4
    and (select not_found from public.closing_inventory_audit a join public.closings c on c.id = a.closing_id where c.idempotency_key = 'a0000000-0000-0000-0000-000000000001') = '{894304}',
    'A5: it is recorded for the person who confirmed it, with the codes checked and not found');
  perform pg_temp.ok((select count(*) from public.closing_inventory_audit_items i join public.closings c on c.id = i.closing_id where c.idempotency_key = 'a0000000-0000-0000-0000-000000000001') = 2
    and (select qty from public.closing_inventory_audit_items i join public.closings c on c.id = i.closing_id where c.idempotency_key = 'a0000000-0000-0000-0000-000000000001' and item_code = '894303') = -2, 'A5: the two non-zero items are frozen with their quantities');
  perform pg_temp.ok(exists (select 1 from public.activity_log where action = 'closing.audit_verified'), 'A5: the verification is in the activity log');
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  perform pg_temp.refused($q$select public.closing_audit_verify('a0000000-0000-0000-0000-000000000001', 'x')$q$, 'audit_already_verified', 'A6: it cannot be redone on the same draft');
  perform public.closing_submit('a0000000-0000-0000-0000-000000000001');
  perform pg_temp.ok((select status from public.closings where idempotency_key = 'a0000000-0000-0000-0000-000000000001') = 'submitted', 'A6: with the audit frozen, the closing can be submitted');
  perform pg_temp.refused($q$select public.closing_audit_verify('a0000000-0000-0000-0000-000000000001', 'x')$q$, 'not_allowed', 'A6: a submitted closing is no longer a draft to verify');
  reset role;
end $t$;

-- stock moves between looking and confirming: the server refuses, then the new list can be confirmed
do $t$ declare d1 text; d2 text; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  perform public.closing_save_draft('a0000000-0000-0000-0000-000000000002', current_date - 5, 'morning', 'shift', '{"sys_cash": 35000, "last_bill_no": 560, "till": [11,0,0,0,0,0,0,0]}');
  d1 := public.closing_audit_preview() ->> 'digest';
  reset role;
  update public.inventory_products set qty = 7 where code = '894301';
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  perform pg_temp.refused(format($q$select public.closing_audit_verify('a0000000-0000-0000-0000-000000000002', %L)$q$, d1), 'audit_changed', 'B1: stock changed after the person looked, so the old list is refused');
  d2 := public.closing_audit_preview() ->> 'digest';
  perform pg_temp.ok(d2 <> d1, 'B1: a fresh preview has a new digest');
  perform public.closing_audit_verify('a0000000-0000-0000-0000-000000000002', d2);
  reset role;
  perform pg_temp.ok((select qty from public.closing_inventory_audit_items i join public.closings c on c.id = i.closing_id where c.idempotency_key = 'a0000000-0000-0000-0000-000000000002' and item_code = '894301') = 7, 'B1: the new list was frozen with the new quantity');
  perform pg_temp.ok((select qty from public.closing_inventory_audit_items i join public.closings c on c.id = i.closing_id where c.idempotency_key = 'a0000000-0000-0000-0000-000000000001' and item_code = '894301') = 5, 'B1: the earlier closing keeps its own frozen quantity');
end $t$;

-- who may do what
do $t$ begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
  perform pg_temp.refused($q$select public.closing_audit_verify('a0000000-0000-0000-0000-000000000002', 'x')$q$, 'audit_already_verified', 'C1 (0217): another cashier is no longer refused as a stranger: the shared draft is already verified, which is the reason given');
  perform pg_temp.ok(jsonb_array_length(public.closing_audit_preview() -> 'items') = 2, 'C1: but any cashier can look at the stock');
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b3');
  perform pg_temp.refused($q$select public.closing_audit_preview()$q$, 'inventory_not_allowed', 'C2: without inventory.search the audit cannot read stock');
  reset role;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b4');
  perform pg_temp.refused($q$select public.closing_audit_preview()$q$, 'not_allowed', 'C3: someone who cannot enter closings cannot audit for them');
  reset role;
  set local role anon;
  perform pg_temp.denied($q$select public.closing_audit_preview()$q$, 'C4: anon cannot read the audit');
  perform pg_temp.denied($q$select public.closing_audit_verify('a0000000-0000-0000-0000-000000000002', 'x')$q$, 'C4: anon cannot verify');
  reset role;
  update public.closing_audit_items set active = false;
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  perform pg_temp.refused($q$select public.closing_audit_preview()$q$, 'no_audit_codes', 'C5: with no active audit code there is nothing to audit');
  reset role;
end $t$;
rollback;
