\set ON_ERROR_STOP on
-- 0642: slip fields and a longer footer. All data below is invented.
begin;
create function pg_temp.as_user(uid uuid, lvl text default 'aal1') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'aal', lvl, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.back() returns void language plpgsql as $$ begin execute 'reset role'; perform set_config('request.jwt.claims', '', true); end $$;
create function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; raise notice 'pass: %', msg; end $$;
create function pg_temp.denied(q text, msg text) returns void language plpgsql as $$
begin
  begin execute q; exception when others then raise notice 'pass (refused): %', msg; return; end;
  raise exception 'FAIL: % was allowed', msg;
end $$;
create function pg_temp.inv(p_id uuid, p_dev uuid, p_net numeric, p_lines jsonb, p_extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('invoice_id', p_id, 'device_id', p_dev, 'client_created_at', now(), 'customer', 'Test', 'payment_mode', 'Cash',
    'totals', jsonb_build_object('net_total', p_net), 'lines', p_lines) || p_extra $$;
create function pg_temp.line(p_code text, p_qty numeric, p_rate numeric, p_dmode text default 'pct', p_dval numeric default 0, p_unit text default 'unit') returns jsonb language sql as $$
  select jsonb_build_object('code', p_code, 'name', 'Item ' || p_code, 'unit', p_unit, 'pack', 10, 'qty', p_qty, 'rate', p_rate,
    'discount', jsonb_build_object('mode', p_dmode, 'value', p_dval)) $$;

insert into auth.users(id, email) values
  ('00000000-0000-0000-0000-0000000000a1','a@t'), ('00000000-0000-0000-0000-0000000000b1','j1@t'),
  ('00000000-0000-0000-0000-0000000000b2','j2@t'), ('00000000-0000-0000-0000-0000000000c1','s1@t'), ('00000000-0000-0000-0000-0000000000d1','x@t');
select public.bootstrap_first_admin('00000000-0000-0000-0000-0000000000a1','owner','Test Owner');
insert into public.staff(id, full_name) values
  ('10000000-0000-0000-0000-000000000001','J One'), ('10000000-0000-0000-0000-000000000002','J Two'), ('10000000-0000-0000-0000-000000000003','S One');
insert into public.profiles(user_id, staff_id, username, role_template) values
  ('00000000-0000-0000-0000-0000000000b1','10000000-0000-0000-0000-000000000001','junior1','junior'),
  ('00000000-0000-0000-0000-0000000000b2','10000000-0000-0000-0000-000000000002','junior2','junior'),
  ('00000000-0000-0000-0000-0000000000c1','10000000-0000-0000-0000-000000000003','senior1','senior');
-- senior1 is made a manager the documented way: a per-person grant
insert into public.user_permissions(user_id, perm_key, effect) values
  ('00000000-0000-0000-0000-0000000000c1','ebill.manage','grant'), ('00000000-0000-0000-0000-0000000000c1','ebill.use','grant'),
  ('00000000-0000-0000-0000-0000000000b1','ebill.use','grant'), ('00000000-0000-0000-0000-0000000000b2','ebill.use','grant');

do $t$ declare r jsonb; begin
  r := (select value from public.settings where key = 'ebill.receipt');
  perform pg_temp.ok(not (r ? 'tax_no'), 'the stored row is untouched by the migration (new keys come from the defaults)');

  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  r := public.ebill_get_receipt();
  perform pg_temp.ok(r ->> 'slip_title' = 'Purchase Slip' and r ->> 'tax_no' = '' and r ->> 'pos_no' = '', 'staff read the new settings with their defaults');
  perform pg_temp.denied($q$select public.ebill_set_receipt('{"tax_no":"1"}', 'because')$q$, 'staff still cannot change them');
  perform pg_temp.back();

  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  perform pg_temp.denied(format($q$select public.ebill_set_receipt(%L, 'because')$q$, jsonb_build_object('tax_no', repeat('x', 41))), 'tax number too long');
  perform pg_temp.denied(format($q$select public.ebill_set_receipt(%L, 'because')$q$, jsonb_build_object('pos_no', repeat('x', 41))), 'POS number too long');
  perform pg_temp.denied(format($q$select public.ebill_set_receipt(%L, 'because')$q$, jsonb_build_object('slip_title', repeat('x', 41))), 'slip title too long');
  perform pg_temp.denied(format($q$select public.ebill_set_receipt(%L, 'because')$q$, jsonb_build_object('footer', repeat('x', 401))), 'footer over 400');
  perform pg_temp.denied($q$select public.ebill_set_receipt('{"tax_no":5}', 'because')$q$, 'a number is not text');
  perform pg_temp.denied($q$select public.ebill_set_receipt('{"mystery":1}', 'because')$q$, 'unknown settings are still refused');

  r := public.ebill_set_receipt(jsonb_build_object('shop_name', 'Fazal Din''s Pharma Plus', 'tax_no', ' 0870213-3 ', 'pos_no', '132070', 'slip_title', 'Purchase Slip',
         'footer', repeat('y', 400)), 'match the printed slip');
  perform pg_temp.ok(r ->> 'tax_no' = '0870213-3' and r ->> 'pos_no' = '132070' and length(r ->> 'footer') = 400, 'a 400-character footer and the slip numbers are saved (and trimmed)');
  r := public.ebill_set_receipt('{"footer":"Short"}', 'shorter footer');
  perform pg_temp.ok(r ->> 'tax_no' = '0870213-3' and r ->> 'shop_name' = 'Fazal Din''s Pharma Plus', 'a partial update keeps the rest');
  perform pg_temp.back();
  perform pg_temp.ok((select count(*) from public.settings_history where key = 'ebill.receipt') >= 2, 'every change is kept in the settings history');

  perform pg_temp.ok(not has_function_privilege('anon', 'public.ebill_set_receipt(jsonb,text)', 'execute'), 'anon cannot run it');
  perform pg_temp.ok(not has_function_privilege('authenticated', 'public.ebill_receipt_defaults()', 'execute'), 'the defaults helper stays internal');
end $t$;
rollback;
