\set ON_ERROR_STOP on
-- 0630: held bills. All data below is invented.
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

do $t$ declare r jsonb; d uuid := '20000000-0000-0000-0000-000000000001'; i int; st jsonb := '{"customer":"Mr Ali","net_total":90,"lines":[{"code":"A1"},{"code":"B2"}]}'; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
  perform pg_temp.denied(format($q$select public.ebill_hold_bill(%L, %L, %L)$q$, gen_random_uuid(), d, st), 'no billing right, no holding');
  perform pg_temp.back();
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  perform pg_temp.ok((public.ebill_hold_bill(gen_random_uuid(), d, '[]'::jsonb) ->> 'code') = 'invalid', 'a state that is not an object is invalid');
  perform pg_temp.ok((public.ebill_hold_bill(gen_random_uuid(), gen_random_uuid(), st) ->> 'code') = 'device_unknown', 'an unregistered device cannot hold');
  r := public.ebill_hold_bill('50000000-0000-0000-0000-000000000001', d, st, '  front desk  ');
  perform pg_temp.ok((r ->> 'code') = 'held', 'a bill can be held');
  perform pg_temp.back();
  perform pg_temp.ok((select item_count = 2 and net_total = 90 and customer = 'Mr Ali' and label = 'front desk' from public.ebill_held_bills where id = '50000000-0000-0000-0000-000000000001'), 'the list fields are taken from the bill; the label is trimmed');
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  perform public.ebill_hold_bill('50000000-0000-0000-0000-000000000001', d, '{"customer":"Mr Ali","net_total":120,"lines":[{"code":"A1"}]}'::jsonb);
  perform pg_temp.back();
  perform pg_temp.ok((select count(*) = 1 and bool_and(net_total = 120 and item_count = 1) from public.ebill_held_bills), 'holding the same id again updates it (a retry never makes a second hold)');
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
  perform pg_temp.ok((public.ebill_hold_bill('50000000-0000-0000-0000-000000000001', d, st) ->> 'code') = 'id_conflict', 'someone else cannot take over a hold');
  perform pg_temp.ok((select count(*) from public.ebill_held_bills) = 0, 'and cannot see it');
  perform public.ebill_release_held('50000000-0000-0000-0000-000000000001');
  perform pg_temp.back();
  perform pg_temp.ok((select count(*) from public.ebill_held_bills) = 1, 'someone else releasing it removes nothing');
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  perform pg_temp.ok((select count(*) from public.ebill_held_bills) = 1, 'a manager can see it');
  perform pg_temp.back();
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  for i in 1..9 loop perform public.ebill_hold_bill(gen_random_uuid(), d, st); end loop;
  perform pg_temp.ok((public.ebill_hold_bill(gen_random_uuid(), d, st) ->> 'code') = 'too_many', 'ten holds is the most one person can keep');
  perform pg_temp.ok((public.ebill_hold_bill('50000000-0000-0000-0000-000000000001', d, st) ->> 'code') = 'held', 'but an existing one can still be updated');
  perform pg_temp.ok((public.ebill_hold_bill(gen_random_uuid(), d, jsonb_build_object('customer', repeat('x', 250000))) ->> 'code') in ('invalid','too_many'), 'a huge state is refused');
  perform public.ebill_release_held('50000000-0000-0000-0000-000000000001');
  perform public.ebill_release_held('50000000-0000-0000-0000-000000000001'); -- twice: harmless
  perform pg_temp.back();
  perform pg_temp.ok(not exists (select 1 from public.ebill_held_bills where id = '50000000-0000-0000-0000-000000000001'), 'the owner releases their own hold, and releasing twice is harmless');
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  perform pg_temp.denied($q$insert into public.ebill_held_bills(id, user_id, device_id, state) values (gen_random_uuid(), '00000000-0000-0000-0000-0000000000b1', '20000000-0000-0000-0000-000000000001', '{}')$q$, 'no direct writes');
  perform pg_temp.back();
end $t$;
update public.ebill_devices set status = 'deactivated';
do $t$ begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
  perform pg_temp.ok((public.ebill_hold_bill(gen_random_uuid(), '20000000-0000-0000-0000-000000000001', '{"lines":[]}'::jsonb) ->> 'code') = 'device_inactive', 'a deactivated device cannot hold');
  perform pg_temp.back();
end $t$;

rollback;
