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
 ('00000000-0000-0000-0000-0000000000a1','a@t'), ('00000000-0000-0000-0000-0000000000b1','j@t'), ('00000000-0000-0000-0000-0000000000b3','s@t');
select public.bootstrap_first_admin('00000000-0000-0000-0000-0000000000a1','owner','Test Owner');
insert into public.staff(id, full_name) values ('10000000-0000-0000-0000-000000000001','J One'), ('10000000-0000-0000-0000-000000000003','J Three');
insert into public.profiles(user_id, staff_id, username, role_template) values
 ('00000000-0000-0000-0000-0000000000b1','10000000-0000-0000-0000-000000000001','junior1','junior'),
 ('00000000-0000-0000-0000-0000000000b3','10000000-0000-0000-0000-000000000003','setter','junior');
insert into public.user_permissions(user_id, perm_key, effect) values ('00000000-0000-0000-0000-0000000000b3','closing.settings','grant');

do $t$ declare sid uuid; aid uuid; v0 int; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b3');
  -- strips
  sid := public.closing_strip_save(null, '  Panadol  ', 'Pain', 25.5, 3, true);
  perform pg_temp.ok((select label from public.closing_strips where id = sid) = 'Panadol' and (select price from public.closing_strips where id = sid) = 25.5, 'S1: a strip is created, trimmed');
  perform public.closing_strip_save(sid, 'Panadol', 'Pain', 30, 3, false);
  perform pg_temp.ok((select price from public.closing_strips where id = sid) = 30 and not (select active from public.closing_strips where id = sid), 'S1: a strip is updated and can be switched off (never deleted)');
  perform pg_temp.refused($q$select public.closing_strip_save(null, '', 'x', 1, 0, true)$q$, 'invalid_text', 'S1: an empty label is refused');
  perform pg_temp.refused($q$select public.closing_strip_save(null, 'X', 'x', -1, 0, true)$q$, 'invalid_amount', 'S1: a negative price is refused');
  perform pg_temp.refused($q$select public.closing_strip_save(null, 'X', 'x', 2000000, 0, true)$q$, 'amount_too_large', 'S1: an absurd price is refused');
  perform pg_temp.refused($q$select public.closing_strip_save('99999999-9999-9999-9999-999999999999', 'X', 'x', 1, 0, true)$q$, 'not_allowed', 'S1: an unknown strip id is refused');
  -- credit accounts and tiers
  aid := public.closing_account_save(null, 'named', null, 'Hospital', 1, true);
  perform pg_temp.ok((select kind from public.closing_credit_accounts where id = aid) = 'named', 'S2: a named account is created');
  perform public.closing_account_save(null, 'tier_name', 1, 'Staff', 1, true);
  perform pg_temp.refused($q$select public.closing_account_save(null, 'tier_name', 1, 'Other', 2, true)$q$, 'tier_taken', 'S2: a tier slot cannot have two active names');
  perform public.closing_account_save(null, 'tier_name', 2, 'Family', 2, true);
  perform pg_temp.refused($q$select public.closing_account_save(null, 'tier_name', 4, 'Bad', 2, true)$q$, 'invalid_payload', 'S2: only tiers 1 to 3 exist');
  perform pg_temp.refused($q$select public.closing_account_save(null, 'named', 1, 'Bad', 2, true)$q$, 'invalid_payload', 'S2: a named account has no tier');
  perform pg_temp.refused($q$select public.closing_account_save(null, 'tier_name', null, 'Bad', 2, true)$q$, 'invalid_payload', 'S2: a tier name needs its tier');
  -- audit codes
  perform public.closing_audit_item_save('PAN-500', 'Panadol 500', 1, true);
  perform public.closing_audit_item_save('PAN-500', 'Panadol 500 mg', 2, false);
  perform pg_temp.ok((select name from public.closing_audit_items where code = 'PAN-500') = 'Panadol 500 mg' and not (select active from public.closing_audit_items where code = 'PAN-500'), 'S3: an audit code is added and edited by its code');
  perform pg_temp.refused($q$select public.closing_audit_item_save('bad code!', 'x', 1, true)$q$, 'invalid_text', 'S3: a code with spaces is refused');
  -- the two core settings
  reset role; select version into v0 from public.settings where key = 'till_float'; perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b3');
  perform public.closing_settings_set('till_float', '50000', 'new float');
  reset role;
  perform pg_temp.ok((select value from public.settings where key = 'till_float') = '50000'::jsonb and (select version from public.settings where key = 'till_float') = v0 + 1
    and exists (select 1 from public.settings_history where key = 'till_float' and version = v0 + 1 and reason = 'new float'), 'S4: till_float is changed with history');
  perform pg_temp.ok(exists (select 1 from public.activity_log where action = 'settings.set' and entity_id = 'till_float'), 'S4: the change is in the activity log');
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b3');
  perform pg_temp.refused($q$select public.closing_settings_set('closing.require_inventory_audit', 'false', 'sneaky')$q$, 'unknown_setting', 'S4: no other setting can be changed through this wrapper');
  perform pg_temp.refused($q$select public.closing_settings_set('till_float', '-5', 'neg')$q$, 'bad_value', 'S4: a negative value is refused');
  perform pg_temp.refused($q$select public.closing_settings_set('till_float', '"abc"', 'text')$q$, 'bad_value', 'S4: a non-number is refused');
  perform pg_temp.refused($q$select public.closing_settings_set('per_customer_charge', '2', 'x')$q$, 'reason_required', 'S4: a reason is required');
  perform public.closing_settings_set('per_customer_charge', '2', 'higher charge');
  reset role;
  perform pg_temp.ok((select count(*) from public.activity_log where action in ('closing.strip_saved', 'closing.account_saved', 'closing.audit_item_saved')) >= 5, 'S5: catalog changes are in the activity log');
end $t$;

do $t$ begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  perform pg_temp.refused($q$select public.closing_strip_save(null, 'X', 'x', 1, 0, true)$q$, 'not_allowed', 'a cashier cannot change strips');
  perform pg_temp.refused($q$select public.closing_account_save(null, 'named', null, 'X', 1, true)$q$, 'not_allowed', 'a cashier cannot change credit accounts');
  perform pg_temp.refused($q$select public.closing_audit_item_save('X1', 'x', 1, true)$q$, 'not_allowed', 'a cashier cannot change audit codes');
  perform pg_temp.refused($q$select public.closing_settings_set('till_float', '1', 'x')$q$, 'not_allowed', 'a cashier cannot change the till float');
  perform pg_temp.denied($q$insert into public.closing_strips(label, group_name, price) values ('direct', '', 1)$q$, 'a table insert is refused outright');
  reset role;
  set local role anon;
  perform pg_temp.denied($q$select public.closing_strip_save(null, 'X', 'x', 1, 0, true)$q$, 'anon cannot save a strip');
  perform pg_temp.denied($q$select public.closing_settings_set('till_float', '1', 'x')$q$, 'anon cannot change settings');
  reset role;
end $t$;
rollback;
