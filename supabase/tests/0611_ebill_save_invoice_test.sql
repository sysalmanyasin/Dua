\set ON_ERROR_STOP on
-- 0611: saving an Emergency Billing invoice (validation, PIN, limits, duplicates, devices). All data below is invented.
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

-- stock the server knows about, a registered device, and PINs set by the owner
insert into public.inventory_products(code, name, qty, price) values ('A1','Test Tablet', 10, 5), ('B2','Test Syrup', 0, 120);
insert into public.ebill_devices(device_id, registered_by) values ('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000b1');
select public.ebill_pin_valid('482913');
do $t$ begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  perform public.ebill_set_pin('00000000-0000-0000-0000-0000000000b1', '482913');
  perform public.ebill_set_pin('00000000-0000-0000-0000-0000000000b2', '739150');
  perform pg_temp.back();
end $t$;

do $t$ declare r jsonb; i uuid := '40000000-0000-0000-0000-000000000001'; d uuid := '20000000-0000-0000-0000-000000000001'; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
  perform pg_temp.denied(format($q$select public.ebill_save_invoice(%L, '482913')$q$, pg_temp.inv(i, d, 10, jsonb_build_array(pg_temp.line('A1', 2, 5)))), 'someone with no billing right cannot save');
  perform pg_temp.back();
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');

  -- the happy path: 2 x 5, 10% line discount -> 9.00
  r := public.ebill_save_invoice(pg_temp.inv(i, d, 9, jsonb_build_array(pg_temp.line('A1', 2, 5, 'pct', 10))), '482913');
  perform pg_temp.ok((r ->> 'code') = 'saved' and (r ->> 'invoice_no') like 'EB-%', 'a valid invoice is saved and numbered');
  perform pg_temp.back();
  perform pg_temp.ok((select net_total = 9 and gross_total = 9 and line_discounts = 1 and staff_name = 'J One' and status = 'posted' from public.ebill_invoices where invoice_id = i), 'the server stored its own figures, the staff name and status posted');
  perform pg_temp.ok((select count(*) = 1 and bool_and(stock_flag = 'ok' and stock_qty = 10) from public.ebill_invoice_lines where invoice_id = i), 'the line is stored with the stock figure the server saw');
  perform pg_temp.ok(exists (select 1 from public.activity_log where action = 'ebill.invoice_saved' and entity_id = i::text), 'the save is in the audit log');
  perform pg_temp.ok(not exists (select 1 from public.activity_log where coalesce(new_value::text,'') like '%482913%'), 'no PIN in the log');

  -- a retry of the same invoice id is success with the same number, and creates nothing new
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  r := public.ebill_save_invoice(pg_temp.inv(i, d, 9, jsonb_build_array(pg_temp.line('A1', 2, 5, 'pct', 10))), null);
  perform pg_temp.ok((r ->> 'code') = 'duplicate' and (r ->> 'ok')::boolean, 'a retry returns duplicate as success (no PIN needed again)');
  perform pg_temp.back();
  perform pg_temp.ok((select count(*) from public.ebill_invoices) = 1 and (select count(*) from public.ebill_invoice_lines) = 1, 'and nothing was created twice');
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
  r := public.ebill_save_invoice(pg_temp.inv(i, d, 9, jsonb_build_array(pg_temp.line('A1', 2, 5, 'pct', 10))), '739150');
  perform pg_temp.ok((r ->> 'code') = 'id_conflict', 'someone else cannot claim an existing invoice id');
  perform pg_temp.back();
end $t$;

do $t$ declare r jsonb; d uuid := '20000000-0000-0000-0000-000000000001'; n uuid; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  n := gen_random_uuid();
  perform pg_temp.ok((public.ebill_save_invoice(pg_temp.inv(n, d, 10, jsonb_build_array(pg_temp.line('A1', 2, 5))), null) ->> 'code') = 'pin_required', 'no PIN given: pin_required');
  perform pg_temp.ok((public.ebill_save_invoice(pg_temp.inv(n, d, 10, jsonb_build_array(pg_temp.line('A1', 2, 5))), '000001') ->> 'code') = 'bad_pin', 'wrong PIN: bad_pin');
  perform pg_temp.back();
  perform pg_temp.ok((select failed_count = 1 from public.ebill_pins where user_id = '00000000-0000-0000-0000-0000000000b1'), 'the wrong-PIN count was kept (not rolled back)');
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  perform public.ebill_save_invoice(pg_temp.inv(n, d, 10, jsonb_build_array(pg_temp.line('A1', 2, 5))), '000002');
  perform public.ebill_save_invoice(pg_temp.inv(n, d, 10, jsonb_build_array(pg_temp.line('A1', 2, 5))), '000003');
  perform public.ebill_save_invoice(pg_temp.inv(n, d, 10, jsonb_build_array(pg_temp.line('A1', 2, 5))), '000004');
  perform public.ebill_save_invoice(pg_temp.inv(n, d, 10, jsonb_build_array(pg_temp.line('A1', 2, 5))), '000005');
  perform pg_temp.ok((public.ebill_save_invoice(pg_temp.inv(n, d, 10, jsonb_build_array(pg_temp.line('A1', 2, 5))), '482913') ->> 'code') = 'locked', 'after 5 wrong PINs even the right PIN is locked out');
  perform pg_temp.back();
  update public.ebill_pins set locked_until = null, failed_count = 0;

  -- someone with no PIN set
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  perform pg_temp.ok((public.ebill_save_invoice(pg_temp.inv(gen_random_uuid(), d, 10, jsonb_build_array(pg_temp.line('A1', 2, 5))), '482913') ->> 'code') = 'no_pin', 'a person the owner has not given a PIN cannot save');
  perform pg_temp.back();
  perform pg_temp.ok(not exists (select 1 from public.ebill_invoices where invoice_id = n), 'nothing was saved by any refused attempt');
