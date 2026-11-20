\set ON_ERROR_STOP on
-- 0633: refunds by item and quantity. All data below is invented.
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

insert into public.ebill_devices(device_id, label, registered_by) values ('20000000-0000-0000-0000-000000000001','Counter 1','00000000-0000-0000-0000-0000000000b1');
-- A: 3 lines of Rs 100 each (qty 3, 2, 1), 10% customer discount, 5% tax: net 283.50
insert into public.ebill_invoices(invoice_id, invoice_no, business_date, device_id, staff_user, staff_name, customer, payment_mode, gross_total, customer_discount_pct, customer_discount, net_gross, tax_pct, tax, net_total, client_created_at)
  values ('30000000-0000-0000-0000-00000000000a','EB-A', current_date, '20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000b1','J One','Mr Ali','Cash',300,10,30,270,5,13.5,283.50,now());
insert into public.ebill_invoice_lines(invoice_id, line_no, code, name, unit, qty, rate, discount_mode, line_total) values
  ('30000000-0000-0000-0000-00000000000a',1,'A1','Tablet','unit',3,33.33,'amt',100), ('30000000-0000-0000-0000-00000000000a',2,'B2','Syrup','unit',2,50,'amt',100), ('30000000-0000-0000-0000-00000000000a',3,'C3','Cream','unit',1,100,'amt',100);
-- B: awkward rounding: three lines 33.33 + 33.33 + 33.34 = 100.00
insert into public.ebill_invoices(invoice_id, invoice_no, business_date, device_id, staff_user, staff_name, payment_mode, gross_total, net_gross, net_total, client_created_at)
  values ('30000000-0000-0000-0000-00000000000b','EB-B', current_date, '20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000b2','J Two','Cash',100,100,100,now());
insert into public.ebill_invoice_lines(invoice_id, line_no, code, name, unit, qty, rate, discount_mode, line_total) values
  ('30000000-0000-0000-0000-00000000000b',1,'X1','One','unit',1,33.33,'amt',33.33), ('30000000-0000-0000-0000-00000000000b',2,'X2','Two','unit',1,33.33,'amt',33.33), ('30000000-0000-0000-0000-00000000000b',3,'X3','Three','unit',1,33.34,'amt',33.34);
-- C: an old-style full refund (Phase 4: no lines recorded)
insert into public.ebill_invoices(invoice_id, invoice_no, business_date, device_id, staff_user, staff_name, payment_mode, gross_total, net_gross, net_total, client_created_at)
  values ('30000000-0000-0000-0000-00000000000c','EB-C', current_date, '20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000b1','J One','Cash',40,40,40,now());
insert into public.ebill_invoice_lines(invoice_id, line_no, code, name, unit, qty, rate, discount_mode, line_total) values ('30000000-0000-0000-0000-00000000000c',1,'Z1','Old','unit',2,20,'amt',40);
insert into public.ebill_invoice_events(invoice_id, kind, reason, amount, created_by, created_by_name) values ('30000000-0000-0000-0000-00000000000c','refund','old full refund',40,'00000000-0000-0000-0000-0000000000c1','S One');

