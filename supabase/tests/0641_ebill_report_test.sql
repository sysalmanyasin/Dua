\set ON_ERROR_STOP on
-- 0641: date-wise report behind the exports. All data below is invented.
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
create function pg_temp.inv(p_id uuid, p_no text, p_user uuid, p_name text, p_mode text, p_net numeric, p_date date, p_disc numeric default 0) returns void language plpgsql as $$
begin
  insert into public.ebill_invoices(invoice_id, invoice_no, business_date, device_id, staff_user, staff_name, customer, payment_mode, gross_total, line_discounts, net_gross, net_total, client_created_at)
  values (p_id, p_no, p_date, '20000000-0000-0000-0000-000000000001', p_user, p_name, 'Cust ' || p_no, p_mode, p_net + p_disc, p_disc, p_net, p_net, p_date::timestamptz + interval '10 hours');
  insert into public.ebill_invoice_lines(invoice_id, line_no, code, name, unit, qty, rate, discount_mode, line_total) values (p_id, 1, 'A1', 'Item', 'unit', 2, (p_net + p_disc) / 2, 'amt', p_net);
end $$;
select pg_temp.inv('30000000-0000-0000-0000-000000000001','EB-1','00000000-0000-0000-0000-0000000000b1','J One','Cash',100, date '2026-11-10', 10);
select pg_temp.inv('30000000-0000-0000-0000-000000000002','EB-2','00000000-0000-0000-0000-0000000000b1','J One','Card',50, date '2026-11-10');
select pg_temp.inv('30000000-0000-0000-0000-000000000003','EB-3','00000000-0000-0000-0000-0000000000b2','J Two','Cash',200, date '2026-11-11');
select pg_temp.inv('30000000-0000-0000-0000-000000000004','EB-4','00000000-0000-0000-0000-0000000000b2','J Two','Credit',80, date '2026-11-13');
insert into public.user_permissions(user_id, perm_key, effect) values ('00000000-0000-0000-0000-0000000000b2','ebill.export','grant');
do $t$ declare r jsonb; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  perform pg_temp.denied($q$select public.ebill_report(date '2026-11-01', date '2026-11-30')$q$, 'staff without the export right are refused by the server');
  perform pg_temp.back();

  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  perform pg_temp.denied($q$select public.ebill_report(null, date '2026-11-30')$q$, 'a range is required');
  perform pg_temp.denied($q$select public.ebill_report(date '2026-11-30', date '2026-11-01')$q$, 'a reversed range is refused');
  perform pg_temp.denied($q$select public.ebill_report(date '2025-01-01', date '2026-11-30')$q$, 'a range over 400 days is refused');
  r := public.ebill_report(date '2026-11-01', date '2026-11-30');
  perform pg_temp.ok((r #>> '{totals,count}')::int = 4 and (r #>> '{totals,net}')::numeric = 430 and (r #>> '{totals,gross}')::numeric = 440 and (r #>> '{totals,discounts}')::numeric = 10, 'a manager gets every invoice, with totals');
  perform pg_temp.ok(jsonb_array_length(r -> 'days') = 3 and (r #>> '{days,0,date}') = '2026-11-10' and (r #>> '{days,0,count}')::int = 2 and (r #>> '{days,0,net}')::numeric = 150, 'date-wise: days in order with their counts and totals (no empty days)');
  perform pg_temp.ok((r #>> '{days,0,by_mode,Cash}')::numeric = 100 and (r #>> '{days,0,by_mode,Card}')::numeric = 50 and (r #>> '{days,2,by_mode,Credit}')::numeric = 80, 'and the split by payment mode');
  perform pg_temp.ok((select (e ->> 'invoice_no') from jsonb_array_elements(r -> 'rows') e limit 1) = 'EB-1' and jsonb_array_length(r -> 'rows') = 4 and not (r ->> 'truncated')::boolean, 'every invoice, oldest first, not truncated');
  perform pg_temp.ok((public.ebill_report(date '2026-11-01', date '2026-11-30', null, null, 'Cash') #>> '{totals,count}')::int = 2, 'filter: payment mode');
  perform pg_temp.ok((public.ebill_report(date '2026-11-01', date '2026-11-30', 'j two') #>> '{totals,count}')::int = 2, 'filter: search');
  perform pg_temp.ok((public.ebill_report(date '2026-11-11', date '2026-11-12') #>> '{totals,count}')::int = 1, 'filter: dates');
  r := public.ebill_report(date '2026-11-01', date '2026-11-30', null, null, null, 2);
  perform pg_temp.ok((r ->> 'truncated')::boolean and jsonb_array_length(r -> 'rows') = 2 and (r ->> 'total_invoices')::int = 4 and (r #>> '{totals,count}')::int = 4, 'a cap is reported as truncated, while the totals still cover everything');

  -- refunds are netted off
  perform public.ebill_refund_lines('30000000-0000-0000-0000-000000000001', '[{"line_no":1,"qty":1}]', 'half back');
  perform public.ebill_refund_invoice('30000000-0000-0000-0000-000000000002', 'all back');
  r := public.ebill_report(date '2026-11-01', date '2026-11-30');
  perform pg_temp.ok((r #>> '{totals,refunded}')::numeric = 100 and (r #>> '{totals,net_after_refunds}')::numeric = 330, 'totals net of refunds: 50 + 50 refunded, 330 left');
  perform pg_temp.ok((r #>> '{days,0,net_after_refunds}')::numeric = 50 and (r #>> '{days,0,by_mode,Cash}')::numeric = 50 and (r #>> '{days,0,by_mode,Card}')::numeric = 0, 'and per day and mode');
  perform pg_temp.ok((public.ebill_report(date '2026-11-01', date '2026-11-30', null, 'partially_refunded') #>> '{totals,count}')::int = 1, 'filter: status');
  perform pg_temp.back();

  perform pg_temp.ok(exists (select 1 from public.activity_log where action = 'ebill.report_run' and (new_value ->> 'invoices')::int = 4), 'running a report is logged with how many invoices it covered');

  -- someone with only the export right sees only their own invoices (the same visibility as History)
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
  r := public.ebill_report(date '2026-11-01', date '2026-11-30');
  perform pg_temp.ok((r #>> '{totals,count}')::int = 2 and (r #>> '{totals,net}')::numeric = 280, 'the export right alone gives their own invoices, not everyone''s');
  perform pg_temp.back();
end $t$;

rollback;