end $t$;

do $t$ declare r jsonb; d uuid := '20000000-0000-0000-0000-000000000001'; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  -- validation
  perform pg_temp.ok((public.ebill_save_invoice(pg_temp.inv(gen_random_uuid(), d, 10, '[]'::jsonb), '482913') ->> 'code') = 'invalid', 'no lines is invalid');
  perform pg_temp.ok((public.ebill_save_invoice(pg_temp.inv(gen_random_uuid(), d, 10, jsonb_build_array(pg_temp.line('A1', 0, 5))), '482913') ->> 'code') = 'invalid', 'a zero quantity is invalid');
  perform pg_temp.ok((public.ebill_save_invoice(pg_temp.inv(gen_random_uuid(), d, 10, jsonb_build_array(pg_temp.line('A1', 2, -5))), '482913') ->> 'code') = 'invalid', 'a negative rate is invalid');
  perform pg_temp.ok((public.ebill_save_invoice('{"x":1}'::jsonb, '482913') ->> 'code') = 'invalid', 'garbage is invalid, not an error');
  perform pg_temp.ok((public.ebill_save_invoice(pg_temp.inv(gen_random_uuid(), d, 10, jsonb_build_array(pg_temp.line('A1', 2, 5)), '{"payment_mode":"Bitcoin"}'), '482913') ->> 'code') = 'invalid', 'an unknown payment mode is invalid');
  perform pg_temp.ok((public.ebill_save_invoice(pg_temp.inv(gen_random_uuid(), d, 10, jsonb_build_array(pg_temp.line('A1', 2, 5)), '{"device_id":"not-a-uuid"}'), '482913') ->> 'code') = 'invalid', 'a malformed id is invalid');
  -- the server recomputes: a client total that disagrees is refused
  r := public.ebill_save_invoice(pg_temp.inv(gen_random_uuid(), d, 1, jsonb_build_array(pg_temp.line('A1', 2, 5))), '482913');
  perform pg_temp.ok((r ->> 'code') = 'total_mismatch' and (r ->> 'server_net_total')::numeric = 10, 'a client total that disagrees with the items is refused');
  -- unknown and deactivated devices
  perform pg_temp.ok((public.ebill_save_invoice(pg_temp.inv(gen_random_uuid(), gen_random_uuid(), 10, jsonb_build_array(pg_temp.line('A1', 2, 5))), '482913') ->> 'code') = 'device_unknown', 'an unregistered device cannot upload');
  perform pg_temp.back();
  update public.ebill_devices set status = 'deactivated';
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  perform pg_temp.ok((public.ebill_save_invoice(pg_temp.inv(gen_random_uuid(), d, 10, jsonb_build_array(pg_temp.line('A1', 2, 5))), '482913') ->> 'code') = 'device_inactive', 'a deactivated device cannot upload');
  perform pg_temp.back();
  update public.ebill_devices set status = 'active';
end $t$;

-- full pipeline maths: line %, customer %, receipt amount, tax, adjustment (same worked example as the JS tests)
do $t$ declare r jsonb; d uuid := '20000000-0000-0000-0000-000000000001'; id2 uuid := gen_random_uuid(); begin
  insert into public.ebill_staff_limits(user_id, max_discount_pct, max_discount_amount) values ('00000000-0000-0000-0000-0000000000b1', 40, 1000);
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  r := public.ebill_save_invoice(pg_temp.inv(id2, d, 209.5,
    jsonb_build_array(pg_temp.line('A1', 2, 100, 'pct', 10), pg_temp.line('B2', 1, 50)),
    '{"customer_discount_pct":10,"receipt_discount":{"mode":"amt","value":7},"tax_pct":5,"adjustment":-0.5,"cash_received":300}'), '482913');
  perform pg_temp.ok((r ->> 'code') = 'saved' and (r ->> 'net_total')::numeric = 209.5, 'the server reaches the same net total as the screen: 209.50');
  perform pg_temp.back();
  perform pg_temp.ok((select gross_total = 230 and line_discounts = 20 and customer_discount = 23 and receipt_discount = 7 and net_gross = 200 and tax = 10 and adjustment = -0.5 and cash_received = 300 from public.ebill_invoices where invoice_id = id2), 'every intermediate figure matches');
  perform pg_temp.ok((select stock_flag from public.ebill_invoice_lines where invoice_id = id2 and code = 'A1') = 'ok', 'a line the server can cover is flagged ok');
  perform pg_temp.ok((select stock_flag = 'none' from public.ebill_invoice_lines where invoice_id = id2 and code = 'B2'), 'a line with no server stock is flagged none but the invoice is still saved');
