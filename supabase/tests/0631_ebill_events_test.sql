\set ON_ERROR_STOP on
-- 0631: refunds and corrections. All data below is invented.
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
create function pg_temp.mk(p_id uuid, p_no text, p_user uuid, p_name text, p_cust text, p_mode text, p_net numeric, p_date date default current_date, p_disc numeric default 0) returns void language plpgsql as $$
begin
  insert into public.ebill_invoices(invoice_id, invoice_no, business_date, device_id, staff_user, staff_name, customer, payment_mode, gross_total, line_discounts, net_gross, net_total, client_created_at)
  values (p_id, p_no, p_date, '20000000-0000-0000-0000-000000000001', p_user, p_name, p_cust, p_mode, p_net + p_disc, p_disc, p_net, p_net, p_date::timestamptz + interval '10 hours');
  insert into public.ebill_invoice_lines(invoice_id, line_no, code, name, unit, qty, rate, discount_mode, line_total) values (p_id, 1, 'A1', 'Item', 'unit', 1, p_net + p_disc, 'amt', p_net);
end $$;

select pg_temp.mk('30000000-0000-0000-0000-000000000001','EB-T-1','00000000-0000-0000-0000-0000000000b1','J One','Mr Ali','Cash',90);
select pg_temp.mk('30000000-0000-0000-0000-000000000002','EB-T-2','00000000-0000-0000-0000-0000000000b2','J Two','Mrs Khan','Card',50);
do $t$ declare r jsonb; a uuid := '30000000-0000-0000-0000-000000000001'; b uuid := '30000000-0000-0000-0000-000000000002'; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  perform pg_temp.denied(format($q$select public.ebill_refund_invoice(%L, 'customer returned it')$q$, a), 'staff cannot refund, not even their own');
  perform pg_temp.denied(format($q$select public.ebill_correct_invoice(%L, '{"customer":"X"}', 'typo')$q$, a), 'staff cannot correct');
  perform pg_temp.denied($q$insert into public.ebill_invoice_events(invoice_id, kind, reason, created_by, created_by_name) values ('30000000-0000-0000-0000-000000000001','refund','sneaky','00000000-0000-0000-0000-0000000000b1','x')$q$, 'staff cannot write an event directly');
  perform pg_temp.back();

  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  perform pg_temp.denied(format($q$select public.ebill_refund_invoice(%L, ' ')$q$, a), 'a refund needs a reason');
  perform pg_temp.denied(format($q$select public.ebill_correct_invoice(%L, '{"customer":"X"}', '')$q$, a), 'a correction needs a reason');
  perform pg_temp.ok((public.ebill_refund_invoice(gen_random_uuid(), 'no such invoice') ->> 'code') = 'not_found', 'an unknown invoice is not_found');

  -- corrections
  perform pg_temp.ok((public.ebill_correct_invoice(a, '{"net_total":1}', 'cheating') ->> 'code') = 'invalid', 'money fields can never be corrected in place');
  perform pg_temp.ok((public.ebill_correct_invoice(a, '{"payment_mode":"Bitcoin"}', 'oops') ->> 'code') = 'invalid', 'an unknown payment mode is refused');
  perform pg_temp.ok((public.ebill_correct_invoice(a, '{"customer":"Mr Ali"}', 'same again') ->> 'code') = 'no_change', 'a correction that changes nothing is refused');
  r := public.ebill_correct_invoice(a, '{"customer":"  Mr Ali Khan ","payment_mode":"Card"}', 'wrong name and tender');
  perform pg_temp.ok((r ->> 'code') = 'corrected' and (r #>> '{changes,customer,from}') = 'Mr Ali' and (r #>> '{changes,customer,to}') = 'Mr Ali Khan', 'a manager corrects customer and payment mode, recording from and to');
  perform public.ebill_correct_invoice(a, '{"customer":"Ali Khan"}', 'shorter');
  perform pg_temp.back();
  perform pg_temp.ok(public.ebill_effective(a, 'customer') = 'Ali Khan' and public.ebill_effective(a, 'payment_mode') = 'Card' and public.ebill_effective(a, 'comments') = '', 'the latest correction wins, uncorrected fields keep their value');
  perform pg_temp.ok((select customer = 'Mr Ali' and payment_mode = 'Cash' from public.ebill_invoices where invoice_id = a), 'the saved invoice itself is untouched');
  perform pg_temp.ok((select count(*) = 2 from public.ebill_invoice_events where invoice_id = a and kind = 'correction'), 'two correction events exist');

  -- refunds
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  r := public.ebill_refund_invoice(b, 'customer returned the goods');
  perform pg_temp.ok((r ->> 'code') = 'refunded' and (r ->> 'amount')::numeric = 50, 'a manager refunds the whole invoice');
  perform pg_temp.ok((public.ebill_refund_invoice(b, 'again') ->> 'code') = 'already_refunded', 'refunding twice is harmless');
  perform pg_temp.ok((public.ebill_correct_invoice(b, '{"customer":"X"}', 'too late') ->> 'code') = 'refunded', 'a refunded invoice cannot be corrected');
  perform pg_temp.back();
  perform pg_temp.ok((select count(*) = 1 and bool_and(amount = 50 and created_by_name = 'S One') from public.ebill_invoice_events where kind = 'refund'), 'exactly one refund event, with the amount and who did it');
  perform pg_temp.ok((select count(*) = 1 from public.activity_log where action = 'ebill.invoice_refunded' and reason = 'customer returned the goods'), 'the refund is in the audit log with its reason');
  perform pg_temp.ok((select count(*) = 2 from public.activity_log where action = 'ebill.invoice_corrected'), 'both corrections are in the audit log');

  -- append-only
  perform pg_temp.denied($q$update public.ebill_invoice_events set reason = 'edited'$q$, 'an event cannot be edited');
  perform pg_temp.denied($q$delete from public.ebill_invoice_events$q$, 'an event cannot be deleted');
  perform pg_temp.denied($q$truncate public.ebill_invoice_events$q$, 'events cannot be truncated');

  -- who can read events
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  perform pg_temp.ok((select count(*) from public.ebill_invoice_events) = 2, 'the author sees the events on their own invoice only');
  perform pg_temp.back();
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
  perform pg_temp.ok((select count(*) from public.ebill_invoice_events) = 1, 'the other author sees theirs');
  perform pg_temp.back();
end $t$;

rollback;