do $t$ declare r jsonb; a uuid := '30000000-0000-0000-0000-00000000000a'; b uuid := '30000000-0000-0000-0000-00000000000b'; c uuid := '30000000-0000-0000-0000-00000000000c'; q1 uuid := gen_random_uuid(); begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  perform pg_temp.denied(format($q$select public.ebill_refund_lines(%L, '[{"line_no":1,"qty":1}]', 'returned')$q$, a), 'staff cannot refund by line');
  perform pg_temp.back();

  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  perform pg_temp.denied(format($q$select public.ebill_refund_lines(%L, '[{"line_no":1,"qty":1}]', ' ')$q$, a), 'a reason is required');
  perform pg_temp.ok((public.ebill_refund_lines(gen_random_uuid(), '[{"line_no":1,"qty":1}]', 'x y z') ->> 'code') = 'not_found', 'an unknown invoice is not_found');
  perform pg_temp.ok((public.ebill_refund_lines(a, '[]', 'nothing') ->> 'code') = 'invalid', 'an empty selection is invalid');
  perform pg_temp.ok((public.ebill_refund_lines(a, '[{"line_no":1,"qty":0}]', 'zero') ->> 'code') = 'invalid', 'a zero quantity is invalid');
  perform pg_temp.ok((public.ebill_refund_lines(a, '[{"line_no":1,"qty":-1}]', 'neg') ->> 'code') = 'invalid', 'a negative quantity is invalid');
  perform pg_temp.ok((public.ebill_refund_lines(a, '[{"line_no":9,"qty":1}]', 'nope') ->> 'code') = 'invalid', 'a line that is not on the invoice is invalid');
  perform pg_temp.ok((public.ebill_refund_lines(a, '[{"line_no":1,"qty":4}]', 'too many') ->> 'code') = 'too_much', 'more than was sold is refused');
  perform pg_temp.ok((public.ebill_refund_lines(a, '[{"line_no":1,"qty":2},{"line_no":1,"qty":2}]', 'twice') ->> 'code') = 'too_much', 'the same line listed twice is added up, then refused');
  perform pg_temp.ok((select count(*) from public.ebill_invoice_events where invoice_id = a) = 0, 'nothing was recorded by any refused attempt');

  -- first partial refund: 1 of 3 of line 1 = 33.333 of 300 -> share of 283.50 = 31.50
  r := public.ebill_refund_lines(a, '[{"line_no":1,"qty":1}]', 'one tablet strip returned', q1);
  perform pg_temp.ok((r ->> 'code') = 'partially_refunded' and (r ->> 'amount')::numeric = 31.50 and (r ->> 'remaining_amount')::numeric = 252.00, 'a partial refund returns its share of the net total (discount and tax in proportion): 31.50');
  -- the same attempt again (a lost reply): reported, not repeated
  r := public.ebill_refund_lines(a, '[{"line_no":1,"qty":1}]', 'one tablet strip returned', q1);
  perform pg_temp.ok((r ->> 'code') = 'duplicate' and (r ->> 'amount')::numeric = 31.50, 'a retry with the same request id changes nothing');
  perform pg_temp.ok((select count(*) = 1 from public.ebill_invoice_events where invoice_id = a and kind = 'refund'), 'still one refund event');

  -- second: 1 of 2 of line 2 (+50): cumulative 83.333/300 -> 78.75; this one = 47.25
  r := public.ebill_refund_lines(a, '[{"line_no":2,"qty":1}]', 'one syrup returned');
  perform pg_temp.ok((r ->> 'code') = 'partially_refunded' and (r ->> 'amount')::numeric = 47.25 and (r ->> 'refunded_total')::numeric = 78.75, 'a second partial refund: 47.25, 78.75 in all');
  perform pg_temp.ok((public.ebill_refund_lines(a, '[{"line_no":1,"qty":3}]', 'too many now') ->> 'code') = 'too_much', 'what was already refunded cannot be refunded again');
  perform pg_temp.ok((public.ebill_correct_invoice(a, '{"customer":"Mr Ali Khan"}', 'name') ->> 'code') = 'corrected', 'a partly refunded invoice can still be corrected');

  -- the rest: the final refund returns exactly what is left
  r := public.ebill_refund_invoice(a, 'everything else returned');
  perform pg_temp.ok((r ->> 'code') = 'refunded' and (r ->> 'amount')::numeric = 204.75 and (r ->> 'remaining_amount')::numeric = 0, 'refunding the rest returns exactly what is left: 204.75');
  perform pg_temp.ok((select sum(amount) = 283.50 from public.ebill_invoice_events where invoice_id = a and kind = 'refund'), 'all the refunds add up to the net total exactly');
  perform pg_temp.ok((public.ebill_refund_invoice(a, 'again') ->> 'code') = 'already_refunded', 'nothing left: already_refunded');
  perform pg_temp.ok((public.ebill_refund_lines(a, '[{"line_no":3,"qty":1}]', 'again') ->> 'code') = 'too_much', 'and by line: too_much');
  perform pg_temp.ok((public.ebill_correct_invoice(a, '{"customer":"X"}', 'late') ->> 'code') = 'refunded', 'a fully refunded invoice cannot be corrected');
  perform pg_temp.back();

  -- awkward rounding: three separate refunds still add up to exactly 100.00
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  perform public.ebill_refund_lines(b, '[{"line_no":1,"qty":1}]', 'first third');
  perform public.ebill_refund_lines(b, '[{"line_no":2,"qty":1}]', 'second third');
  r := public.ebill_refund_lines(b, '[{"line_no":3,"qty":1}]', 'last third');
  perform pg_temp.ok((r ->> 'code') = 'refunded', 'the last item makes it fully refunded');
  perform pg_temp.back();
  perform pg_temp.ok((select sum(amount) = 100.00 and count(*) = 3 from public.ebill_invoice_events where invoice_id = b and kind = 'refund'), 'three refunds of awkward thirds add up to exactly 100.00');

  -- an old-style refund without lines counts as everything
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  perform pg_temp.ok((public.ebill_refund_lines(c, '[{"line_no":1,"qty":1}]', 'again') ->> 'code') = 'too_much', 'a Phase 4 full refund leaves nothing to refund');
  perform pg_temp.ok((public.ebill_refund_invoice(c, 'again') ->> 'code') = 'already_refunded', 'and refunding it again is harmless');
  perform pg_temp.back();

  perform pg_temp.ok((select count(*) = 3 from public.activity_log where action = 'ebill.invoice_refunded' and entity_id = a::text), 'each of the three refunds of invoice A is in the audit log (the retry is not)');