end $t$;

-- discount limits: shop default 10% / Rs 1000 for staff with no row of their own
do $t$ declare r jsonb; d uuid := '20000000-0000-0000-0000-000000000001'; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
  r := public.ebill_save_invoice(pg_temp.inv(gen_random_uuid(), d, 80, jsonb_build_array(pg_temp.line('A1', 1, 100, 'pct', 20))), '739150');
  perform pg_temp.ok((r ->> 'code') = 'discount_limit' and (r ->> 'max_pct')::numeric = 10, '20% is refused against the shop default of 10%');
  r := public.ebill_save_invoice(pg_temp.inv(gen_random_uuid(), d, 90, jsonb_build_array(pg_temp.line('A1', 1, 100, 'pct', 10))), '739150');
  perform pg_temp.ok((r ->> 'code') = 'saved', 'exactly 10% is allowed');
  r := public.ebill_save_invoice(pg_temp.inv(gen_random_uuid(), d, 18800, jsonb_build_array(pg_temp.line('A1', 1, 20000, 'amt', 1200))), '739150');
  perform pg_temp.ok((r ->> 'code') = 'discount_limit', 'Rs 1,200 is refused against the Rs 1,000 amount limit even though it is only 6%');
  -- discounts from every source count together
  r := public.ebill_save_invoice(pg_temp.inv(gen_random_uuid(), d, 81, jsonb_build_array(pg_temp.line('A1', 1, 100, 'pct', 10)), '{"customer_discount_pct":10}'), '739150');
  perform pg_temp.ok((r ->> 'code') = 'discount_limit', 'line + customer discounts are added up (19%)');
  perform pg_temp.back();

  -- a manager raises one person's limit
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  perform public.ebill_set_limits('00000000-0000-0000-0000-0000000000b2', 30, 5000, 'senior cashier');
  perform pg_temp.back();
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
  r := public.ebill_save_invoice(pg_temp.inv(gen_random_uuid(), d, 80, jsonb_build_array(pg_temp.line('A1', 1, 100, 'pct', 20))), '739150');
  perform pg_temp.ok((r ->> 'code') = 'saved', 'after the manager raises the limit, 20% is allowed');
  perform pg_temp.back();

  -- the override right lifts the limits (owner, with MFA)
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'aal2');
  perform public.ebill_set_pin('00000000-0000-0000-0000-0000000000a1', '620481');
  r := public.ebill_save_invoice(pg_temp.inv(gen_random_uuid(), d, 50, jsonb_build_array(pg_temp.line('A1', 1, 100, 'pct', 50))), '620481');
  perform pg_temp.ok((r ->> 'code') = 'saved', 'someone with ebill.discount_override may exceed the limit');
  perform pg_temp.back();
  perform pg_temp.ok((select count(*) from public.ebill_invoices where staff_user = '00000000-0000-0000-0000-0000000000b2') = 2, 'only the two allowed invoices from the second cashier exist');
end $t$;

-- the setting can switch the PIN off (owner decision), and a future device clock cannot move the business date
do $t$ declare r jsonb; d uuid := '20000000-0000-0000-0000-000000000001'; x uuid := gen_random_uuid(); begin
  update public.settings set value = 'false' where key = 'ebill.pin_required';
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  r := public.ebill_save_invoice(pg_temp.inv(x, d, 10, jsonb_build_array(pg_temp.line('A1', 2, 5)), jsonb_build_object('client_created_at', now() + interval '30 days')), null);
  perform pg_temp.ok((r ->> 'code') = 'saved', 'with the PIN requirement off, no PIN is needed');
  perform pg_temp.back();
  perform pg_temp.ok((select business_date = (now() at time zone 'Asia/Karachi')::date + case when (now() + interval '5 minutes') at time zone 'Asia/Karachi' >= date_trunc('day', now() at time zone 'Asia/Karachi') + interval '1 day' then 1 else 0 end from public.ebill_invoices where invoice_id = x), 'a clock 30 days ahead is capped at about now');
end $t$;


rollback;
