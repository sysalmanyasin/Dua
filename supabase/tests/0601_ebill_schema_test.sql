\set ON_ERROR_STOP on
-- 0601: Emergency Billing permissions, settings, tables, immutability and read access. All data below is invented.
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

do $t$ begin
  perform pg_temp.ok((select count(*) from public.permissions where key in ('ebill.use','ebill.history_all','ebill.manage','ebill.discount_override','ebill.set_pin')) = 5, 'the five original ebill permissions are seeded');
    perform pg_temp.ok(not exists (select 1 from public.role_permissions where perm_key like 'ebill.%'), 'no role preset carries any ebill right (the owner grants them per person)');
  perform pg_temp.ok((select count(*) from public.settings where key in ('ebill.max_discount_pct','ebill.max_discount_amount','ebill.pin_required')) = 3, 'settings defaults exist');
  perform pg_temp.ok((select bool_and(relrowsecurity) from pg_class where relname in ('ebill_devices','ebill_invoices','ebill_invoice_lines','ebill_pins','ebill_staff_limits')), 'RLS is on for every ebill table');
end $t$;

-- one invoice written as the table owner (the save function is tested in 0611)
insert into public.ebill_devices(device_id, registered_by) values ('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000b1');
insert into public.ebill_invoices(invoice_id, invoice_no, business_date, device_id, staff_user, staff_name, payment_mode, gross_total, net_gross, net_total, client_created_at)
  values ('30000000-0000-0000-0000-000000000001','EB-T-1', current_date, '20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000b1','J One','Cash',10,10,10,now());
insert into public.ebill_invoice_lines(invoice_id, line_no, code, name, unit, qty, rate, discount_mode, line_total)
  values ('30000000-0000-0000-0000-000000000001',1,'A1','Item','unit',1,10,'pct',10);

do $t$ begin
  perform pg_temp.denied($q$update public.ebill_invoices set net_total = 1$q$, 'a posted invoice cannot be updated, even by the owner of the table');
  perform pg_temp.denied($q$delete from public.ebill_invoices$q$, 'a posted invoice cannot be deleted');
  perform pg_temp.denied($q$truncate public.ebill_invoices cascade$q$, 'invoices cannot be truncated');
  perform pg_temp.denied($q$update public.ebill_invoice_lines set qty = 9$q$, 'a line cannot be updated');
  perform pg_temp.denied($q$delete from public.ebill_invoice_lines$q$, 'a line cannot be deleted');
  perform pg_temp.denied($q$truncate public.ebill_invoice_lines$q$, 'lines cannot be truncated');
end $t$;

do $t$ begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  perform pg_temp.ok((select count(*) from public.ebill_invoices) = 1, 'the author sees their own invoice');
  perform pg_temp.ok((select count(*) from public.ebill_invoice_lines) = 1, 'and its lines');
  perform pg_temp.denied($q$insert into public.ebill_invoices(invoice_id) values (gen_random_uuid())$q$, 'staff cannot insert an invoice directly');
  perform pg_temp.denied($q$insert into public.ebill_devices(device_id, registered_by) values (gen_random_uuid(),'00000000-0000-0000-0000-0000000000b1')$q$, 'staff cannot insert a device directly');
  perform pg_temp.denied($q$select * from public.ebill_pins$q$, 'nobody can read PIN hashes');
  perform pg_temp.ok((select count(*) from public.ebill_devices) = 0, 'staff do not see the device list');
  perform pg_temp.back();
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
  perform pg_temp.ok((select count(*) from public.ebill_invoices) = 0, 'another staff member sees none of it');
  perform pg_temp.ok((select count(*) from public.ebill_invoice_lines) = 0, 'nor its lines');
  perform pg_temp.back();
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  perform pg_temp.ok((select count(*) from public.ebill_invoices) = 1, 'a manager sees every invoice');
  perform pg_temp.ok((select count(*) from public.ebill_devices) = 1, 'and the device list');
  perform pg_temp.back();
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
  perform pg_temp.ok((select count(*) from public.ebill_invoices) = 0, 'a user with no profile sees nothing');
  perform pg_temp.back();
  set local role anon;
  perform pg_temp.denied($q$select * from public.ebill_invoices$q$, 'anon cannot read invoices');
  perform pg_temp.back();
end $t$;

rollback;