end $t$;

-- a partly refunded invoice in history and detail
do $t$ declare r jsonb; d uuid := '30000000-0000-0000-0000-0000000000d0'; begin
  insert into public.ebill_invoices(invoice_id, invoice_no, business_date, device_id, staff_user, staff_name, payment_mode, gross_total, net_gross, net_total, client_created_at)
    values (d,'EB-D', current_date, '20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000b1','J One','Cash',200,200,200,now());
  insert into public.ebill_invoice_lines(invoice_id, line_no, code, name, unit, qty, rate, discount_mode, line_total) values (d,1,'P1','Pack','unit',4,50,'amt',200);
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  perform public.ebill_refund_lines(d, '[{"line_no":1,"qty":1}]', 'one back');
  r := public.ebill_history(null, null, 'EB-D');
  perform pg_temp.ok((r #>> '{rows,0,status}') = 'partially_refunded' and (r #>> '{rows,0,refunded_amount}')::numeric = 50, 'history says partially_refunded and how much');
  perform pg_temp.ok((r ->> 'sum_net')::numeric = 150 and (r ->> 'sum_refunded')::numeric = 50, 'the net total in history is net of refunds');
  perform pg_temp.ok((public.ebill_history(null, null, null, 'partially_refunded') ->> 'total')::int = 1, 'status filter: partially_refunded');
  perform pg_temp.ok((public.ebill_history(null, null, null, 'refunded') ->> 'total')::int = 3, 'status filter: refunded finds the three fully refunded invoices (A, B, C) and not the partly refunded D');
  r := public.ebill_invoice_detail(d);
  perform pg_temp.ok((r #>> '{lines,0,refunded}')::numeric = 1 and (r #>> '{lines,0,remaining}')::numeric = 3 and (r #>> '{invoice,remaining_amount}')::numeric = 150, 'detail shows refunded and remaining per line, and the amount left');
  perform pg_temp.ok((r #>> '{events,0,lines,0,qty}')::numeric = 1, 'and which lines each refund took');
  perform pg_temp.back();
end $t$;

rollback;
